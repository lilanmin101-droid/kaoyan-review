#!/usr/bin/env bash
# Key 到位后的一键预检：npm run key:preflight（= bash scripts/key-preflight.sh）
#
# 把 DeepSeek / 通义千问（DashScope）Key 填进 backend/.env 后跑一次，按顺序检查（HANDOFF §8.3）：
#   1. Key 是否配置（只看有没有，不打印 Key）        5. 讲解预生成：gen:explanations --dry-run，再真生成 2 题
#   2. 编译                                          6. 英语批改评测 eval:grading（两个模型都不能报错）
#   3. ai:check：/models 预检模型名 + 每个模型 1 token  7. Agent 评测 eval:agent（AI 模式，EVAL_TZ=Asia/Shanghai）
#   4. 起一个临时后端：启动日志 /models 预检无 ⚠；真模型跑一条教练指令（不能 400、不能退回规则版）
# 每步打印 ✓ / ✗ / ⚠，最后汇总「要改什么」。全部通过退出码 0，否则 1。
#
# 默认不碰正在跑的服务：临时后端用 PREFLIGHT_PORT（默认 3108），数据库用 .env 里那个库的一份临时拷贝
# （需要 pg_dump / pg_restore；结束后删掉）。
#
# 选项：
#   --fake          不用真 Key：起 test/fake-llm.js（模拟 DeepSeek 思考模式），演练整套流程
#   --no-db-copy    直接用 .env 的 DATABASE_URL（没装 pg_dump 时用；会写入 2 条讲解和若干测试账号）
#   --gen-limit N   第 5 步真生成几题（默认 2；0 = 只 dry-run）
#   --skip-eval     跳过第 6、7 步（省钱 / 省时间）
#   --keep          结束后不停临时后端、不删临时库（排查用）
# 环境变量：PREFLIGHT_PORT（默认 3108）、FAKE_LLM_PORT（默认 4020）
set -uo pipefail
cd "$(dirname "$0")/.."
BACKEND_DIR=$(pwd)

FAKE=0; DB_COPY=1; GEN_LIMIT=2; SKIP_EVAL=0; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --fake) FAKE=1 ;;
    --no-db-copy) DB_COPY=0 ;;
    --gen-limit) GEN_LIMIT="$2"; shift ;;
    --skip-eval) SKIP_EVAL=1 ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（--help 看用法）"; exit 2 ;;
  esac
  shift
done
PORT_PF="${PREFLIGHT_PORT:-3108}"
FAKE_PORT="${FAKE_LLM_PORT:-4020}"
TS=$(date +%Y%m%d-%H%M%S)
LOG_DIR="${PREFLIGHT_LOG_DIR:-/tmp/kaoyan-key-preflight-$TS}"
mkdir -p "$LOG_DIR"

