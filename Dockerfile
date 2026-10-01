# 可通过 --build-arg NPM_REGISTRY=https://registry.npmmirror.com 使用国内镜像
ARG NPM_REGISTRY=https://registry.npmjs.org

FROM node:24-bookworm-slim AS web
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm config set registry $NPM_REGISTRY && pnpm install --frozen-lockfile --filter web
COPY web web
COPY server/src/views/styles.ts server/src/views/styles.ts
RUN pnpm --filter web build

FROM node:24-bookworm-slim
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm config set registry $NPM_REGISTRY && pnpm install --frozen-lockfile --prod --filter server \
  && rm -rf /root/.cache /root/.local/share/pnpm
COPY server server
COPY --from=web /app/web/dist web/dist
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/entry/node.ts"]
