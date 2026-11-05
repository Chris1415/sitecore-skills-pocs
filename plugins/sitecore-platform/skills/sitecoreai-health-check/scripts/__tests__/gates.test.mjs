// The extracted go-live gates keep the same pass/fail semantics: robots (public + private), media, crawl,
// context ids. Each runs against a fetch double serving raw bodies; the verdict mapping is the CLI exit code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsVerdict, checkRobots } from '../check-live-robots.mjs';
import { classifyMedia, checkMedia } from '../check-media-delivery.mjs';
import { classifyAppIds } from '../check-edge-context.mjs';
import { crawl, deadMediaSources } from '../crawl-live-links.mjs';
import { verdict, EXIT } from '../lib/gate.mjs';
import { _setFetchForTests, setRate, _resetRates } from '../lib/http.mjs';
import { fakeFetch, res } from './_fake.mjs';

const BASE = 'https://site.example';
const html = (b) => res(b, 200, { 'content-type': 'text/html; charset=utf-8' });
async function withSite(routes, fn) {
  _resetRates(); setRate('default', 20);
  _setFetchForTests(fakeFetch([(url) => { const u = new URL(url); const h = routes[`${u.host === 'site.example' ? '' : u.origin}${u.pathname}`]; return h ? h() : undefined; }]));
  try { return await fn(); } finally { _setFetchForTests(null); _resetRates(); }
}
const v = (out) => verdict(out.results);

test('robots public: 200 Allow passes; Disallow: / and 404 fail; CM-host Sitemap line is advisory only', () => {
  const ok = robotsVerdict({ base: BASE, anon: { status: 200, text: 'User-Agent: *\nAllow: /\nSitemap: https://xmc-x-cm.sitecorecloud.io/sitemap.xml', headers: {} } });
  assert.equal(verdict([ok]), 'pass');
  assert.equal(ok.findings[0].check, 'D8'); assert.equal(ok.findings[0].blocker, undefined);
  assert.equal(verdict([robotsVerdict({ base: BASE, anon: { status: 200, text: 'User-agent: *\nDisallow: /', headers: {} } })]), 'fail');
  assert.equal(verdict([robotsVerdict({ base: BASE, anon: { status: 404, text: '', headers: {} } })]), 'fail');
  assert.equal(verdict([robotsVerdict({ base: BASE, anon: { status: 302, text: '', headers: { location: 'https://vercel.com/sso-api?x' } } })]), 'fail');
  assert.equal(verdict([robotsVerdict({ base: BASE, anon: { status: 0, err: 'ENOTFOUND' } })]), 'unknown');
});

test('robots private: inverted; anonymous 401 + authenticated Disallow passes; missing cookie is UNKNOWN', () => {
  const anon = { status: 401, text: '', headers: { 'x-robots-tag': 'noindex' } };
  assert.equal(verdict([robotsVerdict({ base: BASE, visibility: 'private', anon, auth: { status: 200, text: 'User-agent: *\nDisallow: /', headers: {} } })]), 'pass');
  assert.equal(verdict([robotsVerdict({ base: BASE, visibility: 'private', anon, auth: { status: 200, text: 'User-agent: *\nAllow: /', headers: {} } })]), 'fail');
  assert.equal(verdict([robotsVerdict({ base: BASE, visibility: 'private', anon: { status: 200, text: 'Disallow: /', headers: {} } })]), 'fail');
  assert.equal(verdict([robotsVerdict({ base: BASE, visibility: 'private', anon })]), 'unknown');
});

test('robots via the request layer (unfollowed)', async () => {
  const out = await withSite({ '/robots.txt': () => res('User-agent: *\nDisallow: /') }, () => checkRobots({ url: BASE }));
  assert.equal(EXIT[v(out)], 1);
});

