'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { rutas, ErrorHttp } = require('./routes');

const MAX_CUERPO = 256 * 1024;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function responder(res, estado, cuerpo) {
  const datos = Buffer.from(JSON.stringify(cuerpo));
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': datos.length,
    'Cache-Control': 'no-store',
  });
  res.end(datos);
}

function error(res, estado, codigo, mensaje) {
  responder(res, estado, { error: { codigo, mensaje } });
}

/** Lee y parsea el cuerpo JSON. Devuelve undefined si viene vacío. */
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    let excedido = false;
    req.on('data', (trozo) => {
      total += trozo.length;
      if (total > MAX_CUERPO) excedido = true;
      else trozos.push(trozo);
    });
    req.on('end', () => {
      if (excedido) return reject(new ErrorHttp(413, 'cuerpo_muy_grande', 'El cuerpo excede el límite.'));
      const texto = Buffer.concat(trozos).toString('utf8');
      if (!texto.trim()) return resolve(undefined);
      try {
        return resolve(JSON.parse(texto));
      } catch {
        return reject(new ErrorHttp(400, 'json_invalido', 'El cuerpo no es JSON válido.'));
      }
    });
    req.on('error', reject);
  });
}

/** Compara la clave en tiempo constante. Sin BOT_API_KEY configurada, no se exige. */
function claveValida(req, config) {
  if (!config.botApiKey) return true;
  const hash = (valor) => crypto.createHash('sha256').update(String(valor)).digest();
  return crypto.timingSafeEqual(hash(req.headers['x-bot-key'] || ''), hash(config.botApiKey));
}

/** Sirve la página desde webDir, sin salirse de esa carpeta. */
function servirEstatico(res, config, rutaUrl) {
  try {
    const raiz = path.resolve(config.webDir);
    const relativa = rutaUrl === '/' ? 'index.html' : decodeURIComponent(rutaUrl).replace(/^\/+/, '');
    const archivo = path.resolve(raiz, relativa);
    if (!archivo.startsWith(raiz + path.sep)) return error(res, 404, 'no_encontrado', 'No existe.');
    return fs.readFile(archivo, (err, datos) => {
      if (err) return error(res, 404, 'no_encontrado', 'No existe.');
      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream',
        'Content-Length': datos.length,
      });
      return res.end(datos);
    });
  } catch {
    return error(res, 404, 'no_encontrado', 'No existe.');
  }
}

function crearServidor(config) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          return error(res, 405, 'metodo_no_permitido', 'Método no permitido.');
        }
        return servirEstatico(res, config, url.pathname);
      }
      const coincidentes = rutas.filter((r) => r.ruta === url.pathname);
      if (!coincidentes.length) return error(res, 404, 'ruta_no_encontrada', 'No existe esa ruta.');
      const ruta = coincidentes.find((r) => r.metodo === req.method);
      if (!ruta) return error(res, 405, 'metodo_no_permitido', 'Método no permitido.');
      if (ruta.protegida && !claveValida(req, config)) {
        return error(res, 401, 'clave_invalida', 'Falta la clave X-Bot-Key o es incorrecta.');
      }
      const cuerpo = ruta.metodo === 'POST' ? await leerCuerpo(req) : undefined;
      return responder(res, 200, ruta.manejar({ url, cuerpo, config }));
    } catch (e) {
      if (e instanceof ErrorHttp) return error(res, e.estado, e.codigo, e.message);
      console.error(e);
      return error(res, 500, 'error_interno', 'Error interno.');
    }
  });
}

module.exports = { crearServidor };
