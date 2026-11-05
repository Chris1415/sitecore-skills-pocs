// The mock Edge binds to loopback only, and a broken fixture answers 500 instead of killing the server mid-proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOCK = join(dirname(fileURLToPath(import.meta.url)), '..', 'mock-edge.mjs');
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
async function withMock(routes, documents, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mock-'));
  writeFileSync(join(dir, 'routes.json'), routes);
  writeFileSync(join(dir, 'documents.json'), documents);
  const port = await freePort();
  const child = spawn(process.execPath, [MOCK, '--dir', dir, '--port', String(port), '--site', 's'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('exit', c => reject(new Error('mock exited ' + c))); });
    await fn('http://127.0.0.1:' + port, port, dir);
  } finally { child.removeAllListeners('exit'); child.kill(); }
}
const layout = base => fetch(base, { method: 'POST', body: JSON.stringify({ query: 'query{layout(site:"s",routePath:"/"){item{rendered}}}', variables: { itemPath: '/' } }) });

test('a Document is served as text/plain, an unknown one is 404', async () => {
  await withMock('{}', '{"ref":{"name":"d"}}', async base => {
    const ok = await fetch(base + '/mms/ref');
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /text\/plain/);
    assert.equal((await fetch(base + '/mms/none')).status, 404);
  });
});

test('a bad fixture answers 500 and the mock survives, on both routes', async () => {
  await withMock('{not json', '{not json', async (base, port, dir) => {
    assert.equal((await fetch(base + '/mms/ref')).status, 500);
    assert.equal((await layout(base)).status, 500);
    writeFileSync(join(dir, 'documents.json'), '{"ref":{"name":"d"}}');
    assert.equal((await fetch(base + '/mms/ref')).status, 200, 'the fixed fixture is picked up without a restart');
  });
});

test('it listens on 127.0.0.1 only', async () => {
  await withMock('{}', '{}', async (base, port) => {
    assert.equal((await fetch(base + '/mms/x')).status, 404);
    const v6 = await new Promise(r => { const s = net.connect({ host: '::1', port }); s.once('connect', () => { s.destroy(); r('open'); }); s.once('error', () => r('closed')); });
    assert.equal(v6, 'closed');
  });
});
