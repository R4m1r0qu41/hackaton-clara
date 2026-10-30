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
 *     aviso y las fuentes que añade el código; si no, un extracto del primer fragmento; sin resultados o con falla,
 *     un aviso
 *   - no hubo herramientas                -> el texto del modelo solo si no dice nada que requiera un cálculo
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
  const pie = [R.AVISO_RAG, hay('RECA') && R.AVISO_RECA, hay('SIE') && R.AVISO_SIE, lineaDeFuentes(fragmentos)].filter(Boolean);
  // El modelo también puede citar las cláusulas candidatas que el servicio extrajo de cada contrato.
  const clausulas = Array.isArray(rag.condiciones) ? rag.condiciones.map((c) => c && c.resumen_candidato).filter((s) => typeof s === 'string') : [];
  const verificacion = R.verificarConversacion(texto, [...fragmentos.map((f) => f.text), ...clausulas]);
  if (verificacion.ok) return { texto: [texto.trim(), ...pie].join('\n'), origen: 'llm', motivo: 'rag', fallas: [] };
  return { texto: [extracto(fragmentos[0].text), ...pie].join('\n'), origen: 'plantilla', motivo: 'rag_rechazo', fallas: verificacion.fallas };
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

  const conversacion = R.verificarConversacion(texto);
  if (conversacion.ok) return { texto: texto.trim(), origen: 'llm', motivo: 'conversacion', fallas: [] };
  return { texto: R.mensajes.error(), origen: 'plantilla', motivo: 'conversacion_rechazada', fallas: conversacion.fallas };
}

module.exports = { leerObservaciones, elegirSalida };
