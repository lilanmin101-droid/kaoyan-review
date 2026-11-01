-- basic：基础词（中考 / 高考词，或最常见的约 1500 词），默认不进「今日单词」新词队列，仍可查、可看
-- 口径：ECDICT 标签有 zk/gk 且没有 ky；或 ECDICT 词频排名 frq_rank ≤ 1500；import:vocab 还会按 ECDICT 的 BNC 排名 ≤ 1500 再标一遍
-- （编号留出 016 给勘误迁移）
ALTER TABLE words ADD COLUMN IF NOT EXISTS basic boolean NOT NULL DEFAULT false;
UPDATE words SET basic = true
 WHERE NOT basic AND ((tags && ARRAY['zk','gk'] AND NOT 'ky' = ANY(tags)) OR (frq_rank BETWEEN 1 AND 1500));
DROP INDEX IF EXISTS words_order_idx;
CREATE INDEX IF NOT EXISTS words_order_idx ON words (basic, frequency DESC, frq_rank ASC NULLS LAST, id);
