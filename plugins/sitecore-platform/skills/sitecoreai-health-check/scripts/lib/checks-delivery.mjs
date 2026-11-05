// Delivery-surface checks over plain HTTP: D3 D4 E1 D8 D14 D15 D16. Every status is the UNFOLLOWED one.
import { request } from './http.mjs';
import { result, addFinding, unknown } from './findings.mjs';
import { CHROME_UA } from './env.mjs';

const isSso = (loc) => /\/sso-api/i.test(loc || '');

export async function checkD3(ctx) {
  const r = result('D3', `Deployment protection vs visibility (${ctx.visibility})`, { layer: 'DL', surface: 'C' });
  const h = await request(`${ctx.base}/`, { headers: { 'user-agent': CHROME_UA, accept: 'text/html' }, label: 'home-anon' });
  if (h.status === 0) return unknown(r, `home unreachable (${h.err})`);
  const locked = h.status === 401 || (h.status >= 300 && h.status < 400 && isSso(h.headers.location));
  if (ctx.visibility === 'public') {
    if (locked) addFinding(r, { severity: 'P0', blocker: true, title: `Public production URL is locked (HTTP ${h.status}${isSso(h.headers.location) ? ' to SSO' : ''})`, url: `${ctx.base}/`, remediation: 'Serve the production alias publicly, or run with --visibility private if that is the intent.' });
    else if (h.status !== 200) addFinding(r, { severity: 'P0', blocker: true, title: `Home returns HTTP ${h.status} anonymously`, url: `${ctx.base}/` });
  } else {
    if (!locked) addFinding(r, { severity: 'P0', blocker: true, title: `Private surface serves the home page anonymously (HTTP ${h.status})`, url: `${ctx.base}/`, remediation: 'Gate every path before publishing anything to this surface.' });
    else if (h.status === 401 && !/noindex/i.test(h.headers['x-robots-tag'] || '')) addFinding(r, { severity: 'P1', title: 'Access gate 401 carries no X-Robots-Tag: noindex', url: `${ctx.base}/` });
  }
  if (!r.findings.length) r.notes.push(`home ${h.status}${h.headers['x-vercel-cache'] ? `, x-vercel-cache ${h.headers['x-vercel-cache']}` : ''}`);
  return r;
}

export async function checkD4(ctx) {
  const r = result('D4', 'Revalidate endpoint not open', { layer: 'DL', surface: 'C' });
  // Non-JSON body, no secret header: cannot revalidate. Never POST {} (2.4.0 revalidates the dictionary).
  const x = await request(`${ctx.base}/api/revalidate`, { method: 'POST', headers: { 'user-agent': CHROME_UA, 'content-type': 'text/plain' }, body: 'x', label: 'revalidate-probe' });
  if (x.status === 0) return unknown(r, `revalidate probe unreachable (${x.err})`);
  if (x.status === 400 && /valid JSON/i.test(x.text)) addFinding(r, { severity: 'P0', title: 'Revalidate endpoint is OPEN: the secret is unset', url: `${ctx.base}/api/revalidate`, evidence: `POST non-JSON -> 400 "${x.text.slice(0, 80)}"`, remediation: 'Set SITECORE_REVALIDATE_SECRET (or the app\'s secret variable) on all Vercel targets and redeploy; anyone can purge the cache until then.', fix_owner: 'ops' });
  else r.notes.push(x.status === 401 ? 'secret set (401 before body parse)' : x.status === 404 ? 'no revalidate route (plain template)' : `answered ${x.status}`);
  return r;
}

export async function checkE1(ctx) {
  const r = result('E1', 'Editing config on the delivery surface', { layer: 'EH', surface: 'C' });
  // No Origin header: CORS is skipped, so 401 = secret set, 500 = SITECORE_EDITING_SECRET unset.
  const x = await request(`${ctx.base}/api/editing/config`, { headers: { 'user-agent': CHROME_UA }, label: 'editing-config' });
  if (x.status === 0) return unknown(r, `editing config unreachable (${x.err})`);
  if (x.status === 500) addFinding(r, { severity: 'P2', title: 'SITECORE_EDITING_SECRET is unset on the delivery surface (/api/editing/config answers 500)', url: `${ctx.base}/api/editing/config`, may_be_intentional: true, evidence: 'GET without Origin -> 500 (the SDK throws on a missing secret)', remediation: 'Harmless for a delivery-only surface; if Pages ever renders through this host, set the estate\'s editing secret on all three Vercel targets. It also logs a handler error per probe.' });
  else if (x.status === 200) addFinding(r, { severity: 'P1', title: 'Editing config answers 200 without a secret', url: `${ctx.base}/api/editing/config` });
  else r.notes.push(x.status === 401 ? 'secret set (401)' : `answered ${x.status}`);
  return r;
}

