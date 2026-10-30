export async function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Falta DATABASE_URL.');
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL debe ser una URL PostgreSQL válida.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL debe usar el protocolo postgres o postgresql.');

  const { default: pg } = await import('pg');
  const connectionTimeoutMillis = Number(process.env.PGCONNECT_TIMEOUT_MS || 5000);
  if (!Number.isSafeInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 1000 || connectionTimeoutMillis > 60000) {
    throw new Error('PGCONNECT_TIMEOUT_MS debe estar entre 1000 y 60000 milisegundos.');
  }
  return new pg.Pool({ connectionString, connectionTimeoutMillis, application_name: 'hackaton-clara-rag' });
}
