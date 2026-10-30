'use strict';

/**
 * Servicio de embeddings LOCAL y de prueba para el RAG de la rama Eugenio. Sin claves ni descargas.
 *
 *   POST { "texts": ["texto 1", "texto 2"] }  ->  { "embeddings": [[...], [...]] }
 *
 * Es el contrato que pide el RAG (ver su README). Cada texto se convierte en un vector por hashing de palabras:
 * es LÉXICO, no semántico. Encuentra fragmentos que comparten palabras con la pregunta, pero no entiende
 * sinónimos ni paráfrasis. Sirve para probar el circuito completo; para producción hay que elegir un proveedor
 * real, cambiar EMBEDDINGS_API_URL y volver a ingerir (la dimensión y el método deben ser los mismos al ingerir
 * y al consultar).
 *
 *   PORT (8090) y HOST (127.0.0.1; usa 0.0.0.0 dentro de un contenedor)
 */

const http = require('node:http');

const DIMENSION = 384;
const MAX_TEXTOS = 256;
const MAX_CARACTERES = 20000;
const MAX_CUERPO = 5 * 1024 * 1024;
const PESO_BIGRAMA = 0.5;

// Palabras muy comunes en español: no ayudan a distinguir un fragmento de otro.
const VACIAS = new Set(
  ('de la el en y a los las del se que un una por con para es al lo como mas pero sus le ya o fue este ha si porque esta son entre ' +
    'cuando muy sin sobre ser tiene tambien me hasta hay donde han quien estan estado desde todo nos durante todos uno les ni contra ' +
    'otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual ' +
    'poco ella estar estas algunas algo nosotros su').split(' ')
);

function palabras(texto) {
  const normal = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const todas = normal.match(/[a-z0-9]+/g) || [];
  const utiles = todas.filter((p) => p.length >= 2 && !VACIAS.has(p));
  return utiles.length ? utiles : todas;
}

/** FNV-1a de 32 bits, con una sal para obtener un segundo valor independiente. */
function hash(cadena, sal = '') {
  let h = 0x811c9dc5;
  for (const c of sal + cadena) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function embed(texto) {
  const v = new Array(DIMENSION).fill(0);
  const agregar = (clave, peso) => {
    v[hash(clave) % DIMENSION] += (hash(clave, 'signo') & 1 ? 1 : -1) * peso;
  };
  const lista = palabras(texto);
  const cuentas = new Map();
  for (const p of lista) cuentas.set(p, (cuentas.get(p) || 0) + 1);
  for (const [p, n] of cuentas) agregar(p, 1 + Math.log(n));
  for (let i = 0; i + 1 < lista.length; i++) agregar(`${lista[i]} ${lista[i + 1]}`, PESO_BIGRAMA);

  let norma = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norma === 0) {
    // pgvector no admite vectores cero con distancia coseno
    v[0] = 1;
    norma = 1;
  }
  return v.map((x) => x / norma);
}

function crearServidor() {
  return http.createServer((req, res) => {
    const responder = (estado, objeto) => {
      res.writeHead(estado, { 'content-type': 'application/json' });
      res.end(JSON.stringify(objeto));
    };
    if (req.method !== 'POST') return responder(405, { error: 'metodo_no_permitido' });

    let tamano = 0;
    let excedido = false;
    const partes = [];
    req.on('data', (d) => {
      tamano += d.length;
      if (tamano > MAX_CUERPO) excedido = true;
      else partes.push(d);
    });
    req.on('end', () => {
      if (excedido) return responder(413, { error: 'cuerpo_demasiado_grande' });
      let cuerpo;
      try {
        cuerpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
      } catch {
        return responder(400, { error: 'json_invalido' });
      }
      const textos = cuerpo && cuerpo.texts;
      const valido =
        Array.isArray(textos) &&
        textos.length >= 1 &&
        textos.length <= MAX_TEXTOS &&
        textos.every((t) => typeof t === 'string' && t.trim() && t.length <= MAX_CARACTERES);
      if (!valido) return responder(400, { error: 'textos_invalidos' });
      return responder(200, { embeddings: textos.map(embed) });
    });
  });
}

if (require.main === module) {
  const puerto = Number(process.env.PORT || 8090);
  const host = process.env.HOST || '127.0.0.1';
  crearServidor().listen(puerto, host, () => console.log(`Embeddings locales de prueba en http://${host}:${puerto} (léxicos, no semánticos)`));
}

module.exports = { embed, crearServidor, DIMENSION };
