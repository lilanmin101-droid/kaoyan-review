-- 真题词汇（npm run import:vocab，来源 /workspace/tiku/vocab/english1_exam_vocab.json）
-- exam_years：出现过的真题年份；frequency 仍是真题出现次数；examples 形状 [{sentence, year, question_id, passage_id}]
-- source：'ecdict'（ECDICT ky 词库）/ 'exam'（真题里出现 ≥3 次、词库没有的词，由 import:vocab 补进来）
-- needs_definition：没有中文释义，补上之前不进学习队列；added_at：补词时间，当天新增的词不打乱当天已排好的今日单词
ALTER TABLE words ADD COLUMN IF NOT EXISTS exam_years int[] NOT NULL DEFAULT '{}';
ALTER TABLE words ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ecdict';
ALTER TABLE words ADD COLUMN IF NOT EXISTS needs_definition boolean NOT NULL DEFAULT false;
ALTER TABLE words ADD COLUMN IF NOT EXISTS added_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS words_word_lower_idx ON words (lower(word));
-- 小问分值来源：'official'（题目文件自带）/ 'estimated'（行业专家在 kp_tags 里估的，非官方）/ 'even_split'（缺分值时按整题平均拆）；没有小问分值为 NULL
ALTER TABLE questions ADD COLUMN IF NOT EXISTS sub_scores_source text;
