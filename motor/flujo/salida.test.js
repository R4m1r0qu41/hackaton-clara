'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { leerObservaciones, elegirSalida, MAX_SALIDA } = require('./salida');
const { procesar } = require('./procesar');
const { buscarEntidad } = require('../sipres/sipres');
const R = require('../respuesta/respuesta');

const FECHA = '30/10/2026';
// Entidad ficticia: no corresponde a una empresa real.
const TABLA = [{ nombre_comercial: 'Zafiro', razon_social: null, estado: 'registrada', terminos_buscados: ['Zafiro', 'Zafiro Soluciones'], fecha_consulta: FECHA }];

const tienda = (credito = {}) => ({
  tipo_entrada: 'etiqueta_tienda',
  confianza_extraccion: 0.9,
  producto: { descripcion: 'Producto de ejemplo', precio_contado: 10000, tienda: 'Tienda de ejemplo' },
  credito: { enganche: 0, abono: 1000, periodicidad: 'mensual', numero_pagos: 11, comisiones: [], seguros: [], ...credito },
  senales_riesgo: {},
  datos_faltantes: [],
});

const evaluado = () => procesar({ extraccion: tienda(), tablaSipres: TABLA, hoy: FECHA });
const pregunta = () => procesar({ extraccion: tienda({ abono: null }), tablaSipres: TABLA, hoy: FECHA });
const verificacion = () => {
  const r = buscarEntidad(TABLA, { nombre_comercial: 'Zafiro' });
  return { ...r, texto: R.mensajes.verificacion(r) };
};

// Fragmentos con la forma que devuelve el RAG de Eugenio: { results: [{ text, source, page, chunkIndex, similarity }] }.
const fragmentos = [
  { text: 'La anualidad de la tarjeta Oro es de $1,200 y su CAT promedio es 45.5%.', source: 'TarjetasOro.pdf', page: 2, chunkIndex: 0, similarity: 0.82 },
  { text: 'La tarjeta Platino ofrece seguro de viaje sin costo adicional.', source: 'TarjetasPlatino.pdf', page: 1, chunkIndex: 3, similarity: 0.61 },
];
const consultaRag = () => ({ results: fragmentos });

// Respuestas del RAG con la forma real de la rama Eugenio (GET /reca/productos y POST /query con registroReca).
const REGISTRO = '17102-140-044679/01-02644-1026';
const consultaReca = (cambios = {}) => ({
  results: [
    { text: `RECA: ${REGISTRO} El acreditado pagará 5% más IVA sobre el saldo vencido por gastos de cobranza.`, source: '144572c.pdf', page: 5, chunkIndex: 0, score: 3, sourceType: 'RECA', registroReca: REGISTRO },
    { text: `RECA: ${REGISTRO} Título ejecutivo. Este contrato es título ejecutivo.`, source: '144572c.pdf', page: 7, chunkIndex: 0, score: 1, sourceType: 'RECA', registroReca: REGISTRO },
    { text: 'Interés ordinario de referencia: 39.0809%, promedio ponderado de cartera comparable de créditos personales. No es CAT ni tasa individual del producto.', source: 'SF316116', page: null, chunkIndex: 0, sourceType: 'SIE' },
  ],
  estado: 'piloto_referencia_promedio',
  estadoRecuperacionContrato: 'con_evidencia',
  registroReca: REGISTRO,
  producto: 'CREDICHIC FLEX',
  condiciones: [{ tipo: 'maximo_ordinario', resumen_candidato: 'Interés ordinario máximo de 45% anual según el contrato.' }],
  advertencias: ['Referencia SIE aceptada para el piloto; no es CAT ni tasa individual.'],
  ...cambios,
});
const listaReca = () => ({
  productos: [
    { registroReca: REGISTRO, nombre: 'CREDICHIC FLEX', institucion: 'Credichic, S.A. de C.V., SOFOM, E.N.R.', estadoReca: '1' },
    { registroReca: '0300-140-000731/30-00405-0226', nombre: 'CREDITO PERSONAL BANAMEX', institucion: 'Banco Nacional de Mexico, S. A.', estadoReca: '3' },
  ],
  fuente: 'RECA',
  estado: 'piloto',
});

