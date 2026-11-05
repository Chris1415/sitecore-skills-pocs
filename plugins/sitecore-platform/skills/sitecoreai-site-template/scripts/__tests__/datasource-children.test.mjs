// (2026-10-24 field test): a datasource is more than one item. `datasource.children` creates child rows under it and
// `datasource.insertOptions` writes the datasource item's __Masters so authors can add rows in Pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSpec, validateBlueprintSpec, renderingPath } from '../lib/spec.mjs';
import { emitSiteSetup } from '../lib/emit-ps.mjs';
import { buildLayoutXml } from '../lib/layout.mjs';
import { resolveDatasourceExtras, checkDatasourceExtras, countChildren } from '../lib/children.mjs';
import { main as removeMain } from '../remove-template.mjs';

const GALLERY = renderingPath('Page Content/Gallery');
const TILE = '/sitecore/templates/Project/Brand/Components/Gallery Tile';
const TILE_ID = '{11111111-1111-1111-1111-111111111111}';
const FINISH = '/sitecore/templates/Project/Brand/Components/Finish';
const FINISH_ID = '{22222222-2222-2222-2222-222222222222}';

const ds = () => ({ name: 'Gallery', fields: { Heading: 'Frames' }, insertOptions: [TILE],
  children: [
    { name: 'Frame 1', fields: { Caption: "it's front" } },
    { name: 'Frame 2', template: FINISH, fields: { Caption: 'rear' }, children: [{ name: 'Detail', fields: { Caption: 'd' } }] },
  ] });
const spec = () => ({
  name: 'Acme', module: 'acme', description: 'd', renderingHost: 'h', homeType: 'Landing',
  pageTypes: [{ name: 'Landing' }],
  pages: [{ path: '', components: [{ rendering: 'Page Content/Gallery', datasource: ds() }] }],
  blueprints: [{ name: 'Campaign', type: 'Landing', components: [{ rendering: 'Page Content/Gallery', datasource: ds() }] }],
});
const resolved = { pageTypeIds: { Landing: '{L}' }, templateIds: { [TILE]: TILE_ID, [FINISH]: FINISH_ID },
  datasourceTemplates: { [GALLERY]: '{DDDDDDDD-0000-0000-0000-000000000000}' }, renderingIds: { [GALLERY]: '{R}' } };

test('spec: children default their template from a single insert option, get explicit __Sortorder, nest', () => {
  const { spec: s, errors, warnings } = validateSpec(spec());
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  const d = s.pages[0].components[0].datasource;
  assert.equal(d.children[0].template, TILE, 'single insertOptions entry is the default child template');
  assert.equal(d.children[1].template, FINISH, 'an explicit template wins');
  assert.equal(d.children[0].fields.__Sortorder, '100');
  assert.equal(d.children[1].fields.__Sortorder, '200');
  assert.equal(d.children[1].children[0].fields.__Sortorder, '100', 'sort order restarts per level');
  assert.equal(d.children[1].children[0].template, TILE);
});

test('spec: an explicit sortOrder or fields.__Sortorder is kept', () => {
  const s = spec();
  s.pages[0].components[0].datasource.children[0].sortOrder = 5;
  s.pages[0].components[0].datasource.children[1].fields.__Sortorder = '7';
  const d = validateSpec(s).spec.pages[0].components[0].datasource;
  assert.equal(d.children[0].fields.__Sortorder, '5');
  assert.equal(d.children[1].fields.__Sortorder, '7');
});

test('spec: lints what would fail or vanish', () => {
  const s = spec();
  const d = s.pages[0].components[0].datasource;
  d.insertOptions = [TILE, FINISH];               // two options: no default template
  d.children.push({ name: 'Frame 1', template: TILE });            // duplicate sibling
  d.children.push({ name: 'a/b', template: TILE });                // not item-safe
  d.children.push({ name: 'Typo', template: TILE, feilds: {} });   // unknown child key
  d.childs = [];                                                   // unknown datasource key
  d.children.push({ name: 'BadFields', template: TILE, fields: [] });
  const { errors, warnings } = validateSpec(s);
  for (const needle of ['no template', 'duplicate child "Frame 1"', 'item-safe', 'fields: object'])
    assert.ok(errors.some(e => e.includes(needle)), `expected error ${needle}; got ${errors.join(' | ')}`);
  assert.ok(warnings.some(w => w.includes('unknown key "feilds"')), warnings.join('|'));
  assert.ok(warnings.some(w => w.includes('unknown key "childs"')), warnings.join('|'));
  const bad = spec();
  bad.pages[0].components[0].datasource.insertOptions = 'x';
  assert.ok(validateSpec(bad).errors.some(e => e.includes('insertOptions')));
});

