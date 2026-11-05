#!/usr/bin/env node
// check-search-wiring.mjs: static gate for SitecoreAI integrated search in a Content SDK head app.
// Scans <app>/src for search hook / SearchService / search-event usage and reports FAIL / WARN.
//
// Usage: node check-search-wiring.mjs --app <head-app dir> [--json]
//        node check-search-wiring.mjs --self-test
// Exit: 0 no FAIL · 1 at least one FAIL · 2 usage.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const HOOK_IMPORT = /from\s+['"]@sitecore-content-sdk\/(?:nextjs|react)\/search['"]/;
const HOOK_CALL = /\buse(?:Infinite)?Search\s*(?:<[^>]*>)?\s*\(|\buseSuggest\s*(?:<[^>]*>)?\s*\(/;
const isClient = (src) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use client['"]/.test(src);

/** Extract the argument text of each hook call (balanced braces from the first `(`). */
export function hookCalls(src) {
  const out = []; const re = /\buse(?:Infinite)?Search\s*(?:<[^>]*>)?\s*\(/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    while (i < src.length && depth) { const ch = src[i]; if (ch === '(') depth++; else if (ch === ')') depth--; i++; }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

export const RULES = [
  { id: 'hook-client', sev: 'FAIL', test: (f) => HOOK_IMPORT.test(f.src) && HOOK_CALL.test(f.src) && !isClient(f.src)
      ? ['search hook used in a file without \'use client\' (a Server Component compiles, then prerender fails: useState is not a function)'] : [] },
  { id: 'hook-root-import', sev: 'FAIL', test: (f) => /import\s*\{[^}]*\b(?:use(?:Infinite)?Search|useSuggest)\b[^}]*\}\s*from\s*['"]@sitecore-content-sdk\/nextjs['"]/.test(f.src)
      ? ['search hooks imported from the package root; they exist only under @sitecore-content-sdk/nextjs/search'] : [] },
  { id: 'inline-sort-facet', sev: 'FAIL', test: (f) => hookCalls(f.src).some((a) => /\b(?:sort|facet)\s*:\s*[[{]/.test(a))
      ? ['inline sort/facet literal in a search hook call: a new object every render re-runs the search in a loop (measured 6,568 requests in 5 s); wrap it in useMemo'] : [] },
  { id: 'unmemoized-sort-facet-var', sev: 'FAIL', test: (f) => HOOK_CALL.test(f.src) && /\b(?:const|let)\s+(?:sort|facet)\w*\s*=(?!\s*(?:React\.)?useMemo\b)[^;\n]*[[{]/.test(f.src)
      ? ['sort/facet object built in the render body without useMemo, then passed to a search hook: same request loop as an inline literal'] : [] },
  { id: 'unencoded-q', sev: 'FAIL', test: (f) => /\?q=\$\{(?!\s*encodeURIComponent)/.test(f.src) || /['"]\?q=['"]\s*\+\s*(?!encodeURIComponent)/.test(f.src)
      ? ['?q= built without encodeURIComponent: &, # and + corrupt the URL'] : [] },
  { id: 'null-results-literal', sev: 'FAIL', test: (f) => /nullResults\s*:\s*false\b/.test(f.src)
      ? ['nullResults hard-coded false: the Null searches KPI can never fire; pass total === 0'] : [] },
  { id: 'event-no-consent', sev: 'FAIL', test: (f) => /type\s*:\s*['"]search['"]/.test(f.src) && /\bevent\s*\(/.test(f.src) && /from\s+['"]@sitecore-content-sdk\/events['"]/.test(f.src) && !/consent|trackEvent|canTrack|hasConsent/i.test(f.src)
      ? ['search event sent with event() and no consent guard; route it through trackEvent() (content-sdk-tracking-consent)'] : [] },
  { id: 'search-service-dep', sev: 'WARN', test: (f, ctx) => /from\s+['"]@sitecore-content-sdk\/search['"]/.test(f.src) && !ctx.deps['@sitecore-content-sdk/search']
      ? ['@sitecore-content-sdk/search imported but not a direct dependency (only transitive via react); pin it to the version npm ls shows'] : [] },
  { id: 'hook-no-locale', sev: 'WARN', test: (f) => hookCalls(f.src).some((a) => !/\blocale\b/.test(a))
      ? ['search hook call without locale: hooks do not pass the route locale for you'] : [] },
  { id: 'event-no-instance-id', sev: 'WARN', test: (f) => /type\s*:\s*['"]search['"]/.test(f.src) && /componentId/.test(f.src) && !/componentInstanceId/.test(f.src)
      ? ['search event without componentInstanceId (A/B/n attribution)'] : [] },
  { id: 'suspense-around-providers', sev: 'WARN', test: (f) => /<Suspense[^>]*>\s*<Providers\b/.test(f.src)
      ? ['<Suspense> wraps Providers: the whole tree renders on the client; keep the boundary local to the search component'] : [] },
  { id: 'runtime-tailwind-class', sev: 'WARN', test: (f) => /`(?:sm|md|lg|xl):\$\{/.test(f.src)
      ? ['responsive Tailwind class built at runtime (`md:${…}`): the scanner never sees it; list literal classes'] : [] },
];
export const GUARDS = Object.fromEntries(RULES.map((r) => [r.id, true]));
const APP_RULES = [
  { id: 'no-client-context-env', sev: 'WARN', test: (ctx) => ctx.usesHooks && !ctx.envHasClientCtx
      ? ['hooks used but no NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID in .env.example / .env.local: hooks stay idle forever, silently'] : [] },
];
for (const r of APP_RULES) GUARDS[r.id] = true;

export function check({ files, deps = {}, envText = '' }) {
  const findings = [];
  const ctx = { deps, usesHooks: files.some((f) => HOOK_IMPORT.test(f.src) && HOOK_CALL.test(f.src)), envHasClientCtx: /^\s*NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID\s*=/m.test(envText) };
  for (const f of files) for (const r of RULES) if (GUARDS[r.id]) for (const msg of r.test(f, ctx)) findings.push({ sev: r.sev, rule: r.id, file: f.path, msg });
  for (const r of APP_RULES) if (GUARDS[r.id]) for (const msg of r.test(ctx)) findings.push({ sev: r.sev, rule: r.id, file: '(app)', msg });
  return findings;
}

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue;
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) walk(p, acc); else if (/\.(tsx?|jsx?|mjs)$/.test(n) && !/\.(test|spec)\./.test(n)) acc.push(p);
  }
  return acc;
}

export function loadApp(app) {
  const src = existsSync(join(app, 'src')) ? join(app, 'src') : app;
  const files = walk(src).map((p) => ({ path: relative(app, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));
  let deps = {}; try { const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')); deps = { ...pkg.dependencies, ...pkg.devDependencies }; } catch { /* no package.json */ }
  const envText = readdirSync(app).filter((n) => /^\.env(\.|$)/.test(n)).map((n) => readFileSync(join(app, n), 'utf8')).join('\n');
  return { files, deps, envText };
}

function main(argv) {
  const i = argv.indexOf('--app');
  if (i < 0 || !argv[i + 1]) { console.log('usage: check-search-wiring.mjs --app <dir> [--json] | --self-test'); return 2; }
  const app = argv[i + 1];
  if (!existsSync(app)) { console.log(`usage: ${app} does not exist`); return 2; }
  const findings = check(loadApp(app));
  if (argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    for (const f of findings) console.log(`${f.sev.padEnd(4)}  ${f.rule.padEnd(26)} ${f.file}: ${f.msg}`);
    const nf = findings.filter((f) => f.sev === 'FAIL').length;
    console.log(`${nf} FAIL, ${findings.length - nf} WARN`);
  }
  return findings.some((f) => f.sev === 'FAIL') ? 1 : 0;
}

// ---------------------------------------------------------------- self-test
const CLEAN = `'use client';
import { useMemo } from 'react';
import { useSearch } from '@sitecore-content-sdk/nextjs/search';
import { trackEvent } from 'lib/consent/track';
export function S({ q, locale, total, uid }) {
  const facet = useMemo(() => ({ all: true }), []);
  const r = useSearch({ searchIndexId: 'i', query: q, facet, locale });
  const href = \`?q=\${encodeURIComponent(q)}\`;
  trackEvent({ type: 'search', core: { componentId: uid, componentInstanceId: uid, nullResults: total === 0 } });
  return null;
}`;
const f = (src, path = 'src/components/S.tsx') => ({ path, src });
const ENV = 'NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID=x\n';
export const FIXTURES = {
  'hook-client': { files: [f(CLEAN.replace("'use client';\n", ''))], envText: ENV },
  'hook-root-import': { files: [f(CLEAN.replace("from '@sitecore-content-sdk/nextjs/search'", "from '@sitecore-content-sdk/nextjs'"))], envText: ENV },
  'inline-sort-facet': { files: [f(CLEAN.replace('facet, locale', 'facet: { all: true }, locale'))], envText: ENV },
  'unmemoized-sort-facet-var': { files: [f(CLEAN.replace('const facet = useMemo(() => ({ all: true }), []);', 'const facet = flag ? { all: true } : undefined;'))], envText: ENV },
  'unencoded-q': { files: [f(CLEAN.replace('${encodeURIComponent(q)}', '${q}'))], envText: ENV },
  'null-results-literal': { files: [f(CLEAN.replace('total === 0', 'false'))], envText: ENV },
  'event-no-consent': { files: [f(CLEAN.replace("import { trackEvent } from 'lib/consent/track';", "import { event } from '@sitecore-content-sdk/events';").replace('trackEvent(', 'event('))], envText: ENV },
  'search-service-dep': { files: [f(CLEAN), f("import { SearchService } from '@sitecore-content-sdk/search';\nexport const s = 1;", 'src/lib/s.ts')], envText: ENV },
  'hook-no-locale': { files: [f(CLEAN.replace('facet, locale', 'facet'))], envText: ENV },
  'event-no-instance-id': { files: [f(CLEAN.replace(' componentInstanceId: uid,', ''))], envText: ENV },
  'suspense-around-providers': { files: [f(CLEAN), f('export default function L({c}){ return <Suspense>\n<Providers>{c}</Providers></Suspense>; }', 'src/app/layout.tsx')], envText: ENV },
  'runtime-tailwind-class': { files: [f(CLEAN), f('export const c = (b) => `md:${b}`;', 'src/components/c.ts')], envText: ENV },
  'no-client-context-env': { files: [f(CLEAN)], envText: '' },
};

export function selfTest({ quiet = false } = {}) {
  let failed = 0;
  const say = (ok, name) => { if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
  const clean = check({ files: [f(CLEAN)], envText: ENV });
  say(clean.length === 0, `clean fixture has no findings${clean.length ? ` (got ${clean.map((x) => x.rule).join(', ')})` : ''}`);
  for (const [rule, fx] of Object.entries(FIXTURES)) {
    const got = check(fx);
    say(got.some((x) => x.rule === rule), `fixture "${rule}" is flagged`);
    say(got.every((x) => x.rule === rule), `fixture "${rule}" flags only its own rule${got.some((x) => x.rule !== rule) ? ` (also ${got.filter((x) => x.rule !== rule).map((x) => x.rule).join(', ')})` : ''}`);
  }
  say(check(FIXTURES['inline-sort-facet']).find((x) => x.rule === 'inline-sort-facet')?.sev === 'FAIL', 'inline literal is a FAIL, not a WARN');
  if (quiet) return failed;
  for (const g of Object.keys(GUARDS)) {
    GUARDS[g] = false; const n = selfTest({ quiet: true }); GUARDS[g] = true;
    const ok = n > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: rule "${g}" disabled is detected (${n} case(s) fail)`); if (!ok) failed++;
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); process.exitCode = argv.includes('--self-test') ? selfTest() : main(argv); }
