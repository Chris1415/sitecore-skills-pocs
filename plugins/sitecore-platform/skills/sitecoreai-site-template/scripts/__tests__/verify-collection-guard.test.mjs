// Offline gate for verify-template --smoke cleanup: a collection is removed only when THIS run created it.
// A local node:http stub plays the Authoring GraphQL endpoint; the token mint and settle delays are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, stampedName } from '../verify-template.mjs';

const SPEC = { name: 'Acme', module: 'acme', description: 'd', renderingHost: 'nextjsstarter', homeType: 'Landing',
  pageTypes: [{ name: 'Landing' }], partials: [], pages: [{ path: '' }] };
const TPL = 'AAAAAAAA-0000-0000-0000-000000000001';

async function withStub(preexisting, fn) {
  const state = { collections: preexisting.map((name, i) => ({ id: `C${i}`, name })), sites: [], removedCollections: [], removedSites: [], createdCollections: [], createdSites: [], failRemove: false, failCreateSite: false, jobExceptions: '[]', jobGone: false };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const { query, variables } = JSON.parse(body);
      const out = d => res.end(JSON.stringify({ data: d }));
      if (query.includes('solutionSites')) return out({ solutionSites: state.sites });
      if (query.includes('solutionTemplates')) return out({ solutionTemplates: [{ id: TPL, name: 'Acme', enabled: true, thumbnailUrl: null }] });
      if (query.includes('createSiteCollection(')) { state.createdCollections.push(variables.i.name); state.collections.push({ id: `N${state.collections.length}`, name: variables.i.name }); return out({ createSiteCollection: { job: { handle: 'h' } } }); }
      if (query.includes('siteCollections')) return out({ siteCollections: state.collections });
      if (query.includes('createSite(')) {
        if (state.failCreateSite) return res.end(JSON.stringify({ errors: [{ message: 'createSite refused' }] }));
        state.createdSites.push(variables.i.siteName);
        return out({ createSite: { job: { handle: 'j' } } });
      }
      if (query.includes('job(')) return out(state.jobGone ? { job: null } : { job: { done: true, status: { jobState: 'FINISHED', exceptions: state.jobExceptions, messages: [] } } });
      if (state.failRemove && query.includes('removeSite')) return res.end(JSON.stringify({ errors: [{ message: 'remove refused' }] }));
      if (query.includes('removeSiteCollection(')) { state.removedCollections.push(variables.i.id); return out({ removeSiteCollection: { job: { handle: 'r' } } }); }
      if (query.includes('removeSite(')) { state.removedSites.push(variables.i.siteName); return out({ removeSite: { job: { handle: 'r' } } }); }
      // Any item(where:) read: a generic item that satisfies the spec's one Home page and the rendering-host check.
      const fields = [{ name: 'RenderingHost', value: 'nextjsstarter' }];
      return out({ item: { itemId: TPL, name: 'x', path: '/x', template: { name: 'Landing', templateId: 'T' }, fields: { nodes: fields },
        f: { value: '' }, s: { value: '' }, insertOptions: [{ name: 'Landing' }] } });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, state); }
  finally { await new Promise(r => server.close(r)); }
}

const specFile = () => { const f = join(mkdtempSync(join(tmpdir(), 'vt-')), 'spec.json'); writeFileSync(f, JSON.stringify(SPEC)); return f; };
const NOW = new Date('2026-11-04T15:30:00Z');
const run = (host, extra, log = () => {}) => main(['--spec', specFile(), '--cm-host', host, '--client-prefix', 'X', '--smoke', ...extra],
  { log, mint: async () => 'tok', sleep: async () => {}, now: () => NOW });

test('(1) a collection this run created is removed together with the site', async () => {
  await withStub([], async (host, st) => {
    const code = await run(host, []);
    assert.equal(code, 0);
    assert.equal(st.createdCollections.length, 1);
    assert.equal(st.removedSites.length, 1);
    assert.equal(st.removedCollections.length, 1);
  });
});

test('(2) --collection without --keep is refused (exit 2) and nothing is mutated', async () => {
  await withStub(['shared'], async (host, st) => {
    const code = await run(host, ['--collection', 'shared']);
    assert.equal(code, 2);
    assert.deepEqual([st.removedSites, st.removedCollections, st.createdCollections], [[], [], []]);
  });
});

