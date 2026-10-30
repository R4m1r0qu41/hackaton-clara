import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkText } from './chunking.js';
import { createPool } from './db.js';
import { getEmbeddings, validateEmbeddings } from './embeddings.js';

export { chunkText };

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

export async function extractPdfPages(filePath) {
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
      if (text) pages.push({ page: pageNumber, text });
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

export async function buildChunks(
  pdfDir = path.resolve(projectRoot, process.env.PDF_DIR || './data/pdfs'),
  {
    extractPages = extractPdfPages,
    chunkSize = Number(process.env.CHUNK_SIZE || 1200),
    overlap = Number(process.env.CHUNK_OVERLAP || 200)
  } = {}
) {
  chunkText('', chunkSize, overlap);
  const entries = (await fs.readdir(pdfDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!entries.length) throw new Error('No se encontraron archivos PDF en ' + pdfDir + '.');

  const records = [];
  for (const entry of entries) {
    const pages = await extractPages(path.join(pdfDir, entry.name));
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error('No se pudo extraer texto de ' + entry.name + '. Si es un PDF escaneado, requiere OCR.');
    }
    const initialCount = records.length;
    for (const page of pages) {
      if (!Number.isSafeInteger(page.page) || page.page < 1 || typeof page.text !== 'string') {
        throw new Error('El extractor devolvió metadatos de página inválidos para ' + entry.name + '.');
      }
      chunkText(page.text, chunkSize, overlap).forEach((text, chunkIndex) => {
        records.push({ source: entry.name, page: page.page, chunkIndex, text });
      });
    }
    if (records.length === initialCount) throw new Error('No se extrajo texto indexable de ' + entry.name + '.');
  }
  return records;
}

function insertBatchSql(records, embeddings) {
  const values = [];
  const params = [];
  records.forEach((record, index) => {
    const offset = params.length;
    values.push('($' + (offset + 1) + ', $' + (offset + 2) + ', $' + (offset + 3) + ', $' + (offset + 4) + ', $' + (offset + 5) + '::vector)');
    params.push(record.source, record.page, record.chunkIndex, record.text, '[' + embeddings[index].join(',') + ']');
  });
  return {
    sql: 'INSERT INTO rag_chunks (source, page, chunk_index, content, embedding) VALUES ' + values.join(', ') +
      ' ON CONFLICT (source, page, chunk_index) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding',
    params
  };
}

export async function ingest({
  pdfDir,
  pool: providedPool,
  embedder = getEmbeddings,
  extractPages = extractPdfPages,
  batchSize = 32
} = {}) {
  if (!providedPool && !process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new Error('batchSize debe ser un entero entre 1 y 256.');

  const records = await buildChunks(pdfDir, { extractPages });
  const allEmbeddings = [];
  let dimensions;
  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = records.slice(offset, offset + batchSize);
    const embeddings = await embedder(batch.map(record => record.text));
    const validated = validateEmbeddings(embeddings, batch.length);
    if (dimensions === undefined) dimensions = validated.dimensions;
    if (validated.dimensions !== dimensions) throw new Error('La dimensión de embeddings cambió entre lotes; no se modificó la base de datos.');
    allEmbeddings.push(...validated.embeddings);
  }

  const pool = providedPool ?? await createPool();
  const ownsPool = !providedPool;
  let client;
  let transactionStarted = false;
  try {
    const current = await pool.query('SELECT MIN(vector_dims(embedding)) AS dimension, COUNT(DISTINCT vector_dims(embedding)) AS dimension_count FROM rag_chunks WHERE embedding IS NOT NULL');
    const currentDimension = current.rows?.[0]?.dimension;
    const currentDimensionCount = Number(current.rows?.[0]?.dimension_count || 0);
    if (currentDimensionCount > 1) throw new Error('La base ya contiene embeddings de más de una dimensión. Limpie o regenere el índice antes de continuar.');
    if (currentDimension != null && Number(currentDimension) !== dimensions) {
      throw new Error('El embedding nuevo tiene dimensión ' + dimensions + ', pero la base ya contiene dimensión ' + currentDimension + '. Use la misma configuración de embeddings o un índice limpio.');
    }

    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('DELETE FROM rag_chunks');
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const statement = insertBatchSql(records.slice(offset, offset + batchSize), allEmbeddings.slice(offset, offset + batchSize));
      await client.query(statement.sql, statement.params);
    }
    await client.query('COMMIT');
    transactionStarted = false;
    return { sources: [...new Set(records.map(record => record.source))], chunks: records.length, dimensions };
  } catch (error) {
    if (transactionStarted && client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure; the connection will be released below.
      }
    }
    throw error;
  } finally {
    if (client) client.release();
    if (ownsPool) await pool.end();
  }
}

async function main() {
  await import('dotenv/config');
  const summary = await ingest();
  console.log('Ingesta completada: ' + summary.chunks + ' chunks de ' + summary.sources.length + ' PDFs; dimensión ' + summary.dimensions + '.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Error en ingesta:', error.message);
    process.exitCode = 1;
  });
}
