# Server-hosted Android updates

Date: 2026-10-25
Status: Proposed; user selected the server-hosted approach. Written design awaiting approval.

## Intent and constraints

The user's Samsung Galaxy should obtain approved fork updates from their existing HTTPS home server, without visiting GitHub for each update. The first fork installation is manual; later releases update that fork in place. Existing server accounts, exercise records and workouts must survive. Do not interrupt an active workout or silently install software.

Today Android CI produces only debug APKs with an application ID suffix `.test`. Their keys are not a permanent release identity. The existing sideload updater checks `DuarteSantos8/openGym` on GitHub, downloads an APK natively, verifies a SHA-256 checksum and invokes Android's installer. Its version comparison uses semver rather than Android versionCode. Reuse the native download path, but do not retain upstream release discovery in the fork's production build.

The pilot already runs behind Caddy. Its serving configuration is also reloaded by a separate stack using another Caddyfile. Deployment must preserve the update route in both active configuration sources; never replace unrelated sites. Home server deployment and Galaxy acceptance require operator access and are separate from CI success.

## Approaches considered

1. **Server-hosted signed APKs (chosen by user):** the home server supplies release metadata and immutable APK files; the phone checks and offers installation. Fits the user's self-hosting requirement and reuses existing installation support. Requires a permanent key, release publishing and server file hosting.
2. **Fork GitHub releases:** replace the upstream repository in the existing updater. Simpler hosting, but downloads and discovery depend on GitHub rather than the user's server.
3. **Server-delivered JavaScript bundles:** can update only some UI behavior, adds another executable update trust mechanism and cannot deliver native capabilities such as calendar integration. Not selected.

## Proposed decisions (builder recommendations, not user preferences)

### Fork identity and bootstrap

Use production application ID `live.orbenda.opengym` and display name **openGym Orbenda**. Keep Java source namespaces where practical; align Capacitor identity, manifest providers, labels, deep links and any certificate-bound integration with the application ID. Fork debug builds use the same ID plus `.test` and a distinct test label. Never let a debug build subscribe to production installation updates.

A distinct production ID permits installation beside the upstream app without uninstalling it. Different signing keys cannot replace the upstream APK. The user first confirms all upstream changes are synced and exports a local backup, installs the fork, connects to the same server and signs in. Server-synced records are reused; local pairing, permissions and preferences must not be assumed to transfer. Verify recent workouts and any unsynced data before removing the upstream app. No automatic local-data import from another Android sandbox.

### Signing and versioning

Generate one permanent release keystore outside the checkout, with restrictive permissions and an encrypted backup in a separate local location. Passwords and key material never enter Git, chat, public artifacts, the Android APK or the web serving directory. Use an operator-run signing command on the development machine initially; CI receives no production signing secrets. The home web server receives only signed release outputs.

CI builds the unsigned fork release APK from a pinned, reviewed main commit; existing debug CI remains available for testing. A local release helper downloads that exact artifact, verifies its workflow/run/commit provenance, signs it with the permanent key and verifies the resulting APK. The helper derives manifest fields from the APK itself and refuses inconsistent declared metadata. Avoid rebuilding with a private upstream media quality directory: use the same checked-in catalogue media staging that current Android CI successfully packages. Verify shipped media licence and notices are preserved.

Use an explicit integer Android versionCode, strictly increasing for every published release. Reject reuse of a published code with different bytes. Version name is a display label; update eligibility uses versionCode. Record the source commit and signer certificate SHA-256 fingerprint with each release. Never use per-run ephemeral debug keys or rotate the release key implicitly. Key rotation and automated production signing are future work.

### Distribution and release metadata

A build-time HTTPS update base is pinned into the fork build, configured through an explicit release build input. It is independent of the paired fitness server: changing the server used for personal records must not change the software publisher. Source and documentation use an example host; the deployment operator supplies the actual hostname. No upstream fallback when this endpoint fails.

Caddy serves an isolated, read-only release directory under `/updates/android/`, outside source, secrets, backups and user data. APKs and metadata are public executable distribution assets, contain no account data and require no bearer token. No directory listing, upload route or web-admin publication endpoint. Permit native downloads and the Capacitor origin's metadata reads without enabling authenticated cross-origin API access. Publish only the reviewed stable channel, one standard animation variant initially. Missing metadata means no published update; malformed or inaccessible metadata is an explicit check failure, never a forced downgrade.

`/updates/android/stable.json` contains schemaVersion, applicationId, channel, versionCode, versionName, minSdk, sourceCommit, publishedAt, sizeBytes, apkPath, apkSha256, signerSha256 and brief plain-text release notes. APK path is a relative immutable path within the release directory (for example `releases/28/openGym-Orbenda-28.apk`). Validate field types, integer bounds, hash encodings, application ID, channel and path containment. Reject external origins, traversal, redirects off the pinned origin and malformed or missing fields. Restrict HTTPS requests and redirect handling in the native downloader as well as metadata parsing.

