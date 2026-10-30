'use strict';

/**
 * Qué se le envía a la persona después de que el agente respondió.
 *
 * leerObservaciones(pasos) toma los pasos intermedios del agente de n8n ({ action: { tool, toolInput },
 * observation }) y devuelve los resultados de las herramientas: [{ tipo: 'evaluar' | 'verificar', resultado }].
 * Solo mira lo que la herramienta devolvió (`observation`), nunca lo que el modelo le pidió (`toolInput`):
 * lo que escribe el modelo no puede hacerse pasar por un resultado.
 *
 * elegirSalida({ texto, pasos, error }) decide, con código, qué mensaje sale:
 *   - el agente falló                     -> aviso de que no se pudo analizar
 *   - la herramienta de cálculo respondió -> su pregunta o aclaración, diga lo que diga el modelo
 *   - hubo cálculo para redactar          -> el texto del modelo si pasa el verificador; si no, la plantilla
 *   - el agente verificó una entidad      -> el mensaje de la herramienta
 *   - llamó a una herramienta de cálculo y no hubo resultado válido -> aviso de que no se pudo analizar
 *   - consultó los documentos (consultar_rag) -> el texto del modelo si sus cifras están en los fragmentos, con el
 *     aviso que añade el código; si no, un extracto del primer fragmento; sin resultados o con falla, un aviso.
 *     No se nombra el documento de donde sale la información; solo los contratos RECA y la serie de Banxico llevan
 *     su línea de fuentes, porque son lo que la persona preguntó
 *   - no hubo herramientas                -> el texto del modelo solo si no dice nada que requiera un cálculo
 * Todo texto escrito por el modelo (con o sin documentos) sale en MAX_SALIDA caracteres o menos, avisos incluidos: se
 * corta en una oración completa y la verificación se hace sobre lo que se envía.
 * Devuelve { texto, origen, motivo, fallas }.
 */

const R = require('../respuesta/respuesta');

const MAX_PROFUNDIDAD = 4;
// Herramientas cuyo resultado decide el mensaje. Una consulta a otra herramienta (por ejemplo, un RAG) no cuenta aquí.
const HERRAMIENTAS_DE_CALCULO = ['evaluar_oferta', 'verificar_entidad'];
// Consultas a documentos (RAG semántico y contratos RECA) y la lista de contratos.
const HERRAMIENTAS_DE_CONSULTA = ['consultar_rag', 'consultar_reca'];
const HERRAMIENTA_DE_LISTA = 'listar_reca';
const MAX_EXTRACTO = 500;
const MAX_SALIDA = 1000;
const MIN_TEXTO_CON_PIE = 100;
const MAX_FUENTE = 80;
const MAX_FUENTES = 3;

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esFragmento = (f) => esObjeto(f) && typeof f.text === 'string';

function clasificar(obj) {
  if ((obj.accion === 'redactar' && esObjeto(obj.ctx)) || (obj.accion === 'responder' && typeof obj.texto === 'string')) return 'evaluar';
  if (typeof obj.estado === 'string' && typeof obj.texto === 'string' && Array.isArray(obj.terminos_buscados)) return 'verificar';
  // Respuesta del RAG: { results: [{ text, source, page, ... }] }. Una lista vacía es "sin resultados", no un error.
  if (Array.isArray(obj.results) && obj.results.every(esFragmento)) return 'rag';
  // Lista de contratos RECA: GET /reca/productos -> { productos: [{ registroReca, nombre, institucion, ... }] }
  if (Array.isArray(obj.productos) && obj.productos.every((p) => esObjeto(p) && typeof p.registroReca === 'string' && typeof p.nombre === 'string')) return 'reca_lista';
  return null;
}

/** Quita caracteres de control y espacios repetidos: el texto de un documento no se pega tal cual en un mensaje. */
const limpiar = (valor, maximo) =>
  typeof valor === 'string' ? valor.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximo).trim() : '';

function extracto(texto) {
  const limpio = limpiar(texto, Number.MAX_SAFE_INTEGER);
  return limpio.length > MAX_EXTRACTO ? `${limpio.slice(0, MAX_EXTRACTO).trimEnd()}…` : limpio;
}

