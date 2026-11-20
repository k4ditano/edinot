// Auto layout (como en Figma), lógica pura. Un marco (grupo con título) con `layout` coloca solo a sus hijos:
//
//   layout = { dir: 'column' | 'row', gap: 16, pad: 16, align: 'start' | 'center' | 'end', hug: true|false }
//
// Hijos = fichas y dibujos cuyo centro cae dentro del marco (en el marco más pequeño que lo contenga). Un grupo
// ligero (`grp`, Ctrl+G o un <g> de SVG) cuenta como una sola pieza. El orden es el de su posición actual en el eje
// (arriba→abajo o izquierda→derecha), así que arrastrar un hijo y soltarlo en otro sitio lo reordena.
// `hug` ajusta el tamaño del marco al contenido. Devuelve el mismo objeto si no hay nada que mover.

export const FRAME_HEAD = 26;   // alto de la cabecera del marco (título)
const DEF_W = 240, DEF_H = 140, GROUP_W = 480, GROUP_H = 320;

const nodeRect = (n) => ({ x: n.x || 0, y: n.y || 0, w: n.w || DEF_W, h: n.h || DEF_H });
const annoRect = (a) => (a.bbox ? { x: a.bbox.x + (a.ox || 0), y: a.bbox.y + (a.oy || 0), w: a.bbox.w, h: a.bbox.h } : null);
const frameRect = (g) => ({ x: g.x || 0, y: g.y || 0, w: g.w || GROUP_W, h: g.h || GROUP_H });
const inside = (r, f) => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h; };

/** Piezas (unidades) de cada marco: Map frameId → [{ nodes:[ids], annos:[ids], rect }]. */
export function frameMembers(json) {
  const frames = (json.groups || []).map(g => ({ g, r: frameRect(g) })).sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h);
  const owner = (r) => { for (const f of frames) if (inside(r, f.r)) return f.g.id; return null; };
  const units = new Map();   // key → unit
  const out = new Map(frames.map(f => [f.g.id, []]));
  const add = (kind, item, r) => {
    if (!r || item.hidden || item.kind === 'page') return;
    const key = item.grp ? 'g:' + item.grp : kind + ':' + item.id;
    let u = units.get(key);
    if (!u) { u = { nodes: [], annos: [], rect: null }; units.set(key, u); }
    (kind === 'n' ? u.nodes : u.annos).push(item.id);
    u.rect = u.rect ? (() => { const x0 = Math.min(u.rect.x, r.x), y0 = Math.min(u.rect.y, r.y); return { x: x0, y: y0, w: Math.max(u.rect.x + u.rect.w, r.x + r.w) - x0, h: Math.max(u.rect.y + u.rect.h, r.y + r.h) - y0 }; })() : { ...r };
  };
  for (const n of json.nodes || []) add('n', n, nodeRect(n));
  for (const a of json.annotations || []) add('a', a, annoRect(a));
  for (const u of units.values()) { const f = owner(u.rect); if (f) out.get(f).push(u); }
  return out;
}

export function applyAutoLayout(json) {
  const groups = json.groups || [];
  if (!groups.some(g => g.layout)) return json;
  const members = frameMembers(json);
  const moveN = new Map(), moveA = new Map(), resize = new Map();
  for (const g of groups) {
    const L = g.layout;
    if (!L) continue;
    const units = members.get(g.id) || [];
    if (!units.length) continue;
    const row = L.dir === 'row';
    const gap = Number.isFinite(L.gap) ? L.gap : 16, pad = Number.isFinite(L.pad) ? L.pad : 16;
    const f = frameRect(g);
    units.sort((a, b) => (row ? (a.rect.x + a.rect.w / 2) - (b.rect.x + b.rect.w / 2) : (a.rect.y + a.rect.h / 2) - (b.rect.y + b.rect.h / 2)));
    let fw = f.w, fh = f.h;
    if (L.hug) {
      const sumMain = units.reduce((s, u) => s + (row ? u.rect.w : u.rect.h), 0) + gap * (units.length - 1);
      const maxCross = Math.max(...units.map(u => (row ? u.rect.h : u.rect.w)));
      if (row) { fw = sumMain + pad * 2; fh = FRAME_HEAD + maxCross + pad * 2; } else { fh = FRAME_HEAD + sumMain + pad * 2; fw = maxCross + pad * 2; }
    }
    let cur = row ? f.x + pad : f.y + FRAME_HEAD + pad;
    for (const u of units) {
      const al = L.align || 'start';
      let tx, ty;
      if (row) {
        tx = cur; cur += u.rect.w + gap;
        const top = f.y + FRAME_HEAD + pad, inner = fh - FRAME_HEAD - pad * 2;
        ty = al === 'center' ? top + (inner - u.rect.h) / 2 : al === 'end' ? top + inner - u.rect.h : top;
      } else {
        ty = cur; cur += u.rect.h + gap;
        const left = f.x + pad, inner = fw - pad * 2;
        tx = al === 'center' ? left + (inner - u.rect.w) / 2 : al === 'end' ? left + inner - u.rect.w : left;
      }
      const dx = Math.round((tx - u.rect.x) * 10) / 10, dy = Math.round((ty - u.rect.y) * 10) / 10;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      for (const id of u.nodes) moveN.set(id, [dx, dy]);
      for (const id of u.annos) moveA.set(id, [dx, dy]);
    }
    if (Math.abs(fw - f.w) >= 0.5 || Math.abs(fh - f.h) >= 0.5) resize.set(g.id, { w: Math.round(fw), h: Math.round(fh) });
  }
  if (!moveN.size && !moveA.size && !resize.size) return json;
  return {
    ...json,
    nodes: (json.nodes || []).map(n => { const m = moveN.get(n.id); return m ? { ...n, x: (n.x || 0) + m[0], y: (n.y || 0) + m[1] } : n; }),
    annotations: (json.annotations || []).map(a => { const m = moveA.get(a.id); return m ? { ...a, ox: (a.ox || 0) + m[0], oy: (a.oy || 0) + m[1] } : a; }),
    groups: groups.map(g => (resize.has(g.id) ? { ...g, ...resize.get(g.id) } : g)),
  };
}
