// Ajustes: sección «Acerca de y actualizaciones» (1.2.2), enlaces antiguos y buscador. `node --test ui/settings/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// registry.js importa i18n.js (que lleva JSX), así que se empaqueta con esbuild antes de probarlo.
const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(mkdtempSync(path.join(tmpdir(), 'edinot-registry-')), 'registry.mjs');
await build({
  entryPoints: [path.join(here, 'registry.js')], outfile: outFile, bundle: true, format: 'esm', platform: 'node',
  loader: { '.js': 'jsx' }, jsx: 'automatic', logLevel: 'silent',
  inject: [path.join(here, '..', '..', 'build', 'shim.js')],   // el mismo `React` global que usa el build
  // store.js (Yjs + IndexedDB) no existe en Node: i18n.js solo lee de ahí el idioma, así que basta un stub.
  plugins: [{
    name: 'store-stub',
    setup(b) {
      b.onResolve({ filter: /(^|\/)store\.js$/ }, () => ({ path: 'store-stub', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export const ySettings = { get() {}, set() {}, observe() {}, unobserve() {}, toJSON() { return {}; } };', loader: 'js',
      }));
    },
  }],
});
const { SECTIONS, SECTION_IDS, ROWS, ROW_BY_ID, resolveTarget, searchSettings } = await import(pathToFileURL(outFile).href);

test('ocho secciones, sin grupo de IA, cuentas ni espacios', () => {
  assert.deepEqual(SECTION_IDS, ['general', 'appearance', 'shortcuts', 'vaults', 'sync', 'connections', 'meetings', 'about']);
  assert.deepEqual(SECTIONS.filter(s => s.group === 'footer').map(s => s.id), ['about']);
  for (const gone of ['profile', 'workspaces', 'agents', 'editor', 'language', 'calendar', 'integrations', 'advanced']) {
    assert.ok(!SECTION_IDS.includes(gone), `${gone} ya no es una sección`);
  }
  assert.ok(!ROWS.some(r => /^(profile|workspaces)\./.test(r.id)), 'sin filas de cuenta, plan ni equipo');
  assert.ok(!ROWS.some(r => ['agents.ambient', 'agents.aliases', 'agents.tags'].includes(r.id)), 'sin modo ambiental, agentes vistos ni etiquetas');
});

test('cada fila del buscador apunta a una sección que existe', () => {
  for (const r of ROWS) assert.ok(SECTION_IDS.includes(r.section), `${r.id} → ${r.section}`);
});

test('cada sección, grupo y fila del buscador tiene su texto en español e inglés', async () => {
  const { SETTINGS_STRINGS } = await import(pathToFileURL(path.join(here, '..', 'i18n-settings.js')).href);
  const { GROUPS } = await import(pathToFileURL(outFile).href);
  for (const lang of ['es', 'en']) {
    const d = SETTINGS_STRINGS[lang];
    for (const id of SECTION_IDS) {
      assert.ok(d[`st.sec.${id}`], `${lang}: falta el título de «${id}»`);
      assert.ok(d[`st.sec.${id}.d`], `${lang}: falta la descripción de «${id}»`);
      assert.ok(d[`st.sec.${id}`].length <= 24, `${lang}: «${d[`st.sec.${id}`]}» es largo y se parte en dos líneas en la barra`);
    }
    for (const g of GROUPS.filter(x => x.title)) assert.ok(d[g.title], `${lang}: falta el grupo ${g.title}`);
    for (const r of ROWS) assert.ok(d[`st.row.${r.id}`], `${lang}: falta la etiqueta de la fila ${r.id}`);
  }
});

test('las filas se reparten donde toca', () => {
  const sec = (id) => ROW_BY_ID[id].section;
  assert.equal(sec('editor.vim'), 'general');
  assert.equal(sec('language.lang'), 'general');
  assert.equal(sec('calendar.client'), 'connections');
  assert.equal(sec('integrations.mcp'), 'connections');
  assert.equal(sec('agents.policy'), 'connections');
  assert.equal(sec('advanced.logs'), 'about');
  assert.equal(sec('about.updates'), 'about');
  assert.equal(sec('sync.devices'), 'sync');
  assert.equal(sec('sync.addDevice'), 'sync');
  assert.equal(sec('sync.join'), 'sync');
  assert.equal(sec('meetings.sttServer'), 'meetings');
  assert.equal(sec('meetings.llmModel'), 'meetings');
});

test('los enlaces y pestañas antiguas llevan a la sección nueva', () => {
  const to = (tab) => resolveTarget(tab);
  assert.deepEqual(to('profile'), { section: 'sync', row: null });
  assert.deepEqual(to('workspaces'), { section: 'sync', row: null });
  assert.deepEqual(to('account'), { section: 'sync', row: null });
  assert.deepEqual(to('editor'), { section: 'general', row: null });
  assert.deepEqual(to('language'), { section: 'general', row: null });
  assert.deepEqual(to('advanced'), { section: 'about', row: null });
  assert.deepEqual(to('agents'), { section: 'connections', row: null });
  assert.deepEqual(to('integrations'), { section: 'connections', row: null });
  assert.deepEqual(to('calendar'), { section: 'connections', row: 'calendar.client' });
  assert.deepEqual(to('ai'), { section: 'connections', row: 'agents.policy' });
  assert.deepEqual(to('recall'), { section: 'connections', row: 'agents.recallKey' });
  assert.deepEqual(to('clipper'), { section: 'connections', row: 'integrations.clipper' });
  assert.deepEqual(to('sync'), { section: 'sync', row: null });
  assert.deepEqual(to('vaults'), { section: 'vaults', row: null });
  assert.deepEqual(to('profile:profile.account'), { section: 'sync', row: 'profile.account' });
  assert.equal(to('nada'), null);
});

test('los enlaces antiguos a actualizaciones llevan a about', () => {
  for (const tab of ['updates', 'advanced.updates', 'advanced:advanced.updates', 'about', 'about:about.updates']) {
    const r = resolveTarget(tab);
    assert.equal(r && r.section, 'about', tab);
  }
  assert.equal(resolveTarget('updates').row, 'about.updates');
  assert.equal(resolveTarget('advanced:advanced.updates').row, 'about.updates');
  assert.equal(resolveTarget('advanced.about').row, 'about.site');
});

test('buscar «actualizar», «update» o «versión» encuentra la sección about', () => {
  for (const w of ['actualizar', 'actualizaciones', 'update', 'updates', 'versión', 'version', 'descargar', 'reiniciar', 'instalar']) {
    const hits = searchSettings(w);
    assert.ok(hits.some(h => h.section === 'about' && h.id === 'about.updates'), `«${w}» debería llevar a about.updates: ${hits.map(h => h.id).join()}`);
  }
  assert.ok(searchSettings('versión').some(h => h.id === 'about.version'));
});

test('el buscador encuentra lo nuevo de sincronización y lo que cambió de sitio', () => {
  for (const [q, id] of [['emparejar', 'sync.addDevice'], ['código', 'sync.join'], ['dispositivos', 'sync.devices'], ['vim', 'editor.vim'],
                         ['idioma', 'language.lang'], ['google', 'calendar.account'], ['clipper', 'integrations.clipper']]) {
    assert.ok(searchSettings(q).some(h => h.id === id), `«${q}» debería encontrar ${id}`);
  }
});
