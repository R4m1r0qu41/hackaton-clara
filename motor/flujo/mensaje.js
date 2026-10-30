'use strict';

/**
 * Qué hacer con un mensaje de Telegram, antes de llegar al agente.
 *
 * clasificarMensaje(actualizacion) acepta la actualización del Telegram Trigger o el mensaje solo, y devuelve
 *   { ruta: 'texto', chat_id, texto }          texto libre: va al agente
 *   { ruta: 'verificar', chat_id, q }          /verificar con nombre: búsqueda determinista en SIPRES
 *   { ruta: 'fijo', chat_id, mensaje }         respuesta fija (ver textoFijo)
 *   { ruta: 'ignorar', chat_id: null }         sin mensaje o sin chat: no se responde
 *
 * Solo salen el chat, el texto y la consulta: no se copia nada de quien escribe (nombre, usuario, fecha).
 */

const R = require('../respuesta/respuesta');

const MAX_TEXTO = 4000;
const MAX_CONSULTA = 200;
const COMANDO = /^\/([A-Za-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/;

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function leerMensaje(actualizacion) {
  if (!esObjeto(actualizacion)) return null;
  if (esObjeto(actualizacion.message)) return actualizacion.message;
  return esObjeto(actualizacion.chat) ? actualizacion : null;
}

function leerChat(mensaje) {
  const id = mensaje && esObjeto(mensaje.chat) ? mensaje.chat.id : undefined;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim()) return id;
  return null;
}

const fijo = (chatId, mensaje) => ({ ruta: 'fijo', chat_id: chatId, mensaje });

function clasificarMensaje(actualizacion) {
  const mensaje = leerMensaje(actualizacion);
  const chatId = leerChat(mensaje);
  if (chatId === null) return { ruta: 'ignorar', chat_id: null };

  const texto = typeof mensaje.text === 'string' ? mensaje.text.trim() : '';
  if (!texto) return fijo(chatId, 'solo_texto');

  const comando = COMANDO.exec(texto);
  if (comando) {
    if (comando[1].toLowerCase() !== 'verificar') return fijo(chatId, 'bienvenida');
    const nombre = (comando[2] || '').trim();
    if (!nombre) return fijo(chatId, 'verificar_sin_nombre');
    return { ruta: 'verificar', chat_id: chatId, q: nombre.slice(0, MAX_CONSULTA) };
  }
  return { ruta: 'texto', chat_id: chatId, texto: texto.slice(0, MAX_TEXTO) };
}

function textoFijo(clave) {
  if (clave === 'bienvenida') return R.mensajes.bienvenida();
  if (clave === 'verificar_sin_nombre') return R.mensajes.verificarSinNombre();
  return R.mensajes.soloTexto();
}

module.exports = { clasificarMensaje, textoFijo };
