#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
. "$SCRIPT_DIR/backup-lib.sh"
[ "$#" -eq 1 ] && valid_id "$1" || fail BACKUP_ID_INVALID
backup_id=$1
init_paths
key_ready || fail BACKUP_KEY_UNAVAILABLE
# Restore targets are private disposable instances; live-service authentication must not reach them.
unset PGPASSWORD POSTGRES_PASSWORD REDISCLI_AUTH REDIS_PASSWORD PGHOST PGPORT PGUSER PGDATABASE
archive="$BACKUP_ROOT/archives/$backup_id"
safe_directory "$archive"
for file in "$archive/manifest.json" "$archive/backup.tar.age"; do [ -f "$file" ] && [ ! -L "$file" ] || fail BACKUP_NOT_FOUND; done
jq -e --arg id "$backup_id" '.id == $id and .status == "complete" and .encrypted == true' "$archive/manifest.json" >/dev/null || fail BACKUP_MANIFEST_INVALID
expected_hash=$(jq -r '.sha256' "$archive/manifest.json")
actual_hash=$(sha256sum "$archive/backup.tar.age" | cut -d ' ' -f 1)
[ "$expected_hash" = "$actual_hash" ] || fail BACKUP_CHECKSUM_FAILED
verify_token=$(openssl rand -hex 16) || fail RANDOM_ID_FAILED
temporary_root=$(realpath -e -- "${TMPDIR:-/tmp}") || fail VERIFY_TEMP_INVALID
# Keep PostgreSQL's complete Unix socket path below Linux's 107-byte limit.
work="$temporary_root/msghub-verify-$verify_token"
case "$work" in "$temporary_root"/msghub-verify-*) ;; *) fail VERIFY_TEMP_INVALID ;; esac
mkdir -m 700 -- "$work" || fail VERIFY_TEMP_INVALID
pgdata="$work/postgres"
pgsocket="$work/pgsocket"
redis_socket="$work/redis.sock"
pg_started=false
redis_started=false
redis_pid=''
verify_error=VERIFY_FAILED

stop_owned_processes() {
  stop_failed=false
  if [ "$redis_started" = true ]; then
    if kill -0 "$redis_pid" 2>/dev/null; then
      redis-cli -s "$redis_socket" shutdown nosave >/dev/null 2>&1 || kill -TERM "$redis_pid" 2>/dev/null || true
      stop_attempt=0
      while kill -0 "$redis_pid" 2>/dev/null && [ "$stop_attempt" -lt 10 ]; do
        stop_attempt=$((stop_attempt + 1))
        sleep 1
      done
      if kill -0 "$redis_pid" 2>/dev/null; then
        kill -KILL "$redis_pid" 2>/dev/null || true
        stop_failed=true
      fi
    fi
    wait "$redis_pid" 2>/dev/null || true
    if kill -0 "$redis_pid" 2>/dev/null; then stop_failed=true; else redis_started=false; fi
  fi
  if [ "$pg_started" = true ] && [ -d "$pgdata" ]; then
    if [ -f "$pgdata/postmaster.pid" ]; then
      su-exec postgres pg_ctl -D "$pgdata" -t 15 -m immediate -w stop >/dev/null 2>&1 || stop_failed=true
      if su-exec postgres pg_ctl -D "$pgdata" status >/dev/null 2>&1; then stop_failed=true; else pg_started=false; fi
    else pg_started=false; fi
  fi
  # Never remove a directory if stopping an owned process could not be confirmed.
  [ "$stop_failed" = false ] || return 1
  # Cleanup is restricted to this process's tokenized directory below the runner's private tmpfs.
  if [ -d "$work" ] && [ ! -L "$work" ]; then safe_remove_verify_work "$work" || return 1; fi
}
cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  if ! stop_owned_processes; then exit_code=1; verify_error=VERIFY_CLEANUP_FAILED; fi
  if [ "$exit_code" -ne 0 ]; then atomic_json "$archive/manifest.json" --arg verifiedAt "$(utc_now)" --arg errorCode "$verify_error" '. + {verification:"failed",verifiedAt:$verifiedAt,errorCode:$errorCode}' "$archive/manifest.json"; fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

