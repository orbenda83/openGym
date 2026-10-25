import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const api = fileURLToPath(new URL('..', import.meta.url));
const helper = fileURLToPath(new URL('../../scripts/hosting/bootstrap-owner.mjs', import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-bootstrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function bootstrap(dir) {
  return spawnSync(process.execPath, [helper], { cwd: api, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, DATA_DIR: dir, API_DIR: api, ORIGIN: 'https://gym.example.com', RP_ID: 'gym.example.com' } });
}
test('bootstrap creates exactly one durable owner via the real API; stdout contains only credentials', t => {
  const dir = fixture(t), r = bootstrap(dir);
  assert.equal(r.status, 0, r.stderr);
  const credentials = JSON.parse(r.stdout);
  assert.equal(credentials.name, 'Owner');
  assert.ok(credentials.password.length >= 40);
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json')));
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].admin, true);
  assert.equal(db.users[0].owner, true);
  assert.ok(db.users[0].pw.h);
  assert.ok(!fs.readFileSync(path.join(dir, 'db.json'), 'utf8').includes(credentials.password));
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-lock')), false);
  const again = bootstrap(dir);
  assert.notEqual(again.status, 0);
  assert.equal(again.stdout, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).users.length, 1);
});
for (const name of ['db.json', 'db.json.bak', 'secret']) test(`bootstrap refuses residual ${name} without creating credentials`, t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, name), name === 'secret' ? 'residual' : '{bad json');
  const before = fs.readFileSync(path.join(dir, name));
  const r = bootstrap(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fresh empty data volume|Bootstrap already running/);
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readFileSync(path.join(dir, name)), before);
});
test('an existing bootstrap lock prevents a second writer', t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, '.bootstrap-lock'));
  const r = bootstrap(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fresh empty data volume|Bootstrap already running/);
  assert.equal(r.stdout, '');
  assert.equal(fs.existsSync(path.join(dir, 'db.json')), false);
  assert.equal(fs.existsSync(path.join(dir, '.bootstrap-lock')), true);
});
