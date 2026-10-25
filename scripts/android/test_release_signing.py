import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('release_signing', Path(__file__).with_name('release_signing.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class ReleaseValidation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.apk = self.root / 'app-sideload-release-unsigned.apk'
        self.apk.write_bytes(b'unsigned fixture')
        self.meta = dict(schemaVersion=1, repository='orbenda83/openGym', runId='123', sourceCommit='a' * 40,
                         applicationId='live.orbenda.opengym', versionCode=28, versionName='1.4.3',
                         apkFile=self.apk.name, apkSha256=hashlib.sha256(self.apk.read_bytes()).hexdigest())
    def load(self):
        (self.root / 'release-provenance.json').write_text(json.dumps(self.meta))
        return release.validate_artifact(self.root, 'a' * 40, '123')
    def test_valid_pinned_artifact(self):
        self.assertEqual(self.load()['versionCode'], 28)
    def test_rejects_source_run_identity_hash_and_path_substitution(self):
        original = self.meta.copy()
        for key, value in [('sourceCommit', 'b' * 40), ('runId', '124'), ('repository', 'other/repo'),
                           ('applicationId', 'ch.duartesantos.opengym'), ('apkSha256', '0' * 64),
                           ('apkFile', '../escape.apk'), ('versionCode', True), ('versionCode', 27)]:
            self.meta = {**original, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError): self.load()
    def test_rejects_symlink_input(self):
        self.apk.unlink()
        target = self.root / 'other.apk'; target.write_bytes(b'unsigned fixture')
        self.apk.symlink_to(target)
        with self.assertRaises(ValueError): self.load()
    def test_refuses_reused_code_and_downgrade(self):
        entry = {**self.meta, 'signedApkSha256': 'c' * 64}
        release.check_version([entry], self.meta)
        for changed in [{**self.meta, 'sourceCommit': 'd' * 40}, {**self.meta, 'apkSha256': 'e' * 64}]:
            with self.assertRaises(ValueError): release.check_version([entry], changed)
        with self.assertRaises(ValueError): release.check_version([{**entry, 'versionCode': 29}], self.meta)
        with self.assertRaises(ValueError): release.check_version([entry, {**entry, 'versionCode': 29}], self.meta)
    def test_badging_must_match_manifest(self):
        good = "package: name='live.orbenda.opengym' versionCode='28' versionName='1.4.3'\nsdkVersion:'24'\n"
        release.validate_badging(good, self.meta)
        for value in [good.replace("'28'", "'29'"), good.replace('live.orbenda.opengym', 'wrong.package')]:
            with self.assertRaises(ValueError): release.validate_badging(value, self.meta)
    def test_missing_signing_history_fails_closed(self):
        path = self.root / 'releases.json'
        with self.assertRaises(ValueError): release.load_ledger(path)
        path.write_text('[]')
        self.assertEqual(release.load_ledger(path), [])
        path.write_text('{}')
        with self.assertRaises(ValueError): release.load_ledger(path)
    def test_run_must_be_successful_main_android_workflow(self):
        good = dict(conclusion='success', head_branch='main', head_sha='a' * 40, event='push', path='.github/workflows/android.yml')
        release.validate_run(good, 'a' * 40)
        for field, value in [('head_branch', 'feature'), ('conclusion', 'failure'), ('event', 'pull_request'), ('path', 'other.yml')]:
            with self.assertRaises(ValueError): release.validate_run({**good, field: value}, 'a' * 40)

if __name__ == '__main__': unittest.main()
