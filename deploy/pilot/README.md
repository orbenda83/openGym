# Single-host HTTPS pilot

This is a separate Compose project for an existing host-native Caddy installation. It
publishes only `127.0.0.1:8082`; the API has no host port. It uses matching scanned image
digests, one non-root API writer, a private named data volume, read-only root filesystems,
and disabled agent/Coach execution. This does not deploy or alter an existing Caddy service.

## 1. Prepare private configuration

Use a fresh checkout of this fork. Keep private material in `deploy/pilot/private/`, which
Git ignores; never commit live hostnames, server addresses, credentials or backup paths.

```sh
umask 077
mkdir -p deploy/pilot/private
cp deploy/pilot/env.example deploy/pilot/private/.env
chmod 700 deploy/pilot/private
chmod 600 deploy/pilot/private/.env
```

Edit that trusted local file. Set the final hostname **before creating any accounts**;
passkeys are bound to it. Set both image refs from the same successful fork **Publish
Docker images** run and pin each manifest digest (`image@sha256:...`). The run summary and
security artifacts retain them. Pull both exact refs, then run:

```sh
bash scripts/hosting/pilot.sh preflight
```

Preflight checks that both local images carry the same commit revision. Scanned publication
provenance is established by choosing the pair from the successful publication, not by the
labels alone. Do not use the default upstream `docker-compose.yml` for this pilot.

## 2. Bootstrap privately, then start locked

Do this **before adding the Caddy route**. Use only the helper for pilot lifecycle
operations, and do not start another writer or maintenance container independently.

```sh
bash scripts/hosting/pilot.sh bootstrap
bash scripts/hosting/pilot.sh up
```

The bootstrap service has no network except its own loopback and no published ports. It
uses the normal registration API to create exactly one owner with a random password, then
exits. Normal runtime has invite-only registration, no automatic first-user promotion and
no guest entry. Bootstrap refuses any nonempty data volume and refuses existing credential
output; it never edits account JSON directly. A crash can leave a lock or incomplete fresh
volume: inspect it before operator recovery; do not delete a volume containing real data.

Read `deploy/pilot/private/bootstrap-owner.json` **locally**, store its password in your
password manager, and never paste the file into chat, CI, issues or logs. If the command
fails, do not publish the site. The private owner file is not part of the app-data backup.

## 3. Add only this Caddy site

Confirm the active Caddyfile location/service configuration on the host. Make a backup of
that existing file. Copy the site in `Caddyfile.example`, replace the example hostname with
the final one, and append/import it using the existing configuration's conventions. Do not
replace the existing file. Match the upstream port if the private env changes 8082.

Validate the complete modified Caddyfile and reload using the service's existing config and
environment (especially any DNS-module credentials). Do not start a second Caddy process.
The DNS name must reach the existing Caddy endpoint and its certificate challenge method
must work. This deployment does not change DNS, router forwarding or other Caddy sites.

The `CF-Connecting-IP` header name reuses the app's existing trusted-IP input: Caddy
**overwrites** it with the immediate connection's remote host, nginx forwards just that
value, and the API trusts only its private web proxy. Loopback-only binding is essential.
Do not remove the overwrite or expose the web port on the LAN. If a CDN/proxy is ahead of
Caddy, configure and test a separate explicit trusted-proxy policy; otherwise this records
the CDN peer, not the original visitor. Do not forward a client's claimed IP unchanged.

Open the final HTTPS URL, sign in as Owner, and add/test a passkey. To disable password
entry afterward, set `OPENGYM_PASSWORD_LOGIN=0` and run `pilot.sh up` again only after the
passkey works. Keep an independent recovery method. Verify anonymous registration returns
an invite-required error. No public signup window is needed.

## 4. Local encrypted backups for the initial pilot

Install restic 0.19.1 or a compatible version with `--stdin-from-command` from its official
release or Homebrew. Pick a **dedicated local repository outside this checkout and outside
Docker's VM**, and create its recovery password in a password manager. Store the local
password-file copy with mode 0600. Keep that password independently recoverable too.

Create `deploy/pilot/private/backup.env` as trusted shell-compatible configuration:

```sh
RESTIC_REPOSITORY='/absolute/local/path/to/opengym-encrypted-backups'
RESTIC_PASSWORD_FILE='/absolute/private/path/to/restic-password'
```

Initialize once with those two values exported (`restic init`), then run:

```sh
bash scripts/hosting/pilot.sh backup
```

The helper stops the API, streams a complete tar through restic encryption, checks repository
integrity and restarts the **same existing API container**, even after a backup error. A
failed tar producer cannot create a successful snapshot. The encrypted snapshot includes
account/passkey records, password hashes, workout state, session secrets, audit files and
uploads. No plaintext data archive is written on the host. Snapshot tags record the image
pair. A protected `last-backup-success` file is updated only after a checked backup.

Back up at least daily and before updates. A host-local launchd schedule can invoke the
helper with absolute paths and must alert on nonzero exit or a last-success age over 26
hours. Do not call a schedule/monitor configured until it is installed and tested on the
actual host. Review snapshots before applying a retention policy such as seven daily,
four weekly and six monthly snapshots; run pruning during a separate maintenance window.

A backup on the same machine cannot recover a lost machine or disk. Off-host QNAP/cloud
copies are tracked in [#33](https://github.com/orbenda83/openGym/issues/33) and deliberately
follow this local-only pilot.

## 5. Disposable restore and rollout

Select an explicit snapshot ID (`restic snapshots --tag opengym-pilot`) and use the image
pair recorded in its tags for a compatibility drill. Never assume a newer image can write
older data without changes.

```sh
bash scripts/hosting/pilot.sh restore-test SNAPSHOT_ID
```

The helper restores into a new, uniquely named Compose project/volume, boots only its API,
checks account/secret presence, and removes that disposable project. It never replaces live
data. The automated synthetic drill additionally checks a saved workout and exact uploaded
media bytes. For actual-host account acceptance, keep an isolated restored API temporarily:

```sh
bash scripts/hosting/pilot.sh restore-inspect SNAPSHOT_ID
bash scripts/hosting/pilot.sh restore-probe < deploy/pilot/private/bootstrap-owner.json
bash scripts/hosting/pilot.sh restore-clean
```

`restore-probe` signs in to the restored API and reads the profile, returning only workout
and media-file counts. Supply a private JSON file with **current** name/password if the
initial credential changed; it must correspond to an enabled password method in the restore
configuration. Match those counts and verify known workout/media content in the recovery
copy; health alone is insufficient. No Caddy route or public port is added, live data is
unchanged, and `restore-clean` removes only the recorded disposable project. Keep the
production image pair in the env until any compatibility update has been validated.

Before any update: take a checked backup, record the previous image pair, restore/test a copy
with the proposed pair and verify representative data. Then update the private env and run
preflight/up. If rollback requires restoring data, rehearse it in a new project first; do not
use `down -v` or extract backups over the live volume. Preserve the original while validating
the recovery copy. Local-host restore and rollback drills remain operator acceptance work.

## 6. Galaxy pilot acceptance

Use a production-signed, independently backed-up Android signing key before relying on a
stable pilot APK. Disposable CI test APKs have `.test` IDs and can require uninstalling to
change signatures; export test data before uninstalling.

From a browser signed in over the final HTTPS hostname, use Settings → Account → Pair the
mobile app. Redeem the one-time code in the Galaxy app. Save a synthetic workout, go offline,
save another set, reconnect, and verify both browser and phone agree. Exercise a conflict
and a full recovery before real records. A successful CI build does not establish these
physical-phone or home-network acceptance criteria.