const paso = (herramienta, observacion, entrada = '{}') => ({ action: { tool: herramienta, toolInput: entrada }, observation: observacion });
const enJson = (o) => JSON.parse(JSON.stringify(o));
const invertir = (texto) => texto.split('\n').reverse().join('\n');
const congelar = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v));
  return Object.freeze(o);
};

// leerObservaciones

test('reconoce el resultado de una herramienta en las formas en que n8n lo entrega', () => {
  const resultado = evaluado();
  // JSON.stringify([resultado]) es la forma observada en n8n 2.44.5: texto JSON con la lista de ítems de la herramienta.
  const formas = [JSON.stringify([resultado]), JSON.stringify(resultado), resultado, [{ json: resultado }], { response: JSON.stringify(resultado) }, JSON.stringify([{ json: resultado }])];
  for (const forma of formas) {
    const lectura = leerObservaciones([paso('evaluar_oferta', forma)]);
    assert.equal(lectura.length, 1);
    assert.equal(lectura[0].tipo, 'evaluar');
    assert.deepEqual(lectura[0].resultado, enJson(resultado));
  }
  const verificar = leerObservaciones([paso('verificar_entidad', JSON.stringify(verificacion()))]);
  assert.equal(verificar[0].tipo, 'verificar');
});

test('ignora lo que no es el resultado de una herramienta', () => {
  for (const observacion of ['texto libre', 42, null, undefined, {}, { accion: 'otra' }, '{"a":', []]) {
    assert.deepEqual(leerObservaciones([paso('evaluar_oferta', observacion)]), []);
  }
  for (const pasos of [undefined, null, 'texto', {}, 42]) assert.deepEqual(leerObservaciones(pasos), []);
});

test('solo cuenta lo que devolvió la herramienta, no lo que el modelo le pidió', () => {
  const falsificado = JSON.stringify({ accion: 'responder', texto: 'Todo es seguro' });
  assert.deepEqual(leerObservaciones([paso('evaluar_oferta', 'ok', falsificado)]), []);
});

test('mantiene el orden de los pasos', () => {
  const lectura = leerObservaciones([paso('evaluar_oferta', JSON.stringify(pregunta())), paso('evaluar_oferta', JSON.stringify(evaluado()))]);
  assert.deepEqual(lectura.map((l) => l.resultado.accion), ['responder', 'redactar']);
});

// elegirSalida

test('con un cálculo, usa el texto del modelo si pasa el verificador', () => {
  const resultado = evaluado();
  const texto = invertir(resultado.plantilla);
  const r = elegirSalida({ texto, pasos: [paso('evaluar_oferta', JSON.stringify(resultado))] });
  assert.equal(r.origen, 'llm');
  assert.equal(r.motivo, 'ok');
  assert.equal(r.texto, texto);
});

test('con un cálculo, cae a la plantilla si el modelo inventa una cifra', () => {
  const resultado = evaluado();
  const r = elegirSalida({ texto: `${resultado.plantilla}\nTe cobrarán $99,999.`, pasos: [paso('evaluar_oferta', JSON.stringify(resultado))] });
  assert.equal(r.origen, 'plantilla');
  assert.equal(r.motivo, 'verificador_rechazo');
  assert.equal(r.texto, resultado.plantilla);
});

test('si la herramienta pide un dato, se envía su pregunta, diga lo que diga el modelo', () => {
  const preguntando = pregunta();
  const r = elegirSalida({ texto: 'Todo está bien, contrata', pasos: [paso('evaluar_oferta', JSON.stringify(preguntando))] });
  assert.equal(r.texto, preguntando.texto);
  assert.equal(r.origen, 'herramienta');
  assert.equal(r.motivo, 'datos_insuficientes');
});

test('si el agente verificó una entidad, se envía el mensaje de la herramienta', () => {
  const r = elegirSalida({ texto: 'Sí, es segura', pasos: [paso('verificar_entidad', JSON.stringify(verificacion()))] });
  assert.equal(r.texto, verificacion().texto);
  assert.equal(r.origen, 'herramienta');
  assert.equal(r.motivo, 'verificacion');
});

test('si hubo cálculo y verificación, gana el cálculo', () => {
  const resultado = evaluado();
  const r = elegirSalida({
    texto: invertir(resultado.plantilla),
    pasos: [paso('verificar_entidad', JSON.stringify(verificacion())), paso('evaluar_oferta', JSON.stringify(resultado))],
  });
  assert.equal(r.origen, 'llm');
});

