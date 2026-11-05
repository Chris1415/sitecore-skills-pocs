// W3 language versions + multi-language --lang. The analysis is pure; the collector runs through the real
// request layer against a fetch double serving raw bodies, so the read-only guard and parsing are exercised.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLanguages, parseLangs, checkW3, mergeLanguageResults, W3_RULES } from '../lib/checks-language.mjs';
import { result, addFinding, unknown } from '../lib/findings.mjs';
import { NOT_RUN } from '../lib/catalogue.mjs';
import { client } from '../lib/sitecore.mjs';
import { _setFetchForTests, setRate, _resetRates } from '../lib/http.mjs';
import { fakeFetch, res, tokenHandler } from './_fake.mjs';

const CLEAN = () => ({
  defaultLanguage: 'en', envLanguages: ['en', 'de-DE'], targetLanguages: ['en', 'de-DE'],
  items: [{ path: '/H', kind: 'page', route: '/', languages: ['en', 'de-DE'] }, { path: '/H/About', kind: 'page', route: '/About', languages: ['en', 'de-DE'] }, { path: '/H/Data/Hero', kind: 'datasource', languages: ['en', 'de-DE'] }],
  dictionary: [{ key: 'Open', path: '/D/Open', languages: ['en', 'de-DE'], phrases: { en: 'Open', 'de-DE': 'Öffnen' } }],
  edge: { en: { routes: ['/', '/About'], dictionary: { Open: 'Open menu' } }, 'de-DE': { routes: ['/', '/about'], dictionary: { Open: 'Menü öffnen' } } },
});
const mod = (fn) => { const s = CLEAN(); fn(s); return s; };
const FIXTURES = {
  'orphan-language': mod((s) => { s.items[1].languages.push('fr-FR'); }),
  'missing-page-version': mod((s) => { s.items[1].languages = ['en']; s.edge['de-DE'].routes = ['/']; }),
  'dict-missing-version': mod((s) => { s.dictionary.push({ key: 'Close', path: '/D/Close', languages: ['en'], phrases: { en: 'Close' } }); s.edge.en.dictionary.Close = 'Close menu'; }),
  'dict-empty-phrase': mod((s) => { s.dictionary[0].phrases['de-DE'] = ''; }),
  'edge-route-missing': mod((s) => { s.edge['de-DE'].routes = ['/']; }),
  'edge-dict-untranslated': mod((s) => { s.edge['de-DE'].dictionary.Open = 'Open'; }),
  'unused-env-language': mod((s) => { s.envLanguages.push('nl-NL'); }),
  'edge-dict-absent': mod((s) => { s.edge['de-DE'].dictionary = {}; }),
};

test('W3 analysis: a clean site has no findings; each fixture flags exactly its own rule', () => {
  assert.deepEqual(analyzeLanguages(CLEAN()), []);
  for (const [rule, fx] of Object.entries(FIXTURES)) {
    const got = analyzeLanguages(fx).map((f) => f.rule);
    assert.deepEqual([...new Set(got)], [rule], `${rule}: got ${got.join(', ')}`);
  }
  assert.deepEqual(Object.keys(W3_RULES).sort(), Object.keys(FIXTURES).sort(), 'every rule has a severity and a fixture');
});

test('W3 analysis: Edge route match is case-insensitive (Edge language/route matching is), the default language is not a target', () => {
  const s = CLEAN(); s.edge['de-DE'].routes = ['/', '/ABOUT'];
  assert.deepEqual(analyzeLanguages(s), []);
  const t = CLEAN(); t.items[1].languages = ['de-DE']; // en missing on a de-only page is not "missing-page-version"
  assert.ok(!analyzeLanguages(t).some((f) => f.rule === 'missing-page-version'));
  // the default language is the REFERENCE, never a target (census-compatible): a de-only entry is not "missing en"
  const u = CLEAN(); u.dictionary.push({ key: 'Nur', path: '/D/Nur', languages: ['de-DE'], phrases: { 'de-DE': 'Nur' } }); u.edge['de-DE'].dictionary.Nur = 'Nur deutsch';
  assert.deepEqual(analyzeLanguages(u), []);
});

