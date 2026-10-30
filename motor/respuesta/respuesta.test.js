'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcular } = require('../calculo/calculo');
const { semaforo } = require('../semaforo/semaforo');
const R = require('./respuesta');

const FECHA = '30/10/2026';

const tienda = (credito = {}) => ({
  tipo_entrada: 'etiqueta_tienda',
  producto: { descripcion: 'Producto de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo' },
  credito: { enganche: 0, abono: 1000, periodicidad: 'mensual', numero_pagos: 11, comisiones: [], seguros: [], ...credito },
});

const prestamo = (credito = {}) => ({
  tipo_entrada: 'oferta_credito',
  producto: { descripcion: null, precio_contado: null, tienda: null },
  credito: { monto_ofrecido: 10000, monto_depositado: 10000, abono: 1000, periodicidad: 'mensual', numero_pagos: 12, comisiones: [], seguros: [], ...credito },
});

const sipres = (estado) => ({ estado, fecha_consulta: FECHA, terminos_buscados: ['Nimbo Express', 'Nimbo'] });

function contexto(datos, entrada = {}, fuentes = {}, opciones = {}) {
  const calculo = calcular(datos);
  return R.armarContexto({ calculo, semaforo: semaforo({ calculo, ...entrada }, opciones), fuentes });
}

const ctxVerde = () => contexto(tienda());
const ctxRojo = () => contexto(tienda({ numero_pagos: 18 }));
const ctxPrestamoVerde = () => contexto(prestamo(), { sipres: { estado: 'registrada', fecha_consulta: FECHA, terminos_buscados: ['Zafiro', 'Zafiro Soluciones'] } }, { sipres: { fecha: FECHA } });
const ctxPrestamoRojo = () => contexto(prestamo(), { sipres: sipres('no_registrada_confirmada') }, { sipres: { fecha: FECHA } });
const ctxPrestamoGris = () => contexto(prestamo(), { sipres: sipres('sin_verificar') });
const todos = () => [ctxVerde(), ctxRojo(), ctxPrestamoVerde(), ctxPrestamoRojo(), ctxPrestamoGris()];

const lineas = (texto) => texto.split('\n').filter((l) => l.trim()).length;
const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// armarContexto

test('armarContexto devuelve null si no hay cálculo válido o semáforo', () => {
  assert.equal(R.armarContexto(), null);
  assert.equal(R.armarContexto({ calculo: { estado: 'error' }, semaforo: { color: 'gris', razones: [] } }), null);
  assert.equal(R.armarContexto({ calculo: calcular(tienda()) }), null);
});

test('armarContexto de tienda reúne color, hechos, CAT y cifras permitidas', () => {
  const ctx = ctxVerde();
  assert.equal(ctx.tipo, 'tienda');
  assert.equal(ctx.color, 'verde');
  assert.equal(ctx.aviso_cat, R.AVISO_CAT);
  assert.ok(/%$/.test(ctx.cat_texto));
  assert.ok(ctx.hechos.length >= 1 && ctx.hechos.length <= 3);
  assert.ok(ctx.hechos.every((h) => h.codigo && h.nivel && h.hecho));
  for (const monto of [10000, 11000, 1000]) assert.ok(ctx.cifras.pesos.includes(monto), `pesos ${monto}`);
  assert.ok(ctx.cifras.porcentajes.includes(10));
});

test('armarContexto deja fuera lo informativo y limita los hechos a tres', () => {
  const calculo = calcular(prestamo({ monto_depositado: 9500, abono: 1000, numero_pagos: 20, comisiones: [{ concepto: 'Apertura', monto: 500, momento: 'inicial' }] }));
  const senales = {
    pide_anticipo: true,
    pide_permiso_contactos: false,
    pide_permiso_fotos_archivos: false,
    deposito_menor_a_ofrecido: true,
    plazo_menor_a_15_dias: false,
    presion_urgencia: true,
    texto_evidencia: ['Deposita primero $500'],
  };
  const sem = semaforo({ calculo, senales, sipres: { estado: 'registrada', fecha_consulta: FECHA, terminos_buscados: [] } }, { reglasDeExtraccion: true });
  const ctx = R.armarContexto({ calculo, semaforo: sem, fuentes: {} });
  assert.deepEqual(ctx.hechos.map((h) => h.codigo), ['pide_anticipo', 'presion_urgencia', 'costo_alto']);
});

