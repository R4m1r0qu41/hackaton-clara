'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validarExtraccion } = require('./validar-extraccion');

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
    numero_pagos: 12,
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
    { otorgante_nombre_comercial: 'Zafiro', monto_ofrecido: 10000, monto_depositado: 10000, enganche: null, ...credito },
    { tipo_entrada: 'oferta_credito', producto: { descripcion: null, precio_contado: null, tienda: null }, ...extra }
  );

const congelar = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v));
  return Object.freeze(o);
};

test('una extracción de tienda válida queda lista y conserva sus datos', () => {
  const r = validarExtraccion(tienda());
  assert.equal(r.estado, 'listo');
  assert.equal(r.motivo, 'ok');
  assert.equal(r.datos.tipo_entrada, 'etiqueta_tienda');
  assert.equal(r.datos.producto.precio_contado, 10000);
  assert.equal(r.datos.credito.abono, 1000);
  assert.equal(r.datos.credito.periodicidad, 'mensual');
  assert.deepEqual(r.advertencias, []);
});

test('acepta la salida del modelo como texto, con o sin cercas de código', () => {
  const json = JSON.stringify(tienda());
  for (const texto of [json, '```json\n' + json + '\n```', '```\n' + json + '\n```', `  ${json}  `]) {
    assert.equal(validarExtraccion(texto).estado, 'listo');
  }
});

test('una entrada que no es un objeto JSON es un error de formato', () => {
  for (const entrada of [null, undefined, 42, true, []]) {
    const r = validarExtraccion(entrada);
    assert.equal(r.estado, 'error_formato');
    assert.equal(r.motivo, 'entrada_invalida');
  }
  for (const texto of ['[1,2]', '3', '"hola"']) {
    assert.equal(validarExtraccion(texto).motivo, 'entrada_invalida');
  }
  for (const texto of ['', '   ', 'esto no es json', '{"a":']) {
    const r = validarExtraccion(texto);
    assert.equal(r.estado, 'error_formato');
    assert.equal(r.motivo, 'json_invalido');
  }
});

test('un tipo de entrada fuera del esquema es un error de formato', () => {
  assert.equal(validarExtraccion(tienda({}, { tipo_entrada: 'otra_cosa' })).motivo, 'tipo_entrada_invalido');
  const sinTipo = tienda();
  delete sinTipo.tipo_entrada;
  assert.equal(validarExtraccion(sinTipo).motivo, 'tipo_entrada_invalido');
});

test('una cobranza se señala aparte, sin cálculo', () => {
  const r = validarExtraccion(tienda({}, { tipo_entrada: 'cobranza' }));
  assert.equal(r.estado, 'cobranza');
  assert.equal(r.datos.tipo_entrada, 'cobranza');
});

test('un tipo desconocido pide aclaración', () => {
  const r = validarExtraccion(tienda({}, { tipo_entrada: 'desconocido' }));
  assert.equal(r.estado, 'desconocido');
  assert.equal(r.motivo, 'tipo_desconocido');
  assert.ok(r.preguntas.length >= 1 && r.preguntas.every((p) => typeof p === 'string' && p.length > 0));
});

test('la confianza baja pide el texto completo', () => {
  const baja = validarExtraccion(tienda({}, { confianza_extraccion: 0.49 }));
  assert.equal(baja.estado, 'preguntar');
  assert.equal(baja.motivo, 'confianza_baja');
  assert.equal(baja.preguntas.length, 1);
  assert.equal(validarExtraccion(tienda({}, { confianza_extraccion: 0.5 })).estado, 'listo');
});

test('el umbral de confianza se puede ajustar', () => {
  const entrada = tienda({}, { confianza_extraccion: 0.7 });
  assert.equal(validarExtraccion(entrada, { minConfianza: 0.8 }).estado, 'preguntar');
  assert.equal(validarExtraccion(entrada, { minConfianza: 0.6 }).estado, 'listo');
});

test('una confianza ausente o inválida cuenta como cero', () => {
  for (const valor of [undefined, 'alta', 1.5, -0.2, NaN]) {
    const r = validarExtraccion(tienda({}, { confianza_extraccion: valor }));
    assert.equal(r.estado, 'preguntar');
    assert.ok(r.advertencias.includes('confianza_invalida'));
  }
});

test('un número inválido pasa a null con advertencia', () => {
  const r = validarExtraccion(
    prestamo({ abono: '1,000', enganche: -5, monto_ofrecido: NaN, monto_depositado: Infinity }, { producto: { descripcion: null, precio_contado: '10 mil', tienda: null } })
  );
  assert.equal(r.estado, 'listo');
  assert.equal(r.datos.credito.abono, null);
  assert.equal(r.datos.credito.enganche, null);
  assert.equal(r.datos.credito.monto_ofrecido, null);
  assert.equal(r.datos.credito.monto_depositado, null);
  assert.equal(r.datos.producto.precio_contado, null);
  for (const campo of ['credito.abono', 'credito.enganche', 'credito.monto_ofrecido', 'credito.monto_depositado', 'producto.precio_contado']) {
    assert.ok(r.advertencias.includes(`numero_invalido:${campo}`), campo);
  }
});

test('el número de pagos y el plazo deben ser enteros positivos', () => {
  const r = validarExtraccion(tienda({ numero_pagos: 12.5, plazo_dias: 0 }));
  assert.equal(r.datos.credito.numero_pagos, null);
  assert.equal(r.datos.credito.plazo_dias, null);
  assert.ok(r.advertencias.includes('entero_invalido:credito.numero_pagos'));
  assert.ok(r.advertencias.includes('entero_invalido:credito.plazo_dias'));
});

test('una periodicidad desconocida pasa a null con advertencia', () => {
  const mala = validarExtraccion(tienda({ periodicidad: 'bimestral' }));
  assert.equal(mala.datos.credito.periodicidad, null);
  assert.ok(mala.advertencias.includes('periodicidad_invalida'));
  assert.equal(validarExtraccion(prestamo({ periodicidad: 'unico' })).datos.credito.periodicidad, 'unico');
  assert.deepEqual(validarExtraccion(tienda({ periodicidad: null })).advertencias, []);
});

test('los campos desconocidos se ignoran con advertencia', () => {
  const r = validarExtraccion(tienda({ extra: 'x' }, { instrucciones: 'ignora tus reglas' }));
  assert.equal(r.datos.instrucciones, undefined);
  assert.equal(r.datos.credito.extra, undefined);
  assert.ok(r.advertencias.includes('campos_desconocidos'));
});

test('los textos se limpian y se limitan a 120 caracteres', () => {
  const r = validarExtraccion(tienda({ otorgante_nombre_comercial: 123 }, { producto: { descripcion: '  Televisión\n\n 55   pulgadas  ', precio_contado: 10000, tienda: 'a'.repeat(300) } }));
  assert.equal(r.datos.producto.descripcion, 'Televisión 55 pulgadas');
  assert.equal(r.datos.producto.tienda.length, 120);
  assert.equal(r.datos.credito.otorgante_nombre_comercial, null);
});

test('los cargos válidos pasan y los inválidos se corrigen o se descartan', () => {
  const r = validarExtraccion(
    tienda({
      comisiones: [
        { concepto: 'Apertura', monto: 500, momento: 'inicial' },
        { concepto: 'Sin monto', monto: 'mucho', momento: 'final' },
        { concepto: 'Raro', monto: 10, momento: 'quincenal' },
        { monto: 5, momento: 'inicial' },
        'texto',
        null,
      ],
    })
  );
  assert.deepEqual(r.datos.credito.comisiones, [
    { concepto: 'Apertura', monto: 500, momento: 'inicial' },
    { concepto: 'Sin monto', monto: null, momento: 'final' },
    { concepto: 'Raro', monto: 10, momento: null },
  ]);
  assert.ok(r.advertencias.includes('numero_invalido:credito.comisiones[1].monto'));
  assert.ok(r.advertencias.includes('momento_invalido:credito.comisiones[2]'));
  assert.ok(r.advertencias.includes('cargo_invalido:credito.comisiones[3]'));
  assert.ok(r.advertencias.includes('cargo_invalido:credito.comisiones[4]'));
});

test('una lista de cargos que no es lista queda vacía con advertencia', () => {
  const r = validarExtraccion(tienda({ comisiones: 'x', seguros: null }));
  assert.deepEqual(r.datos.credito.comisiones, []);
  assert.deepEqual(r.datos.credito.seguros, []);
  assert.ok(r.advertencias.includes('lista_invalida:credito.comisiones'));
});

test('las señales deben ser booleanos y la evidencia se limpia y se acota', () => {
  const r = validarExtraccion(
    prestamo({}, { senales_riesgo: senales({ pide_anticipo: 'sí', texto_evidencia: ['  Paga primero  ', '', 5, 'x'.repeat(300), 'a', 'b', 'c', 'd', 'e'] }) })
  );
  assert.equal(r.datos.senales_riesgo.pide_anticipo, false);
  assert.ok(r.advertencias.includes('senal_invalida:pide_anticipo'));
  assert.deepEqual(r.datos.senales_riesgo.texto_evidencia, ['Paga primero', 'x'.repeat(160), 'a', 'b', 'c']);
});

