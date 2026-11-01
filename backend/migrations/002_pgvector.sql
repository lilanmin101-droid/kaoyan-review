-- 仅在 pgvector 可用时执行（migrate 脚本会先检测）
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS questions_embedding_idx ON questions USING hnsw (embedding vector_cosine_ops);