test('(3) --collection --keep on an existing collection never removes it', async () => {
  await withStub(['shared'], async (host, st) => {
    const code = await run(host, ['--collection', 'shared', '--keep']);
    assert.equal(code, 0);
    assert.deepEqual(st.removedCollections, []);
    assert.deepEqual(st.removedSites, []);
  });
});

test('(4) a pre-existing collection that was reused is not removed even when cleanup runs', async () => {
  // The auto-generated name collides with an existing collection: this run did not create it, so it must stay.
  await withStub([], async (host, st) => {
    st.collections.push({ id: 'PRE', name: 'zz-verify-acme-11041530' });
    const code = await run(host, []);
    assert.equal(code, 0);
    assert.deepEqual(st.createdCollections, []);
    assert.deepEqual(st.removedCollections, []);
    assert.equal(st.removedSites.length, 1);
  });
});

test('(5) --site-name without --keep is refused (exit 2) and nothing is mutated', async () => {
  await withStub([], async (host, st) => {
    const lines = [];
    assert.equal(await run(host, ['--site-name', 'prod-site'], l => lines.push(l)), 2);
    assert.match(lines.join('\n'), /--site-name must be paired with --keep/);
    assert.deepEqual([st.createdCollections, st.createdSites, st.removedSites, st.removedCollections], [[], [], [], []]);
  });
});

test('(6) a site name that already exists is refused before anything is created, whatever the case', async () => {
  await withStub([], async (host, st) => {
    st.sites.push({ name: 'Prod-Site' });
    assert.equal(await run(host, ['--site-name', 'prod-site', '--keep']), 2);
    assert.deepEqual([st.createdCollections, st.createdSites, st.removedSites], [[], [], []]);
  });
});

test('(7) a generated name that collides with an existing site is refused and that site is not removed', async () => {
  await withStub([], async (host, st) => {
    st.sites.push({ name: 'verify-acme-11041530' });
    st.jobExceptions = 'site already exists';
    assert.equal(await run(host, []), 2);
    assert.deepEqual([st.createdSites, st.removedSites, st.createdCollections], [[], [], []]);
  });
});

test('(8) createSite failing removes the collection this run created but no site', async () => {
  await withStub([], async (host, st) => {
    st.failCreateSite = true;
    assert.equal(await run(host, []), 1);
    assert.deepEqual(st.removedSites, []);
    assert.equal(st.removedCollections.length, 1);
  });
});

test('(9) cleanup says so when the removal calls failed', async () => {
  await withStub([], async (host, st) => {
    st.failRemove = true;
    const lines = [];
    await run(host, [], l => lines.push(l));
    const out = lines.find(l => l.startsWith('cleanup:'));
    assert.match(out, /site verify-acme-11041530 NOT removed/);
    assert.match(out, /collection zz-verify-acme-11041530 NOT removed/);
  });
});

test('(10) generated names keep the stamp when a long module name is cut', () => {
  const long = 'm'.repeat(80);
  const site = stampedName('verify', long, '11041530', 60);
  assert.equal(site.length, 60);
  assert.ok(site.endsWith('-11041530'));
  const coll = stampedName('zz-verify', long, '11041530', 50);
  assert.equal(coll.length, 50);
  assert.ok(coll.endsWith('-11041530'));
  assert.equal(stampedName('verify', 'acme', '11041530', 60), 'verify-acme-11041530');
});

test('(11) a scaffold job that is gone fails the smoke instead of passing', async () => {
  await withStub([], async (host, st) => {
    st.jobGone = true;
    const lines = [];
    assert.equal(await run(host, [], l => lines.push(l)), 1);
    assert.ok(lines.some(l => l.startsWith('FAIL') && l.includes('gone or timed out')), lines.join('|'));
  });
});

test('(12) VERIFIED says so when the Edge preview check was skipped', async () => {
  await withStub([], async (host) => {
    const lines = [];
    assert.equal(await run(host, [], l => lines.push(l)), 0);
    assert.equal(lines.at(-1), 'VERIFIED (Edge preview NOT checked: no --environment-id)');
    lines.length = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => (String(url).startsWith('http://127.0.0.1') ? realFetch(url, init) : Promise.resolve(new Response('{}')));
    try { assert.equal(await run(host, ['--environment-id', 'E'], l => lines.push(l)), 0); }
    finally { globalThis.fetch = realFetch; }
    assert.equal(lines.at(-1), 'VERIFIED (Edge preview NOT checked: no previewContextId from the Deploy API)');
  });
});
