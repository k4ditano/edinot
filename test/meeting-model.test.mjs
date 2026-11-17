import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock, parseClock, segmentsFromTranscription, cleanSegments, mergeTracks, transcriptToText,
  chunkTranscript, dropEcho, parseActaJson, normalizeActa, buildMeetingNote, defaultMeetingTitle,
} from '../shared/meeting-model.mjs';

test('formatClock y parseClock son inversas', () => {
  assert.equal(formatClock(65), '01:05');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(parseClock('1:02:05'), 3725);
  assert.equal(parseClock('01:05'), 65);
  assert.equal(parseClock('nada'), null);
  assert.equal(parseClock(12), 12);
});

test('segmentos: usa los de verbose_json y, si no hay, el texto entero', () => {
  assert.deepEqual(segmentsFromTranscription({ segments: [{ start: 1, end: 2, text: ' hola  que tal ' }, { start: 3, end: 4, text: ' ' }] }),
    [{ start: 1, end: 2, text: 'hola que tal' }]);
  assert.deepEqual(segmentsFromTranscription({ text: 'solo texto', duration: 9 }), [{ start: 0, end: 9, text: 'solo texto' }]);
  assert.deepEqual(segmentsFromTranscription(null), []);
});

test('cleanSegments quita alucinaciones del silencio y repeticiones', () => {
  const r = cleanSegments([
    { start: 0, end: 1, text: 'Gracias por ver el vídeo' },
    { start: 1, end: 2, text: 'Vale, empezamos' },
    { start: 2, end: 3, text: 'vale, empezamos' },
    { start: 3, end: 4, text: '...' },
  ]);
  assert.deepEqual(r.map(s => s.text), ['Vale, empezamos']);
});

test('mergeTracks entrelaza por tiempo y une tramos seguidos de la misma voz', () => {
  const mine = [{ start: 0, end: 4, text: 'Buenos días' }, { start: 5, end: 8, text: 'empezamos' }, { start: 30, end: 33, text: 'Yo me encargo' }];
  const others = [{ start: 9, end: 20, text: 'Hay que cerrar el Q2' }];
  const r = mergeTracks(mine, others);
  assert.deepEqual(r.map(s => [s.who, s.text]), [
    ['me', 'Buenos días empezamos'], ['others', 'Hay que cerrar el Q2'], ['me', 'Yo me encargo'],
  ]);
});

test('transcriptToText etiqueta quién habla, en español e inglés', () => {
  const segs = [{ start: 65, end: 70, text: 'hola', who: 'me' }, { start: 70, end: 80, text: 'buenas', who: 'others' }];
  assert.equal(transcriptToText(segs, 'es'), '[01:05] Yo: hola\n[01:10] Otros: buenas');
  assert.equal(transcriptToText(segs, 'en'), '[01:05] Me: hola\n[01:10] Others: buenas');
});

test('chunkTranscript no corta líneas y respeta el máximo', () => {
  const text = Array.from({ length: 50 }, (_, i) => `[00:${String(i).padStart(2, '0')}] Yo: ${'x'.repeat(40)}`).join('\n');
  const parts = chunkTranscript(text, 500);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 500);
  assert.equal(parts.join('\n'), text);
});

test('parseActaJson tolera vallas y texto alrededor', () => {
  assert.deepEqual(parseActaJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseActaJson('Aquí va:\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(parseActaJson('claro {"a":3} listo'), { a: 3 });
  assert.equal(parseActaJson('no hay json'), null);
  assert.equal(parseActaJson('[1,2]'), null);
});

test('normalizeActa aguanta basura y reconoce mis tareas', () => {
  const a = normalizeActa({
    title: 'Cierre: Q2 / plan', summary: ' ok ', topics: [{ time: '02:10', title: 'Q2', points: ['a', 5] }, { title: '' }],
    actions: [{ task: 'Mandar oferta', owner: 'Yo' }, { task: 'Revisar contrato', owner: 'Marta', mine: false }, 'Llamar a Pedro', { task: '' }],
    decisions: 'no es lista',
  }, 'es');
  assert.equal(a.title, 'Cierre Q2 plan');
  assert.equal(a.topics.length, 1);
  assert.equal(a.topics[0].time, 130);
  assert.deepEqual(a.actions.map(x => [x.task, x.mine]), [['Mandar oferta', true], ['Revisar contrato', false], ['Llamar a Pedro', false]]);
  assert.deepEqual(a.decisions, []);
});

test('buildMeetingNote monta la nota con casillas y la transcripción al final', () => {
  const md = buildMeetingNote({
    acta: { title: 'Cierre Q2', summary: 'Se acordó cerrar el Q2.', decisions: ['Cerrar el jueves'],
      actions: [{ task: 'Mandar oferta', owner: 'Yo', mine: true, due: 'viernes' }, { task: 'Revisar contrato', owner: 'Marta' }],
      topics: [{ time: '00:10', title: 'Q2', points: ['Faltan 3 clientes'] }] },
    transcript: '[00:10] Yo: hola\n[00:20] Otros: buenas',
    startedAt: new Date(2026, 10, 17, 18, 30).getTime(), durationSec: 3725, lang: 'es',
  });
  assert.match(md, /^# Cierre Q2 · 2026-11-17\n/);
  assert.match(md, /#reunión · Fecha: 2026-11-17 18:30 · Duración: 1:02:05/);
  assert.match(md, /## Mis tareas\n\n- \[ \] Mandar oferta \(para viernes\)/);
  assert.match(md, /## Tareas de otros\n\n- \[ \] Revisar contrato — Marta/);
  assert.match(md, /- \*\*00:10\*\* Q2\n  - Faltan 3 clientes/);
  assert.match(md, /## Transcripción\n\n\[00:10\] Yo: hola\n\n\[00:20\] Otros: buenas/);
});

test('sin acta del modelo, la nota sigue siendo válida', () => {
  const md = buildMeetingNote({ acta: null, transcript: '', startedAt: 0, durationSec: 0, lang: 'en' });
  assert.match(md, /## Summary\n\nNothing notable\./);
  assert.ok(defaultMeetingTitle(0, 'en').startsWith('Meeting '));
});

test('dropEcho quita lo que el micrófono recogió de los altavoces y deja lo mío', () => {
  const others = [{ start: 10, end: 16, text: 'Hay que cerrar el trimestre el jueves' }];
  const mine = [
    { start: 10.5, end: 16.5, text: 'hay que cerrar el trimestre el jueves' },   // eco
    { start: 17, end: 20, text: 'Yo mando la oferta' },                           // mío
    { start: 11, end: 12, text: 'vale' },                                          // corto: se queda
  ];
  assert.deepEqual(dropEcho(mine, others).map(s => s.text), ['Yo mando la oferta', 'vale']);
});

test('mergeTracks parte los párrafos larguísimos de una misma voz', () => {
  const mine = Array.from({ length: 40 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.5, text: 'una frase de relleno bastante larga para llenar' }));
  const r = mergeTracks(mine, []);
  assert.ok(r.length > 2);
  for (const s of r) assert.ok(s.text.length < 700);
});