export async function checkD8(ctx) {
  const r = result('D8', 'Sitemap on the public host', { layer: 'DL', surface: 'C + E' });
  const sm = await request(`${ctx.base}/sitemap.xml`, { headers: { 'user-agent': CHROME_UA, ...(ctx.cookie ? { cookie: ctx.cookie } : {}) }, label: 'sitemap' });
  if (sm.status === 0) return unknown(r, `sitemap unreachable (${sm.err})`);
  if (sm.status !== 200) { addFinding(r, { severity: 'P2', title: `sitemap.xml returns HTTP ${sm.status}`, url: `${ctx.base}/sitemap.xml` }); return r; }
  let locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (/<sitemapindex/.test(sm.text) && locs[0]) {
    const child = await request(locs[0].replace(/^https?:\/\/[^/]+/, ctx.base), { headers: { 'user-agent': CHROME_UA }, label: 'sitemap-child' });
    locs = [...child.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  }
  const pub = new URL(ctx.base).host;
  const hostOf = (l) => { try { return new URL(l).host; } catch { return 'malformed'; } };
  const foreign = locs.filter((l) => hostOf(l) !== pub);
  if (foreign.length) {
    const cm = foreign.filter((l) => /sitecorecloud\.io$/i.test(hostOf(l))).length;
    addFinding(r, { severity: 'P1', title: `${foreign.length}/${locs.length} sitemap <loc> entries are not on the public host${cm ? ` (${cm} on the CM host)` : ''}`, url: `${ctx.base}/sitemap.xml`, evidence: `sample path ${new URL(foreign[0], ctx.base).pathname}`, remediation: 'The sitemap is generated from the site hostname: set the site\'s target hostname to the public domain and republish the site settings.', fix_owner: 'cms' });
  }
  const census = ctx.store.census?.live;
  if (census) {
    const paths = new Set(locs.map((l) => { try { return new URL(l).pathname.replace(/\/$/, '') || '/'; } catch { return l; } }));
    const routes = new Set(census.map((x) => x.routePath.replace(/\/$/, '') || '/'));
    const missing = [...routes].filter((p) => !paths.has(p)); const extra = [...paths].filter((p) => !routes.has(p));
    if (missing.length || extra.length) addFinding(r, { severity: 'P3', title: `Sitemap vs live route census: ${missing.length} route(s) not in the sitemap, ${extra.length} sitemap path(s) not a live route`, evidence: [...missing.slice(0, 5).map((p) => `missing ${p}`), ...extra.slice(0, 5).map((p) => `extra ${p}`)].join('\n'), may_be_intentional: true, fix_owner: 'cms' });
  }
  if (!r.findings.length) r.notes.push(`${locs.length} <loc>, all on the public host`);
  return r;
}

export async function checkSmall(ctx) {
  const out = [];
  const d16 = result('D16', 'Unknown route returns 404 (no soft 404)', { layer: 'DL' });
  const rnd = await request(`${ctx.base}/doctor-no-such-page-zz9`, { headers: { 'user-agent': CHROME_UA, ...(ctx.cookie ? { cookie: ctx.cookie } : {}) }, label: 'random-slug' });
  if (rnd.status === 0) unknown(d16, rnd.err); else if (rnd.status === 200) addFinding(d16, { severity: 'P2', title: 'Unknown route answers 200 (soft 404)', url: `${ctx.base}/doctor-no-such-page-zz9`, fix_owner: 'code' }); else d16.notes.push(`unknown route -> ${rnd.status}`);
  out.push(d16);
  const d15 = result('D15', 'Leftover debug routes', { layer: 'DL' });
  for (const p of ['/api/layout-debug']) { const x = await request(`${ctx.base}${p}`, { headers: { 'user-agent': CHROME_UA }, label: 'debug-route' }); if (x.status === 200) addFinding(d15, { severity: 'P1', title: `Debug route ${p} is live in production`, url: `${ctx.base}${p}`, remediation: 'Remove the temporary diagnostic route; it exposes raw layout data.', fix_owner: 'code' }); }
  if (!d15.findings.length) d15.notes.push('/api/layout-debug not live');
  out.push(d15);
  const d14 = result('D14', '/llms.txt present', { layer: 'DL' });
  const l = await request(`${ctx.base}/llms.txt`, { headers: { 'user-agent': CHROME_UA }, label: 'llms' });
  if (l.status !== 200) addFinding(d14, { severity: 'P3', title: `/llms.txt returns HTTP ${l.status}`, may_be_intentional: true, fix_owner: 'code' }); else d14.notes.push('present');
  out.push(d14);
  return out;
}