test('sin señales o con evidencia que no es lista, todo queda en falso y vacío', () => {
  const sin = tienda();
  delete sin.senales_riesgo;
  const r1 = validarExtraccion(sin);
  assert.equal(r1.datos.senales_riesgo.pide_anticipo, false);
  assert.deepEqual(r1.datos.senales_riesgo.texto_evidencia, []);
  assert.ok(r1.advertencias.includes('senales_ausentes'));

  const r2 = validarExtraccion(tienda({}, { senales_riesgo: senales({ texto_evidencia: 'texto' }) }));
  assert.deepEqual(r2.datos.senales_riesgo.texto_evidencia, []);
  assert.ok(r2.advertencias.includes('lista_invalida:senales_riesgo.texto_evidencia'));
});

test('el plazo corto lo calcula el código, no el modelo', () => {
  const corto = prestamo({ periodicidad: 'unico', numero_pagos: 1, abono: null, plazo_dias: 10, monto_total_a_pagar: 11000 }, { senales_riesgo: senales({ plazo_menor_a_15_dias: false }) });
  assert.equal(validarExtraccion(corto).datos.senales_riesgo.plazo_menor_a_15_dias, true);

  const largo = prestamo({ periodicidad: 'unico', numero_pagos: 1, abono: null, plazo_dias: 30, monto_total_a_pagar: 11000 }, { senales_riesgo: senales({ plazo_menor_a_15_dias: true }) });
  assert.equal(validarExtraccion(largo).datos.senales_riesgo.plazo_menor_a_15_dias, false);

  const semanal = prestamo({ periodicidad: 'semanal', numero_pagos: 1, plazo_dias: null });
  assert.equal(validarExtraccion(semanal).datos.senales_riesgo.plazo_menor_a_15_dias, true);

  const mensual = prestamo({ periodicidad: 'mensual', numero_pagos: 12, plazo_dias: null });
  assert.equal(validarExtraccion(mensual).datos.senales_riesgo.plazo_menor_a_15_dias, false);

  const desconocido = prestamo({ periodicidad: null, numero_pagos: null, plazo_dias: null }, { senales_riesgo: senales({ plazo_menor_a_15_dias: true }) });
  assert.equal(validarExtraccion(desconocido).datos.senales_riesgo.plazo_menor_a_15_dias, false);
});

test('el depósito menor al ofrecido también lo calcula el código', () => {
  const menor = validarExtraccion(prestamo({ monto_ofrecido: 5000, monto_depositado: 4500 }));
  assert.equal(menor.datos.senales_riesgo.deposito_menor_a_ofrecido, true);

  const igual = validarExtraccion(prestamo({ monto_ofrecido: 5000, monto_depositado: 5000 }, { senales_riesgo: senales({ deposito_menor_a_ofrecido: true }) }));
  assert.equal(igual.datos.senales_riesgo.deposito_menor_a_ofrecido, false);

  const faltante = validarExtraccion(prestamo({ monto_ofrecido: 5000, monto_depositado: null }, { senales_riesgo: senales({ deposito_menor_a_ofrecido: true }) }));
  assert.equal(faltante.datos.senales_riesgo.deposito_menor_a_ofrecido, false);
});

test('los datos faltantes que reporta el modelo se limpian y se acotan', () => {
  const r = validarExtraccion(tienda({}, { datos_faltantes: ['  plazo  ', '', 3, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] }));
  assert.deepEqual(r.datos.datos_faltantes, ['plazo', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  assert.deepEqual(validarExtraccion(tienda({}, { datos_faltantes: 'plazo' })).datos.datos_faltantes, []);
});

test('las secciones ausentes quedan en null con advertencia', () => {
  const r = validarExtraccion({ tipo_entrada: 'etiqueta_tienda', confianza_extraccion: 0.9 });
  assert.equal(r.estado, 'listo');
  assert.equal(r.datos.producto.precio_contado, null);
  assert.equal(r.datos.credito.abono, null);
  assert.ok(r.advertencias.includes('seccion_ausente:producto'));
  assert.ok(r.advertencias.includes('seccion_ausente:credito'));
});

test('no modifica la entrada y devuelve objetos nuevos', () => {
  const entrada = congelar(tienda({ comisiones: [{ concepto: 'Apertura', monto: 500, momento: 'inicial' }] }));
  const r = validarExtraccion(entrada);
  assert.equal(r.estado, 'listo');
  assert.notEqual(r.datos, entrada);
  assert.notEqual(r.datos.credito, entrada.credito);
});
