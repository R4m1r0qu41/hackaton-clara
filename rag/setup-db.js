import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function setupDatabase({ pool: providedPool } = {}) {
  const pool = providedPool ?? await createPool();
  const ownsPool = !providedPool;
  try {
    const schema = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');
    await pool.query(schema);
    return { ready: true };
  } finally {
    if (ownsPool) await pool.end();
  }
}

async function main() {
  await import('dotenv/config');
  await setupDatabase();
  console.log('Esquema de RAG aplicado correctamente.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Error al preparar PostgreSQL:', error.message);
    process.exitCode = 1;
  });
}
