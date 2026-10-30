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
 *   - no hubo herramientas                -> el texto del modelo solo si no dice nada que requiera un cálculo
 * Devuelve { texto, origen, motivo, fallas }.
 */

const R = require('../respuesta/respuesta');

const MAX_PROFUNDIDAD = 4;
// Herramientas cuyo resultado decide el mensaje. Una consulta a otra herramienta (por ejemplo, un RAG) no cuenta aquí.
const HERRAMIENTAS_DE_CALCULO = ['evaluar_oferta', 'verificar_entidad'];

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clasificar(obj) {
  if ((obj.accion === 'redactar' && esObjeto(obj.ctx)) || (obj.accion === 'responder' && typeof obj.texto === 'string')) return 'evaluar';
  if (typeof obj.estado === 'string' && typeof obj.texto === 'string' && Array.isArray(obj.terminos_buscados)) return 'verificar';
  return null;
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
  const llamoCalculo = Array.isArray(pasos) && pasos.some((p) => esObjeto(p) && esObjeto(p.action) && HERRAMIENTAS_DE_CALCULO.includes(p.action.tool));
  if (llamoCalculo) return { texto: R.mensajes.servicioNoDisponible(), origen: 'servicio', motivo: 'herramienta_fallida', fallas: [] };

  const conversacion = R.verificarConversacion(texto);
  if (conversacion.ok) return { texto: texto.trim(), origen: 'llm', motivo: 'conversacion', fallas: [] };
  return { texto: R.mensajes.error(), origen: 'plantilla', motivo: 'conversacion_rechazada', fallas: conversacion.fallas };
}

module.exports = { leerObservaciones, elegirSalida };
