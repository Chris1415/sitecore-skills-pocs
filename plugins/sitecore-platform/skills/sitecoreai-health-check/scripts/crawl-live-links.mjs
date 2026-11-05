#!/usr/bin/env node
// D5/D7/D9 live crawl (a go-live gate, also run by the doctor). Hrefs come from the HYDRATED DOM in a real
// browser (client components emit links absent from server HTML); every status is asserted on an UNFOLLOWED
// request (curl -L behind SSO reports a false 200). Without Playwright it degrades to server-HTML hrefs with
// a WARN; --require-browser turns that degradation into UNKNOWN (what a go-live gate should use).
// Side effect (declared): each page view fires the head app's server-side bot/page-view tracking.
// Usage: node crawl-live-links.mjs --url <live url> [--visibility public|private] [--auth-cookie <c>]
//          [--max-pages 60] [--max-links 400] [--browser auto|never] [--require-browser] [--json]
// Playwright is resolved from the cwd, else from PLAYWRIGHT_MODULE (path to an installed `playwright` package).
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { request, addSecret } from './lib/http.mjs';
import { parseArgs, loadEnv, isMain, CHROME_UA } from './lib/env.mjs';
import { result, addFinding, unknown, skipped } from './lib/findings.mjs';
import { extractHrefs } from './lib/detect.mjs';
import { runGateCli } from './lib/gate.mjs';

const MISSING_COMPONENT = /component is missing React implementation|<MissingComponent|data-missing-component/i;
const isSso = (loc) => /\/sso-api/i.test(loc || '');

const DEV_HOST = /^(localhost|127\.0\.0\.1)$/i;
/** Video, audio or image sources on a dev host: renders an empty player with a clean 200 (OfficeCore's videos, 2026-11-04).
 *  A crawl OF a dev host (a local `next start`) serves its own media there, so nothing counts. */
export const deadMediaSources = (html, crawlHost = '') => (DEV_HOST.test(crawlHost) ? [] : [...new Set([...String(html).matchAll(/<(?:source|video|audio|img)\b[^>]*?\b(?:src|poster|srcset)=["'][^"']*?(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s"',]*)?)/gi)].map((m) => m[1]))]);

export async function loadPlaywright(env = process.env) {
  // A bare `import('playwright')` resolves relative to THIS FILE's own location, not process.cwd() — so it
  // never sees a head app's own node_modules. Build a require() rooted at the cwd instead, matching the
  // documented contract (cwd, then PLAYWRIGHT_MODULE).
  const withChromium = (m) => (m && m.chromium ? m : m && m.default && m.default.chromium ? m.default : null);
  try {
    const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
    const resolved = cwdRequire.resolve('playwright');
    const found = withChromium(await import(pathToFileURL(resolved).href));
    if (found) return found;
  } catch { /* not in cwd */ }
  if (env.PLAYWRIGHT_MODULE) {
    try {
      const found = withChromium(await import(pathToFileURL(path.resolve(env.PLAYWRIGHT_MODULE)).href));
      if (found) return found;
    } catch { /* bad path */ }
  }
  return null;
}

const keyOf = (u) => { const x = new URL(u); x.hash = ''; return x.href; };

/** Status of one internal URL, following same-host redirects by hand (max 5 hops). */
export async function resolveStatus(url, headers) {
  const hops = []; let cur = url;
  for (let i = 0; i < 6; i++) {
    const r = await request(cur, { headers, label: 'crawl-status' });
    hops.push(r.status);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (isSso(r.headers.location)) return { status: r.status, final: cur, hops, sso: true };
      const next = new URL(r.headers.location, cur);
      if (next.host !== new URL(url).host) return { status: r.status, final: next.href, hops, offHost: true };
      cur = next.href; continue;
    }
    return { status: r.status, final: cur, hops, err: r.err, contentType: r.headers['content-type'] || '', text: r.text };
  }
  return { status: -1, final: cur, hops, loop: true };
}

