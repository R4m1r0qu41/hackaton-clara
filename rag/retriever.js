import { createPool } from './db.js';
import { getEmbeddings, validateEmbeddings } from './embeddings.js';

export async function retrieve(question, {
  topK = Number(process.env.TOP_K || 5),
  pool: providedPool,
  embedder = getEmbeddings
} = {}) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('La pregunta no puede estar vacía.');
  const normalizedQuestion = question.trim();
  if (normalizedQuestion.length > 4000) throw new Error('La pregunta no puede superar 4000 caracteres.');
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100) throw new Error('topK debe ser un entero entre 1 y 100.');
  if (!providedPool && !process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');

  const [embedding] = validateEmbeddings(await embedder([normalizedQuestion]), 1).embeddings;
  const pool = providedPool ?? await createPool();
  const ownsPool = !providedPool;
  try {
    const dimensionResult = await pool.query('SELECT MIN(vector_dims(embedding)) AS dimension, COUNT(DISTINCT vector_dims(embedding)) AS dimension_count FROM rag_chunks WHERE embedding IS NOT NULL');
    const storedDimension = dimensionResult.rows?.[0]?.dimension;
    const storedDimensionCount = Number(dimensionResult.rows?.[0]?.dimension_count || 0);
    if (storedDimensionCount > 1) throw new Error('La base contiene embeddings de más de una dimensión; regenere el índice antes de consultar.');
    if (storedDimension != null && Number(storedDimension) !== embedding.length) {
      throw new Error('La consulta generó dimensión ' + embedding.length + ', pero la base contiene dimensión ' + storedDimension + '. Use el mismo modelo de embeddings que en la ingesta.');
    }

    const sql = [
      'SELECT source, page, chunk_index AS "chunkIndex", content,',
      '       1 - (embedding <=> $1::vector) AS similarity',
      'FROM rag_chunks',
      'WHERE embedding IS NOT NULL',
      'ORDER BY embedding <=> $1::vector',
      'LIMIT $2'
    ].join('\n');
    const result = await pool.query(sql, ['[' + embedding.join(',') + ']', topK]);
    return result.rows.map(row => ({
      text: row.content,
      source: row.source,
      page: Number(row.page),
      chunkIndex: Number(row.chunkIndex),
      similarity: Number(row.similarity)
    }));
  } finally {
    if (ownsPool) await pool.end();
  }
}
