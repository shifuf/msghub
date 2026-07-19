# syntax=docker/dockerfile:1
# build: pnpm monorepo compile
# run: npm flat install + openssl3 musl engine

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @msg/api... --frozen-lockfile=false
COPY apps/api ./apps/api
WORKDIR /workspace/apps/api
RUN pnpm exec prisma generate && pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# openssl: Prisma engine on Alpine needs OpenSSL libs
RUN apk add --no-cache wget openssl libssl3 \
  && corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY apps/api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/prisma ./prisma
# regenerate client inside runner so engine matches this OS (linux-musl-openssl-3.0.x)
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x
RUN npx prisma generate

COPY apps/api/wait-db.js /app/wait-db.js
COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh /app/wait-db.js \
  && chmod +x /docker-entrypoint.sh

EXPOSE 3010
ENTRYPOINT ["/docker-entrypoint.sh"]