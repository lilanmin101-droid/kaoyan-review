#!/usr/bin/env bash
# 英语一端到端：独立测试库 kaoyan_e1test（不碰开发库）→ 迁移 → 导入夹具（2099 正确卷、2098 坏卷）+ 真实 english1_2024 → AI_FAKE=1 测试后端 :3100 → 跑用例
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=dist-e1test
PORT=${E1_PORT:-3100}
DB=postgres://kaoyan:kaoyan@127.0.0.1:5432/kaoyan_e1test
npx tsc -p tsconfig.json --outDir $OUT >/tmp/e1test-tsc.log 2>&1 || echo "（tsc 有报错，见 /tmp/e1test-tsc.log；照常用已生成的 js）"
PGPASSWORD=kaoyan psql -q -h 127.0.0.1 -U kaoyan -d postgres -c "DROP DATABASE IF EXISTS kaoyan_e1test" -c "CREATE DATABASE kaoyan_e1test"
DATABASE_URL=$DB node $OUT/scripts/migrate.js >/dev/null
mkdir -p /tmp/e1test-reports
DATABASE_URL=$DB node $OUT/scripts/import-questions.js --tree /workspace/kaoyan/tiku/knowledge_tree.json --questions test/fixtures,/workspace/kaoyan/tiku/english1_2024.json --report-dir /tmp/e1test-reports >/tmp/e1test-import.log 2>&1 || true
DATABASE_URL=$DB node $OUT/scripts/import-questions.js --tree /workspace/kaoyan/tiku/knowledge_tree.json --questions test/fixtures,/workspace/kaoyan/tiku/english1_2024.json --report-dir /tmp/e1test-reports >/tmp/e1test-import2.log 2>&1 || true   # 第二次：幂等
PGPASSWORD=kaoyan psql -h 127.0.0.1 -U kaoyan -d kaoyan_e1test -Atc "SELECT year, count(*), sum(score) FROM questions GROUP BY 1 ORDER BY 1" | tr '\n' ' '; echo "（重复导入两次后的题数/分数）"
DATABASE_URL=$DB PORT=$PORT AI_FAKE=1 DEEPSEEK_API_KEY= DASHSCOPE_API_KEY= node $OUT/src/main.js >/tmp/e1test-server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for i in $(seq 1 50); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null && break; curl -s -o /dev/null "http://127.0.0.1:$PORT/api/v1/questions" 2>/dev/null && break; sleep 0.3; done
BASE=http://127.0.0.1:$PORT/api/v1 node $OUT/scripts/test-english1.js
kill $PID; wait $PID 2>/dev/null || true
# 第二轮：没 Key、没 AI_FAKE → pending；第三轮：AI_FAKE_DISAGREE=1 → disagreement
run_phase() {
  env DATABASE_URL=$DB PORT=$PORT DEEPSEEK_API_KEY= DASHSCOPE_API_KEY= "$@" node $OUT/src/main.js >>/tmp/e1test-server.log 2>&1 &
  PID=$!
  for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/v1/questions" 2>/dev/null && break; sleep 0.3; done
}
run_phase AI_FAKE=0; PHASE=pending BASE=http://127.0.0.1:$PORT/api/v1 node $OUT/scripts/test-english1.js | grep -v '^ok   \(match\|english\|passage\|夹具\|坏夹具\|真实\|五档\|normal\|翻译分数\|不合格\|假模型\|空译文\|相差\)'; kill $PID; wait $PID 2>/dev/null || true
run_phase AI_FAKE=1 AI_FAKE_DISAGREE=1; PHASE=disagree BASE=http://127.0.0.1:$PORT/api/v1 node $OUT/scripts/test-english1.js | grep -v '^ok   \(match\|english\|passage\|夹具\|坏夹具\|真实\|五档\|normal\|翻译分数\|不合格\|假模型\|空译文\|相差\)'
