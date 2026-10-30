'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { embed, crearServidor, DIMENSION } = require('./embeddings-local');

const coseno = (a, b) => a.reduce((suma, x, i) => suma + x * b[i], 0);
const norma = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

async function conServidor(prueba) {
  const servidor = crearServidor();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}/embed`;
  try {
    await prueba(url);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

const publicar = (url, cuerpo, opciones = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), ...opciones });

test('embed devuelve un vector de la dimensión acordada, finito y normalizado', () => {
  const v = embed('La anualidad de la tarjeta Oro es de mil doscientos pesos');
  assert.equal(v.length, DIMENSION);
  assert.ok(v.every((x) => Number.isFinite(x)));
  assert.ok(Math.abs(norma(v) - 1) < 1e-9);
});

test('embed es determinista', () => {
  assert.deepEqual(embed('tarjeta de crédito Oro'), embed('tarjeta de crédito Oro'));
});

test('embed ignora acentos, mayúsculas y puntuación', () => {
  assert.deepEqual(embed('¿Tarjeta de Crédito, Oro?'), embed('tarjeta de credito oro'));
});

test('textos con palabras en común quedan más cerca que textos sin relación', () => {
  const pregunta = embed('requisitos de la tarjeta Oro');
  const relacionado = embed('La tarjeta Oro tiene requisitos de ingreso y comprobantes');
  const ajeno = embed('El seguro de viaje cubre equipaje perdido en vuelos internacionales');
  assert.ok(coseno(pregunta, relacionado) > coseno(pregunta, ajeno) + 0.2);
});

test('embed nunca devuelve un vector cero, aunque el texto solo tenga palabras vacías o números', () => {
  for (const texto of ['de la y el en', '12 3', '¿?!', 'a']) {
    const v = embed(texto);
    assert.ok(v.some((x) => x !== 0), texto);
    assert.ok(Math.abs(norma(v) - 1) < 1e-9, texto);
  }
});

test('el servidor devuelve un vector por texto, en el mismo orden y con la misma dimensión', async () => {
  await conServidor(async (url) => {
    const textos = ['tarjeta Oro', 'tarjeta Platino', 'seguro de viaje'];
    const r = await publicar(url, { texts: textos });
    assert.equal(r.status, 200);
    const { embeddings } = await r.json();
    assert.equal(embeddings.length, 3);
    assert.ok(embeddings.every((v) => v.length === DIMENSION && v.some((x) => x !== 0) && v.every(Number.isFinite)));
    assert.deepEqual(embeddings[0], embed('tarjeta Oro'));
  });
});

test('el servidor rechaza cuerpos que no cumplen el contrato', async () => {
  await conServidor(async (url) => {
    for (const cuerpo of ['no es json', {}, { texts: [] }, { texts: 'texto' }, { texts: ['ok', ''] }, { texts: ['ok', 3] }, { texts: ['   '] }]) {
      const r = await publicar(url, cuerpo);
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
    }
  });
});

test('el servidor acota la cantidad y el tamaño de los textos', async () => {
  await conServidor(async (url) => {
    assert.equal((await publicar(url, { texts: Array.from({ length: 300 }, () => 'texto') })).status, 400);
    assert.equal((await publicar(url, { texts: ['a'.repeat(50000)] })).status, 400);
    assert.equal((await publicar(url, { texts: ['x'.repeat(6 * 1024 * 1024)] })).status, 413);
  });
});

test('el servidor solo acepta POST', async () => {
  await conServidor(async (url) => {
    assert.equal((await fetch(url)).status, 405);
  });
});
