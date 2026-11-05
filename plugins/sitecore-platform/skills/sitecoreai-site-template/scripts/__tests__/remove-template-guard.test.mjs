// remove-template deletes the module roots recursively (deleteItem). A root that also holds items the generator did not create
// (hand-made Components/ templates, a second site template in the same module) must be refused unless --force.
// Found in a field review on 2026-10-24: a module template root held hand-made templates.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../remove-template.mjs';

const SPEC = { name: 'Acme', module: 'acme', description: 'd', renderingHost: 'h', homeType: 'Landing',
  pageTypes: [{ name: 'Landing' }, { name: 'Article' }], partials: [], pages: [{ path: '' }] };
const PT = '/sitecore/templates/Project/acme';
const SETTINGS = '/sitecore/system/Settings/Project/acme';

async function withStub(tree, fn, { sites = [], pageSize = 0 } = {}) {
  const deleted = [];
  const ids = new Map(Object.keys(tree).map((p, i) => [p, `AAAAAAAA-0000-0000-0000-${String(i).padStart(12, '0')}`]));
  const node = p => ({ itemId: ids.get(p), name: p.split('/').pop(), path: p, template: { name: 't', templateId: 'T' } });
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const { query, variables } = JSON.parse(body);
      const out = d => res.end(JSON.stringify({ data: d }));
      if (query.includes('solutionSites')) return out({ solutionSites: sites });
      if (query.includes('solutionTemplates')) return out({ solutionTemplates: [] });
      if (query.includes('deleteItem')) { deleted.push([...ids].find(([, v]) => v === variables.i.itemId)[0]); return out({ deleteItem: { successful: true } }); }
      if (query.includes('children(')) {
        if (!tree[variables.p]) return out({ item: null });
        const from = Number(variables.a || 0), names = tree[variables.p], to = pageSize ? from + pageSize : names.length;
        return out({ item: { children: { nodes: names.slice(from, to).map(n => node(`${variables.p}/${n}`)), pageInfo: { hasNextPage: to < names.length, endCursor: String(to) } } } });
      }
      const p = variables.w ?? [...ids].find(([, v]) => v === variables.i)?.[0];
      return out({ item: tree[p] ? node(p) : null });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, deleted); }
  finally { await new Promise(r => server.close(r)); }
}
const specFile = (spec = SPEC) => { const f = join(mkdtempSync(join(tmpdir(), 'rt-')), 'spec.json'); writeFileSync(f, JSON.stringify(spec)); return f; };
const run = (host, extra = [], { log = () => {}, spec } = {}) => main(['--spec', specFile(spec), '--cm-host', host, '--client-prefix', 'X', ...extra], { log, mint: async () => 'tok' });

const clean = { [PT]: ['Landing', 'Article'], [`${PT}/Landing`]: [], [`${PT}/Article`]: [], [SETTINGS]: ['Acme Setup', 'Templates'] };

test('a module root holding only generator-created page types is deleted', async () => {
  process.env.X_ID = 'i'; process.env.X_SECRET = 's';
  await withStub(clean, async (host, deleted) => {
    await run(host);
    assert.ok(deleted.includes(PT));
  });
});

test('a hand-made template under the module root blocks the delete (exit 1, nothing at that root deleted)', async () => {
  await withStub({ ...clean, [PT]: ['Landing', 'Article', 'Components'], [`${PT}/Components`]: [] }, async (host, deleted) => {
    const code = await run(host);
    assert.equal(code, 1);
    assert.ok(!deleted.includes(PT), 'the module template root survives');
    assert.deepEqual(deleted, [], 'refused before any mutation');
  });
});

test('--force overrides the foreign-item guard', async () => {
  await withStub({ ...clean, [PT]: ['Landing', 'Article', 'Components'], [`${PT}/Components`]: [] }, async (host, deleted) => {
    await run(host, ['--force']);
    assert.ok(deleted.includes(PT));
  });
});

const SCRIPTS = '/sitecore/system/Modules/PowerShell/Script Library/Acme';
const TEMPLATES = `${SETTINGS}/Templates`;
const owned = { ...clean, [TEMPLATES]: ['Acme'], [`${TEMPLATES}/Acme`]: [], [SCRIPTS]: ['Functions'],
  [`${SCRIPTS}/Functions`]: ['Acme Site Setup', 'Acme Configure Rendering Host'] };

