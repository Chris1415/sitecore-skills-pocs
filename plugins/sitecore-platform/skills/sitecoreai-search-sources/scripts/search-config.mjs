#!/usr/bin/env node
// search-config.mjs: read-only listing of SitecoreAI search sources via GET /search/v1/config.
// Fake-context control first (must be 404 "No sitecore context"), then the real call.
// The context id and the bearer come from env vars only and are never printed.
//
// Usage:
//   node search-config.mjs --context-env <VAR> [--env-file <f>] (--bearer-env <VAR> | --client-prefix <PREFIX>)
//        [--edge-url <url>] [--json] [--datasource <source id>]
//   node search-config.mjs --self-test
// Exit: 0 listed · 1 control failed / 401 / 403 / error · 2 usage.
import { readFileSync } from 'node:fs';

export const FAKE = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_EDGE = 'https://edge-platform.sitecorecloud.io';
export const TOKEN_URL = 'https://auth.sitecorecloud.io/oauth/token';
export const GUARDS = { baseline: true, redact: true, explain403: true, getOnly: true };

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--context-env') o.contextEnv = v();
    else if (a === '--env-file') o.envFile = v();
    else if (a === '--bearer-env') o.bearerEnv = v();
    else if (a === '--client-prefix') o.clientPrefix = v();
    else if (a === '--edge-url') o.edgeUrl = v();
    else if (a === '--json') o.json = true;
    else if (a === '--datasource') o.datasource = v();
    else if (a === '--bearer' || a === '--token' || a === '--context') o.secretArgv = a;
    else if (a === '--self-test') o.selfTest = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}
export function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export function flags(field) {
  const on = (k) => field?.[k]?.enabled ? (field[k].name && field[k].name !== field.name ? `${k}(${field[k].name})` : k) : null;
  return ['search', 'filter', 'facet', 'sort', 'retrieve', 'key'].map(on).filter(Boolean);
}

/** Request layer: read-only except the token mint. */
export function makeHttp(fetchImpl) {
  return async (method, url, init = {}) => {
    if (GUARDS.getOnly && method !== 'GET' && url !== TOKEN_URL) throw new Error(`refused: ${method} is not allowed (read-only tool)`);
    const r = await fetchImpl(url, { method, ...init }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* text */ }
    return { status: r.status, json, text };
  };
}

export async function main(argv, { fetchImpl = globalThis.fetch, env = process.env, log = console.log } = {}) {
  let o; try { o = parseArgs(argv); } catch (e) { log(`usage: ${e.message}`); return 2; }
  if (o.secretArgv) { log(`usage: ${o.secretArgv} on argv is refused; pass secrets through env vars (--context-env, --bearer-env)`); return 2; }
  if (!o.contextEnv || (!o.bearerEnv && !o.clientPrefix)) { log('usage: --context-env <VAR> and one of --bearer-env <VAR> | --client-prefix <PREFIX> are required'); return 2; }
  const vars = o.envFile ? { ...env, ...loadEnvFile(o.envFile) } : env;
  const ctx = vars[o.contextEnv]; if (!ctx) { log(`usage: ${o.contextEnv} is empty`); return 2; }
  const secrets = [ctx];
  const scrub = (s) => { let t = String(s); if (GUARDS.redact) for (const x of secrets) if (x) t = t.split(x).join('<redacted>'); return t; };
  const say = (s) => log(scrub(s));
  const http = makeHttp(fetchImpl);
  let bearer = o.bearerEnv ? vars[o.bearerEnv] : null;
  if (o.clientPrefix) {
    const id = vars[`${o.clientPrefix}_ID`], secret = vars[`${o.clientPrefix}_SECRET`];
    if (!id || !secret) { say(`usage: ${o.clientPrefix}_ID / _SECRET not set`); return 2; }
    secrets.push(id, secret);
    const t = await http('POST', TOKEN_URL, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, audience: 'https://api.sitecorecloud.io' }).toString() });
    bearer = t.json?.access_token; if (!bearer) { say(`FAIL  token mint: HTTP ${t.status}`); return 1; }
  }
  if (!bearer) { say('usage: bearer env var is empty'); return 2; }
  secrets.push(bearer);
  const edge = (o.edgeUrl || DEFAULT_EDGE).replace(/\/$/, '');
  const get = (c) => http('GET', `${edge}/search/v1/config?sitecoreContextId=${encodeURIComponent(c)}`, { headers: { authorization: `Bearer ${bearer}` } });

  const c = await get(FAKE);
  if (!(c.status === 404 && /no sitecore context/i.test(c.json?.detail || ''))) {
    say(`FAIL  control: fake context answered ${c.status}, expected 404 "No sitecore context" (baseline moved)`);
    if (GUARDS.baseline) return 1;
  } else say('PASS  control: fake context → 404 No sitecore context');

  const r = await get(ctx);
  if (r.status === 401 || r.status === 403) {
    say(`FAIL  config: HTTP ${r.status} ${scrub(r.text).slice(0, 160)}`);
    if (GUARDS.explain403) say('      The route needs a bearer with a search-config scope. Measured 2026-10-02: org automation client and Edge admin client both get 403 "insufficient scopes". Use the Marketplace SDK (xmc.search.getConfigs) or read the source ID from the UI Settings tab. See references/config-api.md.');
    return 1;
  }
  if (r.status !== 200 || !Array.isArray(r.json)) { say(`FAIL  config: HTTP ${r.status} ${scrub(r.text).slice(0, 200)}`); return 1; }
  const sources = r.json.map((s) => ({ id: s.id, name: s.name, type: s.contentType || (s.contentTypes || []).join('|') || null, templateIds: s.templateIds || (s.templateId ? [s.templateId] : []), fuzzy: !!s.searchSettings?.fuzzySearch?.enabled, fields: (s.fields || []).map((f) => ({ name: f.name, displayName: f.displayName, type: f.type, flags: flags(f) })) }));
  if (o.json) say(JSON.stringify(sources, null, 2));
  else {
    say(`PASS  ${sources.length} source(s)${sources.length ? '' : ' (rolled out, none created yet)'}`);
    for (const s of sources) { say(`  ${s.id}  ${s.name}  type=${s.type} templates=${s.templateIds.join(',') || '-'} fuzzy=${s.fuzzy}`); for (const f of s.fields) say(`      ${f.name}${f.displayName && f.displayName !== f.name ? ` ("${f.displayName}")` : ''} [${f.type || '?'}] ${f.flags.join(' ')}`); }
  }
  if (o.datasource) {
    const s = sources.find((x) => x.id === o.datasource);
    if (!s) { say(`FAIL  --datasource: no source with id ${o.datasource}`); return 1; }
    say(JSON.stringify({ searchIndex: s.id, fieldsMapping: {} }));
  }
  return 0;
}

// ---------------------------------------------------------------- self-test
export async function selfTest({ quiet = false } = {}) {
  const CTX = 'contextIdABCDEFGHIJ123', TOK = 'eyJhbGciOiJub25lIn0.eyJzIjoxfQ.sigsigsig', CS = 'clientSecretXYZ987654';
  const res = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  const CFG = [{ id: 'src-1', name: 'Articles', contentType: 'content', templateIds: ['t1'], searchSettings: { fuzzySearch: { enabled: true } }, fields: [{ name: 'title', displayName: 'Title', type: 'string', search: { enabled: true }, facet: { enabled: false } }, { name: 'category', type: 'string', facet: { enabled: true, name: 'Category' }, filter: { enabled: true } }] }];
  const mk = ({ mode = 'ok', baselineMoved = false } = {}) => {
    const calls = [];
    const f = async (url, init) => {
      calls.push({ url, method: init.method });
      if (url.includes('oauth/token')) return res(200, { access_token: TOK });
      if (url.includes(FAKE)) return baselineMoved ? res(200, []) : res(404, { title: 'NotFound', detail: 'No sitecore context', status: 404 });
      if (mode === '403') return res(403, { message: `insufficient scopes for ${CTX}` });
      if (mode === '401') return res(401, { title: 'Unauthorized', detail: 'Config endpoint requires Authorization' });
      return res(200, CFG);
    };
    return { f, calls };
  };
  const run = async (argv, opts) => { const { f, calls } = mk(opts); const lines = []; const code = await main(argv, { fetchImpl: f, env: { CTX, TOK, P_ID: 'cid', P_SECRET: CS }, log: (l) => lines.push(l) }); return { code, text: lines.join('\n'), calls }; };
  const base = ['--context-env', 'CTX', '--bearer-env', 'TOK'];
  const cases = [
    ['lists sources with facet display names', async () => { const r = await run(base); return r.code === 0 && r.text.includes('facet(Category)') && r.text.includes('src-1'); }],
    ['control runs first', async () => { const r = await run(base); return r.calls[0].url.includes(FAKE); }],
    ['baseline moved → exit 1', async () => (await run(base, { baselineMoved: true })).code === 1],
    ['403 → exit 1 with the scope explanation', async () => { const r = await run(base, { mode: '403' }); return r.code === 1 && /Marketplace SDK/.test(r.text); }],
    ['401 → exit 1', async () => (await run(base, { mode: '401' })).code === 1],
    ['context, bearer and client secret never printed', async () => { const a = await run(['--context-env', 'CTX', '--client-prefix', 'P', '--json'], { mode: '403' }); const b = await run(['--context-env', 'CTX', '--client-prefix', 'P', '--json']); return ![CTX, TOK, CS].some((s) => a.text.includes(s) || b.text.includes(s)); }],
    ['bearer on argv refused', async () => (await run(['--bearer', 'x', ...base])).code === 2],
    ['--datasource prints a stub for a known id', async () => { const r = await run([...base, '--datasource', 'src-1']); return r.code === 0 && r.text.includes('{"searchIndex":"src-1","fieldsMapping":{}}'); }],
    ['--datasource unknown id → exit 1', async () => (await run([...base, '--datasource', 'nope'])).code === 1],
    ['only GET calls besides the token mint', async () => { const r = await run(['--context-env', 'CTX', '--client-prefix', 'P']); return r.calls.every((c) => c.method === 'GET' || c.url.includes('oauth')); }],
    ['request layer refuses a non-GET', async () => { const h = makeHttp(async () => res(200, {})); try { await h('POST', 'https://edge-platform.sitecorecloud.io/search/v1/config'); return false; } catch (e) { return /refused/.test(e.message); } }],
  ];
  let failed = 0;
  for (const [name, fn] of cases) { let ok = false; try { ok = await fn(); } catch { ok = false; } if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  if (quiet) return failed;
  for (const g of Object.keys(GUARDS)) { GUARDS[g] = false; const n = await selfTest({ quiet: true }); GUARDS[g] = true; const ok = n > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: guard "${g}" disabled is detected (${n} case(s) fail)`); if (!ok) failed++; }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); process.exitCode = argv.includes('--self-test') ? await selfTest() : await main(argv); }
