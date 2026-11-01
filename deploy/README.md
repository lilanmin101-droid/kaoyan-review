# 考研复习 App · 部署说明

目标：你给一台服务器，在开发机（box）上跑**一条命令**就部署好，手机浏览器能直接打开。

```
手机/电脑浏览器 ──HTTPS──▶ Caddy（前端静态文件 + /api 反代，SSE 不缓冲，自动证书）
                              └──▶ backend（NestJS，Node 22，带 Chromium 导出 PDF）
                                      └──▶ db（PostgreSQL 17 + pgvector）
migrate（每次 up 先跑迁移）· import（一次性导入题库/单词）· backup（每天 pg_dump，留 7 天）
```

## 你需要准备什么

| 必需 | 说明 |
|---|---|
| 一台 Linux 服务器 | 建议 **2 核 4G**、40G 硬盘，Ubuntu 22.04/24.04 或 Debian 12。1 核 2G 也能跑，但构建镜像会慢、导出 PDF 时吃紧 |
| Docker + Compose v2 | 服务器上执行 `curl -fsSL https://get.docker.com \| sh`，然后 `sudo usermod -aG docker $USER` 重新登录 |
| SSH 登录 | 能 `ssh 用户@服务器IP` 免密登录（把 box 的公钥加到服务器 `~/.ssh/authorized_keys`）；用户要能用 docker（root 或在 docker 组里）|
| 放行端口 | 云厂商安全组 / 防火墙放行 **22、80、443**（443 含 UDP 更好）|

| 可选 | 说明 |
|---|---|
| 域名 | 有域名就把 A 记录指向服务器 IP，`.env` 里填 `DOMAIN=kaoyan.example.com`，Caddy 自动申请免费 HTTPS 证书。**没有域名也能用**：`http://服务器IP` |
| DeepSeek / 通义千问 Key | 填进服务器上的 `deploy/.env`，`docker compose up -d` 重启生效。没有 Key 时 AI 部分走模拟数据 |

注意：
- **手机麦克风（费曼「讲给它听」）和「添加到主屏幕」只在 HTTPS 下可用**，所以推荐配域名。
- **国内（大陆）服务器**：域名要先 ICP 备案，否则 80/443 会被拦；不想备案就用香港/海外服务器。国内拉镜像慢的话给 Docker 配镜像加速，并在 `.env` 里设 `NPM_REGISTRY=https://registry.npmmirror.com`。

## 拿到 SSH 之后：逐步操作

下面每一步都在 **box** 上执行（`ssh` 那几行是登录服务器）。把 `USER@IP` 换成实际的，比如 `root@1.2.3.4`。

```bash
# 0. 本机生成部署用的 SSH key（已有就跳过），把公钥发给服务器管理员 / 粘到云控制台
ls ~/.ssh/kaoyan_deploy.pub 2>/dev/null || ssh-keygen -t ed25519 -N '' -f ~/.ssh/kaoyan_deploy -C kaoyan-deploy
cat ~/.ssh/kaoyan_deploy.pub
export SSH_OPTS="-i ~/.ssh/kaoyan_deploy"        # 非 22 端口再加 -p 2222

# 1. 能登录、看配置
ssh $SSH_OPTS USER@IP 'uname -a; nproc; free -h; df -h /'

# 2. 服务器装 Docker + Compose v2（已装跳过；非 root 用户要重新登录才进 docker 组）
ssh $SSH_OPTS USER@IP 'command -v docker || (curl -fsSL https://get.docker.com | sh); docker compose version; [ "$(id -u)" = 0 ] || sudo usermod -aG docker $USER'

# 3. （有域名）先把 A 记录指向 IP，确认解析生效
dig +short kaoyan.example.com

# 4. 本地准备 .env（推荐；也可以不建，服务器第一次会自动生成随机密码）
cd /workspace/kaoyan/deploy
cp -n .env.example .env
#   填：DOMAIN=（没有就留空）、DEEPSEEK_API_KEY=、DASHSCOPE_API_KEY=
#   POSTGRES_PASSWORD / JWT_SECRET 留空 → 服务器上自动生成（openssl rand）
#   小内存机器推荐：WEB_DOCKERFILE=deploy/web.prebuilt.Dockerfile（用本地 build 好的前端）
#   大陆服务器：NPM_REGISTRY=https://registry.npmmirror.com
(cd ../frontend && npm run build)                 # 用 prebuilt 时需要；不用也无妨

# 5. 演练一遍，再正式部署（同步代码 + 题库 + ECDICT → 构建 → 迁移 → 导入 → 启动 → 健康检查）
./deploy.sh USER@IP --dry-run
./deploy.sh USER@IP

# 6. 冒烟测试（从 box 跑，见下一节）
./smoke-remote.sh https://kaoyan.example.com      # 没域名：./smoke-remote.sh http://IP

# 7. 看服务状态和第一份备份的定时
ssh $SSH_OPTS USER@IP 'cd /opt/kaoyan/deploy && docker compose ps && docker compose logs --tail=5 backup'
```

