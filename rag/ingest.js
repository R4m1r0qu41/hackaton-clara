import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pg from 'pg';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

export function chunkText(text, chunkSize = 1200, overlap = 200) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new Error('chunkSize debe ser un entero positivo');
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) throw new Error('overlap debe ser >= 0 y menor que chunkSize');
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === normalized.length) break;
    start = end - overlap;
  }
  return chunks;
}

export async function extractPdfPages(filePath) {
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const pdf = await getDocument({ data: bytes }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
    if (text) pages.push({ page: pageNumber, text });
  }
  return pages;
}

export async function getEmbeddings(texts) {
  const endpoint = process.env.EMBEDDINGS_API_URL;
  if (!endpoint) throw new Error('Falta EMBEDDINGS_API_URL. Configura un endpoint de embeddings antes de ejecutar la ingesta.');
  const headers = { 'content-type': 'application/json' };
  if (process.env.EMBEDDINGS_API_KEY) headers.authorization = `Bearer ${process.env.EMBEDDINGS_API_KEY}`;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ texts }) });
  if (!response.ok) throw new Error(`Endpoint de embeddings respondió HTTP ${response.status}: ${await response.text()}`);
  const data = await response.json();
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length || data.embeddings.some(v => !Array.isArray(v) || !v.every(Number.isFinite))) {
    throw new Error('Respuesta de embeddings inválida: se esperaba { embeddings: number[][] } con un vector por texto.');
  }
  return data.embeddings;
}

export async function buildChunks(pdfDir = path.resolve(projectRoot, process.env.PDF_DIR || './data/pdfs')) {
  const entries = (await fs.readdir(pdfDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) throw new Error(`No se encontraron PDFs en ${pdfDir}`);
  const size = Number(process.env.CHUNK_SIZE || 1200);
  const overlap = Number(process.env.CHUNK_OVERLAP || 200);
  const records = [];
  for (const entry of entries) {
    const pages = await extractPdfPages(path.join(pdfDir, entry.name));
    for (const page of pages) {
      const chunks = chunkText(page.text, size, overlap);
      chunks.forEach((text, index) => records.push({ source: entry.name, page: page.page, chunkIndex: index, text }));
    }
    console.log(`Procesado: ${entry.name} (${pages.length} páginas con texto)`);
  }
  return records;
}

export async function ingest() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el entorno.');
  const records = await buildChunks();
  if (!records.length) throw new Error('No se extrajo texto de los PDFs. Si son escaneados, hará falta OCR.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // El esquema debe crearse primero con rag/schema.sql.
    const batchSize = 32;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const embeddings = await getEmbeddings(batch.map(record => record.text));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let j = 0; j < batch.length; j++) {
          const r = batch[j];
          await client.query(
            `INSERT INTO rag_chunks (source, page, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4, $5::vector)
             ON CONFLICT (source, page, chunk_index) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding`,
            [r.source, r.page, r.chunkIndex, r.text, `[${embeddings[j].join(',')}]`]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      console.log(`Indexados ${Math.min(i + batch.length, records.length)}/${records.length} fragmentos`);
    }
    console.log(`Ingesta completada: ${records.length} fragmentos procesados.`);
  } finally { await pool.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ingest().catch(error => { console.error('Error en ingesta:', error.message); process.exitCode = 1; });
}
