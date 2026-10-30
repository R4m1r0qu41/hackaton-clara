-- Requiere una instalación de PostgreSQL con pgvector disponible.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_chunks (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page > 0),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL CHECK (length(content) > 0),
  embedding VECTOR NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, page, chunk_index)
);

CREATE INDEX IF NOT EXISTS rag_chunks_source_page_idx ON rag_chunks (source, page);
-- El índice vectorial se define cuando se confirme el proveedor y la dimensión de embeddings.