test('armarContexto normaliza las fuentes y junta las fechas permitidas', () => {
  const ctx = contexto(tienda(), {}, { cetes: { fecha: '29/10/2026', descripcion: 'CETES 28 días', respaldo: true }, sipres: { fecha: FECHA } });
  assert.deepEqual(ctx.fuentes.cetes, { fecha: '29/10/2026', descripcion: 'CETES 28 días', respaldo: true });
  assert.deepEqual(ctx.fuentes.sipres, { fecha: FECHA });
  assert.ok(ctx.fechas.includes('29/10/2026') && ctx.fechas.includes(FECHA));
});

test('armarContexto junta las advertencias del cálculo y del semáforo', () => {
  const ctx = contexto(tienda({ enganche: null }));
  assert.ok(ctx.advertencias.includes('enganche_no_declarado'));
});

// plantillaDesdeContexto

test('la plantilla de tienda lleva color, hecho, CAT y aviso en 10 líneas o menos', () => {
  const ctx = ctxVerde();
  const texto = R.plantillaDesdeContexto(ctx);
  assert.ok(texto.includes('🟢'));
  assert.ok(texto.includes(ctx.hechos[0].hecho));
  assert.ok(texto.includes(`CAT estimado: ${ctx.cat_texto}`));
  assert.ok(texto.includes(R.AVISO_CAT));
  assert.ok(lineas(texto) <= R.MAX_LINEAS);
});

test('la plantilla de un préstamo rojo cita evidencia, fecha y fuente', () => {
  const texto = R.plantillaDesdeContexto(ctxPrestamoRojo());
  assert.ok(texto.includes('🔴'));
  assert.ok(texto.includes('❌'));
  assert.ok(texto.includes('Términos buscados: Nimbo Express, Nimbo'));
  assert.ok(texto.includes(FECHA));
  assert.match(texto, /SIPRES/);
});

test('toda plantilla pasa su propio verificador', () => {
  for (const ctx of todos()) {
    const v = R.verificarRespuesta(R.plantillaDesdeContexto(ctx), ctx);
    assert.deepEqual(v.fallas, [], `${ctx.tipo} ${ctx.color}`);
    assert.equal(v.ok, true);
  }
});

test('la plantilla que cita montos del usuario como evidencia también pasa', () => {
  const senales = {
    pide_anticipo: true,
    pide_permiso_contactos: false,
    pide_permiso_fotos_archivos: false,
    deposito_menor_a_ofrecido: false,
    plazo_menor_a_15_dias: false,
    presion_urgencia: false,
    texto_evidencia: ['Deposita primero $500'],
  };
  const sipresRegistrada = { estado: 'registrada', fecha_consulta: FECHA, terminos_buscados: [] };
  const ctx = contexto(prestamo(), { senales, sipres: sipresRegistrada }, { sipres: { fecha: FECHA } }, { reglasDeExtraccion: true });
  const texto = R.plantillaDesdeContexto(ctx);
  assert.ok(texto.includes('$500'));
  assert.equal(R.verificarRespuesta(texto, ctx).ok, true);
});

test('sin CAT calculable la plantilla no incluye el aviso de CAT y aun así pasa', () => {
  const ctx = contexto(tienda({ abono: 500, numero_pagos: 10 }));
  assert.equal(ctx.cat_texto, null);
  const texto = R.plantillaDesdeContexto(ctx);
  assert.ok(!texto.includes('CAT estimado'));
  assert.equal(R.verificarRespuesta(texto, ctx).ok, true);
});