export async function crawl({ url, visibility = 'public', cookie = null, maxPages = 60, maxLinks = 400, browser = 'auto', requireBrowser = false, env = process.env }) {
  const base = new URL(url.replace(/\/$/, '') + '/');
  const r = result('D5', `Live link crawl (${visibility}${cookie ? ', authenticated' : ''})`, { layer: 'DL', surface: 'C' });
  const d7 = result('D7', 'Per-page delivery markers (MissingComponent, noindex)', { layer: 'DL' });
  const d9 = result('D9', 'Console errors after hydration', { layer: 'DL' });
  if (visibility === 'private' && !cookie) { for (const x of [r, d7, d9]) unknown(x, 'private: an anonymous crawl measures the gate, not the links (pass --auth-cookie)'); return { results: [r, d7, d9] }; }
  const pw = browser === 'never' ? null : await loadPlaywright(env);
  const headers = { 'user-agent': CHROME_UA, accept: 'text/html,application/xhtml+xml', ...(cookie ? { cookie } : {}) };
  if (!pw) {
    const why = browser === 'never' ? '--browser never' : 'Playwright not installed';
    for (const x of [r, d7, d9]) x.degraded = `${why}: server-HTML hrefs only; client-emitted links and console errors are invisible`;
    if (requireBrowser) { for (const x of [r, d7, d9]) unknown(x, `${why} and --require-browser was set`); return { results: [r, d7, d9] }; }
    skipped(d9, `${why}: console errors need a browser`);
  }
  let bro = null, ctx = null;
  if (pw) {
    bro = await pw.chromium.launch({ headless: true }).catch(() => pw.chromium.launch({ headless: true, channel: 'chrome' }));
    ctx = await bro.newContext({ userAgent: CHROME_UA });
    if (cookie) await ctx.addCookies(cookie.split(/;\s*/).filter((c) => c.includes('=')).map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), domain: base.hostname, path: '/' }; }));
  }
  const queue = [base.href]; const visited = new Set(); const checked = new Map(); const referrers = new Map();
  const note = (href, from) => { if (!referrers.has(href)) referrers.set(href, new Set()); referrers.get(href).add(from); };
  let consoleErrors = 0, pagesRendered = 0;
  try {
    while (queue.length && visited.size < maxPages) {
      const pageUrl = queue.shift(); if (visited.has(pageUrl)) continue; visited.add(pageUrl);
      const st = checked.get(pageUrl) || await resolveStatus(pageUrl, headers); checked.set(pageUrl, st);
      if (st.status !== 200 || !/text\/html/i.test(st.contentType || '')) continue;
      let hrefs = []; let html = st.text || '';
      if (ctx) {
        const page = await ctx.newPage(); const errsOnPage = [];
        page.on('pageerror', (e) => errsOnPage.push(`pageerror: ${String(e.message).slice(0, 160)}`));
        page.on('console', (m) => { if (m.type() === 'error') errsOnPage.push(`console: ${m.text().slice(0, 160)}`); });
        page.on('response', (res) => { if (res.request().resourceType() === 'image' && res.status() >= 400) addFinding(r, { check: 'D6', severity: 'P1', title: `Image fails to load (HTTP ${res.status()})`, url: res.url().slice(0, 200), evidence: `on ${pageUrl}` }); });
        try {
          await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 45000 });
          hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
          html = await page.content(); pagesRendered++;
        } catch (e) { r.notes.push(`render failed ${pageUrl}: ${String(e.message).slice(0, 80)}`); }
        await page.close();
        if (errsOnPage.length) { consoleErrors += errsOnPage.length; addFinding(d9, { severity: 'P2', title: `${errsOnPage.length} console error(s) after hydration`, url: pageUrl, evidence: errsOnPage.slice(0, 5).join('\n'), fix_owner: 'code' }); }
      } else hrefs = extractHrefs(html, pageUrl).map((h) => h.raw);
      if (MISSING_COMPONENT.test(html)) addFinding(d7, { severity: 'P1', blocker: true, title: 'Page renders a MissingComponent placeholder', url: pageUrl, remediation: 'A rendering on the page has no registered component in the head app (component map key / componentName mismatch).', fix_owner: 'code' });
      for (const src of deadMediaSources(html, base.hostname)) addFinding(d7, { severity: 'P1', blocker: true, title: 'Media source points at a dev host', url: pageUrl, evidence: src, remediation: 'The item behind it has no file on Edge: a media item carried as content, or an unpublished media item.', fix_owner: 'cms' });
      const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html);
      if (visibility === 'public' && noindex) addFinding(d7, { severity: 'P1', title: 'Public page carries meta robots noindex', url: pageUrl, may_be_intentional: true, fix_owner: 'cms' });
      if (visibility === 'private' && !noindex) addFinding(d7, { severity: 'P1', title: 'Private page lacks noindex', url: pageUrl });
      for (const raw of hrefs) {
        if (!raw || /^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;
        let u; try { u = new URL(raw, pageUrl); } catch { continue; }
        if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
        if (/%20| /.test(raw)) addFinding(r, { severity: 'P2', title: 'Internal href contains a space / %20 (live Edge resolves only the hyphenated route)', url: u.href, evidence: `href="${raw}" on ${pageUrl}`, fix_owner: 'cms' });
        const k = keyOf(u.href); note(k, pageUrl);
        if (!visited.has(k) && !queue.includes(k)) queue.push(k);
      }
    }
    // assert every collected internal link, including ones beyond the page budget
    for (const k of [...referrers.keys()].slice(0, maxLinks)) {
      const st = checked.get(k) || await resolveStatus(k, headers); checked.set(k, st);
      const from = [...referrers.get(k)].slice(0, 3).join(', ');
      if (st.sso) addFinding(r, { severity: 'P0', blocker: true, title: 'Internal link lands on the SSO login (deployment protection on the live surface)', url: k, evidence: `referrers: ${from}` });
      else if (st.loop) addFinding(r, { severity: 'P1', blocker: true, title: 'Redirect loop', url: k, evidence: `hops ${st.hops.join('>')}; referrers: ${from}` });
      else if (st.status === 0) addFinding(r, { severity: 'P1', blocker: true, title: `Internal link unreachable (${st.err})`, url: k, evidence: `referrers: ${from}` });
      else if (st.status >= 400) addFinding(r, { severity: 'P1', blocker: true, title: `Internal link returns HTTP ${st.status}`, url: k, evidence: `hops ${st.hops.join('>')}; referrers: ${from}`, remediation: 'Live Edge resolves only the slugified route; fix the link target or the item name, then publish.', fix_owner: 'cms' });
    }
  } finally { if (bro) await bro.close(); }
  const total = Math.min(referrers.size, maxLinks);
  const bad = r.findings.filter((f) => f.blocker).length;
  r.notes.push(`${total - bad}/${total} internal links resolved; ${visited.size} pages visited${pw ? `, ${pagesRendered} rendered after hydration` : ' (server HTML)'}${referrers.size > maxLinks ? `; ${referrers.size - maxLinks} links over --max-links not checked` : ''}`);
  if (pw && !consoleErrors) d9.notes.push(`${pagesRendered} pages, 0 console errors`);
  if (!d7.findings.length && d7.status === 'pass') d7.notes.push(`${visited.size} pages: no MissingComponent, robots meta matches ${visibility}`);
  return { results: [r, d7, d9] };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(); const env = loadEnv(a);
  const cookie = a['auth-cookie'] || env.DOCTOR_GATE_COOKIE || null; addSecret(cookie);
  if (!a.url) { console.error('usage: crawl-live-links.mjs --url <live url> [--visibility public|private] [--auth-cookie <c>] [--require-browser]'); process.exit(2); }
  runGateCli('crawl-live-links', () => crawl({ url: a.url, visibility: a.visibility || 'public', cookie, maxPages: Number(a['max-pages'] || 60), maxLinks: Number(a['max-links'] || 400), browser: a.browser || 'auto', requireBrowser: !!a['require-browser'], env }));
}
