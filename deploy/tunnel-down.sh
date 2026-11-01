#!/usr/bin/env bash
# 停掉 tunnel-up.sh 起的东西：公网隧道、:8080 源站、:3001 隧道后端（:3000 不动）。地址文件一并删除，下次开会换新地址。
set -uo pipefail
RUN=${TUNNEL_RUN_DIR:-/tmp/kaoyan-tunnel}
SECRETS=${SECRETS_DIR:-/workspace/.secrets}
for n in cloudflared origin api; do
  f="$RUN/$n.pid"; [ -f "$f" ] || continue
  p=$(cat "$f")
  if kill -0 "$p" 2>/dev/null; then
    pkill -TERM -P "$p" 2>/dev/null; kill -TERM "$p" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
    kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null
    echo "· 已停 $n（pid $p）"
  fi
  rm -f "$f"
done
rm -f "$SECRETS/tunnel-url.txt"
