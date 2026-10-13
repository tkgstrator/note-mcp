# syntax=docker/dockerfile:1

# qtmleap/devcontainers: examples/hono-node/Dockerfile の Bun 構成。
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
USER bun
# MCP は HTTP ポートを開かず stdio で通信する。
ENTRYPOINT ["bun", "src/index.ts"]