test('la fuente de CETES de respaldo se dice en la plantilla', () => {
  const ctx = contexto(tienda(), {}, { cetes: { fecha: '29/10/2026', descripcion: 'CETES 28 días, subasta semanal', respaldo: true } });
  const texto = R.plantillaDesdeContexto(ctx);
  assert.ok(texto.includes('29/10/2026'));
  assert.match(texto, /respaldo/);
  assert.equal(R.verificarRespuesta(texto, ctx).ok, true);
});

// verificarRespuesta

test('un texto del modelo bien formado pasa aunque cambie el orden', () => {
  const ctx = ctxPrestamoVerde();
  const texto = R.plantillaDesdeContexto(ctx).split('\n').reverse().join('\n');
  assert.deepEqual(R.verificarRespuesta(texto, ctx), { ok: true, fallas: [] });
});

test('un texto vacío o que no es texto se rechaza', () => {
  for (const texto of ['', '   ', null, undefined, 42]) {
    assert.deepEqual(R.verificarRespuesta(texto, ctxVerde()).fallas, ['texto_vacio']);
  }
});

test('sin contexto no hay contra qué verificar', () => {
  assert.deepEqual(R.verificarRespuesta('texto', null), { ok: false, fallas: ['sin_contexto'] });
});

test('se rechaza el texto con demasiadas líneas o demasiado largo', () => {
  const ctx = ctxVerde();
  const base = R.plantillaDesdeContexto(ctx);
  const muchas = base + '\n' + Array.from({ length: R.MAX_LINEAS }, (_, i) => `línea ${i}`).join('\n');
  assert.ok(R.verificarRespuesta(muchas, ctx).fallas.includes('demasiadas_lineas'));
  assert.ok(R.verificarRespuesta(base + '\n' + 'a'.repeat(R.MAX_CARACTERES), ctx).fallas.includes('demasiado_largo'));
});

test('se rechazan las palabras que acusan o recomiendan', () => {
  const ctx = ctxVerde();
  const base = R.plantillaDesdeContexto(ctx);
  for (const frase of ['Es un fraude.', 'Es una estafa.', 'Te recomiendo contratar este préstamo.', 'No uses esta app.', 'Son delincuentes.', 'No contrates.', 'Te conviene.']) {
    assert.ok(R.verificarRespuesta(`${base}\n${frase}`, ctx).fallas.includes('palabra_prohibida'), frase);
  }
});

test('se rechazan las cifras que no salen del cálculo', () => {
  const ctx = ctxVerde();
  const base = R.plantillaDesdeContexto(ctx);
  assert.ok(R.verificarRespuesta(`${base}\nTe cobrarán $99,999.`, ctx).fallas.includes('cifra_no_permitida:$99,999'));
  assert.ok(R.verificarRespuesta(`${base}\nEs 77% más caro.`, ctx).fallas.includes('cifra_no_permitida:77%'));
});

test('una cifra permitida pasa aunque cambie el formato', () => {
  const ctx = ctxVerde();
  const texto = R.plantillaDesdeContexto(ctx).replace('$11,000', '$11000.00');
  assert.equal(R.verificarRespuesta(texto, ctx).ok, true);
});

test('el color del texto debe ser el del semáforo', () => {
  const ctx = ctxVerde();
  const base = R.plantillaDesdeContexto(ctx);
  const otro = R.verificarRespuesta(base.replace('🟢', '🔴'), ctx);
  assert.ok(otro.fallas.includes('color_distinto'));
  assert.ok(otro.fallas.includes('falta_color'));
  assert.deepEqual(R.verificarRespuesta(base.replace('🟢', ''), ctx).fallas, ['falta_color']);
});

test('con CAT calculado el texto debe llevar el aviso', () => {
  const ctx = ctxVerde();
  const sinAviso = R.plantillaDesdeContexto(ctx).replace(R.AVISO_CAT, '');
  assert.ok(R.verificarRespuesta(sinAviso, ctx).fallas.includes('falta_aviso_cat'));
});