/** Nombre legible de la fuente: el contrato RECA por su registro y la serie de Banxico por su clave. */
function etiquetaDeFuente(f) {
  if (f.sourceType === 'RECA' && limpiar(f.registroReca, MAX_FUENTE)) return `RECA ${limpiar(f.registroReca, MAX_FUENTE)}`;
  if (f.sourceType === 'SIE') return `Banxico SIE ${limpiar(f.source, MAX_FUENTE)}`.trim();
  return limpiar(f.source, MAX_FUENTE);
}

/**
 * Corta el texto a `maximo` caracteres: en el final de una oración si hay uno en la segunda mitad; si no, en una palabra,
 * con puntos suspensivos. Lo que queda es siempre un comienzo del texto original. Lo que no es texto se devuelve igual.
 */
function acotar(texto, maximo) {
  if (typeof texto !== 'string') return texto;
  const limpio = texto.trim();
  if (limpio.length <= maximo) return limpio;
  const ventana = limpio.slice(0, maximo);
  let fin = -1;
  for (const m of ventana.matchAll(/[.!?](?=\s|$)/g)) fin = m.index;
  if (fin >= maximo / 2 && limpio.length > fin + 1) return ventana.slice(0, fin + 1);
  const palabra = limpio.slice(0, maximo - 1).replace(/\s+\S*$/, '').trimEnd();
  return `${palabra || limpio.slice(0, maximo - 1)}…`;
}

/** El modelo no debe nombrar el archivo de donde sale la información: ni un .pdf ni el nombre de una fuente general. */
function citaDocumento(texto, fragmentos) {
  if (typeof texto !== 'string') return false;
  if (/\.pdf\b/i.test(texto)) return true;
  const bajo = texto.toLowerCase();
  return fragmentos.some((f) => {
    if (f.sourceType === 'RECA' || f.sourceType === 'SIE') return false;
    const nombre = limpiar(f.source, MAX_FUENTE).toLowerCase().replace(/\.pdf$/, '').trim();
    return nombre.length >= 4 && bajo.includes(nombre);
  });
}

function lineaDeFuentes(fragmentos) {
  const grupos = new Map();
  for (const f of fragmentos) {
    const etiqueta = etiquetaDeFuente(f);
    if (!etiqueta) continue;
    if (!grupos.has(etiqueta)) {
      if (grupos.size === MAX_FUENTES) continue;
      grupos.set(etiqueta, []);
    }
    const paginas = grupos.get(etiqueta);
    if (Number.isInteger(f.page) && f.page > 0 && !paginas.includes(f.page)) paginas.push(f.page);
  }
  if (grupos.size === 0) return null;
  const partes = Array.from(grupos, ([etiqueta, paginas]) => (paginas.length ? `${etiqueta} (p. ${paginas.join(', ')})` : etiqueta));
  return `Fuentes: ${partes.join('; ')}`;
}

function salidaRag(texto, rag) {
  const fragmentos = rag.results;
  if (fragmentos.length === 0 || rag.estado === 'registro_no_encontrado' || rag.estadoRecuperacionContrato === 'sin_coincidencias') {
    return { texto: R.mensajes.ragSinResultados(), origen: 'herramienta', motivo: 'rag_sin_resultados', fallas: [] };
  }
  const hay = (tipo) => fragmentos.some((f) => f.sourceType === tipo);
  // Solo el contrato RECA y la serie de Banxico se nombran; el resto de los documentos no se revela.
  const fuentes = fragmentos.filter((f) => f.sourceType === 'RECA' || f.sourceType === 'SIE');
  const pie = [R.AVISO_RAG, hay('RECA') && R.AVISO_RECA, hay('SIE') && R.AVISO_SIE, lineaDeFuentes(fuentes)].filter(Boolean);
  const presupuesto = Math.max(MIN_TEXTO_CON_PIE, MAX_SALIDA - pie.join('\n').length - 1);
  // El modelo también puede citar las cláusulas candidatas que el servicio extrajo de cada contrato.
  const clausulas = Array.isArray(rag.condiciones) ? rag.condiciones.map((c) => c && c.resumen_candidato).filter((s) => typeof s === 'string') : [];
  const enviado = acotar(texto, presupuesto);
  const verificacion = R.verificarConversacion(enviado, [...fragmentos.map((f) => f.text), ...clausulas]);
  const fallas = citaDocumento(enviado, fragmentos) ? [...verificacion.fallas, 'cita_documento'] : verificacion.fallas;
  if (verificacion.ok && fallas.length === 0) return { texto: [enviado, ...pie].join('\n'), origen: 'llm', motivo: 'rag', fallas: [] };
  return { texto: [acotar(extracto(fragmentos[0].text), presupuesto), ...pie].join('\n'), origen: 'plantilla', motivo: 'rag_rechazo', fallas };
}

