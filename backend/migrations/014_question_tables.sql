-- 题干里的结构化表格：tables = [{caption?, header?, rows: string[][], note?}]，题干 / 文章正文用 {{table:N}}（N 是数组下标，从 0 开始）引用
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tables jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE passages ADD COLUMN IF NOT EXISTS tables jsonb NOT NULL DEFAULT '[]'::jsonb;
