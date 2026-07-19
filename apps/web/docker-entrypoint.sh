#!/bin/sh
set -e

# 环境：production | development（默认 production）
APP_ENV="${APP_ENV:-production}"
case "$(printf '%s' "$APP_ENV" | tr '[:upper:]' '[:lower:]')" in
  dev|development) APP_ENV=development ;;
  *) APP_ENV=production ;;
esac

# 后台入口：生产默认 /admin，开发默认同 /admin（可用 ADMIN_PATH 覆盖）
ADMIN_PATH="${ADMIN_PATH:-/admin}"
ADMIN_PATH=$(printf '%s' "$ADMIN_PATH" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
case "$ADMIN_PATH" in
  /*) ;;
  *) ADMIN_PATH="/$ADMIN_PATH" ;;
esac
ADMIN_PATH=$(printf '%s' "$ADMIN_PATH" | sed 's:/*$::')
[ -z "$ADMIN_PATH" ] && ADMIN_PATH="/admin"

# 对外站点地址（可选；空则前端用 location.origin）
SITE_URL=$(printf '%s' "${SITE_URL:-}" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s:/*$::')

escape_js() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

ADMIN_ESC=$(escape_js "$ADMIN_PATH")
SITE_ESC=$(escape_js "$SITE_URL")
ENV_ESC=$(escape_js "$APP_ENV")

cat > /usr/share/nginx/html/config.js <<EOF
/* generated at container start — do not edit */
window.__APP_CONFIG__ = {
  env: "${ENV_ESC}",
  adminPath: "${ADMIN_ESC}",
  siteUrl: "${SITE_ESC}",
  apiBase: "/api",
};
EOF

echo "[web] env=${APP_ENV} adminPath=${ADMIN_PATH} siteUrl=${SITE_URL:-"(browser origin)"}"
exec nginx -g 'daemon off;'
