'use strict';

const path = require('node:path');

/**
 * Lee la configuración del entorno. Nunca imprimir ni registrar las claves.
 *   PORT              puerto (3000 por defecto)
 *   HOST              interfaz (127.0.0.1 por defecto; usa 0.0.0.0 para abrirlo a la red local)
 *   BOT_API_KEY       clave que n8n envía en la cabecera X-Bot-Key; si falta, esas rutas quedan abiertas
 *   OPENROUTER_API_KEY  solo indica que hay IA configurada; esta versión todavía no la usa
 *   WEB_DIR           carpeta de la página (../web por defecto)
 */
function cargarConfig(env = process.env) {
  return {
    puerto: Number(env.PORT) || 3000,
    host: env.HOST || '127.0.0.1',
    botApiKey: env.BOT_API_KEY || null,
    iaActiva: Boolean(env.OPENROUTER_API_KEY),
    webDir: env.WEB_DIR || path.join(__dirname, '..', 'web'),
  };
}

module.exports = { cargarConfig };
