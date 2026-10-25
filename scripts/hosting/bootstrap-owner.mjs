/* Run only in the isolated bootstrap container. Credentials go only to stdout. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const data = process.env.DATA_DIR || '/data';
const lock = path.join(data, '.bootstrap-lock');
let acquired = false, child;
try {
  const origin = new URL(process.env.ORIGIN);
  if (origin.protocol !== 'https:' || origin.hostname !== process.env.RP_ID || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('Set matching HTTPS ORIGIN and RP_ID before bootstrap');
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(lock, { mode: 0o700 }); acquired = true; }
  catch { throw new Error('Bootstrap already running or its lock needs operator recovery'); }
  if (fs.readdirSync(data).some(name => name !== '.bootstrap-lock'))
    throw new Error('Bootstrap requires a fresh empty data volume; existing data was left unchanged');
  const name = 'Owner', password = crypto.randomBytes(32).toString('base64url');
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.env.API_DIR || '/app', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', PASSWORD_LOGIN: '1', FIRST_USER_ADMIN: '1', INVITE_ONLY: '0', COACH_DISABLED: '1', ALLOW_GUEST: '0' }
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', terminate); process.once('SIGTERM', terminate);
  child.stderr.pipe(process.stderr);
  const port = await new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error('Bootstrap API did not start')), 20000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Bootstrap API exited before readiness')); });
    child.stdout.on('data', chunk => {
      process.stderr.write(chunk);
      seen = (seen + chunk).slice(-4096);
      const match = /gym-api on :(\d+)/.exec(seen);
      if (match) { clearTimeout(timer); resolve(+match[1]); }
    });
  });
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/register/password`, {
      method: 'POST', headers: { Origin: origin.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }), signal: AbortSignal.timeout(15000)
    });
    const result = await r.json();
    const db = JSON.parse(fs.readFileSync(path.join(data, 'db.json'), 'utf8'));
    if (r.status !== 200 || !result.user?.admin || !result.user?.owner || db.users?.length !== 1 || db.users[0].id !== result.user.id || !db.users[0].owner || !db.users[0].admin || !db.users[0].pw?.h)
      throw new Error('Owner bootstrap verification failed; do not publish this instance');
  } finally {
    child.kill('SIGTERM');
    await exited;
    process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate);
  }
  process.stdout.write(JSON.stringify({ name, password, origin: origin.origin }) + '\n');
} catch (error) {
  child?.kill('SIGTERM');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (acquired) fs.rmdirSync(lock);
}
