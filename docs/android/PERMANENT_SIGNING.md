# Permanent Android release signing

The fork's production identity is `live.orbenda.opengym`, displayed as **openGym Orbenda**. It installs beside the original app and old `OpenGymTest`. Signing stays local on macOS; CI and the web server receive no private signing material.

## Initialize once

On the development Mac, with login Keychain unlocked:

```sh
python3 scripts/android/release_signing.py init
```

This creates an RSA4096 key in an encrypted PKCS12 keystore under `$HOME/.config/opengym-signing/`. Directory permissions are0700; key and identity metadata are0600. A randomly generated password is stored in the **login Keychain**, service `live.orbenda.opengym.android-signing`, account `release`, label **openGym Orbenda Android signing password**. The helper never prints it or puts it in command arguments. No password file is created.

The helper records the public certificate fingerprint and a private release history. Running init again verifies the existing identity; it does not rotate it. If the key, password, fingerprint or history is missing, stop and recover the complete identity rather than generate another key. Loss of this key prevents updates to installations signed with it.

Use Keychain Access to find the labelled entry and, yourself, save a separate recovery copy of its password in your password manager. Do not paste passwords or private keys into chat or Git. A keystore backup without a recoverable password is not sufficient recovery.

## Back up when a separate device is available

The initial operator explicitly deferred a separate-device copy. It is still required for recovery from losing the development Mac; a second directory on the same drive is not an independent backup.

```sh
python3 scripts/android/release_signing.py backup /Volumes/YOUR_DRIVE/openGym-signing-backup-YYYYMMDD
```

The new directory receives the encrypted keystore, public certificate, certificate fingerprint and signing history, with a recovery note. No plaintext password is included. Preserve the password separately and refresh the history backup after releases. Keep the backup outside public serving directories and source control. Never overwrite the only known-good copy while recovering.

## Build unsigned, sign locally

The Android workflow produces `android-unsigned-release-<commit>` with an unsigned production APK, SHA256 sidecar and provenance. Debug APKs use ephemeral CI signing keys and are not a release-update channel. Production APKs must never be signed with a public/test key.

Choose a successful Android workflow run on `main` and its exact40-character commit. Use a trusted installed Android SDK build-tools directory:

```sh
python3 scripts/android/release_signing.py fetch-sign \
  --run RUN_ID --commit FULL_MAIN_COMMIT \
  --build-tools /path/to/Android/sdk/build-tools/35.0.0 \
  --output /path/to/NEW-public-release-directory
```

The command uses the `orbenda83` GitHub account without switching global authentication. It verifies the workflow path, successful main event, exact commit, artifact provenance, bytes, package identity, version and unsigned status. It signs through the Keychain helper, then verifies signature, certificate, package, version and ZIP alignment. Final outputs contain only the signed APK, its checksum, public provenance and any public APK signature sidecar.

Release codes start at28 and must increase. The default is in `frontend/android/app/build.gradle`; workflow dispatch accepts a validated `release_version_code` override (e.g.29) for the next release. Never rely only on display version1.4.3. The protected local ledger refuses a changed APK at an already used code and refuses going backward; an identical latest-code retry preserves the original history record. Restore that ledger with the key, and check existing published release metadata before recovering an older backup.

Do not distribute a file merely because signing completed: retain the verification metadata and complete the appropriate tests/review. Do not upload the private identity directory. The key is never needed on the public home server.

## First installation and later updates

Keep the existing test app while installing **openGym Orbenda**. Sync existing changes and export a backup outside the old app first. Connect the new app to the same server and sign in; verify representative workouts before retiring the test app. Local preferences, permissions and unsynced records do not transfer automatically between Android application IDs.

After this one-time move, newer APKs signed with this same permanent certificate and the same application ID update the production app in place. Validate this with two successive version codes. A signature mismatch is not fixed by weakening Android security.

The fork currently uses a **manual** update channel, including when native channel detection fails. It does not offer the upstream developer's APKs. Checking/downloading releases from the home server is the remaining updater work in issue#40; a signed APK alone does not implement that feature.
