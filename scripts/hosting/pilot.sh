#!/usr/bin/env bash
# Operator entry point. All config and recovery material stays outside tracked source.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd)
private="$root/deploy/pilot/private"
env_file=${OPENGYM_ENV_FILE:-$private/.env}
mkdir -p "$private"
chmod 700 "$private"
[[ -f "$env_file" ]] || { echo "Create $env_file from deploy/pilot/env.example first" >&2; exit 1; }
# Trusted, local, shell-compatible config only. Never source a downloaded env file.
set -a
source "$env_file"
set +a
for ref in "${OPENGYM_API_IMAGE:-}" "${OPENGYM_WEB_IMAGE:-}"; do
  [[ "$ref" =~ @sha256:[0-9a-f]{64}$ || "$ref" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'Images must be pinned by digest' >&2; exit 1; }
done
[[ "${OPENGYM_HOSTNAME:-}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo 'Set a hostname without scheme, port or path' >&2; exit 1; }
compose() { docker compose --env-file "$env_file" -f "$root/deploy/pilot/compose.yml" "$@"; }
operation="$private/.operation-lock"
mkdir "$operation" 2>/dev/null || { echo 'Another pilot operation is active; inspect before removing a stale lock' >&2; exit 1; }
restart_api=0
restore_project=''
cleanup() {
  rc=$?
  trap - EXIT
  if [[ "$restart_api" = 1 ]]; then compose start --wait api || rc=1; fi
  if [[ -n "$restore_project" ]]; then compose -p "$restore_project" down -v >/dev/null || rc=1; fi
  rmdir "$operation"
  exit "$rc"
}
trap cleanup EXIT
backup_config() {
  [[ -f "$private/backup.env" ]] || { echo 'Configure private/backup.env and initialize restic first' >&2; exit 1; }
  set -a; source "$private/backup.env"; set +a
  : "${RESTIC_REPOSITORY:?Set a dedicated encrypted backup repository}"
  : "${RESTIC_PASSWORD_FILE:?Set its recovery-password file}"
  command -v restic >/dev/null
  restic backup --help | grep -F -- --stdin-from-command >/dev/null || { echo 'Restic with --stdin-from-command is required' >&2; exit 1; }
}
case "${1:-}" in
  preflight)
    compose config -q
    for ref in "$OPENGYM_API_IMAGE" "$OPENGYM_WEB_IMAGE"; do docker image inspect "$ref" >/dev/null; done
    api_rev=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$OPENGYM_API_IMAGE")
    web_rev=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$OPENGYM_WEB_IMAGE")
    [[ "$api_rev" = "$web_rev" && "$api_rev" =~ ^[0-9a-f]{40}$ ]] || { echo 'API/web must be a matching scanned publication' >&2; exit 1; }
    echo "Matching image revision: $api_rev"
    ;;
  bootstrap)
    [[ -z "$(compose ps --status running -q api web bootstrap)" ]] || { echo 'Stop all pilot writers and web before bootstrap' >&2; exit 1; }
    [[ ! -e "$private/bootstrap-owner.json" ]] || { echo 'Existing owner credentials will not be overwritten' >&2; exit 1; }
    compose run --rm --no-deps data-init
    # On any failure the temporary file is removed; no partial credentials are published.
    tmp=$(mktemp "$private/bootstrap-owner.XXXXXX")
    chmod 600 "$tmp"
    if compose run --rm --no-deps -T bootstrap > "$tmp"; then
      mv "$tmp" "$private/bootstrap-owner.json"
      echo "Owner created. Read $private/bootstrap-owner.json locally; never paste it into chat or issues."
    else rm -f "$tmp"; exit 1; fi
    ;;
  up) compose up -d --wait api web ;;
  stop) compose stop web api ;;
  backup)
    backup_config
    [[ -n "$(compose ps --status running -q api)" ]] || { echo 'API must be running before a quiesced backup' >&2; exit 1; }
    running_ref=$(docker inspect --format '{{.Config.Image}}' "$(compose ps --status running -q api)")
    [[ "$running_ref" = "$OPENGYM_API_IMAGE" ]] || { echo 'Back up before changing the configured API image' >&2; exit 1; }
    restart_api=1
    compose stop api
    [[ -z "$(compose ps --status running -q api bootstrap)" ]] || { echo 'A writer is still running' >&2; exit 1; }
    restic backup --tag opengym-pilot --tag "api=$OPENGYM_API_IMAGE" --tag "web=$OPENGYM_WEB_IMAGE" \
      --stdin-filename opengym-data.tar --stdin-from-command -- \
      docker compose --env-file "$env_file" -f "$root/deploy/pilot/compose.yml" run --rm --no-deps -T api tar -C /data -cf - .
    restic check --read-data
    date -u +'%Y-%m-%dT%H:%M:%SZ' > "$private/last-backup-success"
    ;;
  restore-test|restore-inspect)
    backup_config
    [[ ! -e "$private/restore-project" ]] || { echo 'Finish the existing restore inspection first' >&2; exit 1; }
    snapshot=${2:?Supply an explicit snapshot ID, not latest}
    [[ "$snapshot" =~ ^[0-9a-f]{8,64}$ ]] || { echo 'Use an explicit restic snapshot ID' >&2; exit 1; }
    restore_project="opengym-restore-$(date +%s)-$$"
    compose -p "$restore_project" run --rm --no-deps data-init
    restic dump "$snapshot" /opengym-data.tar | compose -p "$restore_project" run --rm --no-deps -T api tar -C /data -xf -
    compose -p "$restore_project" up -d --wait api
    compose -p "$restore_project" exec -T api node -e '
      const fs=require("node:fs"),path=require("node:path");
      const db=JSON.parse(fs.readFileSync("/data/db.json"));
      if(!db.users?.length || !fs.readFileSync("/data/secret").length) process.exit(1);
      console.log("Restored accounts:",db.users.length,"profiles:",fs.readdirSync("/data").filter(x=>/^state-.*json$/.test(x)).length);
    '
    if [[ "$1" = restore-inspect ]]; then
      printf '%s\n' "$restore_project" > "$private/restore-project"
      echo "Retained isolated API $restore_project. Use restore-probe with credentials on stdin, then restore-clean."
      restore_project=''
    else
      echo 'Disposable restore boot passed. Use restore-inspect for account/workout/media acceptance.'
    fi
    ;;
  restore-probe|restore-clean)
    saved=$(cat "$private/restore-project")
    [[ "$saved" =~ ^opengym-restore-[0-9]+-[0-9]+$ && "$saved" != "${OPENGYM_PROJECT_NAME:-opengym-pilot}" ]] || { echo 'Invalid disposable project record' >&2; exit 1; }
    if [[ "$1" = restore-probe ]]; then
      compose -p "$saved" exec -T api node /ops/inspect-restored.mjs
    else
      compose -p "$saved" down -v
      rm "$private/restore-project"
    fi
    ;;
  *) echo 'Usage: pilot.sh preflight|bootstrap|up|stop|backup|restore-test ID|restore-inspect ID|restore-probe|restore-clean'  >&2; exit 2 ;;
esac