test('everything the generator created is removed without --force', async () => {
  await withStub(owned, async (host, deleted) => {
    assert.equal(await run(host), 0);
    assert.ok(deleted.includes(SCRIPTS) && deleted.includes(SETTINGS));
  });
});

test('an invalid spec exits 2 before anything is read or deleted', async () => {
  await withStub(owned, async (host, deleted) => {
    const lines = [];
    assert.equal(await run(host, [], { spec: { name: 'Acme' }, log: l => lines.push(l) }), 2);
    assert.ok(lines.some(l => l.startsWith('ERROR module')), lines.join('|'));
    assert.deepEqual(deleted, []);
  });
});

for (const [what, tree, blocker] of [
  ['a foreign library under the script root', { ...owned, [SCRIPTS]: ['Functions', 'Hand Made Library'] }, `${SCRIPTS}/Hand Made Library`],
  ['a foreign script in Functions', { ...owned, [`${SCRIPTS}/Functions`]: ['Acme Site Setup', 'Someone Else Script'] }, `${SCRIPTS}/Functions/Someone Else Script`],
  ['another template under Templates', { ...owned, [TEMPLATES]: ['Acme', 'Someone Else Template'] }, `${TEMPLATES}/Someone Else Template`],
]) {
  test(`${what} blocks the delete; --force overrides`, async () => {
    await withStub(tree, async (host, deleted) => {
      const lines = [];
      assert.equal(await run(host, [], { log: l => lines.push(l) }), 1);
      assert.ok(lines.join('\n').includes(blocker), lines.join('|'));
      assert.deepEqual(deleted, []);
      await run(host, ['--force']);
      assert.ok(deleted.length > 0);
    });
  });
}

test('a spec named like an installed script module does not delete that module', async () => {
  const spe = '/sitecore/system/Modules/PowerShell/Script Library/SPE';
  await withStub({ [spe]: ['Core', 'Tools'] }, async (host, deleted) => {
    assert.equal(await run(host, [], { spec: { ...SPEC, name: 'SPE' } }), 1);
    assert.deepEqual(deleted, []);
  });
});

test('a foreign item past the first page of children is still seen', async () => {
  const many = ['Landing', 'Article'];
  await withStub({ ...owned, [SCRIPTS]: ['Functions', 'A', 'B', 'Past The First Page'], [PT]: many }, async (host, deleted) => {
    const lines = [];
    assert.equal(await run(host, [], { log: l => lines.push(l) }), 1);
    assert.ok(lines.join('\n').includes('Past The First Page'), lines.join('|'));
    assert.deepEqual(deleted, []);
  }, { pageSize: 1 });
});

test('a thumbnail of a name with punctuation is not a false refusal', async () => {
  const MEDIA = '/sitecore/media library/Project/acme';
  await withStub({ ...owned, [MEDIA]: ['Acme  Co Site Preview'], [SCRIPTS]: [], [TEMPLATES]: [] }, async (host) => {
    const lines = [];
    await run(host, [], { spec: { ...SPEC, name: 'Acme & Co.' }, log: l => lines.push(l) });
    assert.ok(!lines.some(l => l.includes('Site Preview') && l.startsWith('REFUSED')), lines.join('|'));
  });
});

test('site guard: a site made from the template refuses; --force goes on and names it', async () => {
  const TPL = `${TEMPLATES}/Acme`;
  const tree = { ...owned };
  const ids = Object.keys(tree);
  const tplId = `AAAAAAAA-0000-0000-0000-${String(ids.indexOf(TPL)).padStart(12, '0')}`;
  const sites = [{ name: 'live-site', rootItem: { path: '/x', field: { value: tplId } } }, { name: 'other', rootItem: { path: '/y', field: { value: 'OTHER' } } }];
  await withStub(tree, async (host, deleted) => {
    const lines = [];
    assert.equal(await run(host, [], { log: l => lines.push(l) }), 1);
    assert.ok(lines.some(l => l.startsWith('REFUSED 1 site') && l.includes('live-site') && !l.includes('other')), lines.join('|'));
    assert.deepEqual(deleted, []);
    lines.length = 0;
    await run(host, ['--force'], { log: l => lines.push(l) });
    assert.ok(lines.some(l => l.startsWith('WARN') && l.includes('live-site')), lines.join('|'));
    assert.ok(deleted.includes(TPL));
  }, { sites });
});
