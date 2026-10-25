// An attended class round-trips through the real API without fabricated strength entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

// ---- the real server -------------------------------------------------------------------------
const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
test('Pilates class metadata survives persisted API PUT/GET without strength entries', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-class-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const headers = { Cookie: `gymsid=${mintSession('u1')}`, 'Content-Type': 'application/json' };
  const { buildClassSession } = await import('../../frontend/src/lib/class-session.js');
  const workout = buildClassSession({ date: '2026-01-02', durationMin: 45, attended: true, notes: 'Variable class' }, { id: 'class1' });
  const put = await fetch(`${base}/api/data`, { method: 'PUT', headers, body: JSON.stringify({ state: { workouts: [workout], routines: [] }, baseRev: 0 }) });
  assert.equal(put.status, 200);
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'state-u1.json'), 'utf8'));
  assert.deepEqual(persisted.workouts[0], workout);
  const get = await fetch(`${base}/api/data`, { headers });
  assert.equal(get.status, 200);
  const restored = await get.json();
  assert.deepEqual(restored.state.workouts[0], workout);
});
