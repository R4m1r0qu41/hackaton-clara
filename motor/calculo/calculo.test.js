'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcular } = require('./calculo');

const tienda = (credito = {}, producto = {}) => ({
  tipo_entrada: 'etiqueta_tienda',
  producto: { descripcion: 'Producto de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo', ...producto },
  credito: { enganche: 0, abono: 1000, periodicidad: 'mensual', numero_pagos: 12, comisiones: [], seguros: [], ...credito },
});

const prestamo = (credito = {}) => ({
  tipo_entrada: 'oferta_credito',
  producto: { descripcion: null, precio_contado: null, tienda: null },
  credito: {
    monto_ofrecido: 10000,
    monto_depositado: 10000,
    abono: 1000,
    periodicidad: 'mensual',
    numero_pagos: 12,
    plazo_dias: null,
    monto_total_a_pagar: null,
    comisiones: [],
    seguros: [],
    ...credito,
  },
});

const congelar = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v));
  return Object.freeze(o);
};

// Valor presente de n pagos a la tasa periódica r. Verifica el CAT sin repetir el algoritmo.
const valorPresente = (r, pago, n) => (r === 0 ? pago * n : (pago * (1 - Math.pow(1 + r, -n))) / r);
const casi = (a, b, tolerancia) => assert.ok(Math.abs(a - b) <= tolerancia, `${a} no está a ${tolerancia} de ${b}`);

test('tienda: costo total y sobrecosto contra el precio de contado', () => {
  const r = calcular(tienda());
  assert.equal(r.estado, 'ok');
  assert.equal(r.tipo, 'tienda');
  assert.equal(r.metricas.costo_total, 12000);
  assert.equal(r.metricas.precio_contado, 10000);
  assert.equal(r.metricas.sobrecosto_pesos, 2000);
  assert.equal(r.metricas.sobrecosto_pct, 20);
});

test('tienda: el CAT iguala el valor presente de los pagos con el principal', () => {
  const { cat } = calcular(tienda());
  casi(valorPresente(cat.tasa_periodica, 1000, 12), 10000, 0.5);
  casi(cat.valor, Math.pow(1 + cat.tasa_periodica, 12) - 1, 1e-9);
  assert.equal(cat.texto, `${(cat.valor * 100).toFixed(1)}%`);
  assert.equal(cat.porcentaje, Math.round(cat.valor * 1000) / 10);
});

test('tienda: sin costo da CAT de 0%', () => {
  const r = calcular(tienda({}, { precio_contado: 12000 }));
  assert.equal(r.metricas.sobrecosto_pesos, 0);
  assert.equal(r.metricas.sobrecosto_pct, 0);
  assert.equal(r.cat.valor, 0);
  assert.equal(r.cat.texto, '0.0%');
});

test('tienda: el enganche resta del principal y suma al costo total', () => {
  const r = calcular(tienda({ enganche: 2000, numero_pagos: 10 }));
  assert.equal(r.metricas.costo_total, 12000);
  casi(valorPresente(r.cat.tasa_periodica, 1000, 10), 8000, 0.5);
});

test('tienda: un cargo periódico suma al pago de cada periodo', () => {
  const r = calcular(tienda({ abono: 900, seguros: [{ concepto: 'Seguro', monto: 100, momento: 'periodico' }] }));
  assert.equal(r.metricas.pago_periodico, 1000);
  assert.equal(r.metricas.costo_total, 12000);
});

test('tienda: un cargo inicial resta del principal y suma al costo total', () => {
  const r = calcular(tienda({ comisiones: [{ concepto: 'Apertura', monto: 500, momento: 'inicial' }] }));
  assert.equal(r.metricas.costo_total, 12500);
  casi(valorPresente(r.cat.tasa_periodica, 1000, 12), 9500, 0.5);
});

test('tienda: un cargo final entra al costo total pero no al CAT', () => {
  const base = calcular(tienda());
  const r = calcular(tienda({ comisiones: [{ concepto: 'Cierre', monto: 500, momento: 'final' }] }));
  assert.equal(r.metricas.costo_total, 12500);
  assert.equal(r.metricas.sobrecosto_pesos, 2500);
  assert.equal(r.metricas.sobrecosto_pct, 25);
  casi(r.cat.tasa_periodica, base.cat.tasa_periodica, 1e-12);
});

