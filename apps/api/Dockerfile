# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @msg/api... --frozen-lockfile
COPY apps/api ./apps/api
RUN pnpm --filter @msg/api exec prisma generate && pnpm --filter @msg/api build
RUN pnpm --filter @msg/api deploy --prod /out

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production APP_ENV=production
RUN apk add --no-cache wget openssl libssl3
COPY --from=build /out ./
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY apps/api/wait-db.js /app/wait-db.js
COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh /app/wait-db.js && chmod +x /docker-entrypoint.sh
EXPOSE 3010
ENTRYPOINT ["/docker-entrypoint.sh"]
