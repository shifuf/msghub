#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
. "$SCRIPT_DIR/backup-lib.sh"
[ "$#" -eq 1 ] && valid_id "$1" || fail BACKUP_ID_INVALID
backup_id=$1
init_paths
key_ready || fail BACKUP_KEY_UNAVAILABLE
printf '%s' "${PGHOST:-postgres}" | grep -Eq '^[a-zA-Z0-9._-]{1,253}$' || fail POSTGRES_HOST_INVALID
printf '%s' "${PGPORT:-5432}" | grep -Eq '^[0-9]{1,5}$' && [ "${PGPORT:-5432}" -ge 1 ] && [ "${PGPORT:-5432}" -le 65535 ] || fail POSTGRES_PORT_INVALID
printf '%s' "${REDIS_HOST:-redis}" | grep -Eq '^[a-zA-Z0-9._-]{1,253}$' || fail REDIS_HOST_INVALID
printf '%s' "${REDIS_PORT:-6379}" | grep -Eq '^[0-9]{1,5}$' && [ "${REDIS_PORT:-6379}" -ge 1 ] && [ "${REDIS_PORT:-6379}" -le 65535 ] || fail REDIS_PORT_INVALID
for file in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/docker-compose.yml"; do [ -f "$file" ] && [ ! -L "$file" ] || fail DEPLOYMENT_FILE_INVALID; done
archive="$BACKUP_ROOT/archives/$backup_id"
work="$BACKUP_ROOT/.work/$backup_id"
safe_directory "$archive"
safe_directory "$work"
[ ! -e "$archive" ] && [ ! -e "$work" ] || fail BACKUP_ID_ALREADY_EXISTS
mkdir -m 700 -- "$archive" "$work"
created_at=$(utc_now)
backup_error=BACKUP_FAILED

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  safe_remove_work "$work" || exit_code=1
  if [ "$exit_code" -ne 0 ]; then
    rm -f -- "$archive/backup.tar.age.tmp"
    atomic_json "$archive/manifest.json" -n --arg id "$backup_id" --arg createdAt "$created_at" --arg errorCode "$backup_error" '{version:1,id:$id,createdAt:$createdAt,status:"failed",encrypted:true,containsSecrets:true,consistency:"online-non-atomic",verification:"not_verified",errorCode:$errorCode}'
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

backup_error=DATABASE_DUMP_FAILED
export PGPASSWORD=${PGPASSWORD:-${POSTGRES_PASSWORD:-}}
pg_dump --format=custom --no-owner --no-acl --host="${PGHOST:-postgres}" --port="${PGPORT:-5432}" --username="${PGUSER:-${POSTGRES_USER:-msg}}" --dbname="${PGDATABASE:-${POSTGRES_DB:-msg_notify}}" > "$work/database.dump" 2>/dev/null || fail DATABASE_DUMP_FAILED
[ -s "$work/database.dump" ] || fail DATABASE_DUMP_FAILED
backup_error=REDIS_SNAPSHOT_FAILED
# redis-cli --rdb treats even an empty REDISCLI_AUTH as a request to authenticate.
# A Redis instance without authentication rejects that request before the snapshot starts.
if [ -n "${REDISCLI_AUTH:-${REDIS_PASSWORD:-}}" ]; then
  export REDISCLI_AUTH="${REDISCLI_AUTH:-${REDIS_PASSWORD:-}}"
else
  unset REDISCLI_AUTH
fi
redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" --rdb "$work/redis.rdb" >/dev/null 2>&1 || fail REDIS_SNAPSHOT_FAILED
[ -s "$work/redis.rdb" ] || fail REDIS_SNAPSHOT_FAILED
backup_error=ENVIRONMENT_CAPTURE_FAILED
cp -- "$PROJECT_ROOT/.env" "$work/environment.env"
cp -- "$PROJECT_ROOT/docker-compose.yml" "$work/docker-compose.yml"
printf '%s\n' "${APP_COMMIT:+APP_COMMIT=$APP_COMMIT}" "${BUILD_TIME:+BUILD_TIME=$BUILD_TIME}" "PGHOST=${PGHOST:-postgres}" "PGPORT=${PGPORT:-5432}" "PGUSER=${PGUSER:-${POSTGRES_USER:-msg}}" "PGDATABASE=${PGDATABASE:-${POSTGRES_DB:-msg_notify}}" "REDIS_HOST=${REDIS_HOST:-redis}" "REDIS_PORT=${REDIS_PORT:-6379}" > "$work/operations.environment.txt"
chmod 600 -- "$work"/*
(cd -- "$work" && sha256sum database.dump redis.rdb environment.env docker-compose.yml operations.environment.txt > SHA256SUMS) || fail CHECKSUM_FAILED
backup_error=ENCRYPTION_FAILED
tar -C "$work" -cf "$work/payload.tar" database.dump redis.rdb environment.env docker-compose.yml operations.environment.txt SHA256SUMS || fail ARCHIVE_FAILED
recipient=$(age-keygen -y < "$BACKUP_KEY_FILE" 2>/dev/null) || fail BACKUP_KEY_UNAVAILABLE
age -r "$recipient" -o "$archive/backup.tar.age.tmp" "$work/payload.tar" 2>/dev/null || fail ENCRYPTION_FAILED
chmod 600 -- "$archive/backup.tar.age.tmp"
mv -- "$archive/backup.tar.age.tmp" "$archive/backup.tar.age"
cipher_hash=$(sha256sum "$archive/backup.tar.age" | cut -d ' ' -f 1)
size=$(wc -c < "$archive/backup.tar.age" | tr -d ' ')
app_commit=${APP_COMMIT:-}
printf '%s' "$app_commit" | grep -Eq '^[a-fA-F0-9]{7,64}$' || app_commit=''
atomic_json "$archive/manifest.json" -n --arg id "$backup_id" --arg createdAt "$created_at" --arg appCommit "$app_commit" --arg sha256 "$cipher_hash" --argjson sizeBytes "$size" '{version:1,id:$id,createdAt:$createdAt,appCommit:(if $appCommit=="" then null else $appCommit end),status:"complete",encrypted:true,containsSecrets:true,consistency:"online-non-atomic",verification:"not_verified",sizeBytes:$sizeBytes,sha256:$sha256}'
cat -- "$archive/manifest.json"