test('el último cálculo es el que cuenta', () => {
  const primero = elegirSalida({ texto: 'x', pasos: [paso('evaluar_oferta', JSON.stringify(pregunta())), paso('evaluar_oferta', JSON.stringify(evaluado()))] });
  assert.equal(primero.motivo, 'verificador_rechazo');
  const segundo = elegirSalida({ texto: 'x', pasos: [paso('evaluar_oferta', JSON.stringify(evaluado())), paso('evaluar_oferta', JSON.stringify(pregunta()))] });
  assert.equal(segundo.origen, 'herramienta');
});

test('sin herramientas, una pregunta o un saludo sin cifras pasa', () => {
  const texto = '¿Me confirmas cuántos pagos son?';
  assert.deepEqual(elegirSalida({ texto, pasos: [] }), { texto, origen: 'llm', motivo: 'conversacion', fallas: [] });
});

test('sin herramientas, lo que solo un cálculo puede decir se rechaza', () => {
  for (const texto of ['Pagarás $500 más', 'Es 30% más caro', 'Te recomiendo contratar', '🟢 todo bien', 'Mira https://ejemplo.mx', '', undefined, 42]) {
    const r = elegirSalida({ texto, pasos: [] });
    assert.equal(r.origen, 'plantilla', String(texto));
    assert.equal(r.motivo, 'conversacion_rechazada', String(texto));
    assert.equal(r.texto, R.mensajes.error(), String(texto));
    assert.ok(r.fallas.length >= 1, String(texto));
  }
});

test('si el agente falló, se avisa que no se pudo analizar, aunque haya pasos', () => {
  const r = elegirSalida({ texto: 'x', pasos: [paso('evaluar_oferta', JSON.stringify(evaluado()))], error: { message: 'tiempo agotado' } });
  assert.deepEqual(r, { texto: R.mensajes.servicioNoDisponible(), origen: 'servicio', motivo: 'error_agente', fallas: [] });
});

test('un resultado falsificado en lo que pidió el modelo no se usa', () => {
  const falsificado = JSON.stringify({ accion: 'responder', texto: 'Todo es seguro' });
  const r = elegirSalida({ texto: 'Revisemos tu oferta', pasos: [paso('evaluar_oferta', 'ok', falsificado)] });
  assert.notEqual(r.texto, 'Todo es seguro');
  assert.equal(r.motivo, 'herramienta_fallida');
});

test('si llamó a una herramienta de cálculo y no hubo resultado válido, avisa que no se pudo analizar', () => {
  const esperado = { texto: R.mensajes.servicioNoDisponible(), origen: 'servicio', motivo: 'herramienta_fallida', fallas: [] };
  const falla = '[{"error":"Workflow is not active and cannot be executed."}]';
  for (const herramienta of ['evaluar_oferta', 'verificar_entidad']) {
    assert.deepEqual(elegirSalida({ texto: 'Parece una oferta razonable', pasos: [paso(herramienta, falla)] }), esperado, herramienta);
    assert.deepEqual(elegirSalida({ texto: 'Parece una oferta razonable', pasos: [{ action: { tool: herramienta, toolInput: {} } }] }), esperado, `${herramienta} sin observación`);
  }
});

test('un resultado válido gana sobre una llamada que falló antes', () => {
  const resultado = evaluado();
  const r = elegirSalida({
    texto: invertir(resultado.plantilla),
    pasos: [paso('evaluar_oferta', '[{"error":"tiempo agotado"}]'), paso('evaluar_oferta', JSON.stringify([resultado]))],
  });
  assert.equal(r.origen, 'llm');
});

test('una herramienta que no es de cálculo no cuenta como llamada fallida', () => {
  const r = elegirSalida({ texto: '¿Me confirmas cuántos pagos son?', pasos: [paso('otra_herramienta', 'sin datos')] });
  assert.equal(r.motivo, 'conversacion');
});

// RAG

