#!/usr/bin/env bash
# 数据库每日备份（在服务器上运行），保留最近 BACKUP_KEEP 份（默认 7）。日常备份已由 compose 里的 backup 服务自动做，这个脚本留作手动 / 宿主机 cron 备选
#   手动：  cd /opt/kaoyan/deploy && ./backup.sh
#   每天 3:15 自动：crontab -e 加一行
#     15 3 * * * /opt/kaoyan/deploy/backup.sh >> /opt/kaoyan/deploy/backups/backup.log 2>&1
# 恢复：见 README.md「备份与恢复」
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; }
KEEP="${BACKUP_KEEP:-7}"
DIR="${BACKUP_DIR:-$PWD/backups}"
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/kaoyan-$TS.dump"

# pg_dump 自定义格式（压缩、可选择性恢复）；先写临时文件，成功后再改名，避免留下半截备份
docker compose exec -T db pg_dump -U kaoyan -d kaoyan -Fc -Z 6 > "$OUT.part"
mv "$OUT.part" "$OUT"
# 费曼录音（uploads 卷）一起打包；很小的话几乎不占空间
docker compose exec -T backend tar -C /app -czf - uploads > "$DIR/uploads-$TS.tgz" 2>/dev/null || rm -f "$DIR/uploads-$TS.tgz"

# 真题 PDF / OCR 原始材料（tiku/src，不进 git）
[ -d "${TIKU_HOST_DIR:-../tiku}/src" ] && tar -C "${TIKU_HOST_DIR:-../tiku}/src" -cf "$DIR/tiku-src-$TS.tar" .
echo "$(date '+%F %T') 备份完成 $OUT ($(du -h "$OUT" | cut -f1))"

# 只保留最近 KEEP 份
ls -1t "$DIR"/kaoyan-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DIR"/tiku-src-*.tar 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
ls -1t "$DIR"/uploads-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
