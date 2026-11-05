// Mutation test of the read-only guard (a guard nothing can turn red is not a guard). Each line tagged
// GUARD:<name> in lib/http.mjs is removed in a temp copy; that guard's probe must pass on the original and FAIL
// on the mutant. Every tagged line needs a probe, so a new guard cannot ship untested. The network is never
// touched: every probe runs against an injected fetch double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'http.mjs');
const source = readFileSync(SRC, 'utf8');
const AGQL = 'https://xmc-demo.sitecorecloud.io/sitecore/api/authoring/graphql/v1';
const throwsRO = (fn) => { try { fn(); return false; } catch (e) { return e.code === 'READ_ONLY' || e instanceof RangeError; } };
const fakeFetch = (log) => async (url, init) => { log.push({ url, init, t: Date.now() }); return new Response('ok', { status: 200 }); };

/** probe(mod) -> true when the guard DID its job. */
const PROBES = {
  verb: (m) => throwsRO(() => m.guard({ method: 'DELETE', url: 'https://xmclouddeploy-api.sitecorecloud.io/api/x' })),
  'edge-admin-content': (m) => throwsRO(() => m.guard({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/webhooks/content' })),
  'edge-admin-allowlist': (m) => throwsRO(() => m.guard({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/cache' })),
  'token-grant': (m) => throwsRO(() => m.guard({ method: 'POST', url: m.TOKEN_URL, body: 'grant_type=password' })),
  'gql-shape': (m) => throwsRO(() => m.guard({ method: 'POST', url: AGQL, body: '[]' })), // an empty batch carries no document to parse
  'gql-unparseable': (m) => throwsRO(() => m.guard({ method: 'POST', url: AGQL, body: JSON.stringify({ query: '' }) })),
  'gql-mutation': (m) => throwsRO(() => m.guard({ method: 'POST', url: AGQL, body: JSON.stringify({ query: 'mutation { deleteItem(input:{}){ successful } }' }) })),
  'revalidate-json': (m) => throwsRO(() => m.guard({ method: 'POST', url: 'https://s.example/api/revalidate', body: '{}' })),
  'revalidate-headers': (m) => throwsRO(() => m.guard({ method: 'POST', url: 'https://s.example/api/revalidate', body: 'x', headers: { 'x-revalidate-secret': 'y' } })),
  'post-allowlist': (m) => throwsRO(() => m.guard({ method: 'POST', url: 'https://xmclouddeploy-api.sitecorecloud.io/api/environments/v1/x/restart', body: '' })),
  'rate-cap': (m) => throwsRO(() => m.setRate('edge', 500)),
  redirect: async (m) => { const log = []; m._setFetchForTests(fakeFetch(log)); await m.request('https://s.example/'); return log[0].init.redirect === 'manual'; },
  throttle: async (m) => { const log = []; m._setFetchForTests(fakeFetch(log)); m.setRate('default', 5); for (let i = 0; i < 3; i++) await m.request('https://s.example/'); return log[2].t - log[0].t >= 350; },
};

const tagged = [...source.matchAll(/GUARD:([a-z-]+)/g)].map((x) => x[1]);

test('every GUARD-tagged line has a probe, and every probe a tagged line', () => {
  assert.deepEqual([...new Set(tagged)].sort(), Object.keys(PROBES).sort());
  assert.equal(tagged.length, new Set(tagged).size, 'a GUARD name is used twice');
});

const dir = mkdtempSync(join(tmpdir(), 'hc-mutation-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

for (const name of Object.keys(PROBES)) {
  test(`guard ${name}: probe passes on the original, fails on the mutant`, async () => {
    const orig = await import(`${pathToFileURL(SRC).href}?orig=${name}`);
    assert.equal(await PROBES[name](orig), true, `probe ${name} fails on the ORIGINAL module`);
    const lines = source.split('\n'); const idx = lines.findIndex((l) => l.includes(`GUARD:${name}`));
    lines.splice(idx, 1);
    const p = join(dir, `http-${name}.mjs`); writeFileSync(p, lines.join('\n'));
    const mut = await import(pathToFileURL(p).href);
    assert.equal(await PROBES[name](mut), false, `mutant without GUARD:${name} survived: the probe cannot see this guard`);
  });
}
