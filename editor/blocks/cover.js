// Portadas de nota (meta `cover` del fichero, como el icono):
//   'g:<semilla>'  degradado generativo (ui/shared/generative.js)
//   'c:#rrggbb'    color sólido
//   'i:<url>'      imagen (edinot://blob/<sha>, data: o http)
// Se pintan como una banda redondeada encima del icono, en Leer y en Editar.

import { svg } from './icons.js';
import { genCss } from '../../ui/shared/generative.js';
import { t } from '../../i18n.js';

export const COVER_GRADIENTS = [3, 11, 27, 42, 58, 77, 91, 105, 133, 160, 199, 240].map(n => 'g:' + n);
export const COVER_COLORS = ['#E8EEF7', '#E7F3EC', '#FBEFD9', '#F8E2E2', '#EDE6F7', '#E3F1F4', '#2F3437', '#1E3A5F'].map(c => 'c:' + c);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function coverCss(cover) {
  const v = String(cover || '');
  if (v.startsWith('g:')) return genCss(parseInt(v.slice(2), 10) >>> 0);
  if (v.startsWith('c:')) return v.slice(2);
  if (v.startsWith('i:')) return `center / cover no-repeat url("${v.slice(2).replace(/"/g, '%22')}")`;
  return '';
}

export function coverHtml(cover, { editable = true } = {}) {
  if (!cover) return '';
  const tools = editable
    ? `<div class="blk-cover-tools blk-noexport"><button type="button" data-blk-cover="change">${esc(t('blk.cover.change'))}</button><button type="button" data-blk-cover="remove">${esc(t('blk.cover.remove'))}</button></div>`
    : '';
  return `<div class="blk-cover" style="background:${esc(coverCss(cover))}">${tools}</div>`;
}

// Botón «Añadir portada» (junto a «Añadir icono», visible al pasar el ratón).
export function coverAddHtml(cover, { editable = true } = {}) {
  if (cover || !editable) return '';
  return `<button type="button" class="blk-cover-add blk-noexport" data-blk-cover="add">${svg('image', 14)}${esc(t('blk.cover.add'))}</button>`;
}

// Escala una imagen a ≤ maxW px y la devuelve como data: URL JPEG (modo sin sincronización).
export function imageFileToDataUrl(file, maxW = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxW / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