以后更新：代码或题库改了就重跑第 5 步（`SKIP_IMPORT=1` 可以只更新代码：`ssh … 'cd /opt/kaoyan/deploy && SKIP_IMPORT=1 ./server-up.sh'`）。

## 拿到 Key 之后：预生成讲解（一次性，约 $1.3–2.2）

英语题库目前没有官方解析，讲解靠 AI 生成：DeepSeek（`deepseek-flash`，思考模式）写分步讲解，通义千问独立核对。每题都要过自动质检：选项字母和题库答案一致、没有 null/NaN、长度合理，英语题要给出原文证据句并在文章里找得到。不过关的存为「待核对」，不会当作好讲解发出。提前批量生成，学生打开就有，不用现场等。

```bash
cd /opt/kaoyan/deploy
# 1. .env 填 DEEPSEEK_API_KEY、DASHSCOPE_API_KEY；模型名用 deepseek-flash（旧名 deepseek-chat / deepseek-reasoner 已下线，填了也会自动映射）
docker compose up -d                     # 会先跑迁移（020_explanation_store：讲解表加 prompt_version / quality / origin / usage）
# 2. 先估算：要生成多少题、token 和费用（不调模型、不写库）
docker compose --profile tools run --rm -T --entrypoint node import dist/scripts/gen-explanations.js --dry-run
# 3. 正式跑（建议 DeepSeek 低峰：避开北京时间工作日 09:00–12:00、14:00–18:00，低峰价格是高峰的一半）
#    先英语（2015–2025），数学目前每题都有官方 / 专家解析，默认不生成；后台跑，日志写到 reports/
nohup docker compose --profile tools run --rm -T --entrypoint node import dist/scripts/gen-explanations.js \
  --subject english1 --year 2015-2025 --concurrency 3 --rpm 30 > reports/gen-explanations.log 2>&1 &
tail -f reports/gen-explanations.log     # 每 10 题一行进度；结束打印报告路径 reports/gen-explanations-*.md
```

- **可以断点续跑**：中途断了（Ctrl-C、网络、429）就重跑同一条命令，已生成的跳过，出错的题没写库、会自动重做。
- 报告列出「待核对」的题和原因（如 `final_answer_mismatch`、`evidence_not_in_passage`）。人工看过后可以 `--retry-failed` 重做这些题；`--force` 全部重做（会写新版本，旧版本保留）。其他参数：`--ids 题号,…`、`--limit N`、`--include-official`（连有官方解析的数学题也生成）。
- 不预生成也能用：讲解接口发现某题没有讲解、AI 已接入时，会现场生成一次并入库（同一题只生成一次；`.env` 里 `EXPLAIN_ON_DEMAND=0` 可关）。
- **接 Key 后顺手检查教练对话**：Agent 用 DeepSeek 工具调用。新模型默认开思考模式，工具调用时如果没把思考内容回传，会报 400。发一条教练消息，`docker compose logs --tail=50 backend` 里没有 400 就正常。

