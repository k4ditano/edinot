// Ancho de la columna de la nota (Ajustes → Apariencia → Ancho de lectura).
// UN solo ancho para todo lo que hay en una nota —texto, títulos, listas,
// citas, imágenes, código y tablas—: sus bordes izquierdo y derecho coinciden.
// Los valores incluyen 96 px de márgenes (48 por lado):
//   estrecho  776  → 680 px de contenido
//   medio    1088  → 992 px (por defecto; lo que antes ocupaban las tablas: columna + 240)
//   completo 1320  → 1224 px
// Solo «Ampliar» en una tabla la saca de la columna, a todo el panel.
export const READ_WIDTHS = { narrow: 776, medium: 1088, wide: 1320 };
export function readMaxWidth(width) {
  return width === 'narrow' ? READ_WIDTHS.narrow : width === 'wide' ? READ_WIDTHS.wide : READ_WIDTHS.medium;
}
