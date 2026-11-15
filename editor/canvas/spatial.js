// Índice espacial de cuadrícula para el canvas: recorte por viewport, hit-test
// de lazo y candidatos de snap sin recorrer todos los nodos. Se reconstruye en
// O(N) sólo cuando cambia el array de nodos confirmado (no en cada frame de un
// gesto) y cada consulta cuesta O(celdas tocadas + resultados).

export function buildGrid(items, rectOf, cell = 512) {
  const cells = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = rectOf(it);
    const x0 = Math.floor(r.x / cell), x1 = Math.floor((r.x + r.w) / cell);
    const y0 = Math.floor(r.y / cell), y1 = Math.floor((r.y + r.h) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = cx + ',' + cy;
        let arr = cells.get(k);
        if (!arr) cells.set(k, arr = []);
        arr.push(it);
      }
    }
  }
  return {
    size: items.length,
    // Elementos cuyo rectángulo toca [x, x+w] × [y, y+h] (sin duplicados). Con
    // rectOf se comprueba la intersección exacta; el índice sólo acota.
    query(x, y, w, h) {
      const out = new Set();
      const x0 = Math.floor(x / cell), x1 = Math.floor((x + w) / cell);
      const y0 = Math.floor(y / cell), y1 = Math.floor((y + h) / cell);
      // Una consulta enorme (zoom muy alejado) no debe recorrer millones de celdas vacías.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > cells.size * 2) {
        for (const arr of cells.values()) for (const it of arr) out.add(it);
      } else {
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const arr = cells.get(cx + ',' + cy);
            if (arr) for (const it of arr) out.add(it);
          }
        }
      }
      const res = [];
      for (const it of out) {
        const r = rectOf(it);
        if (r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y) res.push(it);
      }
      return res;
    },
  };
}
