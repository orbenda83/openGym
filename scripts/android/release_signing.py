#!/usr/bin/env python3
"""Fetch a successful pinned main-build APK and sign locally; no signing secrets enter CI."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPOSITORY = 'orbenda83/openGym'
APPLICATION_ID = 'live.orbenda.opengym'
HERE = Path(__file__).resolve().parent

def digest(path):
    with Path(path).open('rb') as stream:
        value = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''): value.update(block)
        return value.hexdigest()

def validate_artifact(directory, commit, run_id):
    directory = Path(directory)
    provenance = directory / 'release-provenance.json'
    if provenance.is_symlink() or provenance.stat().st_size > 65536: raise ValueError('Invalid provenance file')
    data = json.loads(provenance.read_text())
    expected = {'schemaVersion': 1, 'repository': REPOSITORY, 'runId': str(run_id), 'sourceCommit': commit,
                'applicationId': APPLICATION_ID, 'apkFile': 'app-sideload-release-unsigned.apk'}
    if any(data.get(key) != value for key, value in expected.items()): raise ValueError('Artifact provenance does not match the pinned build')
    code = data.get('versionCode')
    if type(code) is not int or not 28 <= code <= 2100000000: raise ValueError('Invalid release versionCode')
    if not isinstance(data.get('versionName'), str) or not re.fullmatch(r'[0-9A-Za-z.+_-]{1,80}', data['versionName']): raise ValueError('Invalid release versionName')
    apk = directory / data['apkFile']
    if apk.is_symlink() or not apk.is_file() or not re.fullmatch(r'[0-9a-f]{64}', data.get('apkSha256', '')): raise ValueError('Invalid APK input')
    if digest(apk) != data['apkSha256']: raise ValueError('Unsigned APK checksum mismatch')
    return data

def validate_badging(text, metadata):
    package = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", text, re.M)
    if not package or package.groups() != (APPLICATION_ID, str(metadata['versionCode']), metadata['versionName']):
        raise ValueError('APK package/version differs from provenance')
    sdk = re.search(r"^sdkVersion:'(\d+)'", text, re.M)
    if not sdk: raise ValueError('APK minimum Android SDK is missing')
    return int(sdk[1])

def validate_run(data, commit):
    if (data.get('conclusion') != 'success' or data.get('head_branch') != 'main' or data.get('head_sha') != commit
        or data.get('event') not in ('push', 'workflow_dispatch') or data.get('path') != '.github/workflows/android.yml'):
        raise ValueError('Only a successful pinned Android build on main may be signed')

def check_version(ledger, metadata):
    code = metadata['versionCode']
    if ledger and code < max(item['versionCode'] for item in ledger): raise ValueError('Release versionCode cannot go backwards')
    same = [item for item in ledger if item['versionCode'] == code]
    if same:
        if any(item['sourceCommit'] != metadata['sourceCommit'] or item['apkSha256'] != metadata['apkSha256'] for item in same):
            raise ValueError('Version code already belongs to another APK; increment it')
    elif ledger and code <= max(item['versionCode'] for item in ledger): raise ValueError('Release versionCode must increase')

def load_ledger(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('Signing history is missing or invalid; restore the complete identity backup')
    ledger = json.loads(path.read_text())
    if not isinstance(ledger, list) or any(not isinstance(item, dict) or type(item.get('versionCode')) is not int for item in ledger):
        raise ValueError('Invalid signing history; do not reset it')
    return ledger


def invoke(command, **kwargs):
    result = subprocess.run([str(arg) for arg in command], capture_output=True, **kwargs)
    if result.returncode: raise ValueError('Tool failed: ' + Path(str(command[0])).name + '; no release was published')
    return result.stdout.decode().strip()

def swift(command, key_dir, *arguments):
    return invoke(['/usr/bin/swift', HERE / 'macos-signing.swift', command, key_dir, *arguments])

def github_env():
    env = os.environ.copy()
    env['GH_TOKEN'] = invoke(['gh', 'auth', 'token', '--user', 'orbenda83'])
    return env

def fetch_artifact(run_id, commit, target):
    env = github_env()
    run = json.loads(invoke(['gh', 'api', f'repos/{REPOSITORY}/actions/runs/{run_id}'], env=env))
    validate_run(run, commit)
    artifact_name = 'android-unsigned-release-' + commit
    listing = json.loads(invoke(['gh', 'api', f'repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100'], env=env))
    matches = [item for item in listing['artifacts'] if item['name'] == artifact_name and not item['expired']]
    if len(matches) != 1: raise ValueError('Expected one unexpired unsigned release artifact')
    invoke(['gh', 'run', 'download', run_id, '--repo', REPOSITORY, '--name', artifact_name, '--dir', target], env=env)
    return validate_artifact(target, commit, run_id)

def sign_release(run_id, commit, output, key_dir, tools):
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'[1-9][0-9]*', run_id): raise ValueError('Pin an exact commit and numeric workflow run')
    output, key_dir, tools = Path(output).resolve(), Path(key_dir).resolve(), Path(tools).resolve()
    if output.exists() or output == key_dir or key_dir in output.parents or output in key_dir.parents: raise ValueError('Choose a new public output directory separate from signing material')
    if not key_dir.is_dir(): raise ValueError('Initialize the protected signing key first')
    for name in ('apksigner', 'aapt2', 'zipalign'):
        if not (tools / name).is_file(): raise ValueError('Provide a trusted Android SDK build-tools directory')
    # Lock the private release ledger so simultaneous invocations cannot reuse a code.
    with (key_dir / 'release.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger_path = key_dir / 'releases.json'
        ledger = load_ledger(ledger_path)
        expected = swift('fingerprint', key_dir).strip()
        with tempfile.TemporaryDirectory(prefix='opengym-unsigned-') as tmp:
            meta = fetch_artifact(run_id, commit, tmp)
            check_version(ledger, meta)
            unsigned = Path(tmp) / meta['apkFile']
            min_sdk = validate_badging(invoke([tools / 'aapt2', 'dump', 'badging', unsigned]), meta)
            if subprocess.run([str(tools / 'apksigner'), 'verify', str(unsigned)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                raise ValueError('CI release input must be unsigned')
            invoke([tools / 'zipalign', '-c', '-p', '4', unsigned])
            # Stage the output privately; a partial result is never the final download folder.
            output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='.opengym-signing-', dir=output.parent) as stage:
                apk = Path(stage) / f'openGym-Orbenda-{meta["versionCode"]}.apk'
                swift('sign', key_dir, tools / 'apksigner', unsigned, apk)
                printed = invoke([tools / 'apksigner', 'verify', '--print-certs', apk])
                certificates = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$', printed, re.M)
                if certificates != [expected]: raise ValueError('Signed APK certificate differs from the permanent identity')
                validate_badging(invoke([tools / 'aapt2', 'dump', 'badging', apk]), meta)
                invoke([tools / 'zipalign', '-c', '-p', '4', apk])
                signed_hash = digest(apk)
                if any(item['versionCode'] == meta['versionCode'] and item.get('signedApkSha256') != signed_hash for item in ledger):
                    raise ValueError('This code was already signed with different output bytes')
                record = {**meta, 'signerSha256': expected, 'signedApkSha256': signed_hash, 'minSdk': min_sdk, 'signedApkFile': apk.name}
                (Path(stage) / (apk.name + '.sha256')).write_text(signed_hash + '  ' + apk.name + '\n')
                (Path(stage) / 'release-provenance.json').write_text(json.dumps(record, indent=2) + '\n')
                # Persist the identity/code reservation before making outputs available. A retry
                # may reproduce the same bytes after a crash; it may not replace this code.
                next_ledger = ledger if any(item['versionCode'] == meta['versionCode'] for item in ledger) else ledger + [record]
                fd, pending = tempfile.mkstemp(dir=key_dir, prefix='.release-ledger-')
                try:
                    with os.fdopen(fd, 'w') as stream:
                        json.dump(next_ledger, stream, indent=2); stream.flush(); os.fsync(stream.fileno())
                    os.replace(pending, ledger_path)
                finally:
                    if os.path.exists(pending): os.unlink(pending)
                os.rename(stage, output)
                # TemporaryDirectory tolerates the renamed staging directory on exit.
                print('Verified signed release: ' + str(output / apk.name))
                print('Certificate SHA-256: ' + expected)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-dir', default=str(Path.home() / '.config/opengym-signing'))
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('init')
    commands.add_parser('fingerprint')
    backup = commands.add_parser('backup'); backup.add_argument('destination')
    sign = commands.add_parser('fetch-sign')
    sign.add_argument('--run', required=True); sign.add_argument('--commit', required=True)
    sign.add_argument('--output', required=True); sign.add_argument('--build-tools', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'fetch-sign': sign_release(args.run, args.commit, args.output, args.key_dir, args.build_tools)
    elif args.command == 'backup': print(swift('backup', args.key_dir, Path(args.destination).expanduser()))
    else: print(swift(args.command, args.key_dir))

if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error: raise SystemExit(str(error))