verify_error=DECRYPTION_FAILED
age -d -i - "$archive/backup.tar.age" > "$work/payload.tar" 2>/dev/null < "$BACKUP_KEY_FILE" || fail DECRYPTION_FAILED
verify_error=ARCHIVE_CONTENT_INVALID
tar -tf "$work/payload.tar" > "$work/file-list" || fail ARCHIVE_CONTENT_INVALID
printf '%s\n' database.dump redis.rdb environment.env docker-compose.yml operations.environment.txt SHA256SUMS | sort > "$work/allowed-list"
sort "$work/file-list" > "$work/actual-list"
cmp -s "$work/allowed-list" "$work/actual-list" || fail ARCHIVE_CONTENT_INVALID
if tar -tvf "$work/payload.tar" | grep -q '^[^\-]'; then fail ARCHIVE_CONTENT_INVALID; fi
mkdir -m 700 -- "$work/extracted"
tar --no-same-owner --no-same-permissions -C "$work/extracted" -xf "$work/payload.tar" || fail ARCHIVE_CONTENT_INVALID
chmod 600 -- "$work/extracted"/*
verify_error=PAYLOAD_CHECKSUM_FAILED
for name in database.dump redis.rdb environment.env docker-compose.yml operations.environment.txt; do
  expected=$(grep -E "^[a-f0-9]{64}  ?\\*?${name}$" "$work/extracted/SHA256SUMS" | cut -c 1-64)
  printf '%s' "$expected" | grep -Eq '^[a-f0-9]{64}$' || { printf 'PAYLOAD_CHECKSUM_ENTRY_MISSING:%s\n' "$name" >&2; fail PAYLOAD_CHECKSUM_FAILED; }
  actual=$(sha256sum "$work/extracted/$name" | cut -d ' ' -f 1)
  [ "$expected" = "$actual" ] || { printf 'PAYLOAD_CHECKSUM_MISMATCH:%s\n' "$name" >&2; fail PAYLOAD_CHECKSUM_FAILED; }
done
verify_error=VERIFY_DATABASE_START_FAILED
mkdir -m 700 -- "$pgsocket" "$pgdata"
chown postgres:postgres "$work" "$pgdata" "$pgsocket" 2>/dev/null || true
su-exec postgres initdb -D "$pgdata" --auth-local=trust --auth-host=reject --no-instructions >/dev/null 2>&1 || fail VERIFY_DATABASE_START_FAILED
chown -R postgres:postgres "$pgsocket" "$pgdata"
pg_started=true
su-exec postgres pg_ctl -D "$pgdata" -o "-k $pgsocket -p 55432 -c listen_addresses='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off" -t 30 -w start >/dev/null 2>&1 || fail VERIFY_DATABASE_START_FAILED
PGHOST="$pgsocket" PGPORT=55432 PGUSER=postgres createdb msghub_verify >/dev/null 2>&1 || fail VERIFY_DATABASE_START_FAILED
verify_error=DATABASE_RESTORE_FAILED
PGHOST="$pgsocket" PGPORT=55432 PGUSER=postgres pg_restore --exit-on-error --no-owner --no-acl --dbname=msghub_verify "$work/extracted/database.dump" >/dev/null 2>&1 || fail DATABASE_RESTORE_FAILED
tables=$(PGHOST="$pgsocket" PGPORT=55432 PGUSER=postgres psql -X -A -t -v ON_ERROR_STOP=1 -d msghub_verify -c "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'" 2>/dev/null | tr -d '[:space:]') || fail DATABASE_RESTORE_FAILED
printf '%s' "$tables" | grep -Eq '^[1-9][0-9]*$' || fail DATABASE_RESTORE_FAILED
migration=$(PGHOST="$pgsocket" PGPORT=55432 PGUSER=postgres psql -X -A -t -v ON_ERROR_STOP=1 -d msghub_verify -c 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 1' 2>/dev/null | tr -d '[:space:]') || fail DATABASE_RESTORE_FAILED
printf '%s' "$migration" | grep -Eq '^[A-Za-z0-9_-]{1,200}$' || fail DATABASE_RESTORE_FAILED
verify_error=REDIS_RDB_INVALID
mkdir -m 700 -- "$work/redis-data"
cp -- "$work/extracted/redis.rdb" "$work/redis-data/dump.rdb"
chmod 600 -- "$work/redis-data/dump.rdb"
redis-check-rdb "$work/redis-data/dump.rdb" >/dev/null 2>&1 || fail REDIS_RDB_INVALID
redis-server --port 0 --unixsocket "$redis_socket" --unixsocketperm 700 --protected-mode yes --save '' --appendonly no --dir "$work/redis-data" --dbfilename dump.rdb --daemonize no --pidfile "$work/redis-data/redis.pid" --logfile "$work/redis-data/redis.log" >/dev/null 2>&1 &
redis_pid=$!
redis_started=true
verify_error=VERIFY_REDIS_START_FAILED
redis_attempt=0
until redis-cli -s "$redis_socket" ping 2>/dev/null | grep -qx PONG; do
  kill -0 "$redis_pid" 2>/dev/null || fail VERIFY_REDIS_START_FAILED
  redis_attempt=$((redis_attempt + 1))
  [ "$redis_attempt" -lt 60 ] || fail VERIFY_REDIS_START_FAILED
  sleep 1
done
verify_error=REDIS_RDB_INVALID
redis-cli -s "$redis_socket" dbsize 2>/dev/null | grep -Eq '^[0-9]+$' || fail REDIS_RDB_INVALID
verify_error=VERIFY_CLEANUP_FAILED
stop_owned_processes || fail VERIFY_CLEANUP_FAILED
pg_started=false
redis_started=false
trap - EXIT INT TERM
atomic_json "$archive/manifest.json" --arg verifiedAt "$(utc_now)" --argjson restoredTables "$tables" --arg migrationVersion "$migration" '. + {verification:"passed",verifiedAt:$verifiedAt,restoredTables:$restoredTables,migrationVersion:$migrationVersion,errorCode:null}' "$archive/manifest.json"
cat -- "$archive/manifest.json"
