'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buscarEntidad, validarTabla } = require('./sipres');

// Entidades ficticias: ninguna corresponde a una empresa real.
const FECHA = '30/10/2026';
const tabla = [
  { nombre_comercial: 'Zafiro', razon_social: 'Zafiro Soluciones Financieras SAPI de CV SOFOM ENR', estado: 'registrada', terminos_buscados: ['Zafiro', 'Zafiro Soluciones Financieras'], fecha_consulta: FECHA },
  { nombre_comercial: 'Nimbo Express', razon_social: null, estado: 'no_registrada_confirmada', terminos_buscados: ['Nimbo Express', 'Nimbo'], fecha_consulta: FECHA },
  { nombre_comercial: 'Tulipán Pay', razon_social: null, estado: 'no_registrada_confirmada', terminos_buscados: ['Tulipán Pay'], fecha_consulta: FECHA },
  { nombre_comercial: 'Halcón', razon_social: null, estado: 'registrada', terminos_buscados: ['Halcón', 'Halcón Capital'], fecha_consulta: FECHA },
  { nombre_comercial: 'Halcón', razon_social: null, estado: 'no_registrada_confirmada', terminos_buscados: ['Halcón', 'Halcón Capital'], fecha_consulta: FECHA },
  { nombre_comercial: 'Alfa Beta Gamma', razon_social: null, estado: 'registrada', terminos_buscados: ['Alfa Beta Gamma', 'Gamma'], fecha_consulta: FECHA },
  { nombre_comercial: 'Ceiba', razon_social: null, estado: 'registrada', terminos_buscados: ['Ceiba'], fecha_consulta: null },
];

test('una entidad registrada devuelve estado, fecha y nombre', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'zafiro' });
  assert.equal(r.estado, 'registrada');
  assert.equal(r.fecha_consulta, FECHA);
  assert.equal(r.entidad, 'Zafiro');
  assert.equal(r.motivo, 'ok');
  assert.deepEqual(r.advertencias, []);
});

test('ignora acentos, mayúsculas, puntuación y sufijos legales', () => {
  const r = buscarEntidad(tabla, { razon_social: 'ZAFIRO Soluciones Financieras, S.A.P.I. de C.V., SOFOM E.N.R.' });
  assert.equal(r.estado, 'registrada');
  assert.equal(buscarEntidad(tabla, { nombre_comercial: 'tulipan' }).entidad, 'Tulipán Pay');
});

test('no registrada confirmada con fecha y 2 términos buscados se confirma', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'Nimbo' });
  assert.equal(r.estado, 'no_registrada_confirmada');
  assert.equal(r.fecha_consulta, FECHA);
  assert.deepEqual(r.terminos_buscados, ['Nimbo Express', 'Nimbo']);
});

test('no registrada con un solo término baja a sin_verificar', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'Tulipan' });
  assert.equal(r.estado, 'sin_verificar');
  assert.equal(r.motivo, 'confirmacion_insuficiente');
  assert.equal(r.entidad, 'Tulipán Pay');
  assert.deepEqual(r.advertencias, ['confirmacion_insuficiente']);
});

test('lo que no está en la tabla es sin_verificar, nunca no registrada', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'Entidad Inexistente' });
  assert.equal(r.estado, 'sin_verificar');
  assert.equal(r.motivo, 'no_esta_en_tabla');
  assert.equal(r.fecha_consulta, null);
  assert.deepEqual(r.terminos_buscados, []);
});

test('un nombre genérico no coincide con nada', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'Financiera Digital' });
  assert.equal(r.estado, 'sin_verificar');
  assert.equal(r.motivo, 'sin_nombre_utilizable');
});

test('sin nombre utilizable no lanza excepciones', () => {
  for (const consulta of [undefined, null, {}, { nombre_comercial: 123 }, { razon_social: '   ' }]) {
    const r = buscarEntidad(tabla, consulta);
    assert.equal(r.estado, 'sin_verificar');
    assert.equal(r.motivo, 'sin_nombre_utilizable');
  }
});

test('una tabla inválida da sin_verificar', () => {
  for (const mala of [null, undefined, {}, 'texto']) {
    const r = buscarEntidad(mala, { nombre_comercial: 'Zafiro' });
    assert.equal(r.estado, 'sin_verificar');
    assert.equal(r.motivo, 'tabla_invalida');
  }
});

test('coincidencias con estados contradictorios no se adivinan', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'Halcón' });
  assert.equal(r.estado, 'sin_verificar');
  assert.equal(r.motivo, 'coincidencias_contradictorias');
  assert.deepEqual(r.advertencias, ['coincidencias_ambiguas']);
});

test('un nombre parcial solo coincide si tiene al menos 5 caracteres', () => {
  assert.equal(buscarEntidad(tabla, { nombre_comercial: 'Alfa' }).motivo, 'no_esta_en_tabla');
  assert.equal(buscarEntidad(tabla, { nombre_comercial: 'Gamma' }).estado, 'registrada');
  assert.equal(buscarEntidad(tabla, { nombre_comercial: 'Beta Gamma' }).estado, 'registrada');
});

test('una entidad registrada sin fecha se devuelve con advertencia', () => {
  const r = buscarEntidad(tabla, { nombre_comercial: 'Ceiba' });
  assert.equal(r.estado, 'registrada');
  assert.equal(r.fecha_consulta, null);
  assert.deepEqual(r.advertencias, ['sin_fecha']);
});

test('las filas inválidas de la tabla no rompen la búsqueda', () => {
  const r = buscarEntidad([null, 'texto', 42, ...tabla], { nombre_comercial: 'Zafiro' });
  assert.equal(r.estado, 'registrada');
});

test('validarTabla acepta una tabla bien formada', () => {
  const buena = tabla.filter((f) => f.fecha_consulta && f.estado === 'registrada');
  assert.deepEqual(validarTabla(buena), []);
});

test('validarTabla lista cada problema con el número de fila', () => {
  const mala = [
    { nombre_comercial: 'Omega Uno', estado: 'otro', fecha_consulta: FECHA },
    { nombre_comercial: 'Beta Corp', estado: 'registrada' },
    { nombre_comercial: 'Gama Uno', estado: 'no_registrada_confirmada', terminos_buscados: ['Gama Uno'], fecha_consulta: FECHA },
    { estado: 'registrada', fecha_consulta: FECHA },
  ];
  const problemas = validarTabla(mala);
  assert.equal(problemas.length, 4);
  assert.ok(problemas.some((p) => p.startsWith('Fila 1') && p.includes('estado')));
  assert.ok(problemas.some((p) => p.startsWith('Fila 2') && p.includes('fecha')));
  assert.ok(problemas.some((p) => p.startsWith('Fila 3') && p.includes('2 términos')));
  assert.ok(problemas.some((p) => p.startsWith('Fila 4') && p.includes('nombre')));
});

test('validarTabla rechaza algo que no es una lista', () => {
  assert.deepEqual(validarTabla(null), ['La tabla no es una lista.']);
});
