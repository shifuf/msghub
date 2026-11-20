#!/bin/sh
# Exercise the real runner image against disposable PostgreSQL/Redis, with no published ports.
set -eu
umask 077
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
project_root=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
command -v docker >/dev/null 2>&1 || { printf '%s\n' DOCKER_REQUIRED >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { printf '%s\n' OPENSSL_REQUIRED >&2; exit 1; }
docker info >/dev/null 2>&1 || { printf '%s\n' DOCKER_UNAVAILABLE >&2; exit 1; }
for directory in "$project_root/data" "$project_root/data/backups"; do
  [ ! -L "$directory" ] || { printf '%s\n' SMOKE_PATH_SYMLINK >&2; exit 1; }
  [ -d "$directory" ] || mkdir -m 700 -- "$directory"
done
fixture=$(mktemp -d "$project_root/data/backups/image-smoke.XXXXXXXX")
token=$(openssl rand -hex 8)
network="msghub-backup-smoke-$token"
postgres="msghub-backup-pg-$token"
redis="msghub-backup-redis-$token"
runner="msghub-backup-runner-$token"
image="msghub-backup-smoke:$token"
network_created=false
postgres_created=false
redis_created=false
runner_created=false
image_created=false

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  if [ "$runner_created" = true ]; then docker rm -f "$runner" >/dev/null 2>&1 || exit_code=1; fi
  if [ "$redis_created" = true ]; then docker rm -f "$redis" >/dev/null 2>&1 || exit_code=1; fi
  if [ "$postgres_created" = true ]; then docker rm -f "$postgres" >/dev/null 2>&1 || exit_code=1; fi
  if [ "$network_created" = true ]; then docker network rm "$network" >/dev/null 2>&1 || exit_code=1; fi
  case "$fixture" in "$project_root/data/backups/image-smoke."*)
    resolved=$(realpath -e -- "$fixture") || exit 1
    if [ "$resolved" = "$fixture" ] && [ ! -L "$fixture" ]; then
      if [ "$image_created" = true ] && [ "$(id -u)" -ne 0 ]; then
        docker run --rm --network none --read-only --mount "type=bind,src=$fixture,dst=/fixture" --entrypoint sh "$image" \
          -ec 'chown -R "$1:$2" /fixture' sh "$(id -u)" "$(id -g)" >/dev/null 2>&1 || exit_code=1
      fi
      rm -rf -- "$fixture" || exit_code=1
    else exit_code=1; fi
  ;; *) exit_code=1 ;; esac
  if [ "$image_created" = true ]; then docker image rm "$image" >/dev/null 2>&1 || exit_code=1; fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

mkdir -m 700 -p -- "$fixture/project/data/backups"
printf '%s\n' JWT_SECRET=smoke-fixture-secret TOTP_ENCRYPTION_KEY=smoke-fixture-totp > "$fixture/project/.env"
printf '%s\n' 'services: {}' > "$fixture/project/docker-compose.yml"
app_commit=$(git -C "$project_root" rev-parse HEAD 2>/dev/null) || app_commit=unknown
docker build -f "$SCRIPT_DIR/backup.Dockerfile" --build-arg "ALPINE_MIRROR=${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}" --build-arg "APP_COMMIT=$app_commit" --build-arg "BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" -t "$image" "$project_root"
image_created=true
printf 'Backup image smoke resources: %s\n' "$token"
docker run --rm --network none --read-only --mount "type=bind,src=$fixture,dst=/fixture" --entrypoint sh "$image" -ec 'umask 077; age-keygen -o /fixture/identity.txt >/dev/null 2>&1'
docker network create --internal --label "msghub.backup-smoke=$token" "$network" >/dev/null
network_created=true
pg_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)
docker run -d --name "$postgres" --label "msghub.backup-smoke=$token" --network "$network" --tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m \
  -e POSTGRES_USER=msg -e "POSTGRES_PASSWORD=$pg_password" -e POSTGRES_DB=msg_notify postgres:16-alpine >/dev/null
postgres_created=true
docker run -d --name "$redis" --label "msghub.backup-smoke=$token" --network "$network" --tmpfs /data:rw,nosuid,size=64m \
  redis:7-alpine redis-server --save '' --appendonly no --requirepass "$redis_password" >/dev/null
redis_created=true
attempt=0
until docker exec "$postgres" pg_isready -h 127.0.0.1 -U msg -d msg_notify >/dev/null 2>&1 && docker exec -e "REDISCLI_AUTH=$redis_password" "$redis" redis-cli ping 2>/dev/null | grep -qx PONG; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || { printf '%s\n' SMOKE_DATABASE_START_FAILED >&2; exit 1; }
  sleep 1
