-- 考研复习 App 初始表结构 · PostgreSQL 17
-- pgvector 可选：装了就建 embedding 列（见 002_pgvector.sql）

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────── 账号 ─────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text,
  exam_date     date,                       -- 考试日期，用于阶段切换
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ───────── 知识点树（科目/章/知识点）─────────
CREATE TABLE knowledge_points (
  path        text PRIMARY KEY,             -- 例：高等数学/一元函数积分学/变限积分
  name        text NOT NULL,
  parent_path text REFERENCES knowledge_points(path) ON DELETE CASCADE,
  level       smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  sort_order  int NOT NULL DEFAULT 0,
  tree_version text
);
CREATE INDEX knowledge_points_parent_idx ON knowledge_points(parent_path);

-- ───────── 题库（对应 question_schema_draft.json v0.2）─────────
CREATE TABLE questions (
  id               text PRIMARY KEY,         -- math1-2024-01
  schema_version   text NOT NULL,
  exam             text NOT NULL,            -- math1 / english1
  year             int  NOT NULL,
  number           int  NOT NULL,
  section          text NOT NULL,            -- 选择题/填空题/解答题/...
  type             text NOT NULL,            -- single_choice/multi_choice/fill_blank/essay/...
  score            numeric(5,1),
  stem             text NOT NULL,
  images           jsonb NOT NULL DEFAULT '[]',
  options          jsonb NOT NULL DEFAULT '[]',   -- [{key, content}]
  answer           jsonb NOT NULL DEFAULT '[]',   -- 数组
  sub_questions    jsonb NOT NULL DEFAULT '[]',   -- [{number, stem, score, answer[]}]
  solution         text,                          -- 只放原卷/官方解析
  knowledge_points text[] NOT NULL DEFAULT '{}',
  source           jsonb NOT NULL DEFAULT '{}',
  review_status    text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','suspect','confirmed')),
  review_notes     jsonb NOT NULL DEFAULT '[]',
  review_checked_by jsonb NOT NULL DEFAULT '[]',
  kp_confidence    text,                          -- 知识点标签置信度 high/medium/low/none（来自 kp_tags 文件时）
  kp_source        text,                          -- question_json / kp_tags_file
  import_problems  jsonb NOT NULL DEFAULT '[]',   -- 导入校验发现的问题
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam, year, number)
);
CREATE INDEX questions_kp_idx ON questions USING gin (knowledge_points);
CREATE INDEX questions_exam_year_idx ON questions(exam, year);

-- AI 讲解与 solution 分开存
CREATE TABLE ai_explanations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version       int  NOT NULL DEFAULT 1,
  model         text,                        -- deepseek-reasoner / qwen-...
  steps         jsonb NOT NULL DEFAULT '[]', -- 分步讲解 [{n, text}]，提示按步放出
  full_text     text,
  final_answer  jsonb,
  verified      boolean NOT NULL DEFAULT false,  -- 双模型 + 题库答案一致
  verify_detail jsonb NOT NULL DEFAULT '{}',
  citations     jsonb NOT NULL DEFAULT '[]', -- 出处：年份、题号、知识点
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','pending_review','rejected')),
  feedback      jsonb NOT NULL DEFAULT '[]', -- 没讲清/讲错了
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, version)
);

-- ───────── 作答（只追加）─────────
CREATE TABLE exams (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               text NOT NULL DEFAULT 'paper' CHECK (kind IN ('paper','custom_mock','quiz')),
  title              text NOT NULL,
  exam               text NOT NULL,
  year               int,
  question_ids       text[] NOT NULL,
  duration_seconds   int  NOT NULL DEFAULT 10800,
  status             text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','paused','submitted','abandoned')),
  started_at         timestamptz NOT NULL DEFAULT now(),
  submitted_at       timestamptz,
  result             jsonb,                  -- 交卷后：得分、每题用时、时间分配复盘
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX exams_one_active_per_user ON exams(user_id) WHERE status IN ('in_progress','paused');

CREATE TABLE exam_progress (
  exam_id          uuid PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
  answers          jsonb NOT NULL DEFAULT '{}',   -- {question_id: {answer:[], time_spent_seconds, client_seq, flagged}}
  current_question_id text,
  elapsed_seconds  int  NOT NULL DEFAULT 0,       -- 服务端累计的作答时长（暂停不计，断网期间最多按心跳上限计）
  last_tick_at     timestamptz,                    -- 上一次计时点；暂停时为 null
  last_client_seq  bigint NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- 幂等键：同一 (exam, idempotency_key) 只生效一次
CREATE TABLE exam_progress_ops (
  exam_id         uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  client_seq      bigint,
  response        jsonb,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, idempotency_key)
);

CREATE TABLE answer_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id        text NOT NULL REFERENCES questions(id),
  exam_id            uuid REFERENCES exams(id),
  sub_number         int,                    -- 大题小问
  answer             jsonb NOT NULL DEFAULT '[]',
  is_correct         boolean,                -- 主观题可能为 null（待自评/批改）
  self_rating        text CHECK (self_rating IN ('full','approach_ok_calc_wrong','no_idea')),
  time_spent_seconds int,
  thought_text       text,                   -- 自己写的思路，供错因诊断
  client_id          text,                   -- 客户端生成的 id，离线同步去重
  device             text,
  answered_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX answer_records_user_q_idx ON answer_records(user_id, question_id, answered_at DESC);

-- 作答记录只能追加：禁止 UPDATE / DELETE
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER answer_records_append_only BEFORE UPDATE OR DELETE ON answer_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ───────── 错题本 ─────────
CREATE TABLE wrong_questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id     text NOT NULL REFERENCES questions(id),
  first_wrong_at  timestamptz NOT NULL DEFAULT now(),
  last_wrong_at   timestamptz NOT NULL DEFAULT now(),
  wrong_count     int NOT NULL DEFAULT 1,
  error_type      text CHECK (error_type IN ('concept','calc','reading','method')),
  error_type_by   text CHECK (error_type_by IN ('user','agent')),
  note            text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','mastered','archived')),
  fsrs_card       jsonb,                      -- ts-fsrs Card
  due_at          timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

-- ───────── 单词 ─────────
CREATE TABLE words (
  id            serial PRIMARY KEY,
  word          text NOT NULL UNIQUE,
  phonetic_uk   text,
  phonetic_us   text,
  definition_cn text,                          -- ECDICT
  pos           text,
  frequency     int NOT NULL DEFAULT 0,        -- 真题出现次数
  tags          text[] NOT NULL DEFAULT '{}',
  examples      jsonb NOT NULL DEFAULT '[]',   -- 真题原句 [{sentence, year, question_id}]
  audio_uk      text,
  audio_us      text
);

CREATE TABLE word_progress (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word_id      int  NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  fsrs_card    jsonb NOT NULL,                 -- ts-fsrs Card（due/stability/difficulty/...）
  due_at       timestamptz NOT NULL,
  state        smallint NOT NULL DEFAULT 0,    -- 0 New 1 Learning 2 Review 3 Relearning
  reps         int NOT NULL DEFAULT 0,
  lapses       int NOT NULL DEFAULT 0,
  context      jsonb,                          -- 加入生词本时的原句
  last_review_at timestamptz,
  review_log   jsonb NOT NULL DEFAULT '[]',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX word_progress_due_idx ON word_progress(user_id, due_at);

-- ───────── 计划 ─────────
CREATE TABLE study_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_date   date NOT NULL,
  title       text,
  why_changed text,                          -- 首页第一行「为什么改」
  changed_by_agent boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, plan_date)
);

CREATE TABLE plan_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('practice','redo_wrong','variant','mock_exam','words','review_cards','feynman','essay','custom')),
  title         text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',   -- question_ids / kp_path / count ...
  sort_order    int NOT NULL DEFAULT 0,
  estimated_minutes int,
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','skipped')),
  changed_by_agent boolean NOT NULL DEFAULT false,
  agent_action_id uuid,
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_tasks_plan_idx ON plan_tasks(plan_id, sort_order);

