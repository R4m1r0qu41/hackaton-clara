import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../rag/ingest.js';

test('chunkText devuelve [] para texto vacío', () => {
  assert.deepEqual(chunkText('   '), []);
});

test('chunkText normaliza espacios y conserva todo el texto', () => {
  const chunks = chunkText('  hola   mundo\neste es un test  ', 12, 3);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 12));
  assert.ok(chunks[0].startsWith('hola mundo'));
});

test('chunkText valida tamaño y solapamiento', () => {
  assert.throws(() => chunkText('texto', 0, 0), /chunkSize/);
  assert.throws(() => chunkText('texto', 10, 10), /overlap/);
});
