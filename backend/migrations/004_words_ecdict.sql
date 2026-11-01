-- 单词改为全部来自 ECDICT：去掉自拟例句和自拟词频
-- frq_rank：ECDICT 词频排名（越小越常见，NULL = 无排名）；frequency 仍表示真题出现次数（暂无真实来源，为 0）
-- examples 允许 NULL：没有真实例句来源前为 NULL
ALTER TABLE words ADD COLUMN IF NOT EXISTS frq_rank integer;
ALTER TABLE words ALTER COLUMN examples DROP NOT NULL;
ALTER TABLE words ALTER COLUMN examples DROP DEFAULT;
UPDATE words SET examples = NULL WHERE examples = '[]'::jsonb OR examples @> '[{"sample": true}]'::jsonb;
UPDATE words SET frequency = 0, tags = array_remove(tags, 'sample') WHERE 'sample' = ANY(tags);
CREATE INDEX IF NOT EXISTS words_order_idx ON words (frequency DESC, frq_rank ASC NULLS LAST, id);