test('tienda: pagos menores al principal no dan CAT', () => {
  const r = calcular(tienda({ abono: 500, numero_pagos: 10 }));
  assert.equal(r.estado, 'ok');
  assert.equal(r.metricas.sobrecosto_pesos, -5000);
  assert.equal(r.cat.valor, null);
  assert.equal(r.cat.motivo, 'pagos_menores_al_principal');
});

test('tienda: una tasa fuera de rango se dice "más de 1,000%" sin inventar el valor', () => {
  const r = calcular(tienda({ abono: 5000, numero_pagos: 2 }, { precio_contado: 100 }));
  assert.equal(r.cat.valor, null);
  assert.equal(r.cat.texto, 'más de 1,000%');
  assert.equal(r.cat.motivo, 'fuera_de_rango');
});

test('préstamo periódico: lo que recibes, lo que pagas y el costo', () => {
  const r = calcular(prestamo());
  assert.equal(r.estado, 'ok');
  assert.equal(r.tipo, 'prestamo');
  assert.equal(r.metricas.recibes, 10000);
  assert.equal(r.metricas.pagas, 12000);
  assert.equal(r.metricas.costo_credito_pesos, 2000);
  assert.equal(r.metricas.costo_pct_sobre_recibido, 20);
  assert.equal(r.metricas.diferencia_ofrecido_depositado, 0);
  casi(valorPresente(r.cat.tasa_periodica, 1000, 12), 10000, 0.5);
});

test('préstamo de pago único: el CAT se anualiza con el plazo en días', () => {
  const r = calcular(prestamo({ monto_ofrecido: 5000, monto_depositado: 4500, periodicidad: 'unico', numero_pagos: 1, abono: null, plazo_dias: 30, monto_total_a_pagar: 6000 }));
  assert.equal(r.estado, 'ok');
  assert.equal(r.metricas.recibes, 4500);
  assert.equal(r.metricas.pagas, 6000);
  assert.equal(r.metricas.costo_credito_pesos, 1500);
  assert.equal(r.metricas.costo_pct_sobre_recibido, 33.3);
  assert.equal(r.metricas.diferencia_ofrecido_depositado, 500);
  assert.ok(r.cat.valor > 10);
  assert.equal(r.cat.texto, 'más de 1,000%');
});

test('préstamo: el monto depositado ya refleja los cargos iniciales declarados', () => {
  const r = calcular(prestamo({ monto_depositado: 9500, comisiones: [{ concepto: 'Comisión por apertura', monto: 500, momento: 'inicial' }] }));
  assert.equal(r.metricas.cargos_iniciales_declarados, 500);
  assert.equal(r.metricas.diferencia_ofrecido_depositado, 500);
  casi(valorPresente(r.cat.tasa_periodica, 1000, 12), 9500, 0.5);
});

test('faltan datos: error con los campos que faltan', () => {
  const r = calcular(tienda({ abono: null }));
  assert.equal(r.estado, 'error');
  assert.equal(r.motivo, 'datos_insuficientes');
  assert.ok(r.campos.includes('credito.abono'));
});

test('una periodicidad desconocida es un error', () => {
  const r = calcular(tienda({ periodicidad: 'bimestral' }));
  assert.equal(r.estado, 'error');
  assert.equal(r.motivo, 'periodicidad_invalida');
});

test('un tipo de entrada que no se calcula es un error', () => {
  assert.equal(calcular({ tipo_entrada: 'cobranza' }).motivo, 'tipo_no_soportado');
  assert.equal(calcular(null).estado, 'error');
  assert.equal(calcular(undefined).estado, 'error');
});

test('un dato desconocido no se toma como cero en silencio', () => {
  const r = calcular(tienda({ enganche: null }));
  assert.equal(r.estado, 'ok');
  assert.equal(r.metricas.costo_total, 12000);
  assert.ok(r.advertencias.includes('enganche_no_declarado'));
});

test('un cargo sin monto se ignora con advertencia', () => {
  const r = calcular(tienda({ comisiones: [{ concepto: 'Gestión', monto: null, momento: 'inicial' }] }));
  assert.equal(r.metricas.costo_total, 12000);
  assert.ok(r.advertencias.includes('cargo_sin_monto:Gestión'));
});

test('no modifica la entrada', () => {
  const entrada = congelar(tienda({ comisiones: [{ concepto: 'Apertura', monto: 500, momento: 'inicial' }] }));
  assert.doesNotThrow(() => calcular(entrada));
});
