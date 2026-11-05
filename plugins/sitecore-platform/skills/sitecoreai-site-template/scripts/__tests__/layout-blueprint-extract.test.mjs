// Offline gates for the layout builder/parser, page blueprints and the behaviours the live probes forced.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as extractMain } from '../extract-spec.mjs';
import { buildLayoutXml, parseLayoutXml, nestRenderings } from '../lib/layout.mjs';
import { validateSpec, validateBlueprintSpec, CONTAINER, renderingPath } from '../lib/spec.mjs';
import { emitSiteSetup, seededGuid } from '../lib/emit-ps.mjs';

const PROMO = renderingPath('Page Content/Promo'), TEXT = renderingPath('Page Content/RichText');
const IDS = { [PROMO]: '{P}', [TEXT]: '{T}', [CONTAINER]: '{C}' };
const uid = n => `{U${n}}`;
const comps = () => [
  { renderingPath: PROMO, placeholder: 'headless-main', datasource: { name: 'Hero', fields: { PromoText: 'a&b "q"' } } },
  { renderingPath: CONTAINER, placeholder: 'headless-main', children: [
    { renderingPath: TEXT, datasource: { name: 'One', fields: {} } },
    { renderingPath: CONTAINER, children: [{ renderingPath: PROMO, datasource: '/sitecore/content/shared/x', params: { Styles: 's1' } }] }] },
];

test('build → parse → nest round-trips structure, datasources and params', () => {
  const { xml, datasources } = buildLayoutXml(comps(), IDS, uid);
  assert.deepEqual(datasources.map(d => d.name), ['Hero', 'One']);
  assert.match(xml, /s:ds="local:\/Data\/Hero"/);
  const { renderings } = parseLayoutXml(xml);
  assert.equal(renderings.length, 5);
  assert.deepEqual(renderings.map(r => r.ph), ['headless-main', 'headless-main', '/headless-main/container-2', '/headless-main/container-2', '/headless-main/container-2/container-4']);
  const roots = nestRenderings(renderings, '{C}');
  assert.equal(roots.length, 2);
  assert.equal(roots[1].children.length, 2);
  assert.equal(roots[1].children[1].children[0].ds, '/sitecore/content/shared/x');
  assert.equal(roots[1].children[1].children[0].params.Styles, 's1');
});

test('parser accepts the "?"-prefixed s:par the Basic site script writes, and flags personalization', () => {
  const xml = '<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}"><r uid="{1}" s:id="{X}" s:par="?Styles=%7BA%7D&amp;GridParameters=%7BG%7D" s:ph="headless-main"><rls><ruleset/></rls></r></d></r>';
  const { renderings, dropped } = parseLayoutXml(xml);
  assert.equal(renderings[0].params.Styles, '{A}');
  assert.equal(renderings[0].params.GridParameters, '{G}');
  assert.ok(dropped.length === 1);
});

test('site setup always sets Home insert options (the skeleton Home overrides them at item level)', () => {
  const { spec } = validateSpec({ name: 'A', module: 'aa', description: 'd', renderingHost: 'h', homeType: 'Land', pageTypes: [{ name: 'Land' }], pages: [] });
  const ps = emitSiteSetup(spec, { pageTypeIds: { Land: '{L}' }, datasourceTemplates: {}, renderingIds: {} });
  assert.ok(ps.includes("Set-Masters $pages[''] (@($types['Land'].ID.ToString()) + $bpIds)"));
});

