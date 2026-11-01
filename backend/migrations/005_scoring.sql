-- 计分规则：证明题按整题计分；计算题小问分值可能是估算的；作答记录存下这次的得分/满分
ALTER TABLE questions ADD COLUMN IF NOT EXISTS score_by_whole boolean NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS score_estimated boolean NOT NULL DEFAULT false;
ALTER TABLE answer_records ADD COLUMN IF NOT EXISTS points numeric(5,1);
ALTER TABLE answer_records ADD COLUMN IF NOT EXISTS max_points numeric(5,1);
