const MAX_FLOAT32 = 3.4028234e38;

export function validateEmbeddings(embeddings, expectedCount) {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
    throw new Error('Respuesta de embeddings inválida: se esperaba un vector por texto.');
  }
  let dimensions;
  for (const vector of embeddings) {
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('Respuesta de embeddings inválida: los vectores no pueden estar vacíos.');
    if (!vector.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_FLOAT32)) {
      throw new Error('Respuesta de embeddings inválida: los vectores deben contener números finitos compatibles con pgvector.');
    }
    if (vector.every(value => value === 0)) throw new Error('Respuesta de embeddings inválida: pgvector no admite vectores cero para distancia coseno.');
    if (dimensions === undefined) dimensions = vector.length;
    if (vector.length !== dimensions) throw new Error('Respuesta de embeddings inválida: todos los vectores deben tener la misma dimensión.');
  }
  return { embeddings, dimensions };
}

export async function getEmbeddings(texts, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0 || texts.some(text => typeof text !== 'string' || !text.trim())) {
    throw new Error('Se requiere una lista no vacía de textos para generar embeddings.');
  }
  const endpoint = options.endpoint ?? process.env.EMBEDDINGS_API_URL;
  if (!endpoint) throw new Error('Falta EMBEDDINGS_API_URL. Configura un endpoint de embeddings antes de continuar.');

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('EMBEDDINGS_API_URL debe ser una URL HTTP o HTTPS válida.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('EMBEDDINGS_API_URL debe usar HTTP/HTTPS y no incluir credenciales en la URL.');
  }

  const timeoutMs = options.timeoutMs ?? Number(process.env.EMBEDDINGS_TIMEOUT_MS || 30000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) {
    throw new Error('EMBEDDINGS_TIMEOUT_MS debe estar entre 1000 y 300000 milisegundos.');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Este runtime de Node.js no dispone de fetch.');

  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  const apiKey = options.apiKey ?? process.env.EMBEDDINGS_API_KEY;
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('El endpoint de embeddings excedió el tiempo de espera.');
    throw new Error('No se pudo conectar con el endpoint de embeddings.');
  }
  if (!response?.ok) throw new Error('El endpoint de embeddings respondió HTTP ' + (Number(response?.status) || 502) + '.');

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('El endpoint de embeddings no devolvió JSON válido.');
  }
  validateEmbeddings(data?.embeddings, texts.length);
  return data.embeddings;
}
