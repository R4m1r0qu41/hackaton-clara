'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { procesar } = require('./procesar');
const R = require('../respuesta/respuesta');

const FECHA = '30/10/2026';

// Entidades ficticias: ninguna corresponde a una empresa real.
const tabla = [
  { nombre_comercial: 'Zafiro', razon_social: null, estado: 'registrada', terminos_buscados: ['Zafiro', 'Zafiro Soluciones'], fecha_consulta: FECHA },
  { nombre_comercial: 'Nimbo Express', razon_social: null, estado: 'no_registrada_confirmada', terminos_buscados: ['Nimbo Express', 'Nimbo'], fecha_consulta: FECHA },
];

const senales = (extra = {}) => ({
  pide_anticipo: false,
  pide_permiso_contactos: false,
  pide_permiso_fotos_archivos: false,
  deposito_menor_a_ofrecido: false,
  plazo_menor_a_15_dias: false,
  presion_urgencia: false,
  texto_evidencia: [],
  ...extra,
});

const tienda = (credito = {}, extra = {}) => ({
  tipo_entrada: 'etiqueta_tienda',
  confianza_extraccion: 0.9,
  producto: { descripcion: 'Producto de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo' },
  credito: {
    otorgante_nombre_comercial: null,
    otorgante_razon_social: null,
    monto_ofrecido: null,
    monto_depositado: null,
    enganche: 0,
    abono: 1000,
    periodicidad: 'mensual',
    numero_pagos: 11,
    plazo_dias: null,
    monto_total_a_pagar: null,
    comisiones: [],
    seguros: [],
    cat_publicado: null,
    ...credito,
  },
  senales_riesgo: senales(),
  datos_faltantes: [],
  ...extra,
});

const prestamo = (credito = {}, extra = {}) =>
  tienda(
    { otorgante_nombre_comercial: 'Zafiro', monto_ofrecido: 10000, monto_depositado: 10000, enganche: null, numero_pagos: 12, ...credito },
    { tipo_entrada: 'oferta_credito', producto: { descripcion: null, precio_contado: null, tienda: null }, ...extra }
  );

const congelar = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v));
  return Object.freeze(o);
};

