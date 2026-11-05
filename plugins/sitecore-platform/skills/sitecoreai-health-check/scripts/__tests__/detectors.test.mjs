// Detectors on fixtures: the probe-P7 seeds are found, the clean sibling stays clean, template/layout targets
// are not flagged as unpublished. The graph runs through the REAL request layer over raw fixture bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseValue, scanLog, harvestMedia, deploymentAdvisories, extractHrefs } from '../lib/detect.mjs';
import { deadDatasources } from '../lib/checks-content.mjs';
import { checkGraph } from '../lib/checks-content.mjs';
import { client } from '../lib/sitecore.mjs';
import { _setFetchForTests, setRate, _resetRates } from '../lib/http.mjs';
import { fakeFetch, tokenHandler, graphHandler } from './_fake.mjs';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (n) => JSON.parse(readFileSync(join(FX, n), 'utf8'));

async function runGraph(fx, { live = true } = {}) {
  _resetRates(); setRate('default', 20); setRate('edge', 80);
  _setFetchForTests(fakeFetch([tokenHandler, graphHandler(fx)]));
  try {
    const env = { T_ID: 'client-id-xxxx', T_SECRET: 'client-secret-xxxx' };
    const ctx = { org: client(env, 'T'), cmHost: 'https://xmc-demo.sitecorecloud.io', root: fx.root, lang: 'en', ids: live ? { live: 'live-context-id-0001' } : {}, store: {}, opts: {} };
    const want = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'T2', 'M1', 'D12']);
    const results = await checkGraph(ctx, want);
    return results;
  } finally { _setFetchForTests(null); _resetRates(); }
}
const pairs = (results, skip = ['D12']) => results.flatMap((r) => r.findings).filter((f) => !skip.includes(f.check)).map((f) => [f.check, f.severity]).sort();

test('P7 seeds: all five seeded defects found at the expected severity', async () => {
  const fx = fixture('graph-p7-seed.json');
  const results = await runGraph(fx);
  assert.deepEqual(pairs(results), fx.expect.map((x) => [...x]).sort());
  const titles = results.flatMap((r) => r.findings).map((f) => f.title).join('\n');
  assert.match(titles, /without id=/);
  assert.match(titles, /datasource \(s:ds\) is missing/);
  assert.ok(results.every((r) => r.status !== 'unknown'), 'no UNKNOWN on a complete fixture');
});

test('P7 clean sibling: zero findings (D12 included)', async () => {
  const results = await runGraph(fixture('graph-p7-clean.json'));
  assert.deepEqual(pairs(results, []), []);
});