test('media: Edge 200 image passes; 302 to the CM / CM host / HTML 200 fail; none found is UNKNOWN', async () => {
  assert.equal(classifyMedia('https://edge.sitecorecloud.io/t/media/a.jpg', { status: 200, headers: { 'content-type': 'image/jpeg' } }), null);
  assert.equal(classifyMedia('https://edge.sitecorecloud.io/t/media/a.jpg', { status: 302, headers: { location: 'https://xmc-abc-cm1.sitecorecloud.io/-/media/a.jpg' } }).severity, 'P0');
  assert.equal(classifyMedia('https://xmc-abc-cm1.sitecorecloud.io/-/jssmedia/a.jpg', { status: 200, headers: { 'content-type': 'image/jpeg' } }).severity, 'P0');
  assert.equal(classifyMedia('https://edge.sitecorecloud.io/t/media/a.jpg', { status: 200, headers: { 'content-type': 'text/html' } }).severity, 'P1');
  const page = '<img src="https://edge.sitecorecloud.io/t/media/a.jpg"><img src="https://edge.sitecorecloud.io/t/media/b.jpg">';
  const pass = await withSite({ '/': () => html(page), 'https://edge.sitecorecloud.io/t/media/a.jpg': () => res('x', 200, { 'content-type': 'image/jpeg' }), 'https://edge.sitecorecloud.io/t/media/b.jpg': () => res('x', 200, { 'content-type': 'image/webp' }) }, () => checkMedia({ url: BASE }));
  assert.equal(v(pass), 'pass');
  const fail = await withSite({ '/': () => html(page), 'https://edge.sitecorecloud.io/t/media/a.jpg': () => res('', 302, { location: 'https://app.sitecorecloud.io/x' }), 'https://edge.sitecorecloud.io/t/media/b.jpg': () => res('x', 200, { 'content-type': 'image/webp' }) }, () => checkMedia({ url: BASE }));
  assert.equal(v(fail), 'fail');
  const none = await withSite({ '/': () => html('<p>no images</p>') }, () => checkMedia({ url: BASE }));
  assert.equal(v(none), 'unknown');
});

