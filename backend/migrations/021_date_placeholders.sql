-- 021：「凌晨 4 点前还算 MM-DD 这一天」每个学习日只说一次：记下最近一次说的学习日
-- 存量文字里的日期换成占位符 {{date:YYYY-MM-DD}}（读时按读者学习日渲染）由 npm run migrate:dates 做（要用 TS 里同一个转换函数，幂等）
ALTER TABLE users ADD COLUMN IF NOT EXISTS early_note_day date;