test('template/layout targets are never L5; an unpublished content target is', async () => {
  const fx = fixture('graph-template-targets.json');
  const results = await runGraph(fx);
  assert.deepEqual(pairs(results), fx.expect.map((x) => [...x]).sort());
  const l5 = results.flatMap((r) => r.findings).filter((f) => f.check === 'L5');
  assert.ok(l5.every((f) => /\/sitecore\/content\//.test(f.target)), JSON.stringify(l5));
});

test('L5 is SKIPPED, not clean, without a live context id', async () => {
  const results = await runGraph(fixture('graph-template-targets.json'), { live: false });
  assert.equal(results.find((r) => r.check === 'L5').status, 'skipped');
});

test('parseValue: link, image, layout, RTE, GUID lists', () => {
  assert.equal(parseValue('Link', 'general link', '<link linktype="internal" url="/x" />').issues[0].severity, 'P0');
  assert.equal(parseValue('Link', 'general link', '<link linktype="internal" id="{5E6D0C1A-0000-4000-8000-00000000DEAD}" />').edges[0].kind, 'link');
  assert.equal(parseValue('Img', 'image', '<image mediaid="{5E6D0C1A-0000-4000-8000-00000000DEAD}" />').edges[0].kind, 'image');
  const lay = parseValue('__Renderings', 'layout', '<r><d><r uid="u" s:id="{A}" s:ds="local:/Data/x" /></d></r>');
  assert.deepEqual(lay.edges.map((e) => e.kind), ['rendering', 'datasource']);
  const nl = parseValue('Tags', 'treelist', '{5E6D0C1A-0000-4000-8000-00000000DEAD}\n{5E6D0C1A-0000-4000-8000-00000000BEEF}');
  assert.equal(nl.issues[0].key, 'newline-joined');
  assert.equal(parseValue('Body', 'rich text', '<a href="~/link.aspx?_id=5E6D0C1A00004000800000000000DEAD">x</a>').edges[0].kind, 'rte-link');
  assert.equal(parseValue('Title', 'single-line text', 'just text').edges.length, 0);
});

test('logs: level-aware Solr, recovery lines ignored, template subjects collected, secrets redacted', () => {
  const log = [
    "80880 01 Oct 2026 12:20:11 INFO  IsSolrAliveAgent: Solr is available",
    "80880 01 Oct 2026 12:20:12 WARN  IndexingStateSwitcher: State of Solr has changed: '' -> 'Running'.",
    "ManagedPoolThread #5 01 Oct 2026 12:21:00 ERROR IndexingStateSwitcher: Solr is not available",
    "4711 01 Oct 2026 12:22:00 ERROR Data template '{0000-1}' not found for item '/sitecore/system/X/Mock-A'",
    "4711 01 Oct 2026 12:22:01 ERROR Data template '{0000-1}' not found for item '/sitecore/system/X/Mock-A'",
    "4711 01 Oct 2026 12:22:02 ERROR Data template '{0000-2}' not found for item '/sitecore/system/X/Mock-B'",
    '   at Sitecore.Data.Items.Item.get_Template()',
    'next start: editing sent "real-secret" expected "real-secret2"',
  ].join('\n');
  const s = scanLog(log, (l) => l.replace(/sent ".*?" expected ".*?"/g, 'sent "<r>" expected "<r>"'));
  assert.equal(s.hits['solr-degraded'].count, 1);
  assert.equal(s.hits['template-not-found'].count, 3);
  assert.deepEqual(s.hits['template-not-found'].subjects.sort(), ['/sitecore/system/X/Mock-A', '/sitecore/system/X/Mock-B']);
  assert.equal(s.hits['template-not-found'].firstAt, '01 Oct 2026 12:22:00');
  assert.ok(!JSON.stringify(s).includes('real-secret'));
  assert.equal(s.hits['secret-leak-debug'].count, 1);
});

test('Edge-side dead datasource: dataSource without fields', () => {
  const route = { placeholders: { main: [{ componentName: 'NavLink', dataSource: '{5E6D0C1A-0000-4000-8000-00000000DEAD}' }, { componentName: 'NavLink', dataSource: '{AAAAAAAA-1111-4111-8111-000000000001}', fields: { Link: {} } }, { componentName: 'Header', placeholders: { inner: [{ componentName: 'Promo', dataSource: 'abcdef12-3456-7890-abcd-ef1234567890' }] } }] } };
  assert.deepEqual(deadDatasources(route).map((d) => d.placeholder), ['main', 'main/inner']);
});

test('media harvest strips the RSC trailing backslash; hrefs; deployment advisories', () => {
  const html = 'src="https://edge.sitecorecloud.io/t-1/media/a.jpg?h=1&amp;w=2" x \\"https://edge.sitecorecloud.io/t-1/media/b.jpg\\"';
  assert.deepEqual(harvestMedia(html), ['https://edge.sitecorecloud.io/t-1/media/a.jpg?h=1&w=2', 'https://edge.sitecorecloud.io/t-1/media/b.jpg']);
  assert.deepEqual(extractHrefs('<a href="/a">a</a><a href="mailto:x">m</a><a href=\'https://other.example/\'>o</a>', 'https://s.example/').map((h) => h.internal), [true, false]);
  assert.match(deploymentAdvisories({ postActionCompletedAt: '2026-01-01T00:00:00Z', deploymentCompletedAt: '2026-01-01T00:29:00Z' })[0], /leg-mutation/);
});
