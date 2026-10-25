import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../../scripts/scan-image.sh', import.meta.url));
for (const [label, status, platform] of [['clean', 0, ''], ['vulnerable', 1, 'linux/arm64'], ['scanner error', 2, '']]) {
  test(`image scan preserves SBOM and propagates ${label} result`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-scan-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'trivy'), `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n');fs.writeFileSync(a[a.indexOf('--output')+1],'{}');process.exit(a.includes('json')?Number(process.env.STATUS):0);\n`, { mode: 0o755 });
    const report = path.join(dir, 'reports', 'image');
    const result = spawnSync('/bin/bash', [script, 'fixture@sha256:123', report, platform], {
      env: { ...process.env, PATH: dir + ':' + process.env.PATH, CALLS: path.join(dir, 'calls'), STATUS: String(status) }, encoding: 'utf8'
    });
    assert.equal(result.status, status, result.stderr);
    assert.ok(fs.existsSync(report + '.cdx.json'));
    const calls = fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes('HIGH,CRITICAL'));
    assert.equal(calls[1].at(-1), 'fixture@sha256:123');
    if (platform) assert.equal(calls[1][calls[1].indexOf('--platform') + 1], platform);
    else assert.ok(!calls[1].includes('--platform'));
  });
}
