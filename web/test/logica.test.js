'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logica');

test('vistaSemaforo: color con palabra; n.a. y desconocido no tienen semáforo', () => {
  assert.equal(L.vistaSemaforo('gris').palabra, 'Sin verificar');
  assert.equal(L.vistaSemaforo('rojo').clave, 'rojo');
  assert.equal(L.vistaSemaforo('n.a.'), null);
  assert.equal(L.vistaSemaforo('morado'), null);
  assert.equal(L.vistaSemaforo(undefined), null);
});

test('vistaSemaforo: verde nunca es recomendación y cita la fecha solo si existe', () => {
  const con = L.vistaSemaforo('verde', '30/10/2026').linea;
  assert.match(con, /30\/10\/2026/);
  assert.match(con, /No es una recomendación/);
  assert.doesNotMatch(L.vistaSemaforo('verde').linea, /undefined|null/);
});

test('vistaSipres: no encontrada → advertencia; la confirmada y la sin verificar se distinguen', () => {
  assert.equal(L.vistaSipres('sin_verificar').icono, 'advertencia-bn');
  assert.equal(L.vistaSipres('no_registrada_confirmada').icono, 'advertencia-confirmada');
  assert.equal(L.vistaSipres('registrada').icono, 'ok');
  assert.equal(L.vistaSipres('sin_verificar').enlace, true);
  assert.equal(L.vistaSipres('registrada').enlace, false);
});

test('vistaSipres: lo desconocido nunca se afirma como registrada', () => {
  assert.equal(L.vistaSipres('algo_raro').icono, 'advertencia-bn');
  assert.equal(L.vistaSipres('n.a.'), null);
  assert.equal(L.vistaSipres(null), null);
});

test('los mensajes no acusan a nadie', () => {
  for (const e of ['registrada', 'no_registrada_confirmada', 'sin_verificar', 'x']) {
    const v = L.vistaSipres(e);
    assert.doesNotMatch(v.titulo, /fraude|estafa|ilegal/i);
  }
});

test('esEjemplo detecta las tres formas en que el servidor marca datos de ejemplo', () => {
  assert.equal(L.esEjemplo({ ejemplo: true }), true);
  assert.equal(L.esEjemplo({ origen: 'ejemplo' }), true);
  assert.equal(L.esEjemplo({ advertencias: ['dato_de_ejemplo'] }), true);
  assert.equal(L.esEjemplo({ origen: 'llm', advertencias: [] }), false);
  assert.equal(L.esEjemplo(null), false);
});

test('textoOrigen: la plantilla avisa que el modelo no estuvo disponible', () => {
  assert.match(L.textoOrigen('plantilla').detalle, /modelo no estuvo disponible/);
  assert.equal(L.textoOrigen('???').etiqueta, 'Origen desconocido');
});

test('avisosLegibles traduce los códigos conocidos y no pierde los desconocidos', () => {
  const r = L.avisosLegibles(['dato_de_ejemplo', 'codigo_nuevo']);
  assert.match(r[0], /ejemplo/);
  assert.match(r[1], /codigo_nuevo/);
  assert.deepEqual(L.avisosLegibles(undefined), []);
});

test('esUrlSegura rechaza javascript:, data: y basura', () => {
  assert.equal(L.esUrlSegura(L.SIPRES_URL), true);
  assert.equal(L.esUrlSegura('javascript:alert(1)'), false);
  assert.equal(L.esUrlSegura('data:text/html,hola'), false);
  assert.equal(L.esUrlSegura('no es url'), false);
  assert.equal(L.esUrlSegura(null), false);
});

test('validación de entradas: mínimo para buscar y máximo del servidor', () => {
  assert.equal(L.consultaValida('ab'), false);
  assert.equal(L.consultaValida('  ab '), false);
  assert.equal(L.consultaValida('abc'), true);
  assert.equal(L.textoValido(''), false);
  assert.equal(L.textoValido('x'.repeat(L.MAX_TEXTO)), true);
  assert.equal(L.textoValido('x'.repeat(L.MAX_TEXTO + 1)), false);
});

test('formatearValor: desconocido es "dato faltante", nunca cero', () => {
  assert.equal(L.formatearValor(null, '%'), 'dato faltante');
  assert.equal(L.formatearValor(undefined), 'dato faltante');
  assert.equal(L.formatearValor('12'), 'dato faltante');
  assert.notEqual(L.formatearValor(0, '%'), 'dato faltante');
  assert.match(L.formatearValor(50, '%'), /^50 %$/);
});

test('barras: null queda sin porcentaje y no distorsiona la escala', () => {
  const r = L.barras([
    { estado_id: 'A', nombre: 'A', valor: 50 },
    { estado_id: 'B', nombre: 'B', valor: null },
    { estado_id: 'C', nombre: 'C', valor: 100 },
  ]);
  assert.equal(r[0].pct, 50);
  assert.equal(r[1].pct, null);
  assert.equal(r[1].valor, null);
  assert.equal(r[2].pct, 100);
});

test('barras: todo desconocido no inventa barras', () => {
  const r = L.barras([{ estado_id: 'A', nombre: 'A', valor: null }]);
  assert.equal(r[0].pct, null);
  assert.deepEqual(L.barras(undefined), []);
});
