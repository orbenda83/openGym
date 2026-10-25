/* Credentials on stdin, summary only on stdout. Runs inside the disposable restored API. */
import fs from 'node:fs';
try {
  const credentials = JSON.parse(fs.readFileSync(0, 'utf8'));
  const base = 'http://127.0.0.1:3000';
  const r = await fetch(base + '/api/login/password', {
    method: 'POST', headers: { Origin: process.env.ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: credentials.name, password: credentials.password }), signal: AbortSignal.timeout(15000)
  });
  if (r.status !== 200) throw new Error('Restored password sign-in failed; use current credentials and an enabled password method');
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Restored API did not issue a session');
  const data = await fetch(base + '/api/data', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) });
  if (data.status !== 200) throw new Error('Restored profile could not be read');
  const { state } = await data.json();
  const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? walk(dir + '/' + d.name) : d.isFile() && !d.name.startsWith('.') ? 1 : 0), 0) : 0;
  console.log(JSON.stringify({ authenticated: true, workouts: state?.workouts?.length || 0, mediaFiles: walk('/data/uploads') }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
