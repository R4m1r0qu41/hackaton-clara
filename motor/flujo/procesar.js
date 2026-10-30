'use strict';

/**
 * Orquestador: lo que hace la herramienta `evaluar_oferta` del bot.
 *
 * procesar({ extraccion, tablaSipres, config, hoy }) devuelve SIEMPRE un objeto:
 *   { accion: 'responder', texto, motivo, log, advertencias }  -> enviar `texto` tal cual
 *   { accion: 'redactar', ctx, plantilla, log, advertencias }  -> el modelo redacta con `ctx`, o se envía `plantilla`
 *
 * Encadena: validar extracción -> (SIPRES si es un préstamo) -> calcular -> semáforo -> contexto.
 * No guarda nada, no llama a ninguna API y no copia el texto de la persona: el log solo lleva fecha,
 * tipo de entrada, color del semáforo y estado de SIPRES.
 *
 * config: { minConfianza, umbrales, reglasDeExtraccion, enlaces }. Las reglas de extracción están
 * apagadas por defecto (ver semaforo.js).
 */

const { validarExtraccion } = require('../extraccion/validar-extraccion');
const { calcular } = require('../calculo/calculo');
const { semaforo } = require('../semaforo/semaforo');
const { buscarEntidad } = require('../sipres/sipres');
const R = require('../respuesta/respuesta');

const PREGUNTAS = {
  'producto.precio_contado': '¿Cuál es el precio de contado del producto?',
  'credito.monto_depositado': '¿Cuánto dinero te depositan realmente?',
  'credito.abono': '¿De cuánto es cada pago?',
  'credito.numero_pagos': '¿Cuántos pagos son?',
  'credito.periodicidad': '¿Cada cuánto pagas: semanal, quincenal o mensual?',
  'credito.monto_total_a_pagar': '¿Cuánto pagarás en total?',
  'credito.plazo_dias': '¿En cuántos días tienes que pagar?',
};

function buscarSipres(datos, tablaSipres, advertencias) {
  const resultado = buscarEntidad(tablaSipres, {
    nombre_comercial: datos.credito.otorgante_nombre_comercial,
    razon_social: datos.credito.otorgante_razon_social,
  });
  if (resultado.motivo !== 'ok') advertencias.push(`sipres:${resultado.motivo}`);
  resultado.advertencias.forEach((a) => advertencias.push(`sipres:${a}`));
  return resultado;
}

function procesar({ extraccion, tablaSipres, config, hoy = null } = {}) {
  const cfg = config && typeof config === 'object' ? config : {};
  const validacion = validarExtraccion(extraccion, { minConfianza: cfg.minConfianza });
  const advertencias = [...validacion.advertencias];

  const log = (tipo, color, sipres) => ({ fecha: hoy, tipo_entrada: tipo, semaforo: color, estado_sipres: sipres });
  const responder = (texto, motivo, tipo = 'desconocido') => ({
    accion: 'responder',
    texto,
    motivo,
    log: log(tipo, 'n.a.', 'n.a.'),
    advertencias,
  });

  if (validacion.estado === 'error_formato') return responder(R.mensajes.error(), 'error_formato');
  if (validacion.estado === 'cobranza') return responder(R.mensajes.cobranza(), 'cobranza', 'cobranza');
  if (validacion.estado === 'desconocido' || validacion.estado === 'preguntar') {
    const tipo = validacion.datos ? validacion.datos.tipo_entrada : 'desconocido';
    return responder(R.mensajes.aclaracion(validacion.preguntas), validacion.motivo, tipo);
  }

  const datos = validacion.datos;
  const sipres = datos.tipo_entrada === 'oferta_credito' ? buscarSipres(datos, tablaSipres, advertencias) : null;

  const calculo = calcular(datos);
  if (calculo.estado !== 'ok') {
    if (calculo.motivo === 'datos_insuficientes') {
      const preguntas = Array.from(new Set(calculo.campos.map((campo) => PREGUNTAS[campo]).filter(Boolean)));
      return responder(R.mensajes.aclaracion(preguntas), 'datos_insuficientes', datos.tipo_entrada);
    }
    return responder(R.mensajes.error(), `calculo_invalido:${calculo.motivo}`, datos.tipo_entrada);
  }

  const resultado = semaforo(
    {
      calculo,
      senales: datos.senales_riesgo,
      sipres: sipres && { estado: sipres.estado, fecha_consulta: sipres.fecha_consulta, terminos_buscados: sipres.terminos_buscados },
    },
    { umbrales: cfg.umbrales, reglasDeExtraccion: cfg.reglasDeExtraccion === true }
  );
  const fuentes = sipres && sipres.fecha_consulta ? { sipres: { fecha: sipres.fecha_consulta } } : {};
  const ctx = R.armarContexto({ calculo, semaforo: resultado, fuentes, config: cfg });
  if (!ctx) return responder(R.mensajes.error(), 'sin_contexto', datos.tipo_entrada);

  return {
    accion: 'redactar',
    ctx,
    plantilla: R.plantillaDesdeContexto(ctx),
    log: log(datos.tipo_entrada, resultado.color, resultado.estado_sipres || 'n.a.'),
    advertencias: Array.from(new Set([...advertencias, ...ctx.advertencias])),
  };
}

module.exports = { procesar };