/** Busca resultados de herramientas en lo que n8n entregó: objetos, listas, { json }, o texto JSON. */
function buscar(valor, salida, profundidad = 0) {
  if (profundidad > MAX_PROFUNDIDAD) return;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (!texto.startsWith('{') && !texto.startsWith('[')) return;
    try {
      buscar(JSON.parse(texto), salida, profundidad + 1);
    } catch {
      // no era JSON: no es un resultado
    }
    return;
  }
  if (Array.isArray(valor)) {
    valor.forEach((v) => buscar(v, salida, profundidad + 1));
    return;
  }
  if (!esObjeto(valor)) return;
  const tipo = clasificar(valor);
  if (tipo) salida.push({ tipo, resultado: valor });
  else Object.values(valor).forEach((v) => buscar(v, salida, profundidad + 1));
}

function leerObservaciones(pasos) {
  if (!Array.isArray(pasos)) return [];
  const salida = [];
  for (const paso of pasos) {
    if (esObjeto(paso)) buscar(paso.observation, salida);
  }
  return salida;
}

function elegirSalida({ texto, pasos, error } = {}) {
  if (error) return { texto: R.mensajes.servicioNoDisponible(), origen: 'servicio', motivo: 'error_agente', fallas: [] };

  const lectura = leerObservaciones(pasos);
  const ultimo = (tipo) => {
    for (let i = lectura.length - 1; i >= 0; i--) if (lectura[i].tipo === tipo) return lectura[i].resultado;
    return null;
  };

  const evaluar = ultimo('evaluar');
  if (evaluar) {
    if (evaluar.accion === 'responder') return { texto: evaluar.texto, origen: 'herramienta', motivo: evaluar.motivo || 'responder', fallas: [] };
    return R.elegirRespuesta(texto, evaluar.ctx);
  }

  const verificar = ultimo('verificar');
  if (verificar) return { texto: verificar.texto, origen: 'herramienta', motivo: 'verificacion', fallas: [] };

  // Llamó a una herramienta de cálculo y no hubo un resultado válido (sub-workflow inactivo, error, tiempo agotado):
  // lo que diga el modelo no está respaldado por ningún cálculo.
  const llamo = (nombres) => Array.isArray(pasos) && pasos.some((p) => esObjeto(p) && esObjeto(p.action) && nombres.includes(p.action.tool));
  if (llamo(HERRAMIENTAS_DE_CALCULO)) return { texto: R.mensajes.servicioNoDisponible(), origen: 'servicio', motivo: 'herramienta_fallida', fallas: [] };

  // Consulta a documentos: con resultados, el texto del modelo solo sale si sus cifras están en los fragmentos.
  const ragNoDisponible = { texto: R.mensajes.ragNoDisponible(), origen: 'servicio', motivo: 'rag_fallido', fallas: [] };
  const rag = ultimo('rag');
  if (rag) return salidaRag(texto, rag);
  if (llamo(HERRAMIENTAS_DE_CONSULTA)) return ragNoDisponible;
  const lista = ultimo('reca_lista');
  if (lista) return { texto: R.mensajes.recaLista(lista.productos), origen: 'herramienta', motivo: 'reca_lista', fallas: [] };
  if (llamo([HERRAMIENTA_DE_LISTA])) return ragNoDisponible;

  const enviado = acotar(texto, MAX_SALIDA);
  const conversacion = R.verificarConversacion(enviado);
  if (conversacion.ok) return { texto: enviado, origen: 'llm', motivo: 'conversacion', fallas: [] };
  return { texto: R.mensajes.error(), origen: 'plantilla', motivo: 'conversacion_rechazada', fallas: conversacion.fallas };
}

module.exports = { leerObservaciones, elegirSalida, MAX_SALIDA };
