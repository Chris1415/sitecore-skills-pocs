// check-estate-parity: two Edge contexts served by a fetch double. Each case is a control the user runs
// before trusting a 0 (A vs A → 0; different content → 1; missing route → 1; no routes → 2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEstateParity, compareRoutes, normMediaUrl } from '../check-estate-parity.mjs';
import { _setFetchForTests, setRate, _resetRates } from '../lib/http.mjs';
import { fakeFetch, res } from './_fake.mjs';

const CTX_A = 'ctxAAAAAAAAAAAAAAAAAAAA1', CTX_B = 'ctxBBBBBBBBBBBBBBBBBBBB2';
const img = (tenant, file = 'hero.jpg') => `https://edge.sitecorecloud.io/${tenant}/media/project/site/${file}?h=600&hash=${tenant}`;
const route = ({ tenant = 'tenant-a', title = 'Home', comps = ['Hero', 'Promo'], heading = 'Welcome', link = null, file } = {}) => ({
  name: 'Home', templateName: 'Page', itemLanguage: 'en', fields: { Title: { value: title } },
  placeholders: { main: comps.map((c, i) => ({ componentName: c, fields: { heading: { value: heading }, image: { value: { src: img(tenant, file) } }, ...(link ? { target: { url: link } } : {}) }, params: { i: String(i) } })) },
});

/** Edge double: per context { routes: { lang: [paths] }, layouts: { 'lang|path': route }, dict: { lang: {k:v} } }. */
function edgeSite(byCtx, { mediaStatus = 200 } = {}) {
  return fakeFetch([(url, init, body) => {
    if (/\/media\//.test(url)) return res('binary', mediaStatus, { 'content-type': 'image/jpeg' });
    if (!/graphql/.test(url)) return undefined;
    const ctx = new URL(url).searchParams.get('sitecoreContextId');
    const s = byCtx[ctx]; if (!s) return res({ errors: [{ message: 'No sitecore context' }] }, 404);
    const { query, variables } = JSON.parse(body);
    if (/routes\(/.test(query)) return res({ data: { site: { siteInfo: { routes: { pageInfo: { hasNext: false, endCursor: null }, results: (s.routes[variables.l] || []).map((routePath) => ({ routePath })) } } } } });
    if (/dictionary\(/.test(query)) return res({ data: { site: { siteInfo: { dictionary: { pageInfo: { hasNext: false, endCursor: null }, results: Object.entries(s.dict?.[variables.l] || {}).map(([key, value]) => ({ key, value })) } } } } });
    if (/layout\(/.test(query)) { const r = s.layouts[`${variables.l}|${variables.p}`]; return res({ data: { layout: { item: r ? { rendered: { sitecore: { route: r } } } : null } } }); }
    return undefined;
  }]);
}
async function run(byCtx, args = {}, fetchOpts) {
  _resetRates(); setRate('edge', 80); setRate('default', 20);
  _setFetchForTests(edgeSite(byCtx, fetchOpts));
  try { return await checkEstateParity({ a: CTX_A, b: CTX_B, site: 'Site', ...args }); } finally { _setFetchForTests(null); _resetRates(); }
}
const site = (over = {}, tenant = 'tenant-a') => ({ routes: { en: ['/', '/about'] }, layouts: { 'en|/': route({ tenant, ...over }), 'en|/about': route({ tenant, title: 'About' }) }, dict: { en: { k: 'v' } } });

test('A vs B with only the media tenant/hash differing → parity (exit 0), media GET checked', async () => {
  const { code, report } = await run({ [CTX_A]: site(), [CTX_B]: site({}, 'tenant-b') });
  assert.equal(code, 0);
  assert.equal(report.media.checkedB, 1); // one unique asset across both routes
  assert.ok(!JSON.stringify(report).includes(CTX_A) && !JSON.stringify(report).includes(CTX_B), 'context ids never in the report');
});

test('content, structure, route-set, dictionary and media failures each report exit 1', async () => {
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: site({ heading: 'Hello' }, 'tenant-b') })).code, 1, 'field diff');
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: site({ comps: ['Hero'] }, 'tenant-b') })).code, 1, 'structure diff');
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: site({ title: 'Start' }, 'tenant-b') })).code, 1, 'route field diff');
  const missing = site({}, 'tenant-b'); delete missing.layouts['en|/about']; missing.routes.en = ['/'];
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: missing })).code, 1, 'route only on A');
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: { ...site({}, 'tenant-b'), dict: { en: {} } } })).code, 1, 'dictionary');
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: site({}, 'tenant-b') }, {}, { mediaStatus: 302 })).code, 1, 'media not 200');
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: site({ file: 'other.jpg' }, 'tenant-b') }, { mediaGet: false })).code, 1, 'media set');
});

test('--pair compares two different routes (the content control); A with no routes is undecided (exit 2)', async () => {
  const { code } = await run({ [CTX_A]: site(), [CTX_B]: site({}, 'tenant-b') }, { pairs: [['/', '/about']] });
  assert.equal(code, 1);
  assert.equal((await run({ [CTX_A]: { routes: { en: [] }, layouts: {}, dict: {} }, [CTX_B]: site() })).code, 2);
  assert.equal((await run({ [CTX_A]: site(), [CTX_B]: site() }, { siteB: 'Site' })).code, 0, 'A vs A control');
});

test('--normalize-cm-host is opt-in: host-only differences on /sitecore/login/ links pass only with it', () => {
  const a = route({ link: 'https://xmc-a-cm.sitecorecloud.io/sitecore/login/Option' });
  const b = route({ link: 'https://localhost/sitecore/login/Option' });
  assert.equal(compareRoutes(a, b).differs, true);
  assert.equal(compareRoutes(a, b, { normalizeCmHost: true }).differs, false);
  const c = route({ link: 'https://localhost/sitecore/login/Other' });
  assert.equal(compareRoutes(a, c, { normalizeCmHost: true }).differs, true, 'a path change still differs');
});

test('normMediaUrl drops host, tenant segment and cache params but keeps the asset and size', () => {
  assert.equal(normMediaUrl(img('t1')), normMediaUrl(img('t2')));
  assert.notEqual(normMediaUrl(img('t1')), normMediaUrl(img('t1', 'b.jpg')));
  assert.notEqual(normMediaUrl('https://e/x/media/a.jpg?h=600'), normMediaUrl('https://e/x/media/a.jpg?h=300'));
});
