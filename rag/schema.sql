-- Ejecutar una vez en la base de datos que tenga instalada la extensión pgvector.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_chunks (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page > 0),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  embedding VECTOR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, page, chunk_index)
);

CREATE INDEX IF NOT EXISTS rag_chunks_source_idx ON rag_chunks (source);
-- El índice ANN se añadirá cuando se confirme la dimensión del embedding y el volumen de datos.
