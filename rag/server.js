import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './db.js';
import { retrieve } from './retriever.js';
import { queryRecaSie, loadRecaSie } from './reca-sie.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function isAuthorized(request, apiKey) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(apiKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request, maxBodyBytes) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    throw new HttpError(415, 'Se requiere Content-Type: application/json.');
  }
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > maxBodyBytes) {
    request.resume();
    throw new HttpError(413, 'El cuerpo de la solicitud es demasiado grande.');
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new HttpError(413, 'El cuerpo de la solicitud es demasiado grande.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'El cuerpo debe ser JSON válido.');
  }
}

function validateApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length < 32) throw new Error('RAG_API_KEY es obligatorio y debe tener al menos 32 caracteres.');
}

export function createRagServer({
  pool,
  mode = 'semantic',
  recaQueryFn = queryRecaSie,
  apiKey = process.env.RAG_API_KEY,
  retrieveFn = (question, options) => retrieve(question, { ...options, pool }),
  maxBodyBytes = MAX_BODY_BYTES
} = {}) {
  validateApiKey(apiKey);
  if (!['semantic', 'reca-sie'].includes(mode)) throw new Error('Modo RAG inválido');
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new Error('maxBodyBytes debe ser un entero positivo.');

  return createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/healthz' && request.method === 'GET') return sendJson(response, 200, { status: 'ok' });

    if (pathname === '/readyz' && request.method === 'GET') {
      try {
        if (mode === 'reca-sie') { const corpus = loadRecaSie(); return sendJson(response, 200, {status:'ready',mode,registros:corpus.records.length}); }
        if (!pool) throw new Error('PostgreSQL pool is not configured');
        await pool.query('SELECT 1 FROM rag_chunks LIMIT 0');
        return sendJson(response, 200, { status: 'ready' });
      } catch {
        return sendJson(response, 503, { status: 'not_ready' });
      }
    }

    if (pathname === '/reca/productos' && request.method === 'GET') {
      if (!isAuthorized(request, apiKey)) return sendJson(response, 401, {error:'unauthorized'});
      try {
        const corpus = loadRecaSie();
        return sendJson(response, 200, {productos:corpus.records.map(r => ({registroReca:r.registration, nombre:r.product, institucion:r.institution, estadoReca:r.status_code})), fuente:'RECA', estado:'piloto'});
      } catch { return sendJson(response, 503, {error:'Corpus RECA no disponible'}); }
    }

    if (pathname !== '/query') return sendJson(response, 404, { error: 'not_found' });
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      return sendJson(response, 405, { error: 'method_not_allowed' });
    }
    if (!isAuthorized(request, apiKey)) {
      request.resume();
      return sendJson(response, 401, { error: 'unauthorized' });
    }

    try {
      const body = await readJson(request, maxBodyBytes);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'El cuerpo debe ser un objeto JSON.');
      if (typeof body.query !== 'string' || !body.query.trim()) throw new HttpError(400, 'El campo query es obligatorio y debe ser texto.');
      if (body.query.length > 4000) throw new HttpError(400, 'query no puede superar 4000 caracteres.');
      const topK = body.topK;
      if (topK !== undefined && (!Number.isSafeInteger(topK) || topK < 1 || topK > 100)) {
        throw new HttpError(400, 'topK debe ser un entero entre 1 y 100.');
      }

      if (body.registroReca !== undefined || mode === 'reca-sie') {
        if (typeof body.registroReca !== 'string' || !body.registroReca.trim() || body.registroReca.length > 100) throw new HttpError(400, 'registroReca es obligatorio y debe ser texto de hasta 100 caracteres.');
        const data = await recaQueryFn(body.query, {registroReca:body.registroReca, ...(topK === undefined ? {} : {topK})});
        return sendJson(response, 200, data);
      }
      const options = topK === undefined ? {} : { topK, pool };
      const results = await retrieveFn(body.query, options);
      return sendJson(response, 200, { results });
    } catch (error) {
      if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
      console.error('Error de consulta RAG:', error?.code || error?.name || 'unknown');
      return sendJson(response, 500, { error: 'No se pudo completar la consulta RAG.' });
    }
  });
}

async function startServer() {
  await import('dotenv/config');
  const apiKey = process.env.RAG_API_KEY;
  validateApiKey(apiKey);
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');

  const mode = process.env.RAG_MODE || 'semantic';
  if (!['semantic','reca-sie'].includes(mode)) throw new Error('RAG_MODE inválido');
  if (mode === 'reca-sie') loadRecaSie();
  const pool = mode === 'semantic' ? await createPool() : undefined;
  const server = createRagServer({ pool, apiKey, mode });
  if(pool) server.once('close', () => pool.end());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log('RAG HTTP listo en http://' + host + ':' + port + '.');

  const shutdown = () => server.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => {
    console.error('No se pudo iniciar la API RAG:', error.message);
    process.exitCode = 1;
  });
}
