#!/usr/bin/env node
// D2 robots gate (a go-live gate, also run by the doctor). Visibility-aware:
//   public : anonymous GET /robots.txt -> 200 and no `Disallow: /` line.
//   private: anonymous -> 401 (or a 3xx to the host's SSO), then AUTHENTICATED body contains `Disallow: /`.
// Usage: node check-live-robots.mjs --url <live url> [--visibility public|private] [--auth-cookie <c> | env DOCTOR_GATE_COOKIE] [--json]
import { request, addSecret } from './lib/http.mjs';
import { parseArgs, loadEnv, isMain, CHROME_UA } from './lib/env.mjs';
import { result, addFinding, unknown } from './lib/findings.mjs';
import { runGateCli } from './lib/gate.mjs';

const DISALLOW_ALL = /^\s*Disallow:\s*\/\s*$/im;
const isSso = (loc) => /vercel\.com\/sso-api|\/sso-api/i.test(loc || '');

/** Pure verdict over captured responses (fixture-testable). */
export function robotsVerdict({ base, visibility = 'public', anon, auth = null, edgeRobots = undefined }) {
  const r = result('D2', `robots.txt matches delivery visibility (${visibility})`, { layer: 'DL' });
  const url = `${base}/robots.txt`;
  if (!anon || anon.status === 0) return unknown(r, `robots.txt unreachable (${anon?.err || 'no response'})`);
  const sitemapLine = (anon.text?.match(/^Sitemap:\s*(\S+)/im) || [])[1] || (auth?.text?.match(/^Sitemap:\s*(\S+)/im) || [])[1] || null;
  if (visibility === 'private') {
    const locked = anon.status === 401 || (anon.status >= 300 && anon.status < 400 && isSso(anon.headers?.location));
    if (!locked) addFinding(r, { severity: 'P0', blocker: true, title: `Private site serves robots.txt anonymously (HTTP ${anon.status})`, url, evidence: `anonymous GET ${url} -> ${anon.status}`, remediation: 'Put the access gate in front of every path including /robots.txt before anything is published to this surface.' });
    else if (anon.status === 401 && !/noindex/i.test(anon.headers?.['x-robots-tag'] || '')) addFinding(r, { severity: 'P1', title: 'Access gate answers 401 without X-Robots-Tag: noindex', url, evidence: `x-robots-tag: ${anon.headers?.['x-robots-tag'] ?? '(absent)'}`, remediation: 'Send X-Robots-Tag: noindex on the 401 so a leaked URL is never indexed.' });
    if (!auth) return r.findings.some((f) => f.blocker) ? r : unknown(r, 'private: the authenticated leg needs --auth-cookie (or DOCTOR_GATE_COOKIE)');
    if (auth.status !== 200 || !DISALLOW_ALL.test(auth.text || '')) addFinding(r, { severity: 'P0', blocker: true, title: `Authenticated robots.txt does not Disallow: / (HTTP ${auth.status})`, url, evidence: (auth.text || '').slice(0, 300), remediation: 'Set the site Settings RobotsContent to "User-agent: *\\nDisallow: /" and PUBLISH that item, then re-check.', fix_owner: 'cms' });
  } else {
    if (anon.status >= 300 && anon.status < 400) addFinding(r, { severity: 'P0', blocker: true, title: `robots.txt redirects (HTTP ${anon.status}${isSso(anon.headers?.location) ? ', to the SSO login' : ''})`, url, evidence: `location: ${anon.headers?.location}`, remediation: 'A public site must answer /robots.txt with 200 on the production alias; check deployment protection and the route wiring.' });
    else if (anon.status !== 200) addFinding(r, { severity: 'P0', blocker: true, title: `robots.txt returns HTTP ${anon.status}`, url, evidence: `anonymous GET -> ${anon.status}`, remediation: 'Wire the robots route handler and its next.config rewrite (an unwired route is a 404).', fix_owner: 'code' });
    else if (DISALLOW_ALL.test(anon.text || '')) addFinding(r, { severity: 'P0', blocker: true, title: 'Public site blocks all crawling (Disallow: /)', url, evidence: anon.text.slice(0, 300), remediation: 'An empty RobotsContent serves "Disallow: /" at 200. Set RobotsContent on the site Settings item, publish that item, re-fetch /robots.txt.', fix_owner: 'cms' });
    if (edgeRobots !== undefined && anon.status === 200) {
      const norm = (s) => String(s || '').replace(/\r/g, '').trim();
      if (!edgeRobots) addFinding(r, { severity: 'P2', title: 'Edge siteInfo.robots is empty on the live context', evidence: 'An empty field composes "Disallow: /" at 200; the served body comes from elsewhere (hard-coded file?).', remediation: 'Author RobotsContent in the CMS and publish it, so the served value stays authorable.', fix_owner: 'cms' });
      else if (norm(edgeRobots) !== norm(anon.text)) addFinding(r, { severity: 'P3', title: 'Served robots.txt differs from Edge siteInfo.robots (live)', evidence: `served ${norm(anon.text).length} chars vs Edge ${norm(edgeRobots).length} chars`, remediation: 'A public/robots.txt in the app shadows the CMS value; remove it unless intentional.', may_be_intentional: true, fix_owner: 'code' });
    }
  }
  if (sitemapLine) {
    let host = null; try { host = new URL(sitemapLine).host; } catch { /* malformed */ }
    const pub = new URL(base).host;
    if (host !== pub) addFinding(r, { check: 'D8', severity: 'P1', title: `robots.txt Sitemap: line points at ${/sitecorecloud\.io$/i.test(host || '') ? 'the CM host' : `another host (${host})`}, not the public host`, url, evidence: `Sitemap: <${host ? (/sitecorecloud\.io$/i.test(host) ? 'cm-host' : host) : 'malformed'}>`, remediation: 'Sitecore appends a Sitemap line from the site hostname. Set the site\'s target hostname to the public domain (Site Grouping) and republish the site settings; not a go-live blocker.', fix_owner: 'cms' });
  }
  if (!r.findings.length) r.notes.push(`${visibility}: ${anon.status}${auth ? ` / authenticated ${auth.status}` : ''}`);
  return r;
}

export async function checkRobots({ url, visibility = 'public', cookie = null, edgeRobots = undefined }) {
  const base = url.replace(/\/$/, '');
  const anon = await request(`${base}/robots.txt`, { headers: { 'user-agent': CHROME_UA }, label: 'robots-anon' });
  let auth = null;
  if (visibility === 'private' && cookie) auth = await request(`${base}/robots.txt`, { headers: { 'user-agent': CHROME_UA, cookie }, label: 'robots-auth' });
  return { results: [robotsVerdict({ base, visibility, anon, auth, edgeRobots })] };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(); const env = loadEnv(a);
  const cookie = a['auth-cookie'] || env.DOCTOR_GATE_COOKIE || null; addSecret(cookie);
  if (!a.url) { console.error('usage: check-live-robots.mjs --url <live url> [--visibility public|private] [--auth-cookie <cookie>]'); process.exit(2); }
  runGateCli('check-live-robots', () => checkRobots({ url: a.url, visibility: a.visibility || 'public', cookie }));
}
