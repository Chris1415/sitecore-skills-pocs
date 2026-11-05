#!/usr/bin/env node
// check-locale-drift.mjs: read-only gate for the language model of a Content SDK App Router head app.
// Compares src/i18n/routing.ts locales with the languages the CM site actually has, and flags the
// i18n anti-patterns that ship green (hard-coded <html lang>, dictionary fetched but never read,
// flat next-intl calls against site-namespaced messages, the dead `t(k) || ''` fallback).
//
// Usage: node check-locale-drift.mjs --app <head-app dir> --languages en,de-DE [--default en] [--json]
//        node check-locale-drift.mjs --app <dir> --site <name> --context-id-env SITECORE_EDGE_CONTEXT_ID [--env-file <app>/.env.local]
//        node check-locale-drift.mjs --self-test
// The --site mode reads Edge (public context id, query only): siteInfo.rootPath, then
// item(<root>/Home).languages = the languages with a version on that Edge surface.
// Waivers: <app>/.locale-drift-ignore.json = { "<rule>": { reason, consumer: { file, pattern, mountedIn, mountPattern } } }.
// A finding is WAIVED only while its consumer exists: `file` contains `pattern` AND `mountedIn` contains `mountPattern`
// (regexes, app-relative paths). Consumer gone -> the FAIL returns plus `waiver-unconsumed`; a waiver without a reason,
// without a consumer or for an unknown rule -> `waiver-invalid` (FAIL). Exit 0 when every FAIL is WAIVED.
// Exit: 0 no FAIL · 1 at least one FAIL · 2 usage / read error.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Each rule is mutation-tested: --self-test switches one off and expects a fixture to fail.
export const GUARDS = {
  'locale-not-in-cm': true, 'cm-not-in-routing': true, 'case-mismatch': true, 'html-lang-hardcoded': true,
  'dictionary-unused': true, 'flat-namespace': true, 'empty-fallback-idiom': true, 'single-locale-routing': true,
};
// Waiver mutation switch (self-test only): off = a waiver is honoured without checking its consumer.
export const WAIVER_GUARDS = { 'consumer-bound': true, 'reason-required': true };