done
docker exec -i "$postgres" psql -X -v ON_ERROR_STOP=1 -U msg -d msg_notify >/dev/null <<'SQL'
CREATE TABLE "_prisma_migrations" (migration_name text, finished_at timestamptz, rolled_back_at timestamptz);
INSERT INTO "_prisma_migrations" VALUES ('20261120000000_backup_smoke', now(), NULL);
CREATE TABLE smoke_live (id integer PRIMARY KEY, value text);
INSERT INTO smoke_live VALUES (1, 'production-fixture-preserved');
SQL
docker exec -e "REDISCLI_AUTH=$redis_password" "$redis" redis-cli set smoke:live production-fixture-preserved >/dev/null
docker run -d --name "$runner" --label "msghub.backup-smoke=$token" --network "$network" --read-only --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,size=512m,mode=1777 \
  --mount "type=bind,src=$fixture/project,dst=/project,readonly" \
  --mount "type=bind,src=$fixture/project/data/backups,dst=/project/data/backups" \
  --mount "type=bind,src=$fixture/identity.txt,dst=/run/secrets/msghub_backup_key,readonly" \
  -e "PGHOST=$postgres" -e PGUSER=msg -e PGDATABASE=msg_notify -e "PGPASSWORD=$pg_password" \
  -e "REDIS_HOST=$redis" -e "REDISCLI_AUTH=$redis_password" "$image" >/dev/null
runner_created=true
attempt=0
until docker exec "$runner" jq -e '.status == "ready" and .keyConfigured == true' /project/data/backups/control/runner-status.json >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 60 ] || { printf '%s\n' SMOKE_RUNNER_START_FAILED >&2; exit 1; }
  sleep 1
done
# Starting the profile alone must leave backups disabled and the archive directory empty.
docker exec "$runner" sh -ec 'set -- /project/data/backups/archives/*; [ ! -e "$1" ]; [ ! -e /project/data/backups/control/config.json ]'
backup_id=$(docker exec "$runner" sh -ec '. /opt/msghub/scripts/backup-lib.sh; new_id')
docker exec "$runner" sh -ec '
  . /opt/msghub/scripts/backup-lib.sh
  init_paths
  atomic_json "$CONTROL_ROOT/last-run.json" -n --argjson lastTriggeredAt "$(date +%s)" "{lastTriggeredAt:\$lastTriggeredAt}"
  atomic_json "$CONTROL_ROOT/config.json" -n "{enabled:true,intervalHours:168,retentionCount:14,verifyAfterBackup:true}"
  atomic_json "$CONTROL_ROOT/jobs/$1.json" -n --arg id "$1" "{id:\$id,action:\"backup\",status:\"pending\"}"
  atomic_json "$CONTROL_ROOT/requests/$1.request" -n --arg id "$1" "{version:1,id:\$id,action:\"backup\"}"
' sh "$backup_id"
attempt=0
until docker exec "$runner" jq -e '.status == "success"' "/project/data/backups/control/jobs/$backup_id.json" >/dev/null 2>&1; do
  if docker exec "$runner" jq -e '.status == "failed"' "/project/data/backups/control/jobs/$backup_id.json" >/dev/null 2>&1; then
    docker exec "$runner" jq '{status,errorCode}' "/project/data/backups/control/jobs/$backup_id.json" >&2
    docker exec "$runner" jq '{status,verification,errorCode}' "/project/data/backups/archives/$backup_id/manifest.json" >&2 || true
    exit 1
  fi
  attempt=$((attempt + 1))
  [ "$attempt" -lt 120 ] || { printf '%s\n' SMOKE_BACKUP_JOB_TIMED_OUT >&2; exit 1; }
  sleep 1
done
docker exec "$runner" jq -e '.status == "complete" and .encrypted == true and .verification == "passed" and .restoredTables == 2 and .migrationVersion == "20261120000000_backup_smoke"' "/project/data/backups/archives/$backup_id/manifest.json" >/dev/null
docker exec "$runner" sh -ec 'set -- /tmp/msghub-verify-*; [ ! -e "$1" ]; set -- /project/data/backups/.work/*; [ ! -e "$1" ]'
[ "$(docker exec "$postgres" psql -X -A -t -U msg -d msg_notify -c 'SELECT value FROM smoke_live WHERE id = 1')" = production-fixture-preserved ]
[ "$(docker exec -e "REDISCLI_AUTH=$redis_password" "$redis" redis-cli get smoke:live)" = production-fixture-preserved ]
# Exercise the API mount contract with no key, network or ability to write archives.
docker run --rm --network none --read-only --entrypoint sh \
  --mount "type=bind,src=$fixture/project/data/backups/control,dst=/api/control" \
  --mount "type=bind,src=$fixture/project/data/backups/archives,dst=/api/archives,readonly" "$image" -ec '
  : > /api/control/.write-probe
  rm /api/control/.write-probe
  if ( : > /api/archives/.write-probe ) 2>/dev/null; then exit 1; fi
  [ ! -e /run/secrets/msghub_backup_key ]
'
printf '%s\n' 'Backup image smoke passed: encrypted archive, real PostgreSQL/Redis restore, isolated cleanup, unchanged live fixtures, API read-only archives.'
