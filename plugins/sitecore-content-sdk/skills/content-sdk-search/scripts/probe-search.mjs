#!/usr/bin/env node
// probe-search.mjs: read-only live probe of SitecoreAI integrated search (POST /v1/search, /v1/search/suggest).
// Runs two controls before your query so the probe can fail: a fake context id must answer
// 404 "No sitecore context", and your context with a fake index must answer 404 "no search index found".
// The context id is read from an env var (never argv) and never printed.
//
// Usage:
//   node probe-search.mjs --context-env NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID [--env-file .env.local]
//        [--index <source id>] [--keyphrase <q>] [--facet-all] [--limit 3] [--locale en]
//        [--suggest <q>] [--expect-results] [--edge-url <url>] [--out <file.json>] [--json]
//   node probe-search.mjs --self-test
// Exit: 0 ok · 1 a control or the query failed · 2 usage.
import { readFileSync, writeFileSync } from 'node:fs';

export const FAKE = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_EDGE = 'https://edge-platform.sitecorecloud.io';

// Guards are switchable only so the self-test can prove each one is load-bearing.
export const GUARDS = { baseline: true, contextRecognized: true, expectResults: true, redact: true, fakeIndexFails: true };

export function classify(status, json) {
  if (status === 404 && json && /no sitecore context/i.test(String(json.detail || ''))) return 'no-context';
  if (status === 404 && Array.isArray(json?.errors) && json.errors.some((e) => /no search index found/i.test(String(e.message)))) return 'index-not-found';
  if (status === 200 && json && typeof json === 'object') return 'ok';
  return 'other';
}

