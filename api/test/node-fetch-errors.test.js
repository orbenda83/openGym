/* A rejected provider response must not kill the process outside fetch's rejection handler. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = fileURLToPath(new URL('..', import.meta.url));

test('excess content codings and a truncated body do not crash a caller that catches fetch rejection', async t => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 10\r\nContent-Encoding: gzip, br, deflate, gzip, br, deflate\r\nConnection: close\r\n\r\n'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const code = `import { fetchFor } from './coach/node-fetch.js';
    try { await fetchFor(60000)(process.argv[1]); } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('survived');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, `http://127.0.0.1:${server.address().port}`], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => err += d);
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  t.after(() => { clearTimeout(timer); child.kill('SIGKILL'); });
  const exit = await new Promise(resolve => child.on('close', resolve));
  assert.equal(exit, 0, err);
  assert.match(out, /survived/);
});
