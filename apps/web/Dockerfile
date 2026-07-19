# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @msg/web... --frozen-lockfile=false
COPY apps/web ./apps/web
WORKDIR /app/apps/web
RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
# 保证存在默认 config.js（entrypoint 启动时会按环境覆盖）
COPY apps/web/public/config.js /usr/share/nginx/html/config.js
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh \
  && chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
