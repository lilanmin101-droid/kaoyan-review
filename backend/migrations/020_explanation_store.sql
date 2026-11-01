-- 020：讲解预生成（npm run gen:explanations）
-- prompt_version：生成时用的提示词版本（换版本后旧讲解仍可用，--force 才重做）
-- quality：自动质检结果 {ok, failures[], warnings[], checked_at}；不过关的存 status=needs_review、verified=false，等人工核对，不当作好讲解发出
-- origin：batch（批量预生成）/ on_demand（讲解接口现场生成）/ legacy（以前的 ai:explain）
-- usage：本次生成的 token 用量（算成本用）
ALTER TABLE ai_explanations ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE ai_explanations ADD COLUMN IF NOT EXISTS quality jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_explanations ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'legacy';
ALTER TABLE ai_explanations ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS ai_explanations_status_idx ON ai_explanations(status, prompt_version);
