import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkText, buildChunks, ingest } from '../rag/ingest.js';
import { getEmbeddings } from '../rag/embeddings.js';
import { retrieve } from '../rag/retriever.js';
import { createRagServer } from '../rag/server.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfDir = path.join(repoRoot, 'data', 'pdfs');

test('chunkText normaliza espacios, limita el tamaño y conserva la secuencia', () => {
  const chunks = chunkText('  hola   mundo\neste es un test  ', 12, 3);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 12));
  assert.ok(chunks[0].startsWith('hola mundo'));
  assert.deepEqual(chunkText('   '), []);
});

test('chunkText rechaza tamaños y solapamientos inválidos', () => {
  assert.throws(() => chunkText('texto', 0, 0), /chunkSize/);
  assert.throws(() => chunkText('texto', 10, 10), /overlap/);
  assert.throws(() => chunkText('texto', 1.5, 0), /chunkSize/);
});

test('buildChunks detecta los PDF del corpus y conserva archivo, página e índice', async () => {
  const files = await fs.readdir(pdfDir, { withFileTypes: true });
  const pdfs = files.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'));
  assert.ok(pdfs.length >= 6);

  const records = await buildChunks(pdfDir, {
    chunkSize: 64,
    overlap: 8,
    extractPages: async filePath => [
      { page: 1, text: 'Servicios y condiciones del producto financiero.' },
      { page: 3, text: 'Entidad, requisitos y costos del préstamo.' }
    ]
  });

  assert.equal(new Set(records.map(record => record.source)).size, pdfs.length);
  assert.ok(records.every(record => record.source.endsWith('.pdf')));
  assert.ok(records.every(record => record.page === 1 || record.page === 3));
  assert.ok(records.every(record => Number.isSafeInteger(record.chunkIndex) && record.chunkIndex >= 0));
  assert.ok(records.every(record => record.text.length > 0));
});

test('buildChunks detiene la ingesta cuando un PDF no tiene texto extraíble', async () => {
  await assert.rejects(
    buildChunks(pdfDir, { extractPages: async () => [] }),
    /OCR/
  );
});

test('getEmbeddings cumple el contrato HTTP y envía el bearer token configurado', async () => {
  let request;
  const embeddings = await getEmbeddings(['pregunta'], {
    endpoint: 'https://embeddings.example.test/v1',
    apiKey: 'test-embedding-token',
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => ({ embeddings: [[0.25, 0.75]] }) };
    }
  });

  assert.deepEqual(embeddings, [[0.25, 0.75]]);
  assert.equal(request.url, 'https://embeddings.example.test/v1');
  assert.equal(request.options.headers.authorization, 'Bearer test-embedding-token');
  assert.deepEqual(JSON.parse(request.options.body), { texts: ['pregunta'] });
});

test('getEmbeddings rechaza respuestas incompletas, dimensión variable y vectores cero', async () => {
  const response = embeddings => ({ ok: true, json: async () => ({ embeddings }) });
  const options = { endpoint: 'https://embeddings.example.test', timeoutMs: 1000, fetchImpl: async () => response([[1, 0]]) };
  await assert.rejects(getEmbeddings(['a', 'b'], options), /un vector por texto/);
  await assert.rejects(getEmbeddings(['a', 'b'], { ...options, fetchImpl: async () => response([[1, 0], [0, 1, 0]]) }), /misma dimensión/);
  await assert.rejects(getEmbeddings(['a'], { ...options, fetchImpl: async () => response([[0, 0]]) }), /vectores cero/);
});

test('ingest crea embeddings y reemplaza el índice de manera transaccional', async () => {
  const events = [];
  const inserted = [];
  const client = {
    async query(sql, params = []) {
      events.push(sql);
      if (sql.startsWith('INSERT')) inserted.push({ sql, params });
      return { rows: [] };
    },
    release() { events.push('RELEASE'); }
  };
  const pool = {
    async query(sql) {
      events.push(sql);
      return { rows: [{ dimension: 2, dimension_count: 1 }] };
    },
    async connect() { return client; }
  };
  const summary = await ingest({
    pdfDir,
    pool,
    batchSize: 2,
    extractPages: async filePath => [{ page: 2, text: path.basename(filePath) + ' tiene requisitos y condiciones.' }],
    embedder: async texts => texts.map((_, index) => index === 0 ? [1, 0] : [0, 1])
  });

  const pdfCount = (await fs.readdir(pdfDir)).filter(name => name.toLowerCase().endsWith('.pdf')).length;
  assert.equal(summary.sources.length, pdfCount);
  assert.equal(summary.chunks, pdfCount);
  assert.equal(summary.dimensions, 2);
  assert.equal(inserted.length, Math.ceil(summary.chunks / 2));
  assert.ok(inserted.every(batch => batch.params.length > 0));
  assert.ok(events.includes('BEGIN'));
  assert.ok(events.includes('DELETE FROM rag_chunks'));
  assert.ok(events.includes('COMMIT'));
  assert.equal(events.at(-1), 'RELEASE');
});