RESULTS=(); FIXES=(); FAILED=0
ok()   { echo "  ✓ $1"; RESULTS+=("✓ $1"); }
warn() { echo "  ⚠ $1"; RESULTS+=("⚠ $1"); [ -n "${2:-}" ] && FIXES+=("$2"); }
bad()  { echo "  ✗ $1"; RESULTS+=("✗ $1"); FAILED=1; [ -n "${2:-}" ] && FIXES+=("$2"); }
step() { echo; echo "== $1"; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# .env 里的值（进程环境优先，和后端 loadEnv 一致）；只在脚本内部用，不打印
envval() {
  local k="$1" v="${!1:-}"
  if [ -z "$v" ] && [ -f .env ]; then v=$(grep -E "^\s*$k\s*=" .env | tail -1 | sed -E "s/^\s*$k\s*=\s*//; s/\s*$//"); fi
  printf '%s' "$v"
}

BE_PID=""; FAKE_PID=""; COPY_DB=""; BASE_URL_DB=""
cleanup() {
  [ "$KEEP" = 1 ] && { echo; echo "（--keep：临时后端 pid=${BE_PID:-无}、fake-llm pid=${FAKE_PID:-无}、临时库 ${COPY_DB:-无} 都留着）"; return; }
  [ -n "$BE_PID" ] && kill "$BE_PID" 2>/dev/null
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null
  if [ -n "$COPY_DB" ]; then
    sleep 1
    DB_ADMIN_URL="$BASE_URL_DB" DB_NAME="$COPY_DB" node -e '
      const { Client } = require("pg"); const c = new Client({ connectionString: process.env.DB_ADMIN_URL });
      c.connect().then(() => c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`, [process.env.DB_NAME]))
        .then(() => c.query(`DROP DATABASE IF EXISTS "${process.env.DB_NAME}"`)).then(() => c.end()).catch((e) => { console.error("删临时库失败：" + e.message); process.exit(1); });' \
      && echo "（已删临时库 $COPY_DB）"
  fi
}
trap cleanup EXIT

echo "Key 预检 $(date '+%F %T')（北京时间）  模式：$([ $FAKE = 1 ] && echo '演练（fake-llm）' || echo '真 Key')  日志：$LOG_DIR"

# ---------- 1. Key ----------
step "1/7 Key 配置"
if [ "$FAKE" = 1 ]; then
  if port_busy "$FAKE_PORT"; then bad "fake-llm 端口 $FAKE_PORT 被占用" "换个端口：FAKE_LLM_PORT=4021 npm run key:preflight -- --fake"; exit 1; fi
  FAKE_LLM_PORT="$FAKE_PORT" FAKE_LLM_THINKING=1 node test/fake-llm.js > "$LOG_DIR/fake-llm.log" 2>&1 &
  FAKE_PID=$!
  export DEEPSEEK_API_KEY=fake DASHSCOPE_API_KEY=fake DEEPSEEK_BASE_URL="http://127.0.0.1:$FAKE_PORT" DASHSCOPE_BASE_URL="http://127.0.0.1:$FAKE_PORT"
  export DEEPSEEK_CHAT_MODEL=deepseek-flash DEEPSEEK_REASONER_MODEL=deepseek-flash QWEN_MODEL=qwen-max
  sleep 1
  ok "演练模式：fake-llm 在 :$FAKE_PORT（模拟思考模式，多轮工具调用不回传 reasoning_content 会 400）"
else
  [ -f .env ] || warn "backend/.env 不存在，只读进程环境变量" "cp .env.example .env 后填 Key"
  if [ -n "$(envval DEEPSEEK_API_KEY)" ]; then ok "DEEPSEEK_API_KEY 已配置"; else bad "DEEPSEEK_API_KEY 没配置" "在 backend/.env 加一行 DEEPSEEK_API_KEY=sk-…（DeepSeek 开放平台 → API Keys）"; fi
  if [ -n "$(envval DASHSCOPE_API_KEY)" ]; then ok "DASHSCOPE_API_KEY 已配置"; else bad "DASHSCOPE_API_KEY 没配置" "在 backend/.env 加一行 DASHSCOPE_API_KEY=sk-…（阿里云百炼 → API-KEY）"; fi
  [ "$(envval AI_MOCK)" = 1 ] && bad "AI_MOCK=1 强制模拟，Key 不会被使用" "删掉 backend/.env 里的 AI_MOCK=1"
  [ "$(envval AI_FAKE)" = 1 ] && bad "AI_FAKE=1 会用假模型" "删掉 backend/.env 里的 AI_FAKE=1"
  if [ "$FAILED" = 1 ]; then echo; echo "Key 没配好，先处理上面的问题再跑。"; for f in "${FIXES[@]}"; do echo "  → $f"; done; exit 1; fi
fi
unset AI_MOCK AI_FAKE

# ---------- 2. 编译 ----------
step "2/7 编译"
if npx tsc -p tsconfig.json > "$LOG_DIR/tsc.log" 2>&1; then ok "tsc 通过"; else bad "编译失败（见 $LOG_DIR/tsc.log）" "先修编译错误：cd backend && npx tsc -p tsconfig.json"; exit 1; fi

# ---------- 3. ai:check ----------
step "3/7 ai:check（/models 预检 + 每个模型 1 token）"
node dist/scripts/ai-check.js 2>&1 | tee "$LOG_DIR/ai-check.log" | sed 's/^/    /'
if [ "${PIPESTATUS[0]}" = 0 ]; then ok "ai:check 通过"; else
  bad "ai:check 不通过" "按上面「要处理」逐条改 backend/.env（Key 无效 → 重新复制；模型名不在列表 → 改 DEEPSEEK_CHAT_MODEL / DEEPSEEK_REASONER_MODEL / QWEN_MODEL）"
  grep -E '^\s+✗' "$LOG_DIR/ai-check.log" | sed 's/^\s*✗ //' | while read -r l; do echo "$l" >> "$LOG_DIR/fixes.txt"; done
fi

# ---------- 准备临时库 ----------
BASE_URL_DB="$(envval DATABASE_URL)"
[ -z "$BASE_URL_DB" ] && { bad "DATABASE_URL 没配置" "在 backend/.env 配 DATABASE_URL=postgres://…"; exit 1; }
DB_URL="$BASE_URL_DB"
if [ "$DB_COPY" = 1 ]; then
  if command -v pg_dump >/dev/null && command -v pg_restore >/dev/null; then
    COPY_DB="kaoyan_preflight_$(date +%s)"
    DB_URL=$(BASE="$BASE_URL_DB" NAME="$COPY_DB" node -e 'const u=new URL(process.env.BASE);u.pathname="/"+process.env.NAME;console.log(u.toString())')
    if DB_ADMIN_URL="$BASE_URL_DB" DB_NAME="$COPY_DB" node -e '
         const { Client } = require("pg"); const c = new Client({ connectionString: process.env.DB_ADMIN_URL });
         c.connect().then(() => c.query(`CREATE DATABASE "${process.env.DB_NAME}"`)).then(() => c.end()).catch((e) => { console.error(e.message); process.exit(1); });' > "$LOG_DIR/db-copy.log" 2>&1 \
       && pg_dump -Fc "$BASE_URL_DB" 2>>"$LOG_DIR/db-copy.log" | pg_restore --no-owner --no-acl -d "$DB_URL" >> "$LOG_DIR/db-copy.log" 2>&1; then
      echo "（临时库 $COPY_DB：拷自 .env 的库，结束后删除）"
    else
      tail -3 "$LOG_DIR/db-copy.log" | sed 's/^/    /'
      warn "拷贝数据库失败，改用 .env 的库（会写入少量测试数据）" "要隔离就装和服务器同版本的 pg_dump，或加 --no-db-copy 明确使用原库"
      DB_URL="$BASE_URL_DB"
    fi
  else
    warn "没装 pg_dump，直接用 .env 的库（会写入 2 条讲解和测试账号）" "不想写原库就装 postgresql-client 再跑"
  fi
fi
export DATABASE_URL="$DB_URL"

# ---------- 4. 临时后端 + 教练指令 ----------
step "4/7 临时后端 :$PORT_PF —— 启动预检 + 一条真模型教练指令"
if port_busy "$PORT_PF"; then
  bad "端口 $PORT_PF 已被占用" "换端口：PREFLIGHT_PORT=3199 npm run key:preflight"
else
  PORT="$PORT_PF" JOBS_ENABLED=0 node dist/src/main.js > "$LOG_DIR/backend.log" 2>&1 &
  BE_PID=$!
  B="http://127.0.0.1:$PORT_PF/api/v1"
  for i in $(seq 1 60); do curl -sf "$B/health" > "$LOG_DIR/health.json" 2>/dev/null && break; sleep 0.5; done
  if ! [ -s "$LOG_DIR/health.json" ]; then
    bad "临时后端没起来（见 $LOG_DIR/backend.log）" "看 backend.log 最后几行；常见：DATABASE_URL 连不上、端口冲突"
    tail -5 "$LOG_DIR/backend.log" | sed 's/^/    /'
  else
    grep -q '"ai":"configured"' "$LOG_DIR/health.json" && ok "/health：ai=configured" || bad "/health 显示没进入 AI 模式：$(cat "$LOG_DIR/health.json" | head -c 200)" "确认 DEEPSEEK_API_KEY 已配置且没设 AI_MOCK=1"
    for i in $(seq 1 30); do [ "$(grep -c '\[ai:startup\]' "$LOG_DIR/backend.log")" -ge 2 ] && break; sleep 0.5; done
    grep '\[ai:startup\]' "$LOG_DIR/backend.log" | sed 's/^/    /'
    if grep '\[ai:startup\]' "$LOG_DIR/backend.log" | grep -q '⚠'; then
      bad "启动时 /models 预检有警告" "按上面 ⚠ 那行改 backend/.env 的模型名或 Base URL"
    elif [ "$(grep -c '\[ai:startup\].*/models 返回' "$LOG_DIR/backend.log")" -ge 2 ]; then ok "启动 /models 预检：两个提供方都通过"
    else bad "启动日志里没看到两条 /models 预检结果" "看 $LOG_DIR/backend.log"; fi

    PW=$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))'); U="pf_$(date +%s)"
    curl -s -X POST "$B/auth/register" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$PW\"}" > /dev/null
    TOKEN=$(curl -s -X POST "$B/auth/login" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$PW\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).access_token||"")}catch{console.log("")}})')
    if [ -z "$TOKEN" ]; then bad "注册 / 登录测试号失败" "看 $LOG_DIR/backend.log"; else
      curl -s -N --max-time 180 -X POST "$B/agent/commands" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
        -d '{"text":"看看我的错题，帮我把今天的计划排一下"}' > "$LOG_DIR/coach.sse"
      DONE=$(grep -A1 '^event: done' "$LOG_DIR/coach.sse" | grep '^data:' | head -1)
      ERR=$(grep -A1 '^event: error' "$LOG_DIR/coach.sse" | grep '^data:' | head -1)
      if [ -n "$ERR" ]; then
        bad "教练指令报错：$(echo "$ERR" | head -c 300)" "$(echo "$ERR" | grep -q 'reasoning_content' && echo 'DeepSeek 思考模式 400：确认 src/ai/llm.ts mastraProviderOptions 关了 thinking，且 coach.service 的 agent.stream 带上了它' || echo '按报错信息查：401 → Key 无效；404 → 模型名 / Base URL 不对；超时 → 服务器访问不到提供方')"
      elif [ -z "$DONE" ]; then bad "教练指令没有返回 done（见 $LOG_DIR/coach.sse）" "看 $LOG_DIR/backend.log 里的报错"
      elif echo "$DONE" | grep -q '"mock":true'; then bad "教练指令走了规则版（mock=true），没用上模型" "确认 DEEPSEEK_API_KEY 有效；看 $LOG_DIR/backend.log"
      else ok "教练指令走真模型完成（mock=false），回复：$(echo "$DONE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(String(JSON.parse(s.replace(/^data: /,"")).reply||"").slice(0,80))}catch{console.log("?")}})')"; fi
      grep -qE 'status code 400|HTTP 400|400 Bad Request|statusCode":400' "$LOG_DIR/backend.log" && bad "后端日志里有 400（见 $LOG_DIR/backend.log）" "多半是请求参数和模型不兼容（思考模式 / tools），看日志里的具体字段"
      if [ "$FAKE" = 1 ]; then
        curl -s "http://127.0.0.1:$FAKE_PORT/__calls" > "$LOG_DIR/fake-calls.json"
        node -e 'const c=require(process.argv[1]);const t=c.filter(x=>x.tools);const b=c.filter(x=>x.status===400);if(b.length||!t.length||t.some(x=>x.thinking!=="disabled")){console.error(JSON.stringify({tool_calls:t.length,bad:b.length,thinking:[...new Set(t.map(x=>x.thinking))]}));process.exit(1)}' "$LOG_DIR/fake-calls.json" \
          && ok "fake-llm：工具调用都带 thinking:disabled，没有 400" || bad "fake-llm 记录到 400 或没关思考模式（见 $LOG_DIR/fake-calls.json）" "Agent 请求要带 thinking:{type:'disabled'}（src/ai/llm.ts mastraProviderOptions）"
      fi
    fi
  fi
fi

# ---------- 5. 讲解预生成 ----------
step "5/7 讲解预生成 gen:explanations"
node dist/scripts/gen-explanations.js --dry-run > "$LOG_DIR/gen-dry.log" 2>&1
if [ $? = 0 ]; then grep -E '符合条件|要生成|估算费用' "$LOG_DIR/gen-dry.log" | sed 's/^/    /'; ok "dry-run 通过（有专家讲解的题默认跳过）"; else tail -5 "$LOG_DIR/gen-dry.log" | sed 's/^/    /'; bad "gen:explanations --dry-run 失败（见 $LOG_DIR/gen-dry.log）" "看日志；常见：DATABASE_URL 连不上"; fi
if [ "$GEN_LIMIT" != 0 ]; then
  node dist/scripts/gen-explanations.js --limit "$GEN_LIMIT" --concurrency 1 --report "$LOG_DIR/gen-explanations.md" > "$LOG_DIR/gen-real.log" 2>&1
  GEN_RC=$?
  grep -E '^\[ai:gen|完成：' "$LOG_DIR/gen-real.log" | sed 's/^/    /'
  ERRN=$(grep -oP '出错未写库 \K[0-9]+' "$LOG_DIR/gen-real.log" | tail -1); PUBN=$(grep -oP '通过并发布 \K[0-9]+' "$LOG_DIR/gen-real.log" | tail -1); REVN=$(grep -oP '（needs_review）\K[0-9]+' "$LOG_DIR/gen-real.log" | tail -1)
  if [ "$GEN_RC" != 0 ] || [ "${ERRN:-x}" != 0 ]; then bad "真生成 $GEN_LIMIT 题出错（见 $LOG_DIR/gen-real.log）" "看日志里的模型报错（401/404/超时/JSON 格式）"
  elif grep -q '⚠' "$LOG_DIR/gen-real.log"; then bad "生成前 /models 预检有警告" "按 gen-real.log 里 ⚠ 那行改模型名"
  elif [ "${PUBN:-0}" = 0 ] && [ "${REVN:-0}" != 0 ]; then warn "真生成 $GEN_LIMIT 题：链路通，但全部待核对（needs_review $REVN）" "抽看 $LOG_DIR/gen-explanations.md，确认是题目本身难核对而不是格式问题"
  else ok "真生成 $GEN_LIMIT 题：发布 ${PUBN:-0}，待核对 ${REVN:-0}，出错 0"; fi
fi

# 评测报告默认写进 eval/，预检产生的挪到日志目录，不弄脏仓库
before_reports=$(ls eval/report-* eval/grading-report-* 2>/dev/null | sort)
move_new_reports() { comm -13 <(echo "$before_reports") <(ls eval/report-* eval/grading-report-* 2>/dev/null | sort) | while read -r f; do [ -n "$f" ] && mv "$f" "$LOG_DIR/"; done; }

# ---------- 6. eval:grading ----------
step "6/7 英语批改评测 eval:grading"
if [ "$SKIP_EVAL" = 1 ]; then warn "跳过（--skip-eval）"; else
  node dist/scripts/eval-grading.js > "$LOG_DIR/eval-grading.log" 2>&1; RC=$?
  grep -E '^(DeepSeek|通义千问):|交叉复评' "$LOG_DIR/eval-grading.log" | sed 's/^/    /'
  ERRS=$(grep -E '^(DeepSeek|通义千问):' "$LOG_DIR/eval-grading.log" | grep -oP '报错 \K[0-9]+' | awk '{s+=$1} END {print s+0}')
  if [ "$RC" != 0 ]; then bad "eval:grading 退出码 $RC（见 $LOG_DIR/eval-grading.log）" "看日志"
  elif grep -q 'skipped: no key' "$LOG_DIR/eval-grading.log"; then bad "eval:grading 说没有 Key" "确认两个 Key 都在 backend/.env"
  elif [ -n "$ERRS" ] && [ "$ERRS" != 0 ]; then bad "eval:grading 有 $ERRS 次模型报错" "多半是模型没按 JSON 输出或调用失败，看 $LOG_DIR/eval-grading.log 里的 ERROR 行"
  else ok "eval:grading 跑完，没有模型报错（通过率见上，供行业专家对照）"; fi
fi
move_new_reports

# ---------- 7. eval:agent ----------
step "7/7 Agent 评测 eval:agent（AI 模式，EVAL_TZ=Asia/Shanghai）"
if [ "$SKIP_EVAL" = 1 ]; then warn "跳过（--skip-eval）"
elif [ -z "$BE_PID" ] || ! kill -0 "$BE_PID" 2>/dev/null; then bad "临时后端没在跑，跳过 eval:agent" "先解决第 4 步"
else
  PORT="$PORT_PF" BASE="http://127.0.0.1:$PORT_PF/api/v1" EVAL_TZ=Asia/Shanghai node dist/scripts/eval-agent.js > "$LOG_DIR/eval-agent.log" 2>&1; RC=$?
  tail -2 "$LOG_DIR/eval-agent.log" | sed 's/^/    /'
  NMODELERR=$(grep -c '模型调用出错' "$LOG_DIR/eval-agent.log"); NSETUP=$(grep -cE 'SETUP_(UNKNOWN|UNAPPLIED)|setup 全部落库' "$LOG_DIR/eval-agent.log")
  if [ "$RC" -ge 2 ] || ! grep -q '^单测 ' "$LOG_DIR/eval-agent.log"; then bad "eval:agent 没跑完（退出码 $RC，见 $LOG_DIR/eval-agent.log）" "看日志最后几行"
  elif [ "$NMODELERR" != 0 ]; then
    grep '模型调用出错' "$LOG_DIR/eval-agent.log" | head -3 | cut -c1-240 | sed 's/^/    /'
    bad "eval:agent 里有 $NMODELERR 处模型调用出错" "按报错查（400 → 请求参数 / 思考模式；401 → Key；429 → 限流，调低并发或稍后再跑）"
  elif [ "$NSETUP" != 0 ]; then bad "eval:agent 有用例前提没落库（SETUP_*）" "看 eval-agent.log 里 SETUP_ 开头的行，修 scripts/eval-agent.ts applySetup"
  elif [ "$RC" = 0 ]; then ok "eval:agent 全部自动项通过（人工项见报告，交给行业专家打分）"
  else
    grep -E '^FAIL' "$LOG_DIR/eval-agent.log" | head -6 | cut -c1-160 | sed 's/^/    /'
    if [ "$FAKE" = 1 ]; then warn "eval:agent 跑完，模型调用无报错；自动项有不通过（演练用的 fake-llm 只会按固定脚本调工具，按规则版写的断言本来就过不了）"
    else warn "eval:agent 跑完、模型调用都成功，但有自动项不通过（真模型的行为问题，不是 Key 配置问题）" "把 $LOG_DIR 里的 eval:agent 报告交给后端 / 行业专家逐条看 FAIL；「不编数字 / 不越权 / 日期对」这类必须修提示词或工具"; fi
  fi
fi
move_new_reports

# ---------- 汇总 ----------
echo; echo "================ 汇总 ================"
for r in "${RESULTS[@]}"; do echo "  $r"; done
[ -f "$LOG_DIR/fixes.txt" ] && while read -r l; do FIXES+=("$l"); done < "$LOG_DIR/fixes.txt"
if [ "$FAILED" = 0 ]; then
  if [ "$FAKE" = 1 ]; then echo; echo "演练通过 ✓（fake-llm）—— 流程和代码没问题；Key 到了以后不带 --fake 再跑一次。日志：$LOG_DIR"
  else echo; echo "全部通过 ✓ —— Key 可以用了。日志和报告：$LOG_DIR"; fi
  [ ${#FIXES[@]} -gt 0 ] && { echo "提醒："; for f in "${FIXES[@]}"; do echo "  → $f"; done; }
  exit 0
fi
echo; echo "没通过 ✗，要改的地方："
for f in "${FIXES[@]}"; do echo "  → $f"; done
echo "日志和报告：$LOG_DIR"
exit 1
