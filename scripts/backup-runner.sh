#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
. "$SCRIPT_DIR/backup-lib.sh"
once=false
if [ "$#" -gt 0 ]; then [ "$#" -eq 1 ] && [ "$1" = --once ] || fail RUNNER_ARGUMENT_INVALID; once=true; fi
init_paths
[ ! -L "$CONTROL_ROOT/runner.lock" ] || fail BACKUP_PATH_SYMLINK
exec 9>"$CONTROL_ROOT/runner.lock"
flock -n 9 || fail RUNNER_ALREADY_RUNNING

heartbeat() {
  state=$1
  key=false
  if key_ready; then key=true; fi
  if ! key_ready || ! pg_isready -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "${PGUSER:-${POSTGRES_USER:-msg}}" -d "${PGDATABASE:-${POSTGRES_DB:-msg_notify}}" >/dev/null 2>&1 || ! redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" ping 2>/dev/null | grep -qx PONG; then state=unavailable; fi
  atomic_json "$CONTROL_ROOT/runner-status.json" -n --arg status "$state" --arg lastSeenAt "$(utc_now)" --argjson keyConfigured "$key" '{status:$status,lastSeenAt:$lastSeenAt,keyConfigured:$keyConfigured}'
}
config_enabled() {
  [ -f "$CONTROL_ROOT/config.json" ] && [ ! -L "$CONTROL_ROOT/config.json" ] && jq -e '.enabled == true' "$CONTROL_ROOT/config.json" >/dev/null 2>&1
}

prune_archives() {
  keep=$(jq -r '.retentionCount // 14' "$CONTROL_ROOT/config.json" 2>/dev/null) || keep=14
  printf '%s' "$keep" | grep -Eq '^[0-9]{1,3}$' && [ "$keep" -ge 1 ] && [ "$keep" -le 365 ] || keep=14
  index_file=$(mktemp "$CONTROL_ROOT/.retention.XXXXXXXX")
  for directory in "$BACKUP_ROOT/archives/"*; do
    [ -d "$directory" ] && [ ! -L "$directory" ] || continue
    id=$(basename -- "$directory")
    valid_id "$id" || continue
    [ -f "$directory/manifest.json" ] && [ ! -L "$directory/manifest.json" ] || continue
    created=$(jq -r --arg id "$id" 'select(.id == $id and .status == "complete") | .createdAt' "$directory/manifest.json" 2>/dev/null) || continue
    printf '%s' "$created" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || continue
    printf '%s %s\n' "$created" "$id" >> "$index_file"
  done
  sort -r "$index_file" | tail -n "+$((keep + 1))" | while read -r created id; do
    valid_id "$id" || continue
    directory="$BACKUP_ROOT/archives/$id"
    safe_directory "$directory"
    rm -rf -- "$directory"
  done
  rm -f -- "$index_file"
}

run_job() {
  id=$1
  action=$2
  backup_id=${3:-}
  job="$CONTROL_ROOT/jobs/$id.json"
  atomic_json "$job" -n --arg id "$id" --arg action "$action" --arg backupId "$backup_id" --arg createdAt "$(utc_now)" '{id:$id,action:$action,backupId:(if $backupId=="" then null else $backupId end),status:"running",createdAt:$createdAt}'
  heartbeat running
  (while sleep 10; do heartbeat running; done) &
  heartbeat_pid=$!
  status=success
  error_code=''
  if [ "$action" = backup ]; then
    atomic_json "$CONTROL_ROOT/last-run.json" -n --argjson lastTriggeredAt "$(date +%s)" '{lastTriggeredAt:$lastTriggeredAt}'
    if ! sh "$SCRIPT_DIR/backup-full.sh" "$id" >/dev/null 2>&1; then status=failed; error_code=BACKUP_FAILED
    elif [ -f "$CONTROL_ROOT/config.json" ] && [ ! -L "$CONTROL_ROOT/config.json" ] && jq -e '.verifyAfterBackup != false' "$CONTROL_ROOT/config.json" >/dev/null 2>&1; then
      if ! sh "$SCRIPT_DIR/verify-full.sh" "$id" >/dev/null 2>&1; then status=failed; error_code=VERIFY_FAILED; fi
    fi
    backup_id=$id
  else
    if ! sh "$SCRIPT_DIR/verify-full.sh" "$backup_id" >/dev/null 2>&1; then status=failed; error_code=VERIFY_FAILED; fi
  fi
  kill "$heartbeat_pid" 2>/dev/null || true
  wait "$heartbeat_pid" 2>/dev/null || true
  heartbeat_pid=''
  atomic_json "$job" --arg status "$status" --arg backupId "$backup_id" --arg finishedAt "$(utc_now)" --arg errorCode "$error_code" '. + {status:$status,backupId:$backupId,finishedAt:$finishedAt,errorCode:(if $errorCode=="" then null else $errorCode end)}' "$job"
  heartbeat ready
  if [ "$status" = success ] && [ "$action" = backup ]; then prune_archives; fi
}

process_requests() {
  for request in "$CONTROL_ROOT/requests/"*.request; do
    [ -f "$request" ] && [ ! -L "$request" ] || continue
    id=$(basename -- "$request" .request)
    valid_id "$id" || continue
    [ "$(wc -c < "$request")" -le 4096 ] || continue
    jq -e --arg id "$id" '.version == 1 and .id == $id and (.action == "backup" or .action == "verify") and (keys - ["version","id","action","backupId"] | length == 0)' "$request" >/dev/null 2>&1 || continue
    action=$(jq -r '.action' "$request")
    backup_id=$(jq -r '.backupId // ""' "$request")
    if [ "$action" = verify ]; then valid_id "$backup_id" || continue; fi
    if ! config_enabled; then
      atomic_json "$CONTROL_ROOT/jobs/$id.json" -n --arg id "$id" --arg action "$action" --arg finishedAt "$(utc_now)" '{id:$id,action:$action,status:"failed",errorCode:"BACKUP_DISABLED",finishedAt:$finishedAt}'
      rm -f -- "$request"
      continue
    fi
    processing="$CONTROL_ROOT/requests/$id.processing"
    [ ! -e "$processing" ] && [ ! -L "$processing" ] || continue
    mv -- "$request" "$processing"
    run_job "$id" "$action" "$backup_id"
    rm -f -- "$processing"
  done
}

maybe_automatic() {
  config_enabled || return 0
  interval=$(jq -r '.intervalHours // 24' "$CONTROL_ROOT/config.json")
  printf '%s' "$interval" | grep -Eq '^[0-9]{1,3}$' && [ "$interval" -ge 1 ] && [ "$interval" -le 168 ] || return 0
  last=0
  if [ -f "$CONTROL_ROOT/last-run.json" ] && [ ! -L "$CONTROL_ROOT/last-run.json" ]; then last=$(jq -r '.lastTriggeredAt // 0' "$CONTROL_ROOT/last-run.json" 2>/dev/null) || last=0; fi
  printf '%s' "$last" | grep -Eq '^[0-9]{1,12}$' || last=0
  now=$(date +%s)
  [ "$((now - last))" -ge "$((interval * 3600))" ] || return 0
  lock="$CONTROL_ROOT/request.lock"
  (set -C; : > "$lock") 2>/dev/null || return 0
  busy=false
  for job in "$CONTROL_ROOT/jobs/"*.json; do
    [ -f "$job" ] && [ ! -L "$job" ] || continue
    if jq -e '.status == "pending" or .status == "running" or .status == "uncertain"' "$job" >/dev/null 2>&1; then busy=true; break; fi
  done
  if [ "$busy" = false ]; then
    id=$(new_id)
    atomic_json "$CONTROL_ROOT/jobs/$id.json" -n --arg id "$id" --arg createdAt "$(utc_now)" '{id:$id,action:"backup",status:"pending",createdAt:$createdAt}'
    atomic_json "$CONTROL_ROOT/requests/$id.request" -n --arg id "$id" '{version:1,id:$id,action:"backup"}'
  fi
  rm -f -- "$lock"
}

shutdown() {
  if [ -n "${heartbeat_pid:-}" ]; then kill "$heartbeat_pid" 2>/dev/null || true; wait "$heartbeat_pid" 2>/dev/null || true; fi
}
trap shutdown EXIT
trap 'exit 1' INT TERM

# An interrupted local job is recorded as failed and is never silently replayed.
for processing in "$CONTROL_ROOT/requests/"*.processing; do
  [ -f "$processing" ] && [ ! -L "$processing" ] || continue
  id=$(basename -- "$processing" .processing)
  valid_id "$id" || continue
  job="$CONTROL_ROOT/jobs/$id.json"
  if [ -f "$job" ] && [ ! -L "$job" ]; then atomic_json "$job" --arg finishedAt "$(utc_now)" '. + {status:"failed",finishedAt:$finishedAt,errorCode:"RUNNER_RESTARTED"}' "$job"; fi
  rm -f -- "$processing"
done

while :; do
  heartbeat ready
  process_requests
  maybe_automatic
  if [ "$once" = true ]; then break; fi
  sleep 10
done
