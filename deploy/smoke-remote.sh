#!/usr/bin/env bash
# 部署后冒烟测试（从任何能访问站点的机器跑，只依赖 curl + python3）：
#   ./smoke-remote.sh https://kaoyan.example.com
#   ./smoke-remote.sh http://1.2.3.4
# 只读为主；会注册一个测试账号 deploy_smoke_<时间戳>（结束时打印清理命令）。不调用付费 AI 接口。
# 退出码：0 全部通过；1 有失败。
set -uo pipefail
URL="${1:-}"; [ -n "$URL" ] || { sed -n 2,6p "$0"; exit 1; }
URL="${URL%/}"; B="$URL/api/v1"
PASS=0; FAIL=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $*"; FAIL=$((FAIL+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
j()    { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

echo "== 1 健康检查 $B/health"
H=$(curl -s --max-time 20 "$B/health")
echo "    $H"
[ "$(echo "$H" | j "d.get('ok')")" = True ] && ok "health ok" || bad "health 不 ok"
[ "$(echo "$H" | j "d.get('pgvector')")" = True ] && ok "pgvector 已启用" || bad "pgvector 没启用（镜像应为 pgvector/pgvector:pg17）"
NQ=$(echo "$H" | j "d.get('questions',0)"); [ "${NQ:-0}" -gt 0 ] 2>/dev/null && ok "题目数 $NQ" || bad "题库为空（docker compose --profile tools run --rm import）"
AI=$(echo "$H" | j "d.get('ai')"); [ "$AI" = mock ] && echo "  ! AI 走模拟（没配 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY）" || ok "AI: $AI"

echo "== 2 前端（Caddy）"
[ "$(code "$URL/")" = 200 ] && ok "首页 200" || bad "首页不是 200"
curl -s --max-time 20 "$URL/" | grep -qi '<div id="app"' && ok "index.html 是前端" || bad "首页内容不像 index.html"
[ "$(code "$URL/some/spa/route")" = 200 ] && ok "SPA 路由回退 index.html" || bad "SPA 路由 404"
ASSET=$(curl -s --max-time 20 "$URL/" | grep -oE '(\./)?assets/[^"]+\.js' | head -1)
if [ -n "$ASSET" ]; then
  CC=$(curl -sI --max-time 20 "$URL/${ASSET#./}" | tr -d '\r' | grep -i '^cache-control' | cut -d' ' -f2-)
  [ -n "$CC" ] && ok "静态资源 ${ASSET#./} cache-control: $CC" || bad "静态资源没有 cache-control"
fi
case "$URL" in https://*)
  HOST=${URL#https://}; HOST=${HOST%%/*}
  C=$(code "http://$HOST/"); case "$C" in 301|308) ok "http → https 跳转（$C）" ;; *) bad "http://$HOST/ 没跳 https（$C）" ;; esac ;;
esac

echo "== 3 注册 / 登录"
U="deploy_smoke_$(date +%s)"; P="smoke-$(date +%s)-pw"
R=$(curl -s --max-time 20 -XPOST "$B/auth/register" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$P\"}")
T=$(echo "$R" | j "d['access_token']")
[ -n "$T" ] && ok "注册 $U" || { bad "注册失败：$R"; echo "== 结果：$PASS 通过，$FAIL 失败"; exit 1; }
T2=$(curl -s --max-time 20 -XPOST "$B/auth/login" -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"$P\"}" | j "d['access_token']")
[ -n "$T2" ] && ok "登录" || bad "登录失败"
A=(-H "authorization: Bearer $T")
[ "$(code "$B/auth/me")" = 401 ] && ok "未登录访问 /auth/me → 401" || bad "未登录访问 /auth/me 不是 401"

echo "== 4 题库"
Y=$(curl -s --max-time 20 "${A[@]}" "$B/questions/years")
echo "$Y" | j "'    ' + ', '.join(f\"{i['exam']}-{i['year']}({i['total']})\" for i in d['items'])"
NY=$(echo "$Y" | j "len(d['items'])"); [ "${NY:-0}" -gt 0 ] 2>/dev/null && ok "years：$NY 套" || bad "years 为空"
for EX in math1 english1; do
  YR=$(echo "$Y" | j "max([i['year'] for i in d['items'] if i['exam']=='$EX'] or [0])")
  [ "${YR:-0}" -gt 0 ] 2>/dev/null || { echo "  - 没有 $EX，跳过"; continue; }
  L=$(curl -s --max-time 20 "${A[@]}" "$B/questions?exam=$EX&year=$YR&page_size=100")
  N=$(echo "$L" | j "d['total']"); QID=$(echo "$L" | j "d['items'][0]['id']")
  [ "${N:-0}" -gt 0 ] 2>/dev/null && ok "$EX $YR 列表 $N 题" || bad "$EX $YR 列表为空"
  [ -n "$QID" ] && [ "$(code "${A[@]}" "$B/questions/$QID")" = 200 ] && ok "题目详情 $QID" || bad "题目详情 $QID"
  IMG=$(echo "$L" | grep -oE 'images/[^"\) ]+\.(png|jpg|jpeg|svg)' | head -1)
  [ -n "$IMG" ] && { [ "$(code "$B/assets/$IMG")" = 200 ] && ok "题图 $IMG" || bad "题图 $IMG 拿不到（tiku/images 没同步？）"; }
done

echo "== 5 生产开关"
C=$(code "${A[@]}" -XPOST "$B/agent/jobs/run" -H 'content-type: application/json' -d '{"job":"nightly"}')
[ "$C" = 404 ] && ok "开发接口 POST /agent/jobs/run → 404" || bad "开发接口 /agent/jobs/run 返回 $C（应 404：NODE_ENV=production 且 DEV_TOOLS≠1）"
[ "$(code "${A[@]}" "$B/plans/today")" = 200 ] && ok "/plans/today 200（登录后接口）" || bad "/plans/today 不是 200"

echo
echo "== 结果：$PASS 通过，$FAIL 失败"
echo "   清理测试账号（服务器上）：cd /opt/kaoyan/deploy && docker compose exec -T db psql -U kaoyan -c \"DELETE FROM users WHERE username LIKE 'deploy\\_smoke\\_%'\""
[ $FAIL = 0 ]
