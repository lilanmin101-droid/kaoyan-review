#!/usr/bin/env bash
# 从开发机（这台 box）一键部署到服务器：
#   ./deploy.sh user@host [APP_DIR]         # APP_DIR 默认 /opt/kaoyan
#   ./deploy.sh user@host --dry-run         # 只打印要做什么
# 可重复执行：同步代码和题库 → 服务器上 ./server-up.sh（构建、迁移、导入、启动）
# 环境变量：
#   TIKU_DIR   题库目录（默认 <项目>/tiku，即仓库里的 tiku/）
#   ECDICT_DIR ECDICT 目录（默认 <项目>/data/ecdict，里面要有 ecdict.csv）
#   SSH_OPTS   额外 ssh 参数，比如 "-p 2222 -i ~/.ssh/kaoyan"
#   PUSH_ENV=1 用本地 deploy/.env 覆盖服务器上的 .env（默认只在服务器还没有 .env 时上传）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"; shift || true
APP_DIR=/opt/kaoyan; DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) APP_DIR="$a" ;; esac; done
[ -n "$TARGET" ] || { sed -n 2,11p "$0"; exit 1; }
TIKU_DIR="${TIKU_DIR:-$ROOT/tiku}"
ECDICT_DIR="${ECDICT_DIR:-$ROOT/data/ecdict}"
SSH="ssh ${SSH_OPTS:-} -o ServerAliveInterval=30"

[ -f "$TIKU_DIR/knowledge_tree.json" ] || { echo "✗ $TIKU_DIR 不像题库目录"; exit 1; }

run() { if [ $DRY = 1 ]; then echo "+ $*"; else eval "$@"; fi; }

# 题库只带运行需要的：题目 JSON、英语文章 *_passages.json、知识点、图片、专家讲解、校对记录、真题词汇 vocab/
# 另带 OCR 原始材料 src/（真题 PDF，不进 git，靠服务器每日备份留底）；不带 img_tmp/
TIKU_INCLUDES=(knowledge_tree.json images explanations reviews)
for d in vocab src; do [ -e "$TIKU_DIR/$d" ] && TIKU_INCLUDES+=("$d"); done
while IFS= read -r f; do TIKU_INCLUDES+=("$f"); done < <(cd "$TIKU_DIR" && ls | grep -E '^(math[123]|english[12]|politics)_[0-9]{4}(_kp_tags|_passages)?\.json$')

CODE_EXCLUDES=(--exclude=node_modules --exclude=dist --exclude=uploads --exclude=.env "--exclude='*.log'"
  "--exclude='import_report*.md'" "--exclude='e2e*.mjs'" --exclude=reports --exclude=backups)

echo "== 目标 $TARGET:$APP_DIR"
run "$SSH $TARGET 'mkdir -p $APP_DIR 2>/dev/null || sudo mkdir -p $APP_DIR && sudo chown \$(id -u):\$(id -g) $APP_DIR; mkdir -p $APP_DIR/tiku $APP_DIR/data/ecdict'"

if command -v rsync >/dev/null && [ $DRY = 0 ] && $SSH "$TARGET" 'command -v rsync' >/dev/null 2>&1; then
  echo "== 同步（rsync）"
  RS="rsync -az --delete -e \"$SSH\""
  for d in backend frontend deploy; do
    eval "$RS ${CODE_EXCLUDES[*]} \"$ROOT/$d/\" \"$TARGET:$APP_DIR/$d/\""
  done
  (cd "$TIKU_DIR" && eval "$RS --relative ${TIKU_INCLUDES[*]} \"$TARGET:$APP_DIR/tiku/\"")
  [ -f "$ECDICT_DIR/ecdict.csv" ] && eval "$RS \"$ECDICT_DIR/\" \"$TARGET:$APP_DIR/data/ecdict/\""
else
  echo "== 同步（tar over ssh；本机或服务器没有 rsync）"
  # 代码目录整体替换（避免服务器上残留已删除的源文件）；deploy/.env、reports、backups 保留
  TAR_X=(--exclude=node_modules --exclude=dist --exclude=uploads --exclude=.env "--exclude='*.log'"
    "--exclude='import_report*.md'" "--exclude='e2e*.mjs'" --exclude=deploy/reports --exclude=deploy/backups)
  run "tar -C '$ROOT' ${TAR_X[*]} -czf - backend frontend deploy | $SSH $TARGET 'set -e; cd $APP_DIR; rm -rf .stage && mkdir .stage && tar -xzf - -C .stage; rm -rf backend frontend; mv .stage/backend .stage/frontend .; mkdir -p deploy; find deploy -maxdepth 1 -type f ! -name .env -delete; cp -a .stage/deploy/. deploy/; rm -rf .stage'"
  # 原地清空再解压（不换目录 inode，正在运行的后端容器的 bind mount 立刻看到新文件）
  run "tar -C '$TIKU_DIR' -czf - ${TIKU_INCLUDES[*]} | $SSH $TARGET 'set -e; cd $APP_DIR; mkdir -p tiku; find tiku -mindepth 1 -delete; tar -xzf - -C tiku'"
  if [ -f "$ECDICT_DIR/ecdict.csv" ]; then
    LOCAL_SIZE=$(stat -c %s "$ECDICT_DIR/ecdict.csv")
    REMOTE_SIZE=$([ $DRY = 1 ] && echo 0 || $SSH "$TARGET" "stat -c %s $APP_DIR/data/ecdict/ecdict.csv 2>/dev/null || echo 0")
    if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
      run "tar -C '$ECDICT_DIR' -czf - . | $SSH $TARGET 'tar -xzf - -C $APP_DIR/data/ecdict'"
    else echo "  ecdict.csv 已是最新，跳过"; fi
  fi
fi

# 前端构建产物（WEB_DOCKERFILE=deploy/web.prebuilt.Dockerfile 时直接用它，服务器不用 npm ci + vite build）
if [ -f "$ROOT/frontend/dist/index.html" ]; then
  echo "== 同步 frontend/dist"
  run "tar -C '$ROOT/frontend' -czf - dist | $SSH $TARGET 'set -e; cd $APP_DIR/frontend; rm -rf dist; tar -xzf -'"
fi

# .env：服务器没有时上传本地的（如果有）；都没有则 server-up.sh 会自动生成
if [ -f "$ROOT/deploy/.env" ]; then
  if [ "${PUSH_ENV:-0}" = 1 ] || ! { [ $DRY = 0 ] && $SSH "$TARGET" "test -f $APP_DIR/deploy/.env"; }; then
    echo "== 上传 deploy/.env"
    run "$SSH $TARGET 'umask 077; cat > $APP_DIR/deploy/.env' < '$ROOT/deploy/.env'"
  fi
fi

echo "== 服务器上构建并启动"
run "$SSH -t $TARGET 'cd $APP_DIR/deploy && chmod +x *.sh && ./server-up.sh'"
