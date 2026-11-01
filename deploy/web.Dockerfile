# 前端：Vite 构建静态文件 → Caddy 托管（SPA + /api 反代 + 自动 HTTPS）
# 构建上下文是项目根目录（deploy/ 的上一级），见 docker-compose.yml
FROM node:22-bookworm-slim AS build
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=1
# 国内服务器可在 .env 设 NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# 只做 vite build（类型检查 vue-tsc 在开发机上跑，避免部署被类型告警卡住）
RUN npx vite build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /fe/dist /srv