## 部署后冒烟测试

`smoke-remote.sh <站点地址>`：只需要 curl + python3，box 上或任何电脑都能跑，不调用付费 AI 接口。检查：

- `/api/v1/health`：ok、**pgvector 已启用**、题目数 > 0、AI 是否已配置 Key（模拟只提示不算失败）
- Caddy：首页、SPA 路由回退、静态资源长缓存头；https 站点还检查 http → https 跳转
- 注册 + 登录一个测试账号 `deploy_smoke_<时间戳>`，未登录访问 → 401
- 题库：年份列表、每科最新一年的题目列表和详情、题图能取到
- 生产开关：开发接口 `POST /agent/jobs/run` 必须 **404**；登录后 `/plans/today` 200

全部通过退出码 0。结束时会打印清理测试账号的命令。

## 一键部署

在 box 上：

```bash
cd /workspace/kaoyan/deploy
./deploy.sh 用户@服务器IP                 # 默认装到 /opt/kaoyan
./deploy.sh 用户@服务器IP /srv/kaoyan     # 自定义目录
./deploy.sh 用户@服务器IP --dry-run       # 只打印要做的事
SSH_OPTS="-p 2222 -i ~/.ssh/kaoyan" ./deploy.sh 用户@服务器IP
```

它会做这些事（**可以反复执行**，每次更新代码或题库就再跑一遍）：

1. 把 `backend/`、`frontend/`、`deploy/` 同步到服务器（有 rsync 用 rsync，没有就用 tar+ssh），
   题库只带运行要用的部分（`math1_YYYY.json`、`english1_YYYY.json`、`*_passages.json`、`*_kp_tags.json`、`knowledge_tree.json`、`images/`、`explanations/`、`reviews/`、`vocab/`，以及不进 git 的真题 PDF `src/`）到 `tiku/`，
   本地有 `frontend/dist` 时一起带上（`web.prebuilt.Dockerfile` 用），
   ECDICT 词库 `ecdict.csv` 到 `data/ecdict/`（大小没变就跳过）。
2. 服务器上运行 `deploy/server-up.sh`：
   - 第一次没有 `.env` 时从 `.env.example` 复制，并**自动生成随机的 `POSTGRES_PASSWORD` 和 `JWT_SECRET`**；
   - 构建镜像 → 启动数据库 → 迁移（`migrate` 服务，含 `002_pgvector`，执行过的跳过）→ 导入（`import` 服务：题库 → ECDICT 考研词 → 真题词汇，全部 upsert）→ 启动全部服务（含 `backup`）→ 健康检查（后端 + 经过 Caddy）。
   - 以后任何一次 `docker compose up -d` 都会先跑 `migrate`，成功后才启动 backend。
3. 最后打印访问地址。手机浏览器打开它即可，可以「添加到主屏幕」。

想先在本地填好 `.env`：`cp .env.example .env` 编辑后再跑 `deploy.sh`，服务器上还没有 `.env` 时会上传它；之后要用本地的覆盖服务器的，加 `PUSH_ENV=1`。
**Key 只写进 `.env`，不要发到群里。**

也可以不经过 box：把整个项目拷到服务器上（目录结构同下），`cd deploy && ./server-up.sh`。

服务器上的目录：

```
/opt/kaoyan/
  backend/  frontend/  deploy/(.env, reports/, backups/)  tiku/  data/ecdict/
```

## 日常操作（在服务器 `/opt/kaoyan/deploy` 下）

```bash
docker compose ps                       # 状态
docker compose logs -f backend          # 后端日志
docker compose restart backend          # 改了 .env 以后（或 docker compose up -d）
docker compose --profile tools run --rm import
                                        # 重导题库 + 单词（upsert；报告在 deploy/reports/）
docker compose run --rm migrate         # 手动跑迁移（平时 up 会自动跑）
docker compose exec backup bash /backup-loop.sh --once   # 立刻备份一次
curl -s http://127.0.0.1/api/v1/health  # 看 pgvector、题目数、AI 是否已配置
```

