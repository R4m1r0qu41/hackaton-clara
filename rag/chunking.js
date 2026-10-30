export function chunkText(text, chunkSize = 1200, overlap = 200) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('chunkSize debe ser un entero positivo');
  if (!Number.isSafeInteger(overlap) || overlap < 0 || overlap >= chunkSize) throw new Error('overlap debe ser >= 0 y menor que chunkSize');
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