/** Locales listed in routing.ts; identifier entries resolve to the default language. */
export function parseRoutingLocales(src, defaultLanguage) {
  const m = src.match(/locales\s*:\s*\[([^\]]*)\]/);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).map((tok) => {
    const lit = tok.match(/^['"`]([^'"`]+)['"`]$/);
    return lit ? lit[1] : defaultLanguage; // sitecoreConfig.defaultLanguage and friends
  });
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(n) && !/\.(test|spec)\./.test(n)) out.push(p);
  }
  return out;
}

const CONSUMER_KEYS = ['file', 'pattern', 'mountedIn', 'mountPattern'];
// A comment is not a consumer: strip block, JSX and line comments before the regex runs (a `//` after `:` is a URL, kept).
export const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\'"`])\/\/.*$/gm, '$1');

/** Applies <app>/.locale-drift-ignore.json: WAIVED only while the declared consumer is present (a waiver must name what still uses it). */
export function applyWaivers(findings, waivers, readApp) {
  if (!waivers) return findings;
  const out = []; const bad = (rule, msg) => out.push({ rule: 'waiver-invalid', sev: 'FAIL', msg: `waiver "${rule}": ${msg}` });
  const valid = {};
  for (const [rule, w] of Object.entries(waivers)) {
    if (!(rule in GUARDS)) { bad(rule, 'unknown finding id'); continue; }
    if (!w || (WAIVER_GUARDS['reason-required'] && (typeof w.reason !== 'string' || !w.reason.trim()))) { bad(rule, 'no reason'); continue; }
    const c = w.consumer;
    if (!c || CONSUMER_KEYS.some((k) => typeof c[k] !== 'string' || !c[k])) { bad(rule, `no consumer (needs ${CONSUMER_KEYS.join(', ')})`); continue; }
    try { new RegExp(c.pattern); new RegExp(c.mountPattern); } catch { bad(rule, 'consumer pattern is not a valid regex'); continue; }
    valid[rule] = w;
  }
  for (const f of findings) {
    const w = valid[f.rule];
    if (!w) { out.push(f); continue; }
    const c = w.consumer; const code = (r) => { const t = readApp(r); return t == null ? null : stripComments(t); }; const src = code(c.file); const host = code(c.mountedIn);
    const missing = src == null ? `${c.file} does not exist` : !new RegExp(c.pattern).test(src) ? `${c.file} no longer matches /${c.pattern}/` : host == null ? `${c.mountedIn} does not exist` : !new RegExp(c.mountPattern).test(host) ? `${c.mountedIn} no longer matches /${c.mountPattern}/` : null;
    if (!missing || !WAIVER_GUARDS['consumer-bound']) out.push({ ...f, sev: 'WAIVED', msg: `${f.msg} [waived: ${w.reason}]` });
    else { out.push(f); out.push({ rule: 'waiver-unconsumed', sev: 'FAIL', msg: `waiver "${f.rule}" is void, its consumer is gone: ${missing}` }); }
  }
  return out;
}

/** Pure check over an in-memory snapshot: { routingSrc, files:[{path,src}], cmLanguages, defaultLanguage, waivers, readApp }. */
export function check({ routingSrc, files = [], cmLanguages = null, defaultLanguage = 'en', waivers = null, readApp = () => null }) {
  return applyWaivers(rawCheck({ routingSrc, files, cmLanguages, defaultLanguage }), waivers, readApp);
}

function rawCheck({ routingSrc, files = [], cmLanguages = null, defaultLanguage = 'en' }) {
  const out = []; const add = (rule, sev, msg) => out.push({ rule, sev, msg });
  const locales = parseRoutingLocales(routingSrc || '', defaultLanguage);
  if (!locales) { add('routing-unparsed', 'FAIL', 'src/i18n/routing.ts: no `locales: [...]` array found'); return out; }
  if (cmLanguages) {
    const lower = new Map(cmLanguages.map((l) => [l.toLowerCase(), l]));
    for (const loc of locales) {
      if (cmLanguages.includes(loc)) continue;
      const twin = lower.get(loc.toLowerCase());
      if (twin && GUARDS['case-mismatch']) add('case-mismatch', 'FAIL', `routing locale "${loc}" vs CM "${twin}": LocaleProxy matching is case-sensitive, so /${twin}/ is rewritten under the default`);
      else if (!twin && GUARDS['locale-not-in-cm']) add('locale-not-in-cm', 'FAIL', `routing locale "${loc}" has no version on the CM side: every /${loc}/… request 404s`);
    }
    const routedLower = new Set(locales.map((l) => l.toLowerCase()));
    for (const cm of cmLanguages) {
      if (!routedLower.has(cm.toLowerCase()) && GUARDS['cm-not-in-routing']) add('cm-not-in-routing', 'FAIL', `CM language "${cm}" is not in routing.locales: it is unreachable (LocaleProxy rewrites /${cm}/… under the default) and never prerendered`);
    }
  }
  const multi = new Set(locales).size > 1;
  if (!multi && cmLanguages && cmLanguages.length > 1 && GUARDS['single-locale-routing']) add('single-locale-routing', 'WARN', 'routing.ts lists one locale while the site has several languages (the scaffold default)');
  const rootLayout = files.find((f) => /src[\\/]app[\\/]layout\.(t|j)sx?$/.test(f.path));
  if (multi && rootLayout && /<html[^>]*\blang=["']/.test(rootLayout.src) && GUARDS['html-lang-hardcoded']) add('html-lang-hardcoded', 'FAIL', `${rootLayout.path}: <html lang> is a literal while routing has ${locales.length} locales; move <html> to src/app/[site]/[locale]/layout.tsx and use the locale param`);
  const req = files.find((f) => /src[\\/]i18n[\\/]request\.(t|j)sx?$/.test(f.path));
  const consumers = files.filter((f) => f !== req && /from\s+['"]next-intl(\/server)?['"]/.test(f.src) && /\b(useTranslations|getTranslations|useMessages|getMessages)\s*\(/.test(f.src));
  if (req && /getDictionary\s*\(/.test(req.src) && consumers.length === 0 && GUARDS['dictionary-unused']) add('dictionary-unused', 'WARN', `${req.path} fetches the dictionary on every request but no component reads it (cost, and every page carries an sc:dict tag under OSR)`);
  for (const f of files) {
    if (f === req) continue;
    if (/\b(useTranslations|getTranslations)\s*\(\s*\)/.test(f.src) && GUARDS['flat-namespace']) add('flat-namespace', 'FAIL', `${f.path}: useTranslations()/getTranslations() without the site namespace renders the KEY (messages are nested under messages[site])`);
    if (/\bt\s*\([^()]*\)\s*\|\|\s*['"`]{2}/.test(f.src) && GUARDS['empty-fallback-idiom']) add('empty-fallback-idiom', 'WARN', `${f.path}: \`t(key) || ''\` never falls back; a missing key renders "site.KEY"`);
  }
  return out;
}

function readEnvFile(p) { const e = {}; if (!p || !existsSync(p)) return e; for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } return e; }

/** Languages with a version under <rootPath>/Home on the Edge surface behind the context id. Query only. */
export async function edgeSiteLanguages(site, contextId) {
  const url = `https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=${encodeURIComponent(contextId)}`;
  const post = async (query, variables) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) }); return r.json(); };
  const s = await post('query($s:String!){ site{ siteInfo(site:$s){ rootPath language } } }', { s: site });
  const info = s?.data?.site?.siteInfo;
  if (!info) throw new Error(`site "${site}" not found on this Edge surface`);
  const it = await post('query($p:String!,$l:String!){ item(path:$p, language:$l){ languages{ language{ name } } } }', { p: `${info.rootPath}/Home`, l: info.language || 'en' });
  const langs = it?.data?.item?.languages?.map((x) => x.language.name);
  if (!langs) throw new Error(`no Home item under ${info.rootPath} in ${info.language}`);
  return { languages: langs, defaultLanguage: info.language || 'en' };
}

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const app = arg('--app');
  if (!app) { console.log('usage: check-locale-drift.mjs --app <dir> (--languages a,b | --site <name> --context-id-env VAR) [--default en] [--json] | --self-test'); return 2; }
  const routingPath = join(app, 'src', 'i18n', 'routing.ts');
  if (!existsSync(routingPath)) { console.log(`no ${routingPath}`); return 2; }
  let cmLanguages = arg('--languages') ? arg('--languages').split(',').map((s) => s.trim()).filter(Boolean) : null;
  let defaultLanguage = arg('--default') || 'en';
  if (!cmLanguages && arg('--site')) {
    const env = { ...readEnvFile(arg('--env-file') || join(app, '.env.local')), ...process.env };
    const ctx = env[arg('--context-id-env') || 'SITECORE_EDGE_CONTEXT_ID'];
    if (!ctx) { console.log('context id env var not set'); return 2; }
    try { const r = await edgeSiteLanguages(arg('--site'), ctx); cmLanguages = r.languages; if (!arg('--default')) defaultLanguage = r.defaultLanguage; } catch (e) { console.log(`edge read failed: ${e.message}`); return 2; }
  }
  const files = walk(join(app, 'src')).map((p) => ({ path: relative(app, p), src: readFileSync(p, 'utf8') }));
  let waivers = null; const wPath = join(app, '.locale-drift-ignore.json');
  if (existsSync(wPath)) { try { waivers = JSON.parse(readFileSync(wPath, 'utf8').replace(/^﻿/, '')); } catch (e) { console.log(`${wPath}: ${e.message}`); return 2; } }
  const readApp = (rel) => { const p = join(app, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
  const findings = check({ routingSrc: readFileSync(routingPath, 'utf8'), files, cmLanguages, defaultLanguage, waivers, readApp });
  if (argv.includes('--json')) console.log(JSON.stringify({ cmLanguages, defaultLanguage, findings }, null, 2));
  else { console.log(`CM languages: ${cmLanguages ? cmLanguages.join(', ') : '(not given; drift rules skipped)'}`); for (const f of findings) console.log(`${f.sev.padEnd(4)}  ${f.rule}: ${f.msg}`); if (!findings.length) console.log('OK    no findings'); }
  return findings.some((f) => f.sev === 'FAIL') ? 1 : 0;
}

// ---------------------------------------------------------------- self-test
const ROUTING = "export const routing = defineRouting({ locales: [sitecoreConfig.defaultLanguage, 'de-DE'], defaultLocale: sitecoreConfig.defaultLanguage });";
const REQ = { path: 'src/i18n/request.ts', src: "import client from 'src/lib/sitecore-client';\nmessages[site] = await client.getDictionary({ locale, site });" };
const LAYOUT_OK = { path: 'src/app/[site]/[locale]/layout.tsx', src: 'export default async function L({ params }) { const { locale } = await params; return <html lang={locale}><body /></html>; }' };
const COMP = { path: 'src/components/Nav.tsx', src: "import { useTranslations } from 'next-intl';\nexport function Nav({ site }) { const t = useTranslations(site); return <nav aria-label={t('NavLabel')} />; }" };
// consumer-bound waiver fixtures
const HL_FILE = { path: 'src/app/layout.tsx', src: 'export default function R({ children }) { return <html lang="en"><body>{children}</body></html>; }' };
const WAIVER = { 'html-lang-hardcoded': { reason: 'client-side <html lang>', consumer: { file: 'src/ui/html-lang.tsx', pattern: String.raw`document\.documentElement\.lang\s*=`, mountedIn: 'src/Layout.tsx', mountPattern: String.raw`<HtmlLang\b` } } };
const APP = { 'src/ui/html-lang.tsx': "'use client'; useEffect(() => { document.documentElement.lang = lang; }, [lang]);", 'src/Layout.tsx': '<HtmlLang lang={l} />' };
const wfx = (over = {}) => { const app = { ...APP, ...(over.app || {}) }; for (const k of Object.keys(app)) if (app[k] === null) delete app[k]; return { ...base(), files: [REQ, COMP, HL_FILE], waivers: over.waivers === undefined ? WAIVER : over.waivers, readApp: (r) => app[r] ?? null }; };
const wmut = (fn) => { const w = JSON.parse(JSON.stringify(WAIVER)); fn(w['html-lang-hardcoded']); return w; };
const base = () => ({ routingSrc: ROUTING, files: [REQ, LAYOUT_OK, COMP], cmLanguages: ['en', 'de-DE'], defaultLanguage: 'en' });
export const FIXTURES = {
  'locale-not-in-cm': { ...base(), routingSrc: ROUTING.replace("'de-DE'", "'de-DE', 'fr-FR'"), cmLanguages: ['en', 'de-DE'] },
  'cm-not-in-routing': { ...base(), cmLanguages: ['en', 'de-DE', 'nl-NL'] },
  'case-mismatch': { ...base(), routingSrc: ROUTING.replace("'de-DE'", "'de-de'") },
  'html-lang-hardcoded': { ...base(), files: [REQ, COMP, { path: 'src/app/layout.tsx', src: 'export default function R({ children }) { return <html lang="en"><body>{children}</body></html>; }' }] },
  'dictionary-unused': { ...base(), files: [REQ, LAYOUT_OK, { path: 'src/components/Hero.tsx', src: 'export const Hero = () => <h1>Hi</h1>;' }] },
  'flat-namespace': { ...base(), files: [REQ, LAYOUT_OK, { path: 'src/components/Nav.tsx', src: COMP.src.replace('useTranslations(site)', 'useTranslations()') }] },
  'empty-fallback-idiom': { ...base(), files: [REQ, LAYOUT_OK, { path: 'src/components/Nav.tsx', src: COMP.src.replace("t('NavLabel')", "t('NavLabel') || ''") }] },
  'single-locale-routing': { ...base(), routingSrc: ROUTING.replace(", 'de-DE'", ''), cmLanguages: ['en', 'de-DE'], expectAlso: ['cm-not-in-routing'] },
};

export function selfTest({ quiet = false } = {}) {
  let failed = 0;
  const say = (ok, name) => { if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
  const clean = check(base());
  say(clean.length === 0, `clean fixture has no findings${clean.length ? ` (got ${clean.map((x) => x.rule).join(', ')})` : ''}`);
  say(JSON.stringify(parseRoutingLocales(ROUTING, 'en')) === '["en","de-DE"]', 'identifier locale resolves to the default language');
  for (const [rule, fx] of Object.entries(FIXTURES)) {
    const got = check(fx); const allowed = new Set([rule, ...(fx.expectAlso || [])]);
    say(got.some((x) => x.rule === rule), `fixture "${rule}" is flagged`);
    say(got.every((x) => allowed.has(x.rule)), `fixture "${rule}" flags only its own rule${got.some((x) => !allowed.has(x.rule)) ? ` (also ${got.filter((x) => !allowed.has(x.rule)).map((x) => x.rule).join(', ')})` : ''}`);
  }
  const sevOf = (fx, rule) => check(fx).find((x) => x.rule === rule)?.sev;
  const has = (fx, rule) => check(fx).some((x) => x.rule === rule && x.sev === 'FAIL');
  const fails = (fx) => check(fx).some((x) => x.sev === 'FAIL');
  say(sevOf(wfx(), 'html-lang-hardcoded') === 'WAIVED' && !fails(wfx()), 'S017.1 waiver + consumer file + write + mount present: WAIVED, no FAIL');
  say(has(wfx({ app: { 'src/ui/html-lang.tsx': null } }), 'waiver-unconsumed') && sevOf(wfx({ app: { 'src/ui/html-lang.tsx': null } }), 'html-lang-hardcoded') === 'FAIL', 'S017.2 consumer file deleted: FAIL waiver-unconsumed');
  say(has(wfx({ app: { 'src/ui/html-lang.tsx': "'use client';" } }), 'waiver-unconsumed'), 'S017.3 documentElement.lang write removed: FAIL');
  say(has(wfx({ app: { 'src/Layout.tsx': '<div />' } }), 'waiver-unconsumed'), 'S017.4 <HtmlLang mount removed: FAIL');
  say(has(wfx({ app: { 'src/Layout.tsx': null } }), 'waiver-unconsumed'), 'S017.4b mountedIn file deleted: FAIL');
  say(has(wfx({ app: { 'src/ui/html-lang.tsx': '// document.documentElement.lang = lang;' } }), 'waiver-unconsumed') && has(wfx({ app: { 'src/ui/html-lang.tsx': '/* document.documentElement.lang = lang; */' } }), 'waiver-unconsumed'), 'S017.4c write only in a comment: FAIL');
  say(has(wfx({ app: { 'src/Layout.tsx': '{/* <HtmlLang lang={l} /> */}' } }), 'waiver-unconsumed') && has(wfx({ app: { 'src/Layout.tsx': '// <HtmlLang lang={l} />' } }), 'waiver-unconsumed'), 'S017.4d mount only in a comment: FAIL');
  say(has(wfx({ waivers: wmut((w) => { delete w.reason; }) }), 'waiver-invalid') && has(wfx({ waivers: wmut((w) => { w.reason = '  '; }) }), 'waiver-invalid'), 'S017.5 waiver without reason: FAIL waiver-invalid');
  say(has(wfx({ waivers: wmut((w) => { delete w.consumer; }) }), 'waiver-invalid') && has(wfx({ waivers: wmut((w) => { delete w.consumer.mountPattern; }) }), 'waiver-invalid'), 'S017.6 waiver without (complete) consumer: FAIL waiver-invalid');
  say(has(wfx({ waivers: { 'no-such-rule': WAIVER['html-lang-hardcoded'] } }), 'waiver-invalid'), 'S017.7 unknown finding id: FAIL waiver-invalid');
  say(sevOf(wfx({ waivers: null }), 'html-lang-hardcoded') === 'FAIL' && !has(wfx({ waivers: null }), 'waiver-invalid'), 'S017.8 no waiver file: FAIL unchanged');
  say(check({ ...base(), cmLanguages: null }).length === 0, 'drift rules are skipped when no CM languages are given');
  if (quiet) return failed;
  for (const [reg, g] of [...Object.keys(GUARDS).map((k) => [GUARDS, k]), ...Object.keys(WAIVER_GUARDS).map((k) => [WAIVER_GUARDS, k])]) {
    reg[g] = false; const n = selfTest({ quiet: true }); reg[g] = true;
    const ok = n > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: rule "${g}" disabled is detected (${n} case(s) fail)`); if (!ok) failed++;
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); if (argv.includes('--self-test')) process.exitCode = selfTest(); else main(argv).then((c) => { process.exitCode = c; }); }