专家讲解（`tiku/explanations/*_expert.jsonl`）后端会自动重新加载，同步过去即可，不用重启。

## 备份与恢复

**自动**：compose 里的 `backup` 服务每天 `BACKUP_AT`（默认 03:15，`APP_TZ` 时区）做一次
`pg_dump -Fc` → `deploy/backups/kaoyan-时间.dump`，并打包费曼录音 `uploads-时间.tar.gz` 和真题 PDF / OCR 原始材料 `tiku-src-时间.tar`（`tiku/src` 不进 git，靠它留底；恢复：`tar -xf tiku-src-时间.tar -C ../tiku/src`），**保留 `BACKUP_KEEP_DAYS` 天（默认 7）**。
不需要宿主机 cron。`docker compose logs backup` 看记录；健康检查盯着它的心跳。

```bash
docker compose exec backup bash /backup-loop.sh --once   # 立刻备份一次
ls -lh backups/
./backup.sh            # 备选：宿主机上手动备份（保留最近 BACKUP_KEEP 份，默认 7）
```

恢复（会覆盖当前数据）：

```bash
docker compose stop backend
docker compose exec -T db pg_restore -U kaoyan -d kaoyan --clean --if-exists --no-owner < backups/kaoyan-20261101-031500.dump
docker compose start backend
```

建议偶尔把 `backups/` 拷到别的机器上。

## 配置项

全部在 `deploy/.env`，说明见 `.env.example`。容器内路径（`ASSETS_DIR`/`TIKU_DIR=/data/tiku`、`EXPLANATIONS_DIR`、`REVIEWS_DIR`、`ECDICT_PATH`/`ECDICT_CSV`、`AUDIO_DIR`、`CHROME_PATH`、`DATABASE_URL`）由 `docker-compose.yml` 固定，不用填。

生产开关由 `docker-compose.yml` 强制：`NODE_ENV=production`、`DEV_TOOLS=0`（开发接口 404）、`DISABLE_DEBUG_NOW=1`、`AI_FAKE` 为空。
`JWT_SECRET` 必须 ≥ 32 位：compose 缺它直接报错，后端在 production 下发现缺省 / 过短会拒绝启动。

资源上限（2 核 4G）：db 1G、backend 1.5G（含 Chromium）、web 256M、backup 256M；容器日志每个最多 5×10MB。

注意：`POSTGRES_PASSWORD` 只在数据库**第一次初始化**时生效，之后别改；真要改先在库里 `ALTER USER kaoyan PASSWORD '...'`。

## 不用 Docker 的部署（备选）

以 Ubuntu 24.04 为例，以 root 执行。