test('spec: a datasource without extras behaves exactly as before (no new warnings)', () => {
  const s = spec();
  delete s.pages[0].components[0].datasource.children; delete s.pages[0].components[0].datasource.insertOptions;
  const r = validateSpec(s);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.spec.pages[0].components[0].datasource.children, undefined);
});

test('emitter: Ensure-Datasource receives the child literal and the masters; typographic quotes stay escaped', () => {
  const ps = emitSiteSetup(validateSpec(spec()).spec, resolved);
  assert.match(ps, /function Ensure-Children\(\$parent, \[object\[\]\]\$children\)/);
  assert.match(ps, /function Ensure-Datasource\(\$owner, \[string\]\$name, \[string\]\$templatePath, \[hashtable\]\$values, \[object\[\]\]\$children = @\(\), \[string\[\]\]\$masters = @\(\)\)/);
  const call = ps.split('\n').find(l => l.includes("(Ensure-Datasource $pages[''] 'Gallery'"));
  assert.ok(call, 'page datasource call present');
  assert.ok(call.includes(`'Template' = '${TILE_ID}'`) && call.includes(`'Template' = '${FINISH_ID}'`), 'template refs resolved to ids');
  assert.ok(call.includes("'Caption' = 'it''s front'"), 'values go through psq');
  assert.ok(call.includes("'__Sortorder' = '100'") && call.includes("'__Sortorder' = '200'"));
  assert.ok(call.includes("'Name' = 'Detail'"), 'nested children emitted');
  assert.ok(call.trimEnd().endsWith(`@('${TILE_ID}'))`) || call.includes(`@('${TILE_ID}')`), 'masters are the resolved insert option ids');
  assert.doesNotMatch(call, /[‘’]/, 'no raw typographic quote reaches PowerShell');
});