test('template blueprints become collection branches with $name, page-local datasources and stable uids', () => {
  const { spec, errors } = validateSpec({ name: 'A', module: 'aa', description: 'd', renderingHost: 'h', homeType: 'Land', pageTypes: [{ name: 'Land' }],
    blueprints: [{ name: 'Promo Page', type: 'Land', components: [{ rendering: 'Page Content/Promo', datasource: { name: 'Hero', fields: { PromoText: '<h1>$name</h1>' } } }] }] });
  assert.deepEqual(errors, []);
  const resolved = { pageTypeIds: { Land: '{L}' }, renderingIds: { [PROMO]: '{P}' }, datasourceTemplates: { [PROMO]: '/t/Promo' } };
  const ps = emitSiteSetup(spec, resolved);
  assert.match(ps, /Branches\/Project\/\$\(\$collection\.Name\)/);
  assert.ok(ps.includes("Ensure-Child $bp '$name' $types['Land']"));
  assert.ok(ps.includes("'PromoText' = '<h1>$name</h1>'"), '$name stays literal for branch expansion');
  assert.ok(ps.includes(seededGuid('aa/Promo Page/1')), 'rendering uids are deterministic');
  assert.ok(ps.indexOf('$bpIds += $bp.ID') < ps.indexOf("Set-Masters $types['Land']"), 'blueprints exist before insert options reference them');
});