APK files have immutable cache headers; metadata and its error responses use no-store. Serve APK content type and nosniff. Stage and validate complete release outputs, then atomically replace the stable metadata pointer last. A helper refuses publication without a verified expected certificate and a higher versionCode. Retain previously published APKs for recovery. Do not serve keystores, build logs or temporary staging files.

A checksum protects download integrity but is not an independent publisher signature. Before opening the installer, native code must inspect the APK, confirm application ID and versionCode match the offer, ensure minSdk compatibility, verify its signer against the installed fork's certificate and confirm the installed version has not changed since the check. Android also validates signing at installation. A compromised web server cannot produce an accepted new APK without the signing key, although it can suppress updates or replay an older offer; never install a version at or below the installed version.

### Phone experience

Check on first app foreground and at most once every 24 hours afterward; Settings → About → Check for updates always retries immediately. Short request timeout, cancel abandoned requests, retry failures on the next eligible foreground rather than continuous polling. Offline use and workout logging continue normally.

An available update shows a small non-blocking notice with version and release notes. Download starts only after the user chooses it and shows native byte progress. Prevent concurrent downloads and bound download size and time. On cancel or failure, remove partial files and show a retry action. Verify the complete APK before enabling Install. Denied installation-source permission gets clear Android settings guidance, without disabling device protections automatically.

While a live workout exists, defer the update notice and installation until the session ends. If a workout starts while a download is running, let the download finish but defer installation. Recheck this condition immediately before invoking Android's installer. Updates never start, stop or alter workout sessions. Android installation remains a user-confirmed system action; no silent-install guarantee.

Keep the downloaded verified file and offer state across app foreground transitions needed for Android permission screens, but reverify before installation and recheck installed version. After successful app replacement, clear obsolete update caches and show the new installed version. Installation acceptance must not be mistaken for confirmed success.

### Recovery and compatibility

Publishing an older metadata pointer stops an offer to older clients but cannot downgrade already updated phones. Fix a bad installed release by publishing a higher versionCode; do not promise in-place downgrade or use uninstall as routine recovery. Preserve local data and sync compatibility, with supported API capabilities documented per release. Do not force a server upgrade during installation or silently change the paired server.

## Scope and delivery

Implement fork identity and stable signing inputs, unsigned release build artifact, local signing/publishing helpers, metadata validation, native APK checks, foreground update notice and Settings status, isolated Caddy distribution instructions and bootstrap/migration documentation. Make the first install APK available as a stable signed release only after production key creation and safe storage have been completed. An unsigned or CI debug artifact is not that release.

Implementation stays on `codex/server-apk-updates`, with focused regression tests and a fresh security/code review. Merge only after required CI succeeds, then clean up the merged branch as requested. Deployment instructions must accommodate both Caddy configuration sources without overwriting unrelated routes. No remote server or phone acceptance claim from local testing alone.

Non-goals: Google Play publication, silent installs, remote JavaScript hot updates, test APK auto-updates, automatic release promotion on every merge, key rotation, and changing the current backup destination. Local signing is the initial operator step; future cloud/QNAP backups remain separately tracked.

## Acceptance evidence

- Install the fork beside upstream; connect to the existing server and verify representative records without deleting either installation.
- Test two successive signed release APKs on Android: update in place, same package and certificate, higher versionCode; retain local settings, pairing and logs.
- Reject corrupt APKs, wrong signer/package/version, incompatible SDK, oversized downloads, malformed metadata and unsafe URLs/redirects. Exercise these checks with real APK fixtures/native unit tests where possible.
- Verify offline launch, timeout, retry, partial-download cancellation, permission denial and app restart/foreground behavior.
- Verify no installation prompt while a workout is active, including one started during download; ensure no changes to workout state from checking or cancelling updates.
- Test publication failure before metadata switch; previous release remains downloadable. Confirm no private files reachable and the route survives the scheduled external Caddy reload.
- Run relevant JS/native tests, Android release assembly, signature verification and normal required checks. Complete an emulator install/update round trip locally where tooling permits; Galaxy and home-server acceptance remain explicit operator steps.

## References

- Android signing: https://developer.android.com/studio/publish/app-signing
- Existing implementation: `frontend/src/lib/update.js`, `frontend/src/views/Settings.jsx`, `frontend/android/app/src/sideload/java/ch/duartesantos/opengym/InstallPlugin.java`
- Build and hosting: `.github/workflows/android.yml`, `scripts/android/build-release.sh`, `deploy/pilot/README.md`
