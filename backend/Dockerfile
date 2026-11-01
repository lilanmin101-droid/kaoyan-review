# 考研复习 App 后端镜像（多阶段，Node 22）
# 构建：docker compose -f ../deploy/docker-compose.yml build backend
# ---------- 1. 编译 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# puppeteer-core 不会下载浏览器；跳过以防万一
ENV PUPPETEER_SKIP_DOWNLOAD=1
# 国内服务器可在 .env 设 NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry $NPM_REGISTRY
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

# ---------- 2. 运行 ----------
FROM node:22-bookworm-slim AS runtime
# chromium + 中文字体：错题本导出 PDF（puppeteer-core）要用；tzdata：定时任务按 APP_TZ
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-noto-color-emoji tzdata ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    CHROME_PATH=/usr/bin/chromium \
    ASSETS_DIR=/data/tiku \
    EXPLANATIONS_DIR=/data/tiku/explanations \
    ECDICT_PATH=/data/ecdict/ecdict.csv \
    APP_TZ=Asia/Shanghai \
    TZ=Asia/Shanghai
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# migrate.js 读 /app/migrations；费曼录音存 /app/uploads（挂卷）；导入报告写 /app/reports（挂卷）
COPY migrations ./migrations
RUN mkdir -p /app/uploads /app/reports /app/audio && chown -R node:node /app/uploads /app/reports /app/audio
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["node", "dist/src/main.js"]
