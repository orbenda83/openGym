#!/usr/bin/env bash
# Real Linux Docker + restic integration, entirely disposable synthetic data.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
[[ ! -d deploy/pilot/private ]] || { echo 'Run in a clean disposable CI checkout' >&2; exit 1; }
work=$(mktemp -d)
export OPENGYM_ENV_FILE="$work/.env"
project="opengym-ci-$$"
compose() { docker compose --env-file "$OPENGYM_ENV_FILE" -f deploy/pilot/compose.yml "$@"; }
cleanup() {
  rc=$?
  trap - EXIT
  compose logs --no-color >&2 || true
  if [[ -f deploy/pilot/private/restore-project ]]; then bash scripts/hosting/pilot.sh restore-clean || true; fi
  compose down -v >/dev/null || true
  rm -rf "$work" deploy/pilot/private
  exit "$rc"
}
trap cleanup EXIT
api=$(docker image inspect --format '{{.Id}}' opengym-pilot-api:test)
web=$(docker image inspect --format '{{.Id}}' opengym-pilot-web:test)
cat > "$OPENGYM_ENV_FILE" <<ENV
OPENGYM_API_IMAGE=$api
OPENGYM_WEB_IMAGE=$web
OPENGYM_PROJECT_NAME=$project
OPENGYM_HOSTNAME=gym.example.com
OPENGYM_WEB_PORT=18082
ENV
bash scripts/hosting/pilot.sh preflight
bash scripts/hosting/pilot.sh bootstrap
[[ "$(stat -c '%a' deploy/pilot/private/bootstrap-owner.json)" = 600 ]]
[[ "$(stat -c '%a' deploy/pilot/private)" = 700 ]]
# A second bootstrap must refuse without overwriting the owner credential file.
before=$(sha256sum deploy/pilot/private/bootstrap-owner.json)
if bash scripts/hosting/pilot.sh bootstrap; then exit 1; fi
[[ "$before" = "$(sha256sum deploy/pilot/private/bootstrap-owner.json)" ]]
bash scripts/hosting/pilot.sh up
[[ "$(compose port web 8080)" = '127.0.0.1:18082' ]]
bindings=$(docker inspect --format '{{json .HostConfig.PortBindings}}' "$(compose ps -q api)")
[[ "$bindings" = '{}' || "$bindings" = 'null' ]]
[[ "$(compose exec -T api id -u)" = 1000 ]]
[[ "$(compose exec -T web id -u)" = 101 ]]
[[ "$(compose exec -T api stat -c '%a' /data/db.json)" = 600 ]]
# Exercise real password sign-in, closed registration and a saved workout through nginx.
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const c=JSON.parse(fs.readFileSync('deploy/pilot/private/bootstrap-owner.json'));
const base='http://127.0.0.1:18082',headers={Origin:c.origin,'Content-Type':'application/json'};
const call=(p,body,extra={})=>fetch(base+p,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
const login=await call('/api/login/password',c);assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
assert.equal((await call('/api/register/password',{name:'Uninvited',password:'A-synthetic-password-84326'})).status,403);
const state={workouts:[{id:'synthetic-workout',date:'2026-01-01',ex:[]}],routines:[]};
const save=await fetch(base+'/api/data',{method:'PUT',headers:{...headers,Cookie:cookie},body:JSON.stringify({state,baseRev:0})});assert.equal(save.status,200);
JS
# Include an upload fixture so restore evidence covers media bytes as well as account/state.
compose exec -T api sh -ec 'mkdir -p /data/uploads/fixture; printf "synthetic media\n" > /data/uploads/fixture/sample.txt; chmod 600 /data/uploads/fixture/sample.txt'
mkdir -p deploy/pilot/private
head -c 32 /dev/urandom | base64 > "$work/restic-password"
cat > deploy/pilot/private/backup.env <<ENV
RESTIC_REPOSITORY='$work/repository'
RESTIC_PASSWORD_FILE='$work/restic-password'
ENV
export RESTIC_REPOSITORY="$work/repository" RESTIC_PASSWORD_FILE="$work/restic-password"
restic init
original_api=$(compose ps -q api)
bash scripts/hosting/pilot.sh backup
[[ "$original_api" = "$(compose ps -q api)" ]]
snapshot=$(restic snapshots --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s)[0].id))')
# Producer failures must not result in a snapshot presented as a successful backup.
if restic backup --stdin-from-command -- sh -c 'printf partial; exit 1'; then exit 1; fi
restic snapshots --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{if(JSON.parse(s).length!==1)process.exit(1)})'
bash scripts/hosting/pilot.sh restore-test "$snapshot"
bash scripts/hosting/pilot.sh restore-inspect "$snapshot"
saved=$(cat deploy/pilot/private/restore-project)
restore_api=$(docker compose --env-file "$OPENGYM_ENV_FILE" -f deploy/pilot/compose.yml -f deploy/pilot/compose.restore.yml -p "$saved" ps -q api)
[[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$restore_api")" = none ]]
bash scripts/hosting/pilot.sh restore-probe < deploy/pilot/private/bootstrap-owner.json > "$work/probe.json"
node -e 'const j=require(process.argv[1]);if(!j.authenticated||j.workouts!==1||j.mediaFiles!==1)process.exit(1)' "$work/probe.json"
bash scripts/hosting/pilot.sh restore-clean
# Independently decrypt/extract and compare the three data classes with the live source.
mkdir "$work/extract"
restic dump "$snapshot" /opengym-data.tar | tar -C "$work/extract" -xf -
node --input-type=module - "$work/extract" <<'JS'
import fs from 'node:fs';import assert from 'node:assert/strict';
const dir=process.argv[2];
const db=JSON.parse(fs.readFileSync(dir+'/db.json'));assert.equal(db.users.length,1);assert.equal(db.users[0].owner,true);
const state=JSON.parse(fs.readFileSync(dir+'/state-'+db.users[0].id+'.json'));assert.equal(state.workouts[0].id,'synthetic-workout');
assert.equal(fs.readFileSync(dir+'/uploads/fixture/sample.txt','utf8'),'synthetic media\n');
JS
curl --fail --silent http://127.0.0.1:18082/api/health >/dev/null
printf 'Pilot bootstrap, private runtime, signup refusal, encrypted backup and disposable restore passed\n'
