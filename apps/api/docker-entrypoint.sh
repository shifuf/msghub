#!/bin/sh
set -e

echo "[api] starting entrypoint..."
echo "[api] NODE_ENV=${NODE_ENV:-} APP_ENV=${APP_ENV:-} PORT=${PORT:-3010}"
if [ -n "$DATABASE_URL" ]; then
  echo "[api] DATABASE_URL=$(echo "$DATABASE_URL" | sed -E 's#(postgresql://[^:]+:)[^@]+@#\1****@#')"
else
  echo "[api] DATABASE_URL is empty!" >&2
fi

if [ ! -f /app/node_modules/prisma/build/index.js ]; then
  echo "[api] prisma CLI missing, installing..." >&2
  npm install prisma@5.22.0 --no-save --no-audit --no-fund
  npx prisma generate
fi

i=0
until node /app/wait-db.js; do
  i=$((i+1))
  if [ "$i" -ge 45 ]; then
    echo "[api] database TCP not ready after ${i} attempts" >&2
    exit 1
  fi
  echo "[api] waiting database TCP... ($i)"
  sleep 2
done
echo "[api] database TCP ready"

echo "[api] prisma migrate deploy"
npx prisma migrate deploy

echo "[api] seed (non-fatal)"
if [ -f /app/prisma/seed.js ]; then
  node /app/prisma/seed.js || echo "[api] seed failed (ignored)"
else
  echo "[api] seed.js missing, skip"
fi

if [ ! -f /app/dist/src/main.js ]; then
  echo "[api] FATAL: /app/dist/src/main.js missing" >&2
  ls -la /app /app/dist /app/dist/src 2>/dev/null || true
  exit 1
fi

echo "[api] starting server"
exec node /app/dist/src/main.js