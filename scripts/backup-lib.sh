#!/bin/sh
set -eu
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
valid_id() { printf '%s' "$1" | grep -Eq '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'; }
new_id() {
  token=$(openssl rand -hex 16) || fail RANDOM_ID_FAILED
  printf '%s' "$token" | sed -E 's/^(.{8})(.{4}).(.{3}).(.{3})(.{12})$/\1-\2-4\3-8\4-\5/'
}
utc_now() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

init_paths() {
  PROJECT_ROOT=$(realpath -e -- "${PROJECT_ROOT:-$SCRIPT_DIR/..}") || fail PROJECT_ROOT_INVALID
  [ -d "$PROJECT_ROOT" ] || fail PROJECT_ROOT_INVALID
  BACKUP_ROOT="$PROJECT_ROOT/data/backups"
  CONTROL_ROOT="$BACKUP_ROOT/control"
  BACKUP_KEY_FILE=${BACKUP_KEY_FILE:-/run/secrets/msghub_backup_key}
  for directory in "$PROJECT_ROOT/data" "$BACKUP_ROOT" "$CONTROL_ROOT" "$BACKUP_ROOT/archives" "$BACKUP_ROOT/.work" "$CONTROL_ROOT/jobs" "$CONTROL_ROOT/requests"; do
    [ ! -L "$directory" ] || fail BACKUP_PATH_SYMLINK
    if [ ! -e "$directory" ]; then mkdir -- "$directory" || fail BACKUP_PATH_INVALID; fi
    [ -d "$directory" ] || fail BACKUP_PATH_INVALID
    if [ "$directory" != "$PROJECT_ROOT/data" ]; then chmod 700 -- "$directory"; fi
  done
}

safe_directory() {
  case "$1" in "$BACKUP_ROOT"/*) ;; *) fail BACKUP_PATH_INVALID ;; esac
  [ ! -L "$1" ] || fail BACKUP_PATH_SYMLINK
  resolved=$(realpath -m -- "$1") || fail BACKUP_PATH_INVALID
  case "$resolved" in "$BACKUP_ROOT"/*) ;; *) fail BACKUP_PATH_INVALID ;; esac
  [ "$resolved" = "$1" ] || fail BACKUP_PATH_INVALID
}

safe_remove_work() {
  [ -n "${1:-}" ] || return 0
  case "$1" in "$BACKUP_ROOT/.work/"*) ;; *) return 1 ;; esac
  safe_directory "$1"
  rm -rf -- "$1"
}

safe_remove_verify_work() {
  [ -n "${1:-}" ] || return 0
  temporary_root=$(realpath -e -- "${TMPDIR:-/tmp}") || return 1
  case "$1" in "$temporary_root"/msghub-verify-*) ;; *) return 1 ;; esac
  [ ! -L "$1" ] || return 1
  resolved=$(realpath -e -- "$1") || return 1
  case "$resolved" in "$temporary_root"/msghub-verify-*) ;; *) return 1 ;; esac
  [ "$resolved" = "$1" ] || return 1
  rm -rf -- "$resolved"
}

atomic_json() {
  destination=$1
  shift
  safe_directory "$(dirname -- "$destination")"
  [ ! -L "$destination" ] || fail BACKUP_PATH_SYMLINK
  temporary=$(mktemp "$(dirname -- "$destination")/.json.XXXXXXXX") || fail METADATA_WRITE_FAILED
  if jq "$@" > "$temporary"; then
    chmod 600 -- "$temporary"
    mv -f -- "$temporary" "$destination"
  else
    rm -f -- "$temporary"
    fail METADATA_WRITE_FAILED
  fi
}

key_ready() {
  [ -f "$BACKUP_KEY_FILE" ] && [ ! -L "$BACKUP_KEY_FILE" ] && [ -r "$BACKUP_KEY_FILE" ] && age-keygen -y < "$BACKUP_KEY_FILE" >/dev/null 2>&1
}

config_bool() { value=$1; case "$value" in true|false) printf '%s' "$value";; *) fail BACKUP_CONFIG_INVALID;; esac; }