test('crawl (server-HTML fallback): 404 link is a blocker with referrers; degraded is declared; --require-browser is UNKNOWN', async () => {
  const site = { '/': () => html('<a href="/a">a</a> <a href="/b">b</a> <a href="https://elsewhere.example/">x</a>'), '/a': () => html('<a href="/">home</a><a href="/my%20page">sp</a>'), '/my%20page': () => html('ok'), '/b': () => res('nope', 404, { 'content-type': 'text/html' }) };
  const out = await withSite(site, () => crawl({ url: BASE, browser: 'never' }));
  const d5 = out.results.find((r) => r.check === 'D5');
  assert.equal(v(out), 'fail');
  assert.ok(d5.degraded);
  const blocker = d5.findings.find((f) => f.blocker);
  assert.match(blocker.title, /HTTP 404/); assert.match(blocker.evidence, /referrers: https:\/\/site\.example\//);
  assert.ok(d5.findings.some((f) => /%20/.test(f.title)));
  const strict = await withSite(site, () => crawl({ url: BASE, browser: 'never', requireBrowser: true }));
  assert.equal(v(strict), 'unknown');
  const priv = await withSite(site, () => crawl({ url: BASE, visibility: 'private', browser: 'never' }));
  assert.equal(v(priv), 'unknown');
});

test('crawl: an SSO redirect on an internal link is a blocker (never a followed false 200)', async () => {
  const out = await withSite({ '/': () => html('<a href="/x">x</a>'), '/x': () => res('', 302, { location: 'https://vercel.com/sso-api?url=x' }) }, () => crawl({ url: BASE, browser: 'never' }));
  assert.match(out.results[0].findings.find((f) => f.blocker).title, /SSO/);
});

test('context ids: live passes, preview is P0, empty and foreign fail; values never in titles', () => {
  const ids = { live: 'LIVEidLIVEid01', preview: 'PREVidPREVid02' };
  assert.deepEqual(classifyAppIds('.env', { SITECORE_EDGE_CONTEXT_ID: ids.live, NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID: ids.live }, ids), []);
  const prev = classifyAppIds('.env', { SITECORE_EDGE_CONTEXT_ID: ids.preview, NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID: ids.live }, ids);
  assert.equal(prev[0].severity, 'P0');
  const bad = classifyAppIds('.env', { SITECORE_EDGE_CONTEXT_ID: '', NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID: 'OTHERidOTHER03' }, ids);
  assert.deepEqual(bad.map((x) => x.severity), ['P1', 'P1']);
  assert.ok(![...prev, ...bad].some((x) => /LIVEid|PREVid|OTHERid/.test(x.title)));
});

// T6 live templates. source: LIVE Edge answers measured 2026-10-31 on two campaign sites: Home read
// `template { name: "UnknownTemplate" }` while its page type was unpublished, the real name once published.
import { checkLiveTemplates, walkLive } from '../check-live-templates.mjs';
const T6_ROOT = '/sitecore/content/Brand/s';
const t6Tree = (homeTemplate, extra = {}) => ({
  [T6_ROOT]: { path: T6_ROOT, template: { name: 'Headless Site' }, children: { pageInfo: { hasNext: false }, results: [{ path: `${T6_ROOT}/Home`, name: 'Home' }, { path: `${T6_ROOT}/Dictionary`, name: 'Dictionary' }] } },
  [`${T6_ROOT}/Home`]: { path: `${T6_ROOT}/Home`, template: { name: homeTemplate }, children: { pageInfo: { hasNext: false }, results: [] } },
  [`${T6_ROOT}/Dictionary`]: { path: `${T6_ROOT}/Dictionary`, template: { name: 'UnknownTemplate' }, children: { pageInfo: { hasNext: false }, results: [] } },
  ...extra,
});
const t6Query = (tree) => async (_q, { p }) => ({ data: { item: tree[p] ?? null } });

test('T6 live templates: unpublished page type fails, named passes, absent root is unknown, Dictionary skipped', async () => {
  assert.equal(v(await checkLiveTemplates({ root: T6_ROOT, query: t6Query(t6Tree('UnknownTemplate')) })), 'fail');
  assert.equal(v(await checkLiveTemplates({ root: T6_ROOT, query: t6Query(t6Tree('Campaign Home')) })), 'pass');
  assert.equal(v(await checkLiveTemplates({ root: '/sitecore/content/Brand/missing', query: t6Query({}) })), 'unknown');
  const { items } = await walkLive(t6Query(t6Tree('Campaign Home')), T6_ROOT);
  assert.deepEqual(items.map((i) => i.path), [T6_ROOT, `${T6_ROOT}/Home`]);
});

test('T6 live templates: follows children pagination; an Edge error is unknown, never a pass', async () => {
  const pages = { [T6_ROOT]: [
    { path: T6_ROOT, template: { name: 'Headless Site' }, children: { pageInfo: { hasNext: true, endCursor: 'c1' }, results: [{ path: `${T6_ROOT}/A`, name: 'A' }] } },
    { path: T6_ROOT, template: { name: 'Headless Site' }, children: { pageInfo: { hasNext: false }, results: [{ path: `${T6_ROOT}/B`, name: 'B' }] } },
  ] };
  const leaf = (p, n) => ({ path: p, template: { name: n }, children: { pageInfo: { hasNext: false }, results: [] } });
  const q = async (_q, { p, a }) => ({ data: { item: p === T6_ROOT ? pages[p][a ? 1 : 0] : p.endsWith('/A') ? leaf(p, 'Page') : leaf(p, 'UnknownTemplate') } });
  const out = await checkLiveTemplates({ root: T6_ROOT, query: q });
  assert.equal(v(out), 'fail'); assert.equal(out.results[0].findings.length, 1); assert.match(out.results[0].findings[0].title, /\/B$/);
  await assert.rejects(checkLiveTemplates({ root: T6_ROOT, query: async () => ({ errors: [{ message: 'boom' }] }) }), /Edge error/);
});

// source: LIVE Edge answers measured 2026-11-04 on a migrated site: 469 of 472 items, for templates not on Edge.
const NOT_FOUND = { errors: [{ message: 'Template with id 751829BA1E9A5766998BACDDCD647605 was not found' }], data: { item: null } };
test('T6 live templates: a template not on Edge is reported, never a silent pass or a crash', async () => {
  const tree = t6Tree('Campaign Home');
  const q = async (query, { p }) => (/template\{/.test(query) && p.endsWith('/Home') ? NOT_FOUND : { data: { item: tree[p] ?? null } });
  const out = await checkLiveTemplates({ root: T6_ROOT, query: q });
  const r = out.results[0]; const f = r.findings.find((x) => /not on Edge/.test(x.title));
  assert.ok(f, 'the finding names it'); assert.equal(f.severity, 'P2'); assert.ok(!f.blocker);
  assert.match(f.title, /1 of 2 items/); assert.match(f.evidence, /\/Home/);
  assert.match(r.notes.join(), /1 with a template not on Edge/);
  await assert.rejects(checkLiveTemplates({ root: T6_ROOT, query: async () => ({ errors: [{ message: 'Query is too complex' }] }) }), /Edge error/);
});

test('T6 live templates: template{} and children stay in separate queries, within the Edge budget', async () => {
  const seen = [];
  await checkLiveTemplates({ root: T6_ROOT, query: async (query, { p }) => { seen.push(query); return { data: { item: t6Tree('Page')[p] ?? null } }; } });
  assert.ok(seen.length); assert.ok(seen.every((s) => !(/template\{/.test(s) && /children\(/.test(s))));
  assert.ok(seen.filter((s) => /children\(/.test(s)).every((s) => /first:10\b/.test(s)));
});

test('crawl: a media source on a dev host is a blocker; a real one and a link to it are not', async () => {
  const dead = '<video controls><source src="https://localhost/halo_5" type="video/mp4"/></video>';
  const out = await withSite({ '/': () => html(dead) }, () => crawl({ url: BASE, browser: 'never' }));
  const d7 = out.results.find((r) => r.check === 'D7'); const f = d7.findings.find((x) => /dev host/.test(x.title));
  assert.ok(f?.blocker); assert.match(f.evidence, /localhost\/halo_5/); assert.equal(v(out), 'fail');
  assert.deepEqual(deadMediaSources('<source src="https://edge.sitecorecloud.io/t/media/a.mp4"/><a href="https://localhost/x">x</a><img src="/a.png">'), []);
  assert.deepEqual(deadMediaSources('<img alt="" src="http://127.0.0.1:3000/a.png">'), ['http://127.0.0.1:3000/a.png']);
  assert.deepEqual(deadMediaSources('<video poster="https://localhost/p.jpg"></video>'), ['https://localhost/p.jpg']);
  assert.deepEqual(deadMediaSources('<img srcset="https://edge.example/a.png 1x, https://localhost/b.png 2x">'), ['https://localhost/b.png']);
  assert.deepEqual(deadMediaSources(dead, 'localhost'), [], 'a crawl of a local server serves its own media');
  assert.deepEqual(deadMediaSources(dead, 'site.example'), ['https://localhost/halo_5']);
});

test('T6 live templates: wired through the real Edge request layer on the live context id', async () => {
  const tree = t6Tree('UnknownTemplate');
  _resetRates(); setRate('default', 20); setRate('edge', 20);
  _setFetchForTests(fakeFetch([(url, _i, body) => (/edge-platform/.test(url) && /sitecoreContextId=LIVEID/.test(url) ? res({ data: { item: tree[JSON.parse(body).variables.p] ?? null } }) : undefined)]));
  try { assert.equal(v(await checkLiveTemplates({ contextId: 'LIVEID', root: T6_ROOT })), 'fail'); }
  finally { _setFetchForTests(null); _resetRates(); }
});
