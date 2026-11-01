#!/usr/bin/env bash
# backup 容器的主循环（docker-compose.yml 的 backup 服务挂载进去，不用宿主机 cron）
# 每天 BACKUP_AT（容器时区 TZ，默认 Asia/Shanghai 03:15）：
#   /backups/kaoyan-YYYYmmdd-HHMMSS.dump      pg_dump -Fc（恢复见 README「备份与恢复」）
#   /backups/uploads-YYYYmmdd-HHMMSS.tar.gz   费曼录音
#   /backups/tiku-src-YYYYmmdd-HHMMSS.tar     tiku/src 真题 PDF / OCR 原始材料（不进 git；PDF 已压缩，tar 不再 gzip）
# 保留 BACKUP_KEEP_DAYS 天（默认 7），更早的删掉。
# 立即备份一次：docker compose exec backup bash /backup-loop.sh --once
set -uo pipefail
AT="${BACKUP_AT:-03:15}"
KEEP="${BACKUP_KEEP_DAYS:-7}"
DIR="${BACKUP_DIR:-/backups}"
UPLOADS="${UPLOADS_DIR:-/uploads}"
TIKU_SRC="${TIKU_SRC_DIR:-/tiku-src}"
mkdir -p "$DIR"

backup_once() {
  local ts tmp
  ts=$(date +%Y%m%d-%H%M%S)
  tmp="$DIR/.kaoyan-$ts.dump.part"
  echo "[backup] $(date '+%F %T %Z') pg_dump 开始"
  if pg_dump -Fc -f "$tmp" && [ -s "$tmp" ]; then
    mv "$tmp" "$DIR/kaoyan-$ts.dump"
    echo "[backup] ✓ kaoyan-$ts.dump ($(du -h "$DIR/kaoyan-$ts.dump" | cut -f1))"
  else
    rm -f "$tmp"; echo "[backup] ✗ pg_dump 失败"; touch "$DIR/.last_failed"; return 1
  fi
  if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]; then
    tar -czf "$DIR/uploads-$ts.tar.gz" -C "$UPLOADS" . && echo "[backup] ✓ uploads-$ts.tar.gz"
  fi
  if [ -d "$TIKU_SRC" ] && [ -n "$(ls -A "$TIKU_SRC" 2>/dev/null)" ]; then
    tar -cf "$DIR/.tiku-src-$ts.tar.part" -C "$TIKU_SRC" . && mv "$DIR/.tiku-src-$ts.tar.part" "$DIR/tiku-src-$ts.tar" && echo "[backup] ✓ tiku-src-$ts.tar ($(du -h "$DIR/tiku-src-$ts.tar" | cut -f1))" || { rm -f "$DIR/.tiku-src-$ts.tar.part"; echo "[backup] ✗ tiku/src 打包失败"; }
  fi
  # 保留 KEEP 天：按修改时间删
  find "$DIR" -maxdepth 1 -type f \( -name 'kaoyan-*.dump' -o -name 'uploads-*.tar.gz' -o -name 'tiku-src-*.tar' \) -mtime +"$((KEEP - 1))" -print -delete | sed 's/^/[backup] 删除过期 /'
  rm -f "$DIR/.last_failed"; date +%s > "$DIR/.last_ok"
}

if [ "${1:-}" = "--once" ]; then backup_once; exit $?; fi

echo "[backup] 每天 $AT（$(date +%Z)）备份，保留 $KEEP 天，目录 $DIR"
last=""
while true; do
  touch "$DIR/.heartbeat"
  now=$(date +%H:%M); today=$(date +%F)
  if [ "$now" = "$AT" ] && [ "$last" != "$today" ]; then
    backup_once || true
    last=$today
  fi
  sleep 30
done
