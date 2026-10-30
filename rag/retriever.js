import 'dotenv/config';
import pg from 'pg';
import { getEmbeddings } from './ingest.js';
const { Pool } = pg;

export async function retrieve(question, { topK = Number(process.env.TOP_K || 5), pool } = {}) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('La pregunta no puede estar vacía.');
  if (!process.env.DATABASE_URL && !pool) throw new Error('Falta DATABASE_URL en el entorno.');
  const [embedding] = await getEmbeddings([question.trim()]);
  const ownPool = pool || new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await ownPool.query(
      `SELECT id, source, page, chunk_index AS "chunkIndex", content,
              1 - (embedding <=> $1::vector) AS similarity
       FROM rag_chunks
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [`[${embedding.join(',')}]`, topK]
    );
    return result.rows.map(row => ({
      text: row.content,
      source: row.source,
      page: row.page,
      chunkIndex: row.chunkIndex,
      similarity: Number(row.similarity)
    }));
  } finally { if (!pool) await ownPool.end(); }
}
