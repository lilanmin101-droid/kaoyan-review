-- 008：考场模式
-- 错题本记来源：practice（刷题/命令栏）| exam（模考交卷/自评）；source_exam_id = 最近一次因模考进错题本的那场
ALTER TABLE wrong_questions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'practice';
ALTER TABLE wrong_questions ADD COLUMN IF NOT EXISTS source_exam_id uuid REFERENCES exams(id) ON DELETE SET NULL;
ALTER TABLE wrong_questions DROP CONSTRAINT IF EXISTS wrong_questions_source_check;
ALTER TABLE wrong_questions ADD CONSTRAINT wrong_questions_source_check CHECK (source IN ('practice','exam'));

-- 模考复盘一句话（教练消息，GET /agent/messages 里 kind=exam_review）
ALTER TABLE daily_tips DROP CONSTRAINT IF EXISTS daily_tips_kind_check;
ALTER TABLE daily_tips ADD CONSTRAINT daily_tips_kind_check CHECK (kind IN ('tip','review','weekly','exam_review'));

-- 模考历史分页
CREATE INDEX IF NOT EXISTS exams_user_started_idx ON exams(user_id, started_at DESC, id DESC);