test('no se aceptan enlaces que el contexto no permita', () => {
  const ctx = ctxVerde();
  const texto = `${R.plantillaDesdeContexto(ctx)}\nMás info en https://ejemplo.mx/oferta`;
  assert.ok(R.verificarRespuesta(texto, ctx).fallas.includes('enlace_no_permitido'));
  assert.ok(!R.verificarRespuesta(texto, { ...ctx, enlaces: ['https://ejemplo.mx/oferta'] }).fallas.includes('enlace_no_permitido'));
});

test('no se aceptan fechas inventadas y la fecha de la fuente es obligatoria', () => {
  const ctx = ctxPrestamoRojo();
  const base = R.plantillaDesdeContexto(ctx);
  assert.ok(R.verificarRespuesta(`${base}\nConsulta del 01/01/2020`, ctx).fallas.includes('fecha_no_permitida:01/01/2020'));
  assert.ok(R.verificarRespuesta(base.split(FECHA).join(''), ctx).fallas.includes('falta_fecha_fuente'));
});

// elegirRespuesta

test('elegirRespuesta usa el texto del modelo si pasa el verificador', () => {
  const ctx = ctxPrestamoVerde();
  const texto = R.plantillaDesdeContexto(ctx).split('\n').reverse().join('\n');
  assert.deepEqual(R.elegirRespuesta(`  ${texto}  `, ctx), { texto, origen: 'llm', motivo: 'ok', fallas: [] });
});

test('elegirRespuesta cae a la plantilla si el verificador rechaza', () => {
  const ctx = ctxVerde();
  const plantilla = R.plantillaDesdeContexto(ctx);
  const r = R.elegirRespuesta(`${plantilla}\nTe cobrarán $99,999.`, ctx);
  assert.equal(r.origen, 'plantilla');
  assert.equal(r.motivo, 'verificador_rechazo');
  assert.equal(r.texto, plantilla);
  assert.ok(r.fallas.includes('cifra_no_permitida:$99,999'));
});

test('elegirRespuesta usa la plantilla si el modelo no devolvió texto', () => {
  const ctx = ctxVerde();
  for (const texto of [null, undefined, '', '   ', 42]) {
    const r = R.elegirRespuesta(texto, ctx);
    assert.equal(r.origen, 'plantilla');
    assert.equal(r.motivo, 'sin_texto_llm');
    assert.equal(r.texto, R.plantillaDesdeContexto(ctx));
  }
});

test('elegirRespuesta sin contexto responde con el mensaje de error', () => {
  const r = R.elegirRespuesta('texto', null);
  assert.equal(r.origen, 'plantilla');
  assert.equal(r.motivo, 'sin_contexto');
  assert.equal(r.texto, R.mensajes.error());
});

// verificarConversacion

test('verificarConversacion acepta una pregunta o un saludo sin cifras', () => {
  assert.deepEqual(R.verificarConversacion('¿Me confirmas cuántos pagos son?'), { ok: true, fallas: [] });
});

test('verificarConversacion rechaza lo que solo un cálculo puede decir', () => {
  const casos = [
    ['Pagarás $500 más.', 'cifra_sin_calculo'],
    ['Es 30% más caro.', 'cifra_sin_calculo'],
    ['🟢 Todo bien.', 'color_sin_calculo'],
    ['Te recomiendo contratar.', 'palabra_prohibida'],
    ['Mira https://ejemplo.mx', 'enlace_no_permitido'],
    ['', 'texto_vacio'],
    ['   ', 'texto_vacio'],
    [null, 'texto_vacio'],
    [undefined, 'texto_vacio'],
    [42, 'texto_vacio'],
    ['a'.repeat(R.MAX_CARACTERES + 1), 'demasiado_largo'],
    [Array.from({ length: R.MAX_LINEAS + 1 }, (_, i) => `línea ${i}`).join('\n'), 'demasiadas_lineas'],
  ];
  for (const [texto, falla] of casos) {
    const v = R.verificarConversacion(texto);
    assert.equal(v.ok, false, String(texto).slice(0, 30));
    assert.ok(v.fallas.includes(falla), `${String(texto).slice(0, 30)} -> ${v.fallas}`);
  }
});

