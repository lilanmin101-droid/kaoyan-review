#!/usr/bin/env bash
# 在服务器上运行（deploy.sh 会通过 ssh 调它；也可以登录服务器后手动跑）：
#   cd /opt/kaoyan/deploy && ./server-up.sh
# 可重复执行：构建 → 起数据库 → 迁移（含 002_pgvector）→ 导入题库 + 单词 → 启动（含每日备份服务）→ 健康检查
# SKIP_IMPORT=1 ./server-up.sh   只更新代码，不重新导入
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose"
command -v docker >/dev/null || { echo "✗ 没装 Docker：curl -fsSL https://get.docker.com | sh"; exit 1; }
$DC version >/dev/null 2>&1 || { echo "✗ 需要 Docker Compose v2（docker compose 子命令）"; exit 1; }

# ---- .env：第一次自动生成随机密码 ----
if [ ! -f .env ]; then
  cp .env.example .env
  echo "• 已从 .env.example 生成 .env"
fi
fill() { # 空值才填
  local k=$1 v=$2
  if grep -qE "^$k=\s*$" .env; then sed -i "s|^$k=.*|$k=$v|" .env; echo "• 已生成随机 $k"; fi
}
fill POSTGRES_PASSWORD "$(openssl rand -hex 24)"
fill JWT_SECRET "$(openssl rand -hex 32)"
chmod 600 .env
set -a; . ./.env; set +a

[ -f "${TIKU_HOST_DIR:-../tiku}/knowledge_tree.json" ] || { echo "✗ 缺 ${TIKU_HOST_DIR:-../tiku}/knowledge_tree.json（题库没同步过来？）"; exit 1; }
if [ "${WEB_DOCKERFILE:-}" = deploy/web.prebuilt.Dockerfile ] && [ ! -f ../frontend/dist/index.html ]; then
  echo "✗ WEB_DOCKERFILE 用预构建版，但没有 ../frontend/dist/index.html（开发机 cd frontend && npm run build 后重跑 deploy.sh）"; exit 1
fi
mkdir -p reports backups
chmod a+rwx reports   # 容器里以 node 用户写导入报告

echo "== 1/6 构建镜像（backend、web）"
$DC build --pull backend web

echo "== 2/6 启动数据库"
$DC up -d --wait db

echo "== 3/6 数据库迁移（migrate 服务；已执行过的会跳过；以后每次 up 也会自动先跑）"
$DC run --rm -T migrate

if [ "${SKIP_IMPORT:-0}" != 1 ]; then
  echo "== 4-5/6 导入题库 + 单词（import 服务，upsert，可重复；报告在 deploy/reports/）"
  [ -f "${ECDICT_HOST_DIR:-../data/ecdict}/ecdict.csv" ] || echo "  ! 没有 ecdict.csv，跳过 ECDICT 词库（https://github.com/skywind3000/ECDICT 下载 ecdict.csv 放进 data/ecdict/）"
  $DC --profile tools run --rm -T import
else
  echo "== 4-5/6 跳过导入（SKIP_IMPORT=1）"
fi

echo "== 6/6 启动全部服务"
$DC up -d --remove-orphans
for i in $(seq 1 30); do
  if $DC exec -T backend curl -fsS http://127.0.0.1:3000/api/v1/health 2>/dev/null; then echo; ok=1; break; fi
  sleep 2
done
[ "${ok:-}" = 1 ] || { echo "✗ 后端没起来，看日志：docker compose logs backend"; exit 1; }
# 经过 Caddy 再探一次（没域名走 :80；有域名时 :80 会 308 跳 https，也算通）
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT:-80}/api/v1/health" || true)
  case "$code" in 200|301|308) web=1; break ;; esac; sleep 2
done
[ "${web:-}" = 1 ] || { echo "✗ Caddy（web）没通，看日志：docker compose logs web"; exit 1; }
$DC ps
if [ -n "${DOMAIN:-}" ]; then echo "✓ 部署完成：https://$DOMAIN （第一次申请证书要几十秒）"
else echo "✓ 部署完成：http://$(hostname -I 2>/dev/null | awk '{print $1}'):${HTTP_PORT:-80}"; fi