test('emitter: a failing child is collected, not thrown mid-expression', () => {
  const ps = emitSiteSetup(validateSpec(spec()).spec, resolved);
  const fn = ps.slice(ps.indexOf('function Ensure-Children'), ps.indexOf('function Ensure-Datasource'));
  assert.match(fn, /try \{/);
  assert.match(fn, /\$failures\.Add/);
});

test('emitter: blueprint datasources get their children and masters inside the branch', () => {
  const ps = emitSiteSetup(validateSpec(spec()).spec, resolved);
  assert.match(ps, /\$bpDs = Ensure-Child \$bpData 'Gallery'/);
  assert.match(ps, /Set-Masters \$bpDs @\('\{11111111-1111-1111-1111-111111111111\}'\)/);
  assert.match(ps, /Ensure-Children \$bpDs @\(/);
});

test('emitter: without extras the generated call is unchanged', () => {
  const s = spec();
  delete s.pages[0].components[0].datasource.children; delete s.pages[0].components[0].datasource.insertOptions;
  delete s.blueprints;
  const ps = emitSiteSetup(validateSpec(s).spec, resolved);
  assert.ok(ps.includes("(Ensure-Datasource $pages[''] 'Gallery' '{DDDDDDDD-0000-0000-0000-000000000000}' @{ 'Heading' = 'Frames' })"));
});

test('layout: blueprint datasources carry children and insert options', () => {
  const { spec: s } = validateSpec(spec());
  const { datasources } = buildLayoutXml(s.blueprints[0].components, { [GALLERY]: '{R}' }, n => `{U${n}}`);
  assert.equal(datasources[0].children.length, 2);
  assert.deepEqual(datasources[0].insertOptions, [TILE]);
});

test('blueprint spec: same validation, warnings surfaced', () => {
  const r = validateBlueprintSpec({ site: 's', name: 'Camp', components: [{ rendering: 'Page Content/Gallery', datasource: { ...ds(), childs: [] } }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.blueprint.components[0].datasource.children[0].fields.__Sortorder, '100');
  assert.ok(r.warnings.some(w => w.includes('unknown key "childs"')));
});

// --- live pieces against a fake api ---
const fakeApi = (items, templateFields) => ({
  item: async p => items[p] ?? null,
  gql: async (q, v) => ({ itemTemplate: { fields: { nodes: (templateFields[v.id] || []).map(name => ({ name })) } } }),
});
const tplItem = id => ({ itemId: id, name: 't', path: '/t', template: { name: 'Template' } });

test('lint: resolves refs to ids and checks child fields against the child template', async () => {
  const api = fakeApi({ [TILE]: tplItem(TILE_ID), [FINISH]: tplItem(FINISH_ID) }, { [TILE_ID]: ['Caption'], [FINISH_ID]: ['Caption'] });
  const errors = [], warnings = [], res = { templateIds: {} };
  const d = validateSpec(spec()).spec.pages[0].components[0].datasource;
  await resolveDatasourceExtras(api, d, 'page Home', errors, warnings, res);
  assert.deepEqual(errors, []);
  assert.equal(res.templateIds[TILE], TILE_ID);
  d.children[0].fields.Capton = 'typo';
  await resolveDatasourceExtras(api, d, 'page Home', errors, warnings, res);
  assert.ok(errors.some(e => e.includes('"Capton"') && e.includes(TILE)), errors.join('|'));
});

test('lint: a missing or non-data template is an error', async () => {
  const api = fakeApi({ [TILE]: { ...tplItem(TILE_ID), template: { name: 'Branch' } } }, {});
  const errors = [], warnings = [], res = { templateIds: {} };
  await resolveDatasourceExtras(api, validateSpec(spec()).spec.pages[0].components[0].datasource, 'page Home', errors, warnings, res);
  assert.ok(errors.some(e => e.includes('not a data template')), errors.join('|'));
  assert.ok(errors.some(e => e.includes('not found') && e.includes(FINISH)), errors.join('|'));
});

test('smoke: child count and __Masters read-back', async () => {
  const d = validateSpec(spec()).spec.pages[0].components[0].datasource;
  assert.equal(countChildren(d.children), 3);
  const tree = { '/x/Data/Gallery': ['Frame 1', 'Frame 2'], '/x/Data/Gallery/Frame 2': ['Detail'] };
  const mk = (masters, tr = tree) => ({
    item: async p => (p === TILE ? tplItem(TILE_ID) : null),
    children: async p => (tr[p] || []).map(n => ({ name: n, path: `${p}/${n}`, itemId: n })),
    gql: async () => ({ item: { m: { value: masters } } }),
  });
  const run = async api => { const out = []; await checkDatasourceExtras(api, '/x/Data/Gallery', d, (ok, msg) => out.push([ok, msg])); return out; };
  let out = await run(mk(TILE_ID.toLowerCase().replace(/[{}]/g, '')));
  assert.ok(out.every(([ok]) => ok), JSON.stringify(out));
  assert.ok(out.some(([, m]) => m.includes('3/3')));
  out = await run(mk('{99999999-9999-9999-9999-999999999999}'));
  assert.ok(out.some(([ok, m]) => !ok && m.includes('__Masters')), JSON.stringify(out));
  out = await run(mk(TILE_ID, { '/x/Data/Gallery': ['Frame 1'] }));
  assert.ok(out.some(([ok, m]) => !ok && m.includes('1/3')), JSON.stringify(out));
});

// --- module-root guard: generated children live in the sites, never under the module roots ---
test('remove-template: a spec with datasource children still removes cleanly (children are generated, not foreign)', async () => {
  const PT = '/sitecore/templates/Project/acme', SETTINGS = '/sitecore/system/Settings/Project/acme';
  const tree = { [PT]: ['Landing'], [`${PT}/Landing`]: [], [SETTINGS]: ['Acme Setup', 'Templates'] };
  const deleted = [];
  const ids = new Map(Object.keys(tree).map((p, i) => [p, `AAAAAAAA-0000-0000-0000-${String(i).padStart(12, '0')}`]));
  const node = p => ({ itemId: ids.get(p), name: p.split('/').pop(), path: p, template: { name: 't', templateId: 'T' } });
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const { query, variables } = JSON.parse(body);
      const out = d => res.end(JSON.stringify({ data: d }));
      if (query.includes('solutionSites')) return out({ solutionSites: [] });
      if (query.includes('solutionTemplates')) return out({ solutionTemplates: [] });
      if (query.includes('deleteItem')) { deleted.push([...ids].find(([, v]) => v === variables.i.itemId)[0]); return out({ deleteItem: { successful: true } }); }
      if (query.includes('children(')) return out({ item: tree[variables.p] ? { children: { nodes: tree[variables.p].map(n => node(`${variables.p}/${n}`)) } } : null });
      const p = variables.w ?? [...ids].find(([, v]) => v === variables.i)?.[0];
      return out({ item: tree[p] ? node(p) : null });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    process.env.Y_ID = 'i'; process.env.Y_SECRET = 's';
    const f = join(mkdtempSync(join(tmpdir(), 'rt7-')), 'spec.json');
    writeFileSync(f, JSON.stringify({ ...spec(), blueprints: [], pageTypes: [{ name: 'Landing' }] }));
    const code = await removeMain(['--spec', f, '--cm-host', `http://127.0.0.1:${server.address().port}`, '--client-prefix', 'Y'], { log: () => {}, mint: async () => 'tok' });
    assert.ok(deleted.includes(PT), `module root deleted, got exit ${code}`);
  } finally { await new Promise(r => server.close(r)); }
});

// --- wiring: verify-template --smoke really runs the child read-back (a pure helper test cannot see a missing call) ---
test('verify-template --smoke fails when the datasource children were not created', async () => {
  const { main: verify } = await import('../verify-template.mjs');
  const TPL = 'AAAAAAAA-0000-0000-0000-000000000001';
  let coll = null;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const { query, variables } = JSON.parse(body);
      const out = d => res.end(JSON.stringify({ data: d }));
      if (query.includes('solutionSites')) return out({ solutionSites: [] });
      if (query.includes('solutionTemplates')) return out({ solutionTemplates: [{ id: TPL, name: 'Acme', enabled: true, thumbnailUrl: null }] });
      if (query.includes('createSiteCollection(')) { coll = variables.i.name; return out({ createSiteCollection: { job: { handle: 'h' } } }); }
      if (query.includes('siteCollections')) return out({ siteCollections: coll ? [{ id: 'C', name: coll }] : [] });
      if (query.includes('createSite(')) return out({ createSite: { job: { handle: 'j' } } });
      if (query.includes('job(')) return out({ job: { done: true, status: { jobState: 'FINISHED', exceptions: '[]', messages: [] } } });
      if (query.includes('removeSite')) return out({ removeSite: { job: { handle: 'r' } }, removeSiteCollection: { job: { handle: 'r' } } });
      if (query.includes('children(')) return out({ item: { children: { nodes: [] } } });
      return out({ item: { itemId: TPL, name: 'x', path: '/x', template: { name: 'Landing', templateId: 'T' }, fields: { nodes: [{ name: 'RenderingHost', value: 'h' }] },
        f: { value: '<r s:id="1"/>' }, s: { value: '' }, m: { value: '' }, insertOptions: [{ name: 'Landing' }] } });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const lines = [];
  try {
    process.env.Z_ID = 'i'; process.env.Z_SECRET = 's';
    const f = join(mkdtempSync(join(tmpdir(), 'vt7-')), 'spec.json');
    writeFileSync(f, JSON.stringify({ name: 'Acme', module: 'acme', description: 'd', renderingHost: 'h', homeType: 'Landing', pageTypes: [{ name: 'Landing' }],
      pages: [{ path: '', components: [{ rendering: 'Page Content/Gallery', datasource: { name: 'Gallery', template: FINISH, fields: {}, children: [{ name: 'A', template: FINISH }, { name: 'B', template: FINISH }] } }] }] }));
    const code = await verify(['--spec', f, '--cm-host', `http://127.0.0.1:${server.address().port}`, '--client-prefix', 'Z', '--smoke'],
      { log: l => lines.push(l), mint: async () => 'tok', sleep: async () => {} });
    assert.equal(code, 1);
    assert.ok(lines.some(l => l.startsWith('FAIL') && l.includes('0/2 child items')), lines.join('\n'));
  } finally { await new Promise(r => server.close(r)); }
});
