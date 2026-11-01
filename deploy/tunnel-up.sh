#!/usr/bin/env bash
# 临时 https 隧道（Cloudflare quick tunnel，免账号）：给 Tony 在真手机上验收 PWA 用。正式服务器到位后改走 deploy.sh。
#
#   bash deploy/tunnel-up.sh               起 :3001 隧道后端 + :8080 源站，然后开公网隧道，地址写进 /workspace/.secrets/tunnel-url.txt
#   bash deploy/tunnel-up.sh --local-only  只起 :3001 + :8080（本机自测，不开公网隧道）
#   bash deploy/tunnel-up.sh --rebuild     先按 git HEAD 重新编译隧道后端（backend/dist-tunnel）；pull 了新提交后要加它
#   bash deploy/tunnel-down.sh             全部停掉
#
# 隧道 profile（只作用于 :3001，:3000 不受影响）：
#   REGISTRATION_DISABLED=1（注册返回 403）、LOGIN_ALLOWLIST=tony（只有 tony 能登录）、DEBUG_NOW_DISABLED=1（忽略 X-Debug-Now）、
#   JOBS_ENABLED=0（定时任务只在 :3000 跑，免得重复）、独立的 JWT_SECRET（:3000 的令牌在隧道上无效）。
# 密钥都在仓库外：/workspace/.secrets/tunnel.env（JWT_SECRET、LOGIN_ALLOWLIST）、/workspace/.secrets/tony-account.txt（Tony 的密码）。
# 隧道地址只发给统筹者私下转给 Tony，不要贴进群或提交到 git。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS=${SECRETS_DIR:-/workspace/.secrets}
RUN=${TUNNEL_RUN_DIR:-/tmp/kaoyan-tunnel}
API_PORT=${TUNNEL_API_PORT:-3001}
ORIGIN_PORT=${TUNNEL_ORIGIN_PORT:-8080}
CLOUDFLARED=${CLOUDFLARED:-$(command -v cloudflared || echo "$HOME/bin/cloudflared")}
LOCAL_ONLY=0; REBUILD=0
for a in "$@"; do case "$a" in --local-only) LOCAL_ONLY=1 ;; --rebuild) REBUILD=1 ;; *) echo "未知参数 $a" >&2; exit 2 ;; esac; done
mkdir -p "$RUN"; chmod 700 "$RUN"
listening() { ss -ltn "sport = :$1" | grep -q LISTEN; }
wait_http() { for _ in $(seq 1 60); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done; echo "等不到 $1" >&2; return 1; }

[ -f "$SECRETS/tunnel.env" ] || { echo "缺 $SECRETS/tunnel.env（JWT_SECRET、LOGIN_ALLOWLIST）" >&2; exit 1; }
[ -f "$ROOT/frontend/dist/index.html" ] || { echo "缺 frontend/dist，先在 frontend 里 npm run build" >&2; exit 1; }

# ---- 1) 隧道后端 :3001（同一个开发库 kaoyan，只监听 127.0.0.1）----
if listening "$API_PORT"; then
  echo "· :$API_PORT 已在监听，沿用（要换代码先跑 tunnel-down.sh）"
else
  cd "$ROOT/backend"
  if [ "$REBUILD" = 1 ] || [ ! -f dist-tunnel/src/main.js ]; then
    # 只编译已提交的代码（git HEAD），不带上工作区里别人还没提交、可能还缺迁移的改动
    echo "· 编译隧道后端（HEAD $(git -C "$ROOT" rev-parse --short HEAD)）→ backend/dist-tunnel"
    SRC="$RUN/src"; rm -rf "$SRC" dist-tunnel; mkdir -p "$SRC"
    git -C "$ROOT" archive HEAD backend/src backend/scripts backend/tsconfig.json | tar -x -C "$SRC"
    ln -s "$ROOT/backend/node_modules" "$SRC/backend/node_modules"
    ( cd "$SRC/backend" && npx tsc -p tsconfig.json --outDir "$ROOT/backend/dist-tunnel" )
    git -C "$ROOT" rev-parse --short HEAD >dist-tunnel/COMMIT
  fi
  DBURL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
  [[ "$DBURL" =~ /kaoyan$ ]] || { echo "backend/.env 的 DATABASE_URL 不是 kaoyan 库，停下" >&2; exit 1; }
  # 不继承 shell 里可能 export 过的旁路库 / 假模型变量
  ( set -a; . "$SECRETS/tunnel.env"; set +a
    exec env -u AI_FAKE -u PGDATABASE -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD \
      DATABASE_URL="$DBURL" PORT="$API_PORT" HOST=127.0.0.1 JOBS_ENABLED=0 \
      REGISTRATION_DISABLED=1 DEBUG_NOW_DISABLED=1 LOGIN_ALLOWLIST="${LOGIN_ALLOWLIST:-tony}" JWT_SECRET="$JWT_SECRET" \
      nohup node dist-tunnel/src/main.js >"$RUN/api.log" 2>&1 ) &
  echo $! >"$RUN/api.pid"
  wait_http "http://127.0.0.1:$API_PORT/api/v1/health"
  echo "· 隧道后端已起：127.0.0.1:$API_PORT（pid $(cat "$RUN/api.pid")，日志 $RUN/api.log）"
fi

# ---- 2) 单一源站 :8080：frontend/dist + /api → :3001 ----
if listening "$ORIGIN_PORT"; then
  echo "· :$ORIGIN_PORT 已在监听，沿用"
else
  ORIGIN_PORT="$ORIGIN_PORT" ORIGIN_HOST=127.0.0.1 API_UPSTREAM="http://127.0.0.1:$API_PORT" DIST="$ROOT/frontend/dist" \
    nohup node "$ROOT/deploy/tunnel-origin.mjs" >"$RUN/origin.log" 2>&1 &
  echo $! >"$RUN/origin.pid"
  wait_http "http://127.0.0.1:$ORIGIN_PORT/manifest.webmanifest"
  echo "· 源站已起：http://127.0.0.1:$ORIGIN_PORT（pid $(cat "$RUN/origin.pid")）"
fi

[ "$LOCAL_ONLY" = 1 ] && { echo "· --local-only：没开公网隧道"; exit 0; }

# ---- 3) Cloudflare quick tunnel（公网 https）----
[ -x "$CLOUDFLARED" ] || { echo "找不到 cloudflared（~/bin/cloudflared）" >&2; exit 1; }
if [ -f "$RUN/cloudflared.pid" ] && kill -0 "$(cat "$RUN/cloudflared.pid")" 2>/dev/null; then
  echo "· 隧道已在运行（pid $(cat "$RUN/cloudflared.pid")），地址见 $SECRETS/tunnel-url.txt"; exit 0
fi
: >"$RUN/cloudflared.log"
nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:$ORIGIN_PORT" >"$RUN/cloudflared.log" 2>&1 &
echo $! >"$RUN/cloudflared.pid"
URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/cloudflared.log" | head -1 || true)
  [ -n "$URL" ] && break; sleep 1
done
[ -n "$URL" ] || { echo "60 秒内没拿到隧道地址，看 $RUN/cloudflared.log" >&2; exit 1; }
( umask 077; echo "$URL" >"$SECRETS/tunnel-url.txt" )
chmod 600 "$SECRETS/tunnel-url.txt"
echo "· 隧道已开（pid $(cat "$RUN/cloudflared.pid")），地址已写进 $SECRETS/tunnel-url.txt（只发给统筹者，不贴群）"