```bash
# 1. PostgreSQL 17 + pgvector（PGDG 官方源）
apt install -y curl ca-certificates gnupg postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-17 postgresql-17-pgvector
sudo -u postgres psql -c "CREATE USER kaoyan PASSWORD '换成随机密码'" -c "CREATE DATABASE kaoyan OWNER kaoyan"
sudo -u postgres psql -d kaoyan -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
#    （扩展需要超级用户创建；迁移里的 CREATE EXTENSION IF NOT EXISTS 之后就会直接跳过）

# 2. Node 22、Chrome（导出 PDF）、中文字体、Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs fonts-noto-cjk caddy
#    Ubuntu 的 chromium 是 snap 版，读不到 /tmp 里的临时页面，PDF 会失败；装 Google Chrome 的 deb：
curl -fsSLO https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && apt install -y ./google-chrome-stable_current_amd64.deb
#    （Debian 12 可以直接 apt install chromium，CHROME_PATH=/usr/bin/chromium）

# 3. 代码和数据放到 /opt/kaoyan（目录结构同上：backend/ frontend/ deploy/ tiku/ data/ecdict/）
cd /opt/kaoyan/backend
cat > .env <<'ENV'
DATABASE_URL=postgres://kaoyan:换成随机密码@127.0.0.1:5432/kaoyan
PORT=3000
JWT_SECRET=换成 openssl rand -hex 32 的结果
APP_TZ=Asia/Shanghai
ASSETS_DIR=/opt/kaoyan/tiku
EXPLANATIONS_DIR=/opt/kaoyan/tiku/explanations
ECDICT_PATH=/opt/kaoyan/data/ecdict/ecdict.csv
CHROME_PATH=/usr/bin/google-chrome
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
ENV
#    其余可选项见 backend/.env.example 或 deploy/.env.example
npm ci && npm run build && npm prune --omit=dev
node dist/scripts/migrate.js
node dist/scripts/import-questions.js --tree /opt/kaoyan/tiku/knowledge_tree.json --questions /opt/kaoyan/tiku --report-dir .
node dist/scripts/import-words.js /opt/kaoyan/data/ecdict/ecdict.csv --tags ky

# 4. 后端常驻（systemd）
cat > /etc/systemd/system/kaoyan.service <<'UNIT'
[Unit]
Description=kaoyan backend
After=network.target postgresql.service
[Service]
WorkingDirectory=/opt/kaoyan/backend
ExecStart=/usr/bin/node dist/src/main.js
Restart=always
User=www-data
Environment=TZ=Asia/Shanghai
[Install]
WantedBy=multi-user.target
UNIT
chown -R www-data /opt/kaoyan/backend/uploads 2>/dev/null || install -d -o www-data /opt/kaoyan/backend/uploads
systemctl daemon-reload && systemctl enable --now kaoyan

# 5. 前端 + Caddy（复用 deploy/Caddyfile，用环境变量指路径）
cd /opt/kaoyan/frontend && npm ci && npx vite build && mkdir -p /var/www/kaoyan && cp -r dist/. /var/www/kaoyan/
cp /opt/kaoyan/deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/kaoyan.conf <<'CONF'
[Service]
Environment=SITE_ADDRESS=:80
Environment=WEB_ROOT=/var/www/kaoyan
Environment=BACKEND_UPSTREAM=127.0.0.1:3000
CONF
#    有域名就把 SITE_ADDRESS 改成域名
systemctl daemon-reload && systemctl restart caddy
```

备份：`sudo -u postgres pg_dump -Fc kaoyan > /var/backups/kaoyan-$(date +%F).dump`，放进 cron，配合 `find /var/backups -name 'kaoyan-*.dump' -mtime +6 -delete`（留 7 天）。

## 文件说明

| 文件 | 作用 |
|---|---|
| `docker-compose.yml` | db（pgvector/pgvector:pg17）、migrate（一次性迁移）、backend、web（Caddy）、backup（每日 pg_dump）、import（profile tools）；卷：pgdata、uploads、audio、证书 |
| `../backend/Dockerfile` | 后端多阶段镜像（node:22-bookworm-slim + chromium + 中文字体）|
| `web.Dockerfile` | 前端 vite build → caddy:2-alpine |
| `web.prebuilt.Dockerfile` | 直接用 `frontend/dist` → caddy:2-alpine（`WEB_DOCKERFILE` 切换）|
| `Caddyfile` | SPA 回退、`/api` 反代（`flush_interval -1`，SSE 不缓冲、不超时）、有 DOMAIN 自动 HTTPS |
| `.env.example` | 全部配置项 |
| `deploy.sh` | box 上运行：同步 + 远程执行 server-up.sh |
| `server-up.sh` | 服务器上运行：构建、迁移、导入、启动、健康检查（可重复）|
| `backup-loop.sh` | backup 容器的循环：每天定时 pg_dump + 录音打包，留 7 天 |
| `backup.sh` | 备选：宿主机手动 / cron 备份，保留 7 份 |
| `smoke-remote.sh` | 部署后冒烟测试（对着线上地址跑）|
