/* Private JSON must remain private across startup, atomic rewrites and audit retention.
 * Run the real API with a permissive umask: the mode must be the app's policy, not the host's. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'e'.repeat(64);
const USER = 'u_permissions';
const mode = file => fs.statSync(file).mode & 0o777;
const cookie = () => {
  const payload = `${USER}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

async function start(t, { legacy = false, auditMax = 5000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-private-'));
  fs.chmodSync(dir, 0o755); // A traversable bind mount must not expose the files inside it.
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o644 });
  const db = { users: [{ id: USER, name: 'Private', created: new Date().toISOString() }], creds: [], subs: [], invites: [] };
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db), { mode: 0o644 });
  if (legacy) {
    fs.writeFileSync(path.join(dir, 'db.json.bak'), JSON.stringify(db), { mode: 0o644 });
    fs.writeFileSync(path.join(dir, `state-${USER}.json`), '{"_rev":1,"workouts":[]}', { mode: 0o644 });
    fs.writeFileSync(path.join(dir, 'state-deleted-user.json'), '{"bodyweight":[{"w":80}]}', { mode: 0o644 });
    fs.writeFileSync(path.join(dir, `state-${USER}.json.tmp`), 'stale private bytes', { mode: 0o644 });
    fs.writeFileSync(path.join(dir, 'coach.json'), '{}', { mode: 0o644 });
    fs.writeFileSync(path.join(dir, 'coach-auth-u_old.json'), '{"token":"fixture-only"}', { mode: 0o644 });
    fs.writeFileSync(path.join(dir, 'audit.log'), JSON.stringify({ id: 1, ev: 'fixture', ts: Date.now() }) + '\n', { mode: 0o644 });
  }
  const child = spawn(process.execPath, ['--input-type=module', '-e', 'process.umask(0o022); await import("./server.js");'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATA_DIR: dir, PORT: '0', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', AUDIT_MAX: String(auditMax), AUDIT_DAYS: '0', AUDIT_LOG: '1' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return { dir, url };
}

const save = (h, state, baseRev) => fetch(`${h.url}/api/data`, {
  method: 'PUT', headers: { Cookie: cookie(), Origin: 'http://localhost:8080', 'Content-Type': 'application/json' },
  body: JSON.stringify({ state, baseRev })
});

test('startup restricts legacy state, backup, audit and credential files without sealing the bind mount', async t => {
  const h = await start(t, { legacy: true });
  for (const name of ['secret', 'db.json', 'db.json.bak', `state-${USER}.json`, 'state-deleted-user.json', `state-${USER}.json.tmp`, 'coach.json', 'coach-auth-u_old.json', 'audit.log']) {
    assert.equal(mode(path.join(h.dir, name)), 0o600, `${name} must not be readable by the coach uid`);
  }
  assert.equal(mode(h.dir), 0o755, 'the host still owns the directory policy');
  assert.equal(fs.readFileSync(path.join(h.dir, 'state-deleted-user.json'), 'utf8'), '{"bodyweight":[{"w":80}]}');
});

test('new profile state stays private on every atomic replacement, including a permissive stale temp file', async t => {
  const h = await start(t);
  assert.equal((await save(h, { workouts: [], routines: [], unit: 'kg' }, 0)).status, 200);
  const file = path.join(h.dir, `state-${USER}.json`);
  assert.equal(mode(file), 0o600);
  fs.writeFileSync(file + '.tmp', 'stale', { mode: 0o644 });
  assert.equal((await save(h, { workouts: [], routines: [], unit: 'lb' }, 1)).status, 200);
  assert.equal(mode(file), 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).unit, 'lb');
});

test('audit creation, append and retention compaction never expose logged identities', async t => {
  const h = await start(t, { auditMax: 1 });
  for (let i = 0; i < 3; i++) {
    assert.equal((await fetch(`${h.url}/api/logout`, { method: 'POST', headers: { Cookie: cookie(), Origin: 'http://localhost:8080' } })).status, 200);
    assert.equal(mode(path.join(h.dir, 'audit.log')), 0o600);
  }
  const rows = fs.readFileSync(path.join(h.dir, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1, 'retention still compacts the log');
  assert.equal(rows[0].uid, USER);
});


test('the Linux coach uid cannot read migrated profiles, audit entries or credentials', {
  skip: process.platform !== 'linux' || process.getuid?.() !== 0
}, async t => {
  const row = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find(line => line.startsWith('coach:'));
  assert.ok(row, 'run this test inside the API image with its coach user');
  const [, , uid, gid] = row.split(':');
  const h = await start(t, { legacy: true });
  for (const name of [`state-${USER}.json`, 'state-deleted-user.json', 'audit.log', 'db.json.bak', 'coach-auth-u_old.json']) {
    const code = `try { require('node:fs').readFileSync(process.argv[1]); process.exit(2); } catch (error) { process.exit(error.code === 'EACCES' ? 0 : 3); }`;
    const child = spawn(process.execPath, ['-e', code, path.join(h.dir, name)], { uid: +uid, gid: +gid, stdio: 'ignore' });
    const exit = await new Promise(resolve => child.on('close', resolve));
    assert.equal(exit, 0, `${name} must be unreadable by the runtime uid`);
  }
});