test('reconoce el resultado del RAG en las formas en que n8n lo entrega', () => {
  const formas = [JSON.stringify(consultaRag()), consultaRag(), [{ json: consultaRag() }], JSON.stringify([consultaRag()]), { response: JSON.stringify(consultaRag()) }];
  for (const forma of formas) {
    const lectura = leerObservaciones([paso('consultar_rag', forma)]);
    assert.equal(lectura.length, 1);
    assert.equal(lectura[0].tipo, 'rag');
    assert.deepEqual(lectura[0].resultado.results, fragmentos);
  }
});

test('una respuesta de error del RAG no se toma como resultado', () => {
  for (const observacion of ['{"error":"unauthorized"}', '{"results":"no es lista"}', '{"results":[{"source":"a.pdf"}]}', 'Bad gateway']) {
    assert.deepEqual(leerObservaciones([paso('consultar_rag', observacion)]), [], observacion);
  }
});

test('con resultados del RAG, el texto del modelo sale con su aviso, sin revelar de qué documento viene, si solo usa cifras de los fragmentos', () => {
  const texto = 'La anualidad de la tarjeta Oro es de $1,200.';
  const r = elegirSalida({ texto, pasos: [paso('consultar_rag', JSON.stringify(consultaRag()))] });
  assert.equal(r.origen, 'llm');
  assert.equal(r.motivo, 'rag');
  assert.deepEqual(r.fallas, []);
  assert.ok(r.texto.startsWith(texto));
  assert.ok(r.texto.includes(R.AVISO_RAG));
  assert.equal(r.texto, `${texto}\n${R.AVISO_RAG}`);
  assert.ok(!/Fuentes|Tarjetas(Oro|Platino)|\.pdf|\(p\./i.test(r.texto), r.texto);
});

test('si el modelo agrega algo que los fragmentos no dicen, sale un extracto del primer fragmento', () => {
  const casos = [
    ['Cuesta $9,999 al año.', 'cifra_fuera_de_la_fuente'],
    ['Es 99% seguro.', 'cifra_fuera_de_la_fuente'],
    ['🟢 Todo bien.', 'color_sin_calculo'],
    ['Te recomiendo contratarla.', 'palabra_prohibida'],
    [undefined, 'texto_vacio'],
  ];
  for (const [texto, falla] of casos) {
    const r = elegirSalida({ texto, pasos: [paso('consultar_rag', JSON.stringify(consultaRag()))] });
    assert.equal(r.origen, 'plantilla', String(texto));
    assert.equal(r.motivo, 'rag_rechazo', String(texto));
    assert.ok(r.fallas.includes(falla), `${String(texto)} -> ${r.fallas}`);
    assert.ok(r.texto.startsWith('La anualidad de la tarjeta Oro'), String(texto));
    assert.ok(r.texto.includes(R.AVISO_RAG), String(texto));
    assert.ok(!r.texto.includes('9,999') && !r.texto.includes('99%'), String(texto));
  }
});

test('una respuesta natural que cita cifras de una tabla sin símbolos sale con el texto del modelo', () => {
  const tabla = { text: 'Uso Público 26 Oro (Banorte) www.banorte.com/oro 1,150 95.7 27 Scotia Travel Oro www.scotiabank.com.mx/oro 1,209 96.7', source: 'TarjetasOro.pdf', page: 2, chunkIndex: 0, similarity: 0.21 };
  const texto = 'La tarjeta Oro de Banorte tiene una comisión por administración de $1,150 pesos al año y un CAT de publicidad de 95.7%.';
  const r = elegirSalida({ texto, pasos: [paso('consultar_rag', JSON.stringify({ results: [tabla] }))] });
  assert.equal(r.origen, 'llm');
  assert.equal(r.motivo, 'rag');
  assert.ok(r.texto.startsWith(texto));
  const inventada = elegirSalida({ texto: texto.replace('$1,150', '$1,999'), pasos: [paso('consultar_rag', JSON.stringify({ results: [tabla] }))] });
  assert.equal(inventada.motivo, 'rag_rechazo');
});

test('el extracto se limpia y se acota a 500 caracteres', () => {
  const largo = { text: `Línea uno\n\n${'a'.repeat(900)}`, source: 'Largo.pdf', page: 4 };
  const r = elegirSalida({ texto: 'Te cobrarán $9,999', pasos: [paso('consultar_rag', JSON.stringify({ results: [largo] }))] });
  const extracto = r.texto.split('\n')[0];
  assert.ok(extracto.length <= 501);
  assert.ok(extracto.startsWith('Línea uno aaaa'));
  assert.ok(extracto.endsWith('…'));
});

test('los documentos generales no se nombran ni en el texto del modelo ni en el extracto', () => {
  const raro = { text: 'Dato.', source: 'Raro\n.pdf\u0007', page: undefined };
  const ok = elegirSalida({ texto: 'Dato.', pasos: [paso('consultar_rag', JSON.stringify({ results: [raro] }))] });
  assert.equal(ok.texto, `Dato.\n${R.AVISO_RAG}`);
  const rechazo = elegirSalida({ texto: 'Cuesta $9,999.', pasos: [paso('consultar_rag', JSON.stringify(consultaRag()))] });
  assert.equal(rechazo.motivo, 'rag_rechazo');
  assert.ok(!/Fuentes|\.pdf|Tarjetas(Oro|Platino)/i.test(rechazo.texto), rechazo.texto);
});

test('si el modelo nombra el documento, sale el extracto en lugar de su texto', () => {
  for (const texto of ['Según TarjetasOro.pdf la anualidad es de $1,200.', 'El archivo tarjetasplatino dice que hay seguro de viaje.', 'La anualidad viene en el comparativo.pdf: $1,200.']) {
    const r = elegirSalida({ texto, pasos: [paso('consultar_rag', JSON.stringify(consultaRag()))] });
    assert.equal(r.motivo, 'rag_rechazo', texto);
    assert.ok(r.fallas.includes('cita_documento'), `${texto} -> ${r.fallas}`);
    assert.ok(!r.texto.includes(texto), texto);
  }
});

test('el texto del modelo no se limita por mencionar la palabra documentos en general', () => {
  const texto = 'En general, los documentos del crédito deben mostrar el CAT.';
  assert.equal(elegirSalida({ texto, pasos: [paso('consultar_rag', JSON.stringify(consultaRag()))] }).motivo, 'rag');
});

const ORACION = 'El CAT es el costo anual total de un crédito y sirve para comparar ofertas. ';
const parrafo = (veces) => ORACION.repeat(veces).trim();

test('sin herramientas, una explicación larga se acota a 1000 caracteres en una oración completa', () => {
  const texto = parrafo(30);
  assert.ok(texto.length > 2000);
  const r = elegirSalida({ texto, pasos: [] });
  assert.equal(r.origen, 'llm');
  assert.equal(r.motivo, 'conversacion');
  assert.ok(r.texto.length <= MAX_SALIDA, String(r.texto.length));
  assert.ok(r.texto.length > 900);
  assert.ok(r.texto.endsWith('ofertas.'));
  assert.ok(texto.startsWith(r.texto));
});

test('un texto de 1000 caracteres o menos no se toca', () => {
  const texto = parrafo(12).slice(0, 1000);
  const r = elegirSalida({ texto: `${texto.trim()}`, pasos: [] });
  assert.equal(r.texto, texto.trim());
  assert.equal(elegirSalida({ texto: 'Hola', pasos: [] }).texto, 'Hola');
});

test('sin un final de oración a la vista se corta en una palabra y se marca con puntos suspensivos', () => {
  const texto = 'palabra '.repeat(400);
  const r = elegirSalida({ texto, pasos: [] });
  assert.ok(r.texto.length <= MAX_SALIDA);
  assert.ok(r.texto.endsWith('…'));
  assert.ok(!/palabr…$/.test(r.texto));
});

test('el límite se verifica sobre lo que se envía: lo que queda fuera no puede hacer fallar el mensaje', () => {
  const texto = `${parrafo(14)} Después te cobrarán $9,999 al mes.`;
  const r = elegirSalida({ texto, pasos: [] });
  assert.equal(r.motivo, 'conversacion');
  assert.ok(!r.texto.includes('9,999'));
  const dentro = elegirSalida({ texto: `Te cobrarán $9,999. ${parrafo(30)}`, pasos: [] });
  assert.equal(dentro.motivo, 'conversacion_rechazada');
});

test('con el RAG, el mensaje completo (texto, aviso y fuentes) cabe en 1000 caracteres y los avisos quedan íntegros', () => {
  const texto = parrafo(30);
  const general = elegirSalida({ texto, pasos: [paso('consultar_rag', JSON.stringify(consultaRag()))] });
  assert.equal(general.motivo, 'rag');
  assert.ok(general.texto.length <= MAX_SALIDA, String(general.texto.length));
  assert.ok(general.texto.endsWith(R.AVISO_RAG));
  const reca = elegirSalida({ texto, pasos: [paso('consultar_reca', JSON.stringify([consultaReca()]))] });
  assert.equal(reca.motivo, 'rag');
  assert.ok(reca.texto.length <= MAX_SALIDA, String(reca.texto.length));
  for (const aviso of [R.AVISO_RAG, R.AVISO_RECA, R.AVISO_SIE]) assert.ok(reca.texto.includes(aviso), aviso);
  assert.match(reca.texto, /Fuentes: RECA /);
});

test('el extracto de un fragmento largo también deja el mensaje en 1000 caracteres o menos', () => {
  const largo = { text: 'a '.repeat(900), source: 'SF316116', page: null, sourceType: 'SIE' };
  const r = elegirSalida({ texto: 'Cuesta $9,999.', pasos: [paso('consultar_reca', JSON.stringify([{ ...consultaReca(), results: [largo, ...consultaReca().results] }]))] });
  assert.equal(r.motivo, 'rag_rechazo');
  assert.ok(r.texto.length <= MAX_SALIDA, String(r.texto.length));
  assert.ok(r.texto.includes(R.AVISO_SIE));
});

test('sin resultados del RAG se dice que no hay información', () => {
  const r = elegirSalida({ texto: 'Sí hay mucha información', pasos: [paso('consultar_rag', JSON.stringify({ results: [] }))] });
  assert.deepEqual(r, { texto: R.mensajes.ragSinResultados(), origen: 'herramienta', motivo: 'rag_sin_resultados', fallas: [] });
});

test('si el RAG falló, se avisa que no se pudo consultar', () => {
  for (const observacion of ['{"error":"unauthorized"}', 'Bad gateway', undefined]) {
    const r = elegirSalida({ texto: 'Según mis datos el CAT es 50%', pasos: [{ action: { tool: 'consultar_rag', toolInput: {} }, observation: observacion }] });
    assert.deepEqual(r, { texto: R.mensajes.ragNoDisponible(), origen: 'servicio', motivo: 'rag_fallido', fallas: [] });
  }
});

test('un cálculo o una verificación válidos ganan sobre el RAG', () => {
  const resultado = evaluado();
  const r = elegirSalida({ texto: invertir(resultado.plantilla), pasos: [paso('consultar_rag', JSON.stringify(consultaRag())), paso('evaluar_oferta', JSON.stringify([resultado]))] });
  assert.equal(r.origen, 'llm');
  assert.equal(r.motivo, 'ok');
  const v = elegirSalida({ texto: 'x', pasos: [paso('consultar_rag', JSON.stringify(consultaRag())), paso('verificar_entidad', JSON.stringify([verificacion()]))] });
  assert.equal(v.motivo, 'verificacion');
});

test('si el cálculo falló, el RAG no tapa el fallo', () => {
  const r = elegirSalida({ texto: 'La anualidad es de $1,200.', pasos: [paso('evaluar_oferta', '[{"error":"tiempo agotado"}]'), paso('consultar_rag', JSON.stringify(consultaRag()))] });
  assert.equal(r.motivo, 'herramienta_fallida');
});

// RECA

test('reconoce la respuesta de RECA y la lista de contratos', () => {
  const reca = leerObservaciones([paso('consultar_reca', JSON.stringify([consultaReca()]))]);
  assert.equal(reca[0].tipo, 'rag');
  assert.equal(reca[0].resultado.producto, 'CREDICHIC FLEX');
  const lista = leerObservaciones([paso('listar_reca', JSON.stringify([listaReca()]))]);
  assert.equal(lista[0].tipo, 'reca_lista');
  assert.equal(lista[0].resultado.productos.length, 2);
  assert.deepEqual(leerObservaciones([paso('listar_reca', '{"productos":[{"nombre":"x"}]}')]), []);
});

test('con RECA, el texto natural sale con los avisos y fuentes legibles', () => {
  const texto = 'Según el contrato, el cobro por mora es de 5% más IVA sobre el saldo vencido. Como referencia, el promedio de mercado es de 39.0809%.';
  const r = elegirSalida({ texto, pasos: [paso('consultar_reca', JSON.stringify([consultaReca()]))] });
  assert.equal(r.origen, 'llm');
  assert.equal(r.motivo, 'rag');
  assert.ok(r.texto.startsWith(texto));
  for (const aviso of [R.AVISO_RAG, R.AVISO_RECA, R.AVISO_SIE]) assert.ok(r.texto.includes(aviso), aviso);
  assert.match(r.texto, new RegExp(`Fuentes: RECA ${REGISTRO.replace(/[/.]/g, '\\$&')} \\(p\\. 5, 7\\); Banxico SIE SF316116$`));
});

test('sin referencia de Banxico no se agrega su aviso', () => {
  const sinSie = consultaReca();
  sinSie.results = sinSie.results.filter((x) => x.sourceType !== 'SIE');
  const r = elegirSalida({ texto: 'El cobro por mora es de 5% más IVA.', pasos: [paso('consultar_reca', JSON.stringify([sinSie]))] });
  assert.ok(r.texto.includes(R.AVISO_RECA));
  assert.ok(!r.texto.includes(R.AVISO_SIE));
});

test('con RECA, el texto puede citar cifras de las cláusulas candidatas pero no inventar otras', () => {
  const pasos = [paso('consultar_reca', JSON.stringify([consultaReca()]))];
  assert.equal(elegirSalida({ texto: 'El interés ordinario máximo es de 45% anual.', pasos }).motivo, 'rag');
  const inventada = elegirSalida({ texto: 'El interés ordinario máximo es de 60% anual.', pasos });
  assert.equal(inventada.motivo, 'rag_rechazo');
  assert.ok(inventada.texto.startsWith('RECA:'));
});

test('si el contrato no tiene coincidencias o no existe, se dice sin repetir la referencia como respuesta', () => {
  for (const cambios of [{ estadoRecuperacionContrato: 'sin_coincidencias' }, { estado: 'registro_no_encontrado', results: [] }]) {
    const r = elegirSalida({ texto: 'El promedio es 39.0809%.', pasos: [paso('consultar_reca', JSON.stringify([consultaReca(cambios)]))] });
    assert.deepEqual(r, { texto: R.mensajes.ragSinResultados(), origen: 'herramienta', motivo: 'rag_sin_resultados', fallas: [] });
  }
});

test('la lista de contratos la arma el código, no el modelo', () => {
  const r = elegirSalida({ texto: 'Tengo 500 contratos, todos seguros.', pasos: [paso('listar_reca', JSON.stringify([listaReca()]))] });
  assert.equal(r.texto, R.mensajes.recaLista(listaReca().productos));
  assert.equal(r.origen, 'herramienta');
  assert.equal(r.motivo, 'reca_lista');
  assert.ok(r.texto.includes('CREDICHIC FLEX') && r.texto.includes(REGISTRO));
});

test('si fallan consultar_reca o listar_reca se avisa que no se pudo consultar', () => {
  for (const herramienta of ['consultar_reca', 'listar_reca']) {
    const r = elegirSalida({ texto: 'Tienes un contrato excelente', pasos: [paso(herramienta, '{"error":"unauthorized"}')] });
    assert.deepEqual(r, { texto: R.mensajes.ragNoDisponible(), origen: 'servicio', motivo: 'rag_fallido', fallas: [] });
  }
});

test('una consulta a un contrato gana sobre la lista', () => {
  const r = elegirSalida({ texto: 'El cobro por mora es de 5% más IVA.', pasos: [paso('listar_reca', JSON.stringify([listaReca()])), paso('consultar_reca', JSON.stringify([consultaReca()]))] });
  assert.equal(r.motivo, 'rag');
});

test('sin argumentos no lanza excepciones', () => {
  assert.equal(elegirSalida().motivo, 'conversacion_rechazada');
});

test('no modifica sus entradas', () => {
  const resultado = evaluado();
  const entrada = congelar({ texto: resultado.plantilla, pasos: [paso('evaluar_oferta', JSON.stringify(resultado))] });
  assert.doesNotThrow(() => elegirSalida(entrada));
});