test('--lang parsing: comma list, de-duplicated; absent or bare flag means derive', () => {
  assert.deepEqual(parseLangs('en, de-DE,en'), ['en', 'de-DE']);
  assert.equal(parseLangs(undefined), null);
  assert.equal(parseLangs(true), null);
  assert.equal(parseLangs(' , '), null);
});

test('catalogue: W3 runs in this version', () => { assert.equal(NOT_RUN.W3, undefined); });

// ---- wiring: collector over the request layer -------------------------------------------------------
const CM = 'https://xmc-test-cm1.sitecorecloud.io';
function tenant({ envLanguages = ['en'], liveDict = { en: { Open: 'Open menu' } } } = {}) {
  const tree = {
    '/sitecore/content/C/S/Home': { template: 'Page', r: 'x', langs: ['en', 'de-DE'], children: ['/sitecore/content/C/S/Home/About', '/sitecore/content/C/S/Home/Data'] },
    '/sitecore/content/C/S/Home/About': { template: 'Page', r: 'x', langs: ['en'], children: [] },
    '/sitecore/content/C/S/Home/Data': { template: 'Data Folder', r: '', langs: ['en'], children: ['/sitecore/content/C/S/Home/Data/Hero'] },
    '/sitecore/content/C/S/Home/Data/Hero': { template: 'Hero', r: '', langs: ['en', 'de-DE'], children: [] },
  };
  const seen = { edgeBodies: [], agqlQueries: [] };
  const handler = (url, init, body) => {
    if (!/graphql/.test(url)) return undefined;
    const { query: q, variables: v = {} } = JSON.parse(body);
    if (/edge-platform/.test(url)) {
      seen.edgeBodies.push({ q, v });
      if (/routes\(/.test(q)) return res({ data: { site: { siteInfo: { routes: { pageInfo: { hasNext: false, endCursor: null }, results: v.l === 'en' ? [{ routePath: '/' }, { routePath: '/About' }] : [] } } } } });
      if (/dictionary\(/.test(q)) return res({ data: { site: { siteInfo: { dictionary: { pageInfo: { hasNext: false }, results: Object.entries(liveDict[v.l] || {}).map(([key, value]) => ({ key, value })) } } } } });
    }
    seen.agqlQueries.push(q);
    if (/languages\(first:100\)/.test(q)) return res({ data: { languages: { nodes: envLanguages.map((name) => ({ name })) } } });
    if (/site\(siteName/.test(q)) return res({ data: { site: { rootPath: '/sitecore/content/C/S', startPath: '/Home', language: 'en', dictionaryDomain: 'dictid' } } });
    if (/children\(first:100, after:\$a\)\{ pageInfo\{ hasNextPage endCursor \} nodes\{ path/.test(q)) {
      const n = tree[v.p]; if (!n) return res({ data: { item: null } });
      return res({ data: { item: { path: v.p, template: { name: n.template }, versions: n.langs.map((name) => ({ language: { name } })), r: { value: n.r }, children: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: n.children.map((p) => ({ path: p, template: { name: tree[p].template } })) } } } });
    }
    if (/nodes\{ itemId path template\{ templateId \}/.test(q)) return res({ data: { item: { children: { pageInfo: { hasNextPage: false }, nodes: [{ itemId: 'k1', path: '/D/Open', template: { templateId: '{6D1CD897-1936-4A3A-A511-289A94C2A7B1}' }, k: { value: 'Open' }, versions: [{ language: { name: 'en' } }, { language: { name: 'de-DE' } }] }] } } } });
    if (/Phrase/.test(q)) return res({ data: { item: { p: { value: v.l === 'en' ? 'Open menu' : '' } } } });
    return res({ errors: [{ message: `fake: unhandled ${q.slice(0, 60)}` }] });
  };
  return { handler, seen };
}
async function runW3(t, extra = {}) {
  _resetRates(); setRate('default', 20); setRate('edge', 80);
  const f = fakeFetch([tokenHandler, t.handler]);
  _setFetchForTests(f);
  try {
    const ctx = { org: client({ X_ID: 'id-123456789', X_SECRET: 'secret-123456789' }, 'X'), cmHost: CM, site: 'S', ids: { live: 'LiveCtx0000000001' }, opts: { maxLangItems: 800 }, langs: null, ...extra };
    return { r: await checkW3(ctx), calls: f.calls };
  } finally { _setFetchForTests(null); _resetRates(); }
}

test('W3 wiring: orphan language, missing page version, empty phrase and absent live keys are found through the request layer', async () => {
  const t = tenant({ envLanguages: ['en'] });
  const { r } = await runW3(t);
  const rules = r.findings.map((f) => f.rule).sort();
  assert.ok(rules.includes('orphan-language'), rules.join());       // de-DE versions, env has only en
  assert.ok(rules.includes('missing-page-version'), rules.join());  // About has no de-DE
  assert.ok(rules.includes('dict-empty-phrase'), rules.join());     // de-DE phrase empty
  assert.ok(rules.includes('edge-dict-absent'), rules.join());      // de-DE key absent on live
  assert.equal(r.findings.find((f) => f.rule === 'orphan-language').severity, 'P1');
  assert.match(r.notes.join(' '), /languages en, de-DE/);
  // every Edge call passes `first` as a variable, never a literal
  assert.ok(t.seen.edgeBodies.length > 0 && t.seen.edgeBodies.every((b) => /\$f/.test(b.q) && b.v.f === 100 && !/first:\s*\d/.test(b.q)));
  assert.ok(t.seen.agqlQueries.every((q) => !/\bmutation\b/.test(q)));
});

test('W3 wiring: an explicit --lang list narrows the targets; an env with the language drops the orphan finding', async () => {
  const { r } = await runW3(tenant({ envLanguages: ['en', 'de-DE'], liveDict: { en: { Open: 'Open menu' } } }), { langs: ['en'] });
  assert.ok(!r.findings.some((f) => f.rule === 'orphan-language'));
  assert.ok(!r.findings.some((f) => f.rule === 'missing-page-version'), 'en-only target: no de-DE comparison');
  assert.match(r.notes.join(' '), /languages en \(/);
});

test('W3 wiring: an instrument error is UNKNOWN, never clean; page scope is SKIPPED', async () => {
  const broken = { handler: (url) => (/graphql/.test(url) ? res('upstream down', 500) : undefined) };
  const { r } = await runW3(broken);
  assert.equal(r.status, 'unknown');
  assert.match(r.reason, /HTTP 500/);
  const { r: p } = await runW3(tenant(), { page: '/About' });
  assert.equal(p.status, 'skipped');
});

test('multi-language census merge: findings carry the language, UNKNOWN wins, other checks untouched', () => {
  const primary = [result('R1', 'census'), result('D11', 'diff')];
  const de = result('R1', 'census'); addFinding(de, { severity: 'P0', title: 'Live route /x answers item:null at HTTP 200' }); de.notes.push('9 live routes');
  const deD11 = unknown(result('D11', 'diff'), 'preview census failed');
  mergeLanguageResults(primary, [de, deD11], 'de-DE');
  assert.equal(primary[0].findings[0].title, '[de-DE] Live route /x answers item:null at HTTP 200');
  assert.equal(primary[0].status, 'findings');
  assert.deepEqual(primary[0].notes, ['[de-DE] 9 live routes']);
  assert.equal(primary[1].status, 'unknown');
  assert.match(primary[1].reason, /\[de-DE\] preview census failed/);
});
