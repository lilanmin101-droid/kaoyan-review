-- 024：离线题包补传。作答来源 source（online / offline_pack）和题包版本 pack_version。
-- client_id 幂等：001 已有 UNIQUE (user_id, client_id)（answer_records_user_id_client_id_key）；这里兜底确保它在（老库被手工改过的情况）。
ALTER TABLE answer_records ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'online';
ALTER TABLE answer_records ADD COLUMN IF NOT EXISTS pack_version text;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
     WHERE t.relname = 'answer_records' AND i.indisunique
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum = ANY(i.indkey)) = ARRAY['client_id','user_id']
  ) THEN
    CREATE UNIQUE INDEX answer_records_user_client_uidx ON answer_records(user_id, client_id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'answer_records_source_check') THEN
    ALTER TABLE answer_records ADD CONSTRAINT answer_records_source_check CHECK (source IN ('online', 'offline_pack'));
  END IF;
END $$;