// mensajes fijos

test('la bienvenida explica qué hacer y que no es una recomendación', () => {
  const texto = R.mensajes.bienvenida();
  assert.ok(texto.includes('/verificar'));
  assert.match(texto, /oferta/);
  assert.match(texto, /no es una recomendación/i);
});

test('los avisos de texto y de servicio dicen lo acordado en el plan', () => {
  assert.equal(R.mensajes.soloTexto(), 'Por ahora solo leo texto. Pega el texto de tu oferta.');
  assert.equal(R.mensajes.servicioNoDisponible(), 'No pude analizar tu mensaje ahora. Puedes usar /verificar nombre de la entidad.');
});

test('la aclaración pregunta lo mínimo: como máximo dos preguntas', () => {
  const texto = R.mensajes.aclaracion(['¿Cuántos pagos son?', '¿Cada cuánto pagas?', '¿Cuál es el precio?']);
  assert.ok(texto.includes('¿Cuántos pagos son?'));
  assert.ok(texto.includes('¿Cada cuánto pagas?'));
  assert.ok(!texto.includes('¿Cuál es el precio?'));
  const generico = R.mensajes.aclaracion([]);
  assert.ok(generico.length > 0 && !generico.includes('•'));
});

test('el mensaje de /verificar sin nombre explica cómo usarlo', () => {
  const texto = R.mensajes.verificarSinNombre();
  assert.ok(texto.includes('/verificar'));
  assert.match(texto, /nombre/);
});

test('el mensaje de cobranza avisa que por ahora no se analiza', () => {
  const texto = R.mensajes.cobranza();
  assert.match(texto, /cobranza/i);
  assert.match(texto, /por ahora/i);
});

test('el mensaje de verificación dice cada estado sin acusar', () => {
  const registrada = R.mensajes.verificacion({ estado: 'registrada', fecha_consulta: FECHA, terminos_buscados: [], entidad: 'Zafiro' });
  assert.ok(registrada.includes('✅') && registrada.includes(FECHA) && registrada.includes('Zafiro'));

  const noRegistrada = R.mensajes.verificacion({ estado: 'no_registrada_confirmada', fecha_consulta: FECHA, terminos_buscados: ['Nimbo Express', 'Nimbo'], entidad: 'Nimbo Express' });
  assert.ok(noRegistrada.includes('❌') && noRegistrada.includes(FECHA));
  assert.ok(noRegistrada.includes('Términos buscados: Nimbo Express, Nimbo'));

  for (const resultado of [{ estado: 'sin_verificar' }, null, undefined, { estado: 'otro' }]) {
    const sin = R.mensajes.verificacion(resultado);
    assert.ok(sin.includes('❔'));
    assert.ok(!/no registrada/i.test(sin));
  }
});

test('ningún mensaje fijo usa palabras prohibidas', () => {
  const mensajes = [
    R.mensajes.bienvenida(),
    R.mensajes.soloTexto(),
    R.mensajes.servicioNoDisponible(),
    R.mensajes.error(),
    R.mensajes.cobranza(),
    R.mensajes.verificarSinNombre(),
    R.mensajes.aclaracion(['¿Cuántos pagos son?']),
    R.mensajes.verificacion({ estado: 'registrada', fecha_consulta: FECHA, terminos_buscados: [], entidad: 'Zafiro' }),
    R.mensajes.verificacion({ estado: 'no_registrada_confirmada', fecha_consulta: FECHA, terminos_buscados: ['a', 'b'], entidad: 'X' }),
    R.mensajes.verificacion(null),
  ];
  for (const m of mensajes) {
    assert.ok(!R.PROHIBIDAS.some((re) => re.test(normalizar(m))), m);
  }
});
