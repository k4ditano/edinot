// Plantilla «Gestor de tareas»: columnas, estados y vistas. `node --test editor/db/`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskManagerTemplate } from './templates.js';

// Misma expresión que usa editor.jsx para reconocer la directiva de una tabla.
const VIEW_DIRECTIVE_RE = /^[ \t]*<!--\s*edinot:view=([a-z]+)((?::[a-zA-Z]+=[^\s>:]+)*)\s*-->[ \t]*$/;
const clauses = (line) => {
  const m = VIEW_DIRECTIVE_RE.exec(line);
  assert.ok(m, 'la directiva debe cumplir la expresión de editor.jsx: ' + line);
  const out = {};
  for (const part of m[2].split(':').filter(Boolean)) { const i = part.indexOf('='); out[part.slice(0, i)] = part.slice(i + 1); }
  return { view: m[1], ...out };
};

for (const [lang, head, states, views] of [
  ['es', ['Tarea', 'Responsable', 'Prioridad', 'Progreso', 'Estado', 'Fecha límite'], ['Por hacer', 'En curso', 'Bloqueada', 'Hecha'], ['Tabla', 'Kanban']],
  ['en', ['Task', 'Owner', 'Priority', 'Progress', 'Status', 'Deadline'], ['To do', 'In progress', 'Blocked', 'Done'], ['Table', 'Kanban']],
]) {
  test(`plantilla ${lang}: tabla, tipos de columna y estados`, () => {
    const md = taskManagerTemplate(lang);
    const lines = md.split('\n');
    const di = lines.findIndex(l => l.includes('edinot:view='));
    assert.ok(di > 0);
    const c = clauses(lines[di]);
    assert.equal(c.view, 'table');
    // `cols`: cada par «Columna=tipo» con encodeURIComponent, unidos por «;».
    const pairs = c.cols.split(';').map(x => decodeURIComponent(x));
    const map = Object.fromEntries(pairs.map(p => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
    assert.equal(map[head[1]], 'person'); assert.equal(map[head[2]], 'rating'); assert.equal(map[head[3]], 'progress');
    assert.equal(map[head[4]], `status:${states.join('|')}`); assert.equal(map[head[5]], 'date');
    const v = JSON.parse(decodeURIComponent(c.views));
    assert.deepEqual(v.list.map(x => x.n), views);
    assert.equal(v.list[1].v, 'kanban'); assert.equal(v.list[1].by, head[4]); assert.equal(v.act, 0);
    // la tabla: cabecera, separador y filas con 6 celdas
    assert.equal(lines[di + 1], `| ${head.join(' | ')} |`);
    assert.match(lines[di + 2], /^\|(-+\|){6}$/);
    const rows = lines.slice(di + 3).filter(l => l.startsWith('|'));
    assert.ok(rows.length >= 3);
    for (const r of rows) assert.equal(r.split('|').length - 2, 6);
    // los estados de las filas son opciones válidas
    for (const r of rows) assert.ok(states.includes(r.split('|')[5].trim()), r);
  });
}
