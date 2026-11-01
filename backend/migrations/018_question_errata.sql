-- 原卷误印说明：[{printed, correct, note}]，题面按原卷保留，随题干原样返回
ALTER TABLE questions ADD COLUMN IF NOT EXISTS errata jsonb NOT NULL DEFAULT '[]'::jsonb;