test('una etiqueta de tienda válida pide redactar, con contexto y plantilla', () => {
  const r = procesar({ extraccion: tienda(), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'redactar');
  assert.equal(r.ctx.tipo, 'tienda');
  assert.equal(r.ctx.color, 'verde');
  assert.equal(typeof r.plantilla, 'string');
  assert.deepEqual(r.log, { fecha: FECHA, tipo_entrada: 'etiqueta_tienda', semaforo: 'verde', estado_sipres: 'n.a.' });
});

test('un préstamo de una entidad registrada cita SIPRES con su fecha', () => {
  const r = procesar({ extraccion: prestamo(), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'redactar');
  assert.equal(r.ctx.color, 'verde');
  assert.equal(r.ctx.estado_sipres, 'registrada');
  assert.equal(r.ctx.fuentes.sipres.fecha, FECHA);
  assert.equal(r.log.estado_sipres, 'registrada');
});

test('un préstamo de una entidad no registrada confirmada es rojo', () => {
  const r = procesar({ extraccion: prestamo({ otorgante_nombre_comercial: 'Nimbo' }), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.ctx.color, 'rojo');
  assert.ok(r.plantilla.includes('Términos buscados: Nimbo Express, Nimbo'));
});

test('una entidad que no está en la tabla da gris con su advertencia', () => {
  const r = procesar({ extraccion: prestamo({ otorgante_nombre_comercial: 'Entidad Inexistente' }), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.ctx.color, 'gris');
  assert.equal(r.ctx.fuentes.sipres, null);
  assert.ok(r.advertencias.includes('sipres:no_esta_en_tabla'));
});

test('una tabla de SIPRES inválida no rompe el flujo y da gris', () => {
  const r = procesar({ extraccion: prestamo(), tablaSipres: null, hoy: FECHA });
  assert.equal(r.ctx.color, 'gris');
  assert.ok(r.advertencias.includes('sipres:tabla_invalida'));
});

test('acepta la extracción como texto JSON con cercas de código', () => {
  const r = procesar({ extraccion: '```json\n' + JSON.stringify(tienda()) + '\n```', tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'redactar');
});

test('una extracción ilegible se responde con el mensaje de error', () => {
  const r = procesar({ extraccion: 'esto no es json', tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'responder');
  assert.equal(r.texto, R.mensajes.error());
  assert.equal(r.motivo, 'error_formato');
  assert.deepEqual(r.log, { fecha: FECHA, tipo_entrada: 'desconocido', semaforo: 'n.a.', estado_sipres: 'n.a.' });
});

test('sin argumentos tampoco lanza excepciones', () => {
  const r = procesar();
  assert.equal(r.accion, 'responder');
  assert.equal(r.motivo, 'error_formato');
  assert.equal(r.log.fecha, null);
});

test('una cobranza se responde con el aviso de que por ahora no se analiza', () => {
  const r = procesar({ extraccion: tienda({}, { tipo_entrada: 'cobranza' }), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'responder');
  assert.equal(r.texto, R.mensajes.cobranza());
  assert.equal(r.motivo, 'cobranza');
  assert.equal(r.log.tipo_entrada, 'cobranza');
});

test('un tipo desconocido pide aclaración', () => {
  const r = procesar({ extraccion: tienda({}, { tipo_entrada: 'desconocido' }), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'responder');
  assert.equal(r.motivo, 'tipo_desconocido');
  assert.ok(r.texto.includes('•'));
});

test('una confianza baja pide el texto completo', () => {
  const r = procesar({ extraccion: tienda({}, { confianza_extraccion: 0.3 }), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'responder');
  assert.equal(r.motivo, 'confianza_baja');
  assert.match(r.texto, /texto completo/);
});

test('si faltan datos para calcular pregunta lo mínimo: como máximo dos preguntas', () => {
  const r = procesar({ extraccion: tienda({ abono: null, numero_pagos: null, periodicidad: null }), tablaSipres: tabla, hoy: FECHA });
  assert.equal(r.accion, 'responder');
  assert.equal(r.motivo, 'datos_insuficientes');
  assert.ok(r.texto.includes('¿De cuánto es cada pago?'));
  assert.ok(r.texto.includes('¿Cuántos pagos son?'));
  assert.ok(!r.texto.includes('semanal'));
});

test('el texto del usuario no aparece en el log ni en la salida', () => {
  const extraccion = tienda({}, { producto: { descripcion: 'Televisión secreta', precio_contado: 10000, tienda: 'Tienda secreta' } });
  const r = procesar({ extraccion, tablaSipres: tabla, hoy: FECHA });
  assert.deepEqual(Object.keys(r.log), ['fecha', 'tipo_entrada', 'semaforo', 'estado_sipres']);
  const salida = JSON.stringify(r);
  assert.ok(!salida.includes('Televisión secreta'));
  assert.ok(!salida.includes('Tienda secreta'));
});

test('las reglas de extracción están apagadas por defecto y se activan por configuración', () => {
  const extraccion = prestamo({}, { senales_riesgo: senales({ pide_anticipo: true, texto_evidencia: ['Deposita primero $500'] }) });
  assert.equal(procesar({ extraccion, tablaSipres: tabla, hoy: FECHA }).ctx.color, 'verde');
  const activada = procesar({ extraccion, tablaSipres: tabla, hoy: FECHA, config: { reglasDeExtraccion: true } });
  assert.equal(activada.ctx.color, 'rojo');
});

test('los umbrales del semáforo se pueden ajustar por configuración', () => {
  const r = procesar({ extraccion: tienda(), tablaSipres: tabla, hoy: FECHA, config: { umbrales: { tienda: { rojo_desde_pct: 5 } } } });
  assert.equal(r.ctx.color, 'rojo');
});

test('el umbral de confianza se puede ajustar por configuración', () => {
  const extraccion = tienda({}, { confianza_extraccion: 0.7 });
  assert.equal(procesar({ extraccion, tablaSipres: tabla, hoy: FECHA, config: { minConfianza: 0.8 } }).motivo, 'confianza_baja');
});

test('las advertencias del validador y del cálculo llegan juntas, sin repetirse', () => {
  const r = procesar({ extraccion: tienda({ enganche: -5 }), tablaSipres: tabla, hoy: FECHA });
  assert.ok(r.advertencias.includes('numero_invalido:credito.enganche'));
  assert.ok(r.advertencias.includes('enganche_no_declarado'));
  assert.equal(new Set(r.advertencias).size, r.advertencias.length);
});

test('toda plantilla que devuelve pasa el verificador', () => {
  const casos = [tienda(), tienda({ numero_pagos: 18 }), prestamo(), prestamo({ otorgante_nombre_comercial: 'Nimbo' }), prestamo({ otorgante_nombre_comercial: 'Entidad Inexistente' })];
  for (const extraccion of casos) {
    const r = procesar({ extraccion, tablaSipres: tabla, hoy: FECHA });
    assert.equal(r.accion, 'redactar');
    assert.deepEqual(R.verificarRespuesta(r.plantilla, r.ctx).fallas, []);
  }
});

test('no modifica sus entradas', () => {
  assert.doesNotThrow(() => procesar({ extraccion: congelar(prestamo()), tablaSipres: congelar(tabla.map((f) => ({ ...f }))), hoy: FECHA, config: congelar({ reglasDeExtraccion: true }) }));
});