function parseArgs(argv) {
  const o = { limit: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--context-env') o.contextEnv = v();
    else if (a === '--env-file') o.envFile = v();
    else if (a === '--index') o.index = v();
    else if (a === '--keyphrase') o.keyphrase = v();
    else if (a === '--facet-all') o.facetAll = true;
    else if (a === '--limit') o.limit = Number(v());
    else if (a === '--locale') o.locale = v();
    else if (a === '--suggest') o.suggest = v();
    else if (a === '--expect-results') o.expectResults = true;
    else if (a === '--edge-url') o.edgeUrl = v();
    else if (a === '--out') o.out = v();
    else if (a === '--json') o.json = true;
    else if (a === '--context') o.contextArgv = true;
    else if (a === '--self-test') o.selfTest = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export async function main(argv, { fetchImpl = globalThis.fetch, env = process.env, log = console.log, write = writeFileSync } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(`usage: ${e.message}`); return 2; }
  if (o.contextArgv) { log('usage: pass the context id through an env var (--context-env NAME), not argv'); return 2; }
  if (!o.contextEnv) { log('usage: --context-env <VAR> is required (e.g. NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID)'); return 2; }
  const vars = o.envFile ? { ...env, ...loadEnvFile(o.envFile) } : env;
  const ctx = vars[o.contextEnv];
  if (!ctx) { log(`usage: ${o.contextEnv} is empty or unset`); return 2; }
  const edge = (o.edgeUrl || vars.SITECORE_EDGE_PLATFORM_HOSTNAME || DEFAULT_EDGE).replace(/\/$/, '').replace(/^(?!https?:)/, 'https://');
  const scrub = (s) => (GUARDS.redact ? String(s).split(ctx).join('<context>') : String(s));
  const say = (s) => log(scrub(s));
  const post = async (path, contextId, body) => {
    const r = await fetchImpl(`${edge}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sitecore-contextid': contextId }, body: JSON.stringify(body) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  };
  const searchBody = (index, extra = {}) => ({ config: { id: index }, limit: o.limit, offset: 0, query: { keyphrase: o.keyphrase ?? '' }, sessionId: '', sort: { fields: [] }, ...(o.locale && { locale: o.locale }), ...extra });
  const report = { edge, controls: {}, search: null, suggest: null };
  let fail = 0;

  const c1 = await post('/v1/search', FAKE, searchBody(FAKE));
  report.controls.fakeContext = { status: c1.status, kind: classify(c1.status, c1.json) };
  if (report.controls.fakeContext.kind !== 'no-context') {
    say(`FAIL  control: fake context answered ${c1.status} ${report.controls.fakeContext.kind}, expected 404 "No sitecore context" (baseline moved; stop and re-read the API)`);
    if (GUARDS.baseline) return 1;
  } else say('PASS  control: fake context → 404 No sitecore context');

  const c2 = await post('/v1/search', ctx, searchBody(FAKE));
  report.controls.fakeIndex = { status: c2.status, kind: classify(c2.status, c2.json) };
  if (report.controls.fakeIndex.kind === 'no-context') {
    say('FAIL  context: your context id is not recognised by the search plane (404 No sitecore context): dead, wrong environment, or not search-enabled');
    if (GUARDS.contextRecognized) return 1;
  } else if (report.controls.fakeIndex.kind !== 'index-not-found') {
    say(`FAIL  control: fake index answered ${c2.status} ${report.controls.fakeIndex.kind}, expected 404 "no search index found"`);
    if (GUARDS.fakeIndexFails) fail++;
  } else say('PASS  context recognised; fake index → 404 no search index found');

  if (o.index) {
    const r = await post('/v1/search', ctx, searchBody(o.index, o.facetAll ? { facet: { all: true } } : {}));
    const kind = classify(r.status, r.json);
    const content = Array.isArray(r.json?.content) ? r.json.content : [];
    report.search = { status: r.status, kind, total: r.json?.total ?? null, fieldsOnFirst: content[0] ? Object.keys(content[0]) : [], facets: Array.isArray(r.json?.facet) ? r.json.facet.map((f) => f.name) : [] };
    if (kind !== 'ok') { say(`FAIL  search: ${r.status} ${kind} ${scrub(r.text).slice(0, 200)}`); fail++; }
    else {
      say(`PASS  search: 200 total=${report.search.total} fields=[${report.search.fieldsOnFirst.join(', ')}] facets=[${report.search.facets.join(', ')}]`);
      if (o.expectResults && !(report.search.total > 0)) { say('FAIL  --expect-results: total is 0 (unindexed? content sources need a manual reindex after publish)'); if (GUARDS.expectResults) fail++; }
    }
    if (o.out) write(o.out, scrub(JSON.stringify({ request: searchBody(o.index), status: r.status, body: r.json }, null, 2)));
  }
  if (o.suggest) {
    if (!o.index) { say('usage: --suggest needs --index'); return 2; }
    const r = await post('/v1/search/suggest', ctx, { config: { id: o.index }, query: { keyphrase: o.suggest }, ...(o.locale && { locale: o.locale }) });
    report.suggest = { status: r.status, kind: classify(r.status, r.json), suggestions: (r.json?.querySuggestions || []).map((s) => s.text) };
    if (report.suggest.kind !== 'ok') { say(`FAIL  suggest: ${r.status} ${scrub(r.text).slice(0, 200)}`); fail++; }
    else say(`PASS  suggest: [${report.suggest.suggestions.join(', ')}]`);
  }
  if (o.json) say(JSON.stringify(report, null, 2));
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------- self-test
export async function selfTest({ quiet = false } = {}) {
  const CTX = 'realContextIdABCDEFGH123';
  const res = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  const NOCTX = { title: 'NotFound', detail: 'No sitecore context', status: 404 };
  const NOIDX = (id) => ({ errors: [{ message: `no search index found for config ${id}`, code: 404 }] });
  const mk = ({ baselineMoved = false, deadCtx = false, total = 2, fakeIndexOk = false, echoCtx = false } = {}) => {
    const calls = [];
    const f = async (url, init) => {
      const b = JSON.parse(init.body); const c = init.headers['x-sitecore-contextid']; calls.push({ url, c, b });
      if (c === FAKE) return baselineMoved ? res(200, { content: [], total: 0 }) : res(404, NOCTX);
      if (deadCtx) return res(404, NOCTX);
      if (b.config.id === FAKE) return fakeIndexOk ? res(200, { content: [], total: 0 }) : res(404, NOIDX(FAKE));
      if (echoCtx) return res(500, { error: `upstream failed for context ${c}` });
      if (url.endsWith('/suggest')) return res(200, { querySuggestions: [{ text: 'alpha', queryPlusText: 'alpha' }], previewResults: [] });
      return res(200, { content: total ? [{ id: 'a', title: 'A' }] : [], total, facet: [{ name: 'Type', value: [] }] });
    };
    return { f, calls };
  };
  const run = async (argv, opts) => { const { f, calls } = mk(opts); const lines = []; const code = await main(argv, { fetchImpl: f, env: { CTX }, log: (l) => lines.push(l), write: () => {} }); return { code, text: lines.join('\n'), calls }; };
  const base = ['--context-env', 'CTX', '--index', 'idx-1'];
  const cases = [
    ['healthy run passes, controls run first', async () => { const r = await run([...base, '--suggest', 'al']); return r.code === 0 && r.calls[0].c === FAKE && r.calls[1].b.config.id === FAKE; }],
    ['baseline moved → exit 1 before any real query', async () => { const r = await run(base, { baselineMoved: true }); return r.code === 1 && r.calls.length === 1; }],
    ['dead context → exit 1', async () => (await run(base, { deadCtx: true })).code === 1],
    ['dead context, controls only → exit 1', async () => (await run(['--context-env', 'CTX'], { deadCtx: true })).code === 1],
    ['server echoing the context id is scrubbed', async () => { const r = await run(base, { echoCtx: true }); return r.code === 1 && !r.text.includes(CTX) && r.text.includes('<context>'); }],
    ['fake index answering 200 → exit 1', async () => (await run(base, { fakeIndexOk: true })).code === 1],
    ['--expect-results with total 0 → exit 1', async () => (await run([...base, '--expect-results'], { total: 0 })).code === 1],
    ['total 0 without --expect-results → exit 0', async () => (await run(base, { total: 0 })).code === 0],
    ['context id never printed (json report too)', async () => { const r = await run([...base, '--json']); return r.code === 0 && !r.text.includes(CTX); }],
    ['context id in argv refused', async () => (await run(['--context', 'x', '--context-env', 'CTX'])).code === 2],
    ['classify tells the two 404s apart', async () => classify(404, NOCTX) === 'no-context' && classify(404, NOIDX('x')) === 'index-not-found' && classify(500, {}) === 'other'],
  ];
  let failed = 0;
  for (const [name, fn] of cases) { let ok = false; try { ok = await fn(); } catch { ok = false; } if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  if (quiet) return failed;
  // Mutation sweep: with any single guard off, at least one case must fail.
  for (const g of Object.keys(GUARDS)) {
    GUARDS[g] = false; const f = await selfTest({ quiet: true }); GUARDS[g] = true;
    const ok = f > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: guard "${g}" disabled is detected (${f} case(s) fail)`); if (!ok) failed++;
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const argv = process.argv.slice(2);
  process.exitCode = argv.includes('--self-test') ? await selfTest() : await main(argv);
}
