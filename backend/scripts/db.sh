#!/usr/bin/env bash
# 本机原生运行 PostgreSQL 17（没有 Docker）。二进制来自 npm 包 @embedded-postgres/linux-x64（官方源码编译的 PG 17.11）
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"          # /workspace/kaoyan
PGBIN="${PGBIN:-$ROOT/pg-runtime/node_modules/@embedded-postgres/linux-x64/native/bin}"
PGDATA="${PGDATA:-$ROOT/pgdata}"
PGPORT="${PGPORT:-5432}"
mkdir -p "$ROOT/pglogs"
case "$1" in
  init)
    # 新机器：pg-runtime/ 不在 git 里，要自己建 + 给个 package.json（不然 npm 往上找到仓库根装错地方）；
    # 包的 postinstall（还原 lib 的软链接）有时不跑，手动跑一次，重复跑也没事
    if [ ! -x "$PGBIN/initdb" ]; then
      mkdir -p "$ROOT/pg-runtime"
      [ -f "$ROOT/pg-runtime/package.json" ] || echo '{"name":"pg-runtime","private":true}' > "$ROOT/pg-runtime/package.json"
      (cd "$ROOT/pg-runtime" && npm i @embedded-postgres/linux-x64@17.11.0-beta.19)
    fi
    [ -f "$ROOT/pg-runtime/node_modules/@embedded-postgres/linux-x64/scripts/hydrate-symlinks.js" ] && (cd "$ROOT/pg-runtime/node_modules/@embedded-postgres/linux-x64" && node scripts/hydrate-symlinks.js)
    if [ -f "$PGDATA/PG_VERSION" ]; then echo "already initialized: $PGDATA"; exit 0; fi
    echo kaoyan > /tmp/.kaoyan_pw
    "$PGBIN/initdb" -D "$PGDATA" -U kaoyan --pwfile=/tmp/.kaoyan_pw -E UTF8 --locale=C.UTF-8 --auth=scram-sha-256
    rm -f /tmp/.kaoyan_pw
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$ROOT/pglogs/pg.log" -o "-p $PGPORT -k /tmp" -w start
    PGPASSWORD=kaoyan psql -h 127.0.0.1 -p "$PGPORT" -U kaoyan -d postgres -c "CREATE DATABASE kaoyan"
    ;;
  start)  "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 && echo "already running" || "$PGBIN/pg_ctl" -D "$PGDATA" -l "$ROOT/pglogs/pg.log" -o "-p $PGPORT -k /tmp" -w start ;;
  stop)   "$PGBIN/pg_ctl" -D "$PGDATA" -w stop ;;
  status) "$PGBIN/pg_ctl" -D "$PGDATA" status ;;
  psql)   shift; PGPASSWORD=kaoyan psql -h 127.0.0.1 -p "$PGPORT" -U kaoyan -d kaoyan "$@" ;;
  *) echo "usage: $0 {init|start|stop|status|psql}"; exit 1 ;;
esac
