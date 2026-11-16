// El tamaño de letra de un post-it nunca debe partir una palabra por la mitad (si cabe a algún tamaño legible).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stickyFontSize, widthEm } from '../shared/sticky-fit.mjs';

const longestWord = (t) => Math.max(0, ...String(t).split(/\s+/).map(w => widthEm(w)));
const widest = (t, fs, w) => longestWord(t) * fs <= (w - 26);

test('las palabras largas bajan el tamaño de letra hasta que caben enteras', () => {
  for (const word of ['Lanzamiento', 'Anuncio', 'Feedback', 'Presupuestos', 'Internacionalización']) {
    const fs = stickyFontSize(word, 180, 180);
    assert.ok(fs >= 10 && fs <= 42, `${word}: ${fs}`);
    if (fs > 10) assert.ok(widest(word, fs, 180), `${word} se partiría a ${fs}px`);
  }
});

test('un texto corto sigue usando una letra grande y uno largo una pequeña', () => {
  assert.ok(stickyFontSize('Web', 180, 180) >= 30);
  assert.ok(stickyFontSize('Hay que preparar el anuncio, el vídeo, la web y recoger comentarios de los primeros usuarios', 180, 180) <= 18);
});

test('casos límite: vacío, saltos de línea y tamaños pequeños', () => {
  assert.equal(stickyFontSize('', 180, 180), 18);
  assert.equal(stickyFontSize('   ', 180, 180), 18);
  assert.ok(stickyFontSize('uno\ndos\ntres', 180, 180) >= 10);
  assert.ok(stickyFontSize('palabrotamuylarga', 40, 40) >= 10);
});

test('más ancho permite una letra igual o mayor', () => {
  assert.ok(stickyFontSize('Lanzamiento', 300, 180) >= stickyFontSize('Lanzamiento', 180, 180));
});

test('«Feedback» (letras anchas) ya no se parte: cabe entera a la letra elegida', () => {
  const fs = stickyFontSize('Feedback', 180, 180);
  assert.ok(widthEm('Feedback') * fs <= 154, `Feedback a ${fs}px mide ${widthEm('Feedback') * fs}`);
  assert.ok(fs <= 31, String(fs));
});

test('widthEm: las letras anchas y las mayúsculas miden más que las estrechas', () => {
  assert.ok(widthEm('mmm') > widthEm('iii'));
  assert.ok(widthEm('ABC') > widthEm('abc'));
  assert.equal(widthEm(''), 0);
});
