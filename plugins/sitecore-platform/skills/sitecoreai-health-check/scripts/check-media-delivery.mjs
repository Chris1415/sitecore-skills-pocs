#!/usr/bin/env node
// D6 media gate (a go-live gate, also run by the doctor): media referenced by the live pages must answer
// an UNFOLLOWED anonymous GET with 200 and a non-HTML type, from the Edge media host, never the CM.
// Usage: node check-media-delivery.mjs --url <live url> [--pages /,/about] [--limit 10] [--auth-cookie <c>] [--json]
import { request, addSecret } from './lib/http.mjs';
import { parseArgs, loadEnv, isMain, CHROME_UA, routePathArg } from './lib/env.mjs';
import { result, addFinding, unknown } from './lib/findings.mjs';
import { harvestMedia } from './lib/detect.mjs';
import { runGateCli } from './lib/gate.mjs';

const CM_HOST = /^xmc-[a-z0-9-]+\.sitecorecloud\.io$/i;
const PREVIEW_REDIRECT = /(^|\.)app\.sitecorecloud\.io$|^xmc-[a-z0-9-]+\.sitecorecloud\.io$/i;

/** Pure per-asset classification: null when healthy, else { severity, title }. */
export function classifyMedia(url, res) {
  const host = new URL(url).hostname;
  if (res.status === 0) return { unknown: true, title: `unreachable (${res.err})` };
  if (res.status >= 300 && res.status < 400) {
    let loc = null; try { loc = new URL(res.headers.location, url).hostname; } catch { /* none */ }
    return { severity: 'P0', title: `Media redirects (${res.status}) to ${loc && PREVIEW_REDIRECT.test(loc) ? 'the CM/portal: unpublished or on the PREVIEW context' : loc || 'nowhere'}` };
  }
  if (res.status !== 200) return { severity: 'P1', title: `Media returns HTTP ${res.status}` };
  if (/text\/html/i.test(res.headers['content-type'] || '')) return { severity: 'P1', title: 'Media URL answers 200 with an HTML page (soft failure)' };
  if (CM_HOST.test(host)) return { severity: 'P0', title: 'Media is served from the CM host, not Edge (preview context or unpublished)' };
  return null;
}

export async function checkMedia({ url, pages = ['/'], limit = 10, cookie = null }) {
  const base = url.replace(/\/$/, '');
  const r = result('D6', 'Media delivered from Edge: unfollowed 200, non-HTML', { layer: 'DL' });
  const urls = new Set(); let fetched = 0;
  for (const p of pages) {
    const page = await request(`${base}${p}`, { headers: { 'user-agent': CHROME_UA, accept: 'text/html', ...(cookie ? { cookie } : {}) }, label: 'media-page' });
    if (page.status !== 200) { addFinding(r, { check: 'D6', severity: 'P1', title: `Page used for media harvest returned HTTP ${page.status}`, url: `${base}${p}` }); continue; }
    fetched++;
    for (const m of harvestMedia(page.text, limit)) urls.add(m);
  }
  if (!fetched && !r.findings.length) return { results: [unknown(r, 'no page could be fetched')] };
  if (!urls.size) return { results: [unknown(r, `no media URL found in the served HTML of ${pages.join(', ')} (pass --pages with a page that renders an image)`)] };
  let ok = 0; const bad = [];
  for (const m of [...urls].slice(0, limit)) {
    const res = await request(m, { headers: { 'user-agent': CHROME_UA }, maxBytes: 2048, label: 'media-asset' });
    const c = classifyMedia(m, res);
    if (!c) { ok++; continue; }
    if (c.unknown) { bad.push(`${m}: ${c.title}`); continue; }
    addFinding(r, { severity: c.severity, blocker: true, title: c.title, url: m, evidence: `GET (unfollowed) -> ${res.status} ${res.headers['content-type'] || ''} ${res.headers.location ? `location host ${new URL(res.headers.location, m).hostname}` : ''}`.trim(), remediation: 'Confirm the app runs on the LIVE context id (check-edge-context.mjs), publish the media items, redeploy.' });
  }
  if (bad.length && !ok && !r.findings.length) return { results: [unknown(r, `every media request failed at transport level: ${bad[0]}`)] };
  r.notes.push(`${ok}/${Math.min(urls.size, limit)} media assets 200 from ${[...new Set([...urls].map((u) => new URL(u).hostname.replace(/^[^.]+(?=\.sitecorecloud\.io$)/, (s) => (CM_HOST.test(`${s}.sitecorecloud.io`) ? '<cm>' : s))))].join(', ')}`);
  return { results: [r] };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(); const env = loadEnv(a);
  const cookie = a['auth-cookie'] || env.DOCTOR_GATE_COOKIE || null; addSecret(cookie);
  if (!a.url) { console.error('usage: check-media-delivery.mjs --url <live url> [--pages /,/about] [--limit 10]'); process.exit(2); }
  const pages = String(a.pages || '/').split(',').map((p) => routePathArg(p.trim(), 'pages'));
  runGateCli('check-media-delivery', () => checkMedia({ url: a.url, pages, limit: Number(a.limit || 10), cookie }));
}