test('scaffold resilience: site: tokens resolve, missing variants are created, failures are collected then raised', () => {
  const { spec } = validateSpec({ name: 'A', module: 'aa', description: 'd', renderingHost: 'h', pages: [{ path: '', components: [{ rendering: 'Page Content/Title', variant: 'Big' }] }] });
  const ps = emitSiteSetup(spec, { pageTypeIds: {}, datasourceTemplates: {}, renderingIds: {} });
  assert.match(ps, /function Resolve-SiteRefs/);
  assert.match(ps, /-split '\\\|'/, 'PowerShell -split is a regex: the pipe must be escaped');
  assert.match(ps, /function Ensure-Variant/);
  assert.match(ps, /catch \{\s+\[void\]\$failures\.Add/);
  assert.match(ps, /if \(\$failures\.Count -gt 0\) \{ throw/);
});

test('standalone blueprint spec: defaults, required site, duplicate datasource names', () => {
  const ok = validateBlueprintSpec({ site: 's', name: 'Landing', components: [{ rendering: 'Page Content/RichText', datasource: { name: 'A' } }] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.blueprint.pageTemplate, 'Page');
  assert.deepEqual(ok.blueprint.offerOn, ['Page']);
  const bad = validateBlueprintSpec({ name: 'X', components: [{ rendering: 'Page Content/RichText', datasource: { name: 'A' } }, { rendering: 'Page Content/Promo', datasource: { name: 'A' } }] });
  assert.ok(bad.errors.some(e => e.startsWith('site:')));
  assert.ok(bad.errors.some(e => e.includes('duplicate datasource name "A"')));
  assert.ok(validateBlueprintSpec({ site: 's', name: 'Empty', components: [] }).errors.some(e => e.includes('without components')));
});

test('Create Site dialog safety: templates by ID and every path pinned to master:', () => {
  const { spec } = validateSpec({ name: 'A', module: 'aa', description: 'd', renderingHost: 'h', homeType: 'Land', pageTypes: [{ name: 'Land' }],
    pages: [{ path: '', components: [{ rendering: 'Page Content/Promo', datasource: { name: 'Hero', fields: {} } }] }] });
  const comps = spec.pages[0].components; comps[0].datasourceTemplatePath = '{D5A0A1B2-0000-0000-0000-000000000001}';
  const ps = emitSiteSetup(spec, { pageTypeIds: { Land: '{L}' }, renderingIds: { [PROMO]: '{P}' }, datasourceTemplates: { [PROMO]: '{D5A0A1B2-0000-0000-0000-000000000001}' } });
  assert.ok(!/'\/sitecore\/templates\/[^']*'\s*@\{/.test(ps), 'no datasource template passed as a path');
  assert.match(ps, /\$sitePath = "master:\$\(\$Site\.Paths\.Path\)"/);
  assert.match(ps, /New-Item -Path "master:\$\(\$parent\.Paths\.FullPath\)"/);
  assert.match(ps, /Add-Component \$pages\[''\] 'master:\/sitecore\/layout\/Renderings/);
});

test('a blueprint refuses variant and site: tokens, in a template and standalone, at any depth', () => {
  const comps = [{ rendering: 'Page Structure/Container', children: [{ rendering: 'Page Content/Title', variant: 'Big', params: { Styles: 'site:Presentation/Styles/x' } }] }];
  const alone = validateBlueprintSpec({ site: 's', name: 'Landing', components: comps }).errors;
  assert.ok(alone.some(e => e.includes('"variant"')), alone.join('|'));
  assert.ok(alone.some(e => e.includes('site: token')), alone.join('|'));
  const inTemplate = validateSpec({ name: 'A', module: 'aa', description: 'd', renderingHost: 'h', blueprints: [{ name: 'Landing', components: comps }] }).errors;
  assert.ok(inTemplate.some(e => e.includes('"variant"')) && inTemplate.some(e => e.includes('site: token')), inTemplate.join('|'));
  // A page keeps both: the scaffold script creates the variant and resolves the token.
  assert.deepEqual(validateSpec({ name: 'A', module: 'aa', description: 'd', renderingHost: 'h', pages: [{ path: '', components: comps }] }).errors, []);
  // An item id in FieldNames is the documented way round, and it does reach the layout.
  assert.deepEqual(validateBlueprintSpec({ site: 's', name: 'Landing', components: [{ rendering: 'Page Content/Title', params: { FieldNames: '{V}' } }] }).errors, []);
});

test('extract-spec --page says when the captured page needs what a blueprint cannot hold', async () => {
  const id = n => `AAAAAAAA-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const ROOT = '/sitecore/content/c/src', PAGE = `${ROOT}/Home/Landing`;
  const OOTB = '/sitecore/layout/Renderings/Feature/JSS Experience Accelerator';
  const xml = `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}"><r uid="{${id(9)}}" s:id="{${id(1)}}" s:ph="headless-main" s:par="FieldNames=%7B${id(2)}%7D&amp;Styles=%7B${id(3)}%7D" /></d></r>`;
  const mk = (n, path, fields = []) => ({ itemId: `{${id(n)}}`, name: path.split('/').pop(), path, template: { name: 'Page', templateId: `{${id(7)}}` }, fields: { nodes: fields } });
  const items = [mk(1, `${OOTB}/Page Content/Promo`), mk(2, `${ROOT}/Presentation/Headless Variants/Promo/Big`), mk(3, `${ROOT}/Presentation/Styles/x`),
    mk(4, CONTAINER), mk(5, PAGE, [{ name: '__Final Renderings', value: xml }])];
  const find = k => items.find(i => i.path === k || i.itemId.replace(/[{}]/g, '').toUpperCase() === String(k).replace(/[{}]/g, '').toUpperCase()) ?? null;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      const { query, variables } = JSON.parse(body);
      const out = d => res.end(JSON.stringify({ data: d }));
      if (query.includes('solutionSites')) return out({ solutionSites: [{ name: 'src', rootItem: { path: ROOT } }] });
      if (query.includes('itemTemplate')) return out({ itemTemplate: { name: 't', fields: { nodes: [] } } });
      if (query.includes('children(')) return out({ item: { children: { nodes: [] } } });
      return out({ item: find(variables.w ?? variables.i) });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const f = join(mkdtempSync(join(tmpdir(), 'xs-')), 'bp.json');
    const lines = [];
    const code = await extractMain(['--site', 'src', '--page', 'Landing', '--out', f, '--cm-host', `http://127.0.0.1:${server.address().port}`, '--client-prefix', 'X'],
      { log: l => lines.push(l), mint: async () => 'tok' });
    assert.equal(code, 0, lines.join('|'));
    const captured = JSON.parse(readFileSync(f, 'utf8'));
    assert.equal(captured.components[0].variant, 'Big');
    assert.ok(lines.some(l => l.startsWith('WARN') && l.includes('build-blueprint will refuse') && l.includes('"variant"')), lines.join('|'));
    assert.ok(lines.some(l => l.startsWith('WARN') && l.includes('build-blueprint will refuse') && l.includes('site: token')), lines.join('|'));
    assert.ok(validateBlueprintSpec(captured).errors.length >= 2, 'and the build refuses it');
  } finally { await new Promise(r => server.close(r)); }
});