test('ingest no modifica la base si cambia la dimensión de embeddings', async () => {
  const events = [];
  const pool = {
    async query() { return { rows: [{ dimension: 3, dimension_count: 1 }] }; },
    async connect() {
      return {
        async query(sql) { events.push(sql); return { rows: [] }; },
        release() {}
      };
    }
  };
  await assert.rejects(
    ingest({
      pdfDir,
      pool,
      extractPages: async () => [{ page: 1, text: 'contenido' }],
      embedder: async texts => texts.map(() => [1, 0])
    }),
    /dimensión 2.*dimensión 3/
  );
  assert.deepEqual(events, []);
});

test('ingest rechaza una base que ya mezcla dimensiones', async () => {
  let connected = false;
  const pool = {
    async query() { return { rows: [{ dimension: 2, dimension_count: 2 }] }; },
    async connect() { connected = true; throw new Error('no debería abrir una transacción'); }
  };
  await assert.rejects(
    ingest({ pdfDir, pool, extractPages: async () => [{ page: 1, text: 'contenido' }], embedder: async texts => texts.map(() => [1, 0]) }),
    /más de una dimensión/
  );
  assert.equal(connected, false);
});
test('retrieve devuelve texto con fuente y página y comprueba la dimensión guardada', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('vector_dims')) return { rows: [{ dimension: 2, dimension_count: 1 }] };
      return { rows: [{ source: 'TarjetasOro.pdf', page: '4', chunkIndex: '1', content: 'Requisitos del producto.', similarity: '0.91' }] };
    }
  };
  const results = await retrieve('¿Cuáles son los requisitos?', {
    pool,
    topK: 3,
    embedder: async texts => texts.map(() => [1, 0])
  });
  assert.deepEqual(results, [{
    text: 'Requisitos del producto.',
    source: 'TarjetasOro.pdf',
    page: 4,
    chunkIndex: 1,
    similarity: 0.91
  }]);
  assert.equal(queries[1].params[1], 3);
});

test('retrieve rechaza una base que ya mezcla dimensiones', async () => {
  let searchExecuted = false;
  const pool = { async query(sql) {
    if (sql.includes('vector_dims')) return { rows: [{ dimension: 2, dimension_count: 2 }] };
    searchExecuted = true;
    return { rows: [] };
  } };
  await assert.rejects(retrieve('pregunta', { pool, embedder: async () => [[1, 0]] }), /más de una dimensión/);
  assert.equal(searchExecuted, false);
});
test('retrieve detiene consultas cuando la dimensión difiere de la ingesta', async () => {
  let searchExecuted = false;
  const pool = {
    async query(sql) {
      if (sql.includes('vector_dims')) return { rows: [{ dimension: 3, dimension_count: 1 }] };
      searchExecuted = true;
      return { rows: [] };
    }
  };
  await assert.rejects(retrieve('pregunta', { pool, embedder: async texts => texts.map(() => [1, 0]) }), /dimensión 2.*dimensión 3/);
  assert.equal(searchExecuted, false);
});

test('API HTTP para n8n requiere token y entrega citas trazables', async () => {
  const apiKey = 'test-rag-token-0123456789abcdefg';
  const server = createRagServer({
    apiKey,
    retrieveFn: async (query, options) => [{
      text: 'El producto solicita identificación.',
      source: 'TarjetasPlatino.pdf',
      page: 2,
      chunkIndex: 0,
      similarity: 0.88,
      query,
      topK: options.topK ?? 5
    }]
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  try {
    const unauthorized = await fetch(baseUrl + '/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'requisitos' })
    });
    assert.equal(unauthorized.status, 401);

    const response = await fetch(baseUrl + '/query', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'requisitos', topK: 4 })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.results[0].source, 'TarjetasPlatino.pdf');
    assert.equal(body.results[0].page, 2);
    assert.equal(body.results[0].topK, 4);

    const health = await fetch(baseUrl + '/healthz');
    assert.equal(health.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
