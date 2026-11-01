# 前端（预构建版）：直接用开发机上已经 build 好的 frontend/dist（deploy.sh 会同步过去），
# 服务器上不跑 npm ci / vite build —— 2 核 4G 的机器上更快、更省内存。
# 启用：deploy/.env 里 WEB_DOCKERFILE=deploy/web.prebuilt.Dockerfile
# 开发机上先构建：cd frontend && npm run build
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY frontend/dist /srv