CREATE TABLE checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  minutes    int NOT NULL DEFAULT 0,
  mood       text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

-- 客户端埋点（只留自己复盘用的）
CREATE TABLE events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   text,
  name        text NOT NULL,
  props       jsonb NOT NULL DEFAULT '{}',
  device      text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX events_user_time_idx ON events(user_id, occurred_at DESC);

-- 同步游标：记录每张表每台设备的最后同步位置
CREATE TABLE sync_changes (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity      text NOT NULL,      -- wrong_question / word_progress / plan_task / answer_record / note ...
  entity_id   text NOT NULL,
  op          text NOT NULL CHECK (op IN ('upsert','delete')),
  data        jsonb,
  device      text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_changes_user_idx ON sync_changes(user_id, id);

-- ───────── 学习档案（Agent 记忆）─────────
CREATE TABLE mastery (
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kp_path           text NOT NULL REFERENCES knowledge_points(path),
  score             numeric(4,3) CHECK (score BETWEEN 0 AND 1),
  recent_acc        numeric(4,3),
  attempts          int NOT NULL DEFAULT 0,
  correct           int NOT NULL DEFAULT 0,
  last_practiced_at timestamptz,
  feynman_result    jsonb,            -- 讲给它听：{passed, summary, at}
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kp_path)
);

CREATE TABLE error_profile (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kp_path text NOT NULL REFERENCES knowledge_points(path),
  concept int NOT NULL DEFAULT 0,
  calc    int NOT NULL DEFAULT 0,
  reading int NOT NULL DEFAULT 0,
  method  int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kp_path)
);

CREATE TABLE reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id  text NOT NULL REFERENCES questions(id),
  text         text NOT NULL,         -- 下次记住：看到 0·∞ 先化成分式
  fsrs_card    jsonb,
  due_at       timestamptz,
  created_by   text NOT NULL DEFAULT 'agent' CHECK (created_by IN ('user','agent')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_id)
);

CREATE TABLE habits (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hour_bucket  smallint NOT NULL CHECK (hour_bucket BETWEEN 0 AND 23),
  acc          numeric(4,3),
  avg_seconds  numeric(8,1),
  samples      int NOT NULL DEFAULT 0,
  exam_time_pattern jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hour_bucket)
);

CREATE TABLE goals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       text NOT NULL,
  subtasks   jsonb NOT NULL DEFAULT '[]',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
  phase      text NOT NULL DEFAULT 'foundation' CHECK (phase IN ('foundation','intensive','sprint')),
  due_date   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Agent 操作日志：首页「改动记录」与一键撤回
CREATE TABLE agent_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command_id  uuid,                    -- 来自哪次 /agent/commands，定时任务则为 null
  trigger     text NOT NULL DEFAULT 'command' CHECK (trigger IN ('command','nightly','after_exam','weekly','phase_check','event')),
  tool        text NOT NULL,           -- updateDailyPlan / addReviewCard / ...
  summary     text NOT NULL,           -- 一句话：把 3 道极限错题排进了明天
  reason      text NOT NULL,           -- 为什么改
  target_kind text NOT NULL,           -- plan_task / question / word / wrong_question / reminder / goal / plan
  target_id   text,
  before      jsonb,
  after       jsonb,
  undoable    boolean NOT NULL DEFAULT true,
  undone_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_actions_user_idx ON agent_actions(user_id, created_at DESC);
ALTER TABLE plan_tasks ADD CONSTRAINT plan_tasks_agent_action_fk FOREIGN KEY (agent_action_id) REFERENCES agent_actions(id) ON DELETE SET NULL;

-- 讲给它听（费曼）录音记录
CREATE TABLE feynman_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kp_path     text NOT NULL REFERENCES knowledge_points(path),
  audio_path  text,
  mime_type   text,
  transcript  text,
  verdict     jsonb,                   -- {understood: bool, missing: [...], comment}
  created_at  timestamptz NOT NULL DEFAULT now()
);
