-- 010：英语一 —— 文章（passages）、题目挂文章（questions.passage_id）、主观题 AI 批改（answer_gradings）

-- 文章：完形 / 阅读 A / 阅读 B / 翻译 的原文，一篇对应多道题。id 形如 english1-2024-P-text1
CREATE TABLE IF NOT EXISTS passages (
  id              text PRIMARY KEY,
  exam            text NOT NULL,
  year            int  NOT NULL,
  section         text NOT NULL,              -- use_of_english / reading_a / reading_b / translation / writing_a / writing_b
  title           text,
  directions      text,                       -- 作答说明（Directions）
  options         jsonb NOT NULL DEFAULT '[]', -- Part B 的 A–G 选项（每题也各带一份）
  subtype         text,                       -- Part B：matching / heading_matching / ordering / gap_fill
  text            text NOT NULL,              -- 原文（段落用空行分隔，保留原样）
  images          jsonb NOT NULL DEFAULT '[]',
  source          jsonb NOT NULL DEFAULT '{}', -- import_file / assets_dir / 原始出处
  sort_order      int  NOT NULL DEFAULT 0,     -- 在文件里的顺序
  import_problems jsonb NOT NULL DEFAULT '[]',
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passages_exam_year_idx ON passages(exam, year, section);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS passage_id text REFERENCES passages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS questions_passage_idx ON questions(passage_id);

-- 主观题 AI 批改（翻译 / 小作文 / 大作文）。answer_records 只追加不能改，批改结果单独存，一条作答一条批改
CREATE TABLE IF NOT EXISTS answer_gradings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id     uuid NOT NULL UNIQUE REFERENCES answer_records(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id   text NOT NULL REFERENCES questions(id),
  kind          text NOT NULL CHECK (kind IN ('translation','writing_a','writing_b')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  result        jsonb,                         -- {band, score, max_score, points_hit[], errors[], suggestions[], model}
  cross_check   jsonb,                         -- 通义千问复评 {band, score, model} 或 null
  disagreement  boolean NOT NULL DEFAULT false, -- 两个模型相差超过 1 档（翻译：超过 1 分）
  score         numeric(5,1),
  max_score     numeric(5,1),
  model         text,
  error         text,
  attempts      int NOT NULL DEFAULT 0,
  wrong_question_id uuid,                      -- 得分 < 60% 进错题本后对应的错题
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS answer_gradings_user_idx ON answer_gradings(user_id, created_at DESC);
