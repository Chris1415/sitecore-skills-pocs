#!/usr/bin/env node
// search-push.mjs: validate and (only with --yes) send one Ingestion Service API push to ONE named source.
// Writes go to the LIVE index with no server-side dry run, so every rule is checked locally first.
// The ApiKey is read from an env var (default SITECORE_SEARCH_PUSH_APIKEY), never argv, never printed.
//
// Usage:
//   node search-push.mjs --endpoint <https base_url> --source <source id> --file <ops.json>
//        [--yes] [--key-env SITECORE_SEARCH_PUSH_APIKEY] [--env-file <f>] [--json]
//   node search-push.mjs --self-test
// ops.json: { "operations": [ { "action": "upsert"|"delete", "id"|"sc_url": "...", "locale"?, "canonical_url"?, "fields"?: { "<name>": "<string>" } } ] }
// Exit: 0 validated (no --yes) or 200 · 1 validation failed / HTTP error / 207 with failures · 2 usage.
import { readFileSync } from 'node:fs';

export const MAX_OPS = 50;
export const MAX_BYTES = 512 * 1024;
export const COMPACT_DT = /^\d{8}T\d{6}Z$/;
export const ISO_DT = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
export const GUARDS = { count: true, size: true, strings: true, isoDate: true, reserved: true, identity: true, action: true, explicitSource: true, requireYes: true, https: true, redact: true, partialFails: true, keyArgv: true };

/** Returns a list of human-readable problems; empty = valid. */
export function validate(doc) {
  const p = [];
  const ops = doc?.operations;
  if (!Array.isArray(ops)) return ['body must be { "operations": [...] }'];
  if (GUARDS.count && (ops.length < 1 || ops.length > MAX_OPS)) p.push(`operations: ${ops.length} (must be 1-${MAX_OPS}; split the batch)`);
  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8');
  if (GUARDS.size && bytes > MAX_BYTES) p.push(`payload ${bytes} bytes > ${MAX_BYTES} (512 KiB): the whole request would be rejected (413)`);
  ops.forEach((op, i) => {
    const at = `operations[${i}]`;
    if (GUARDS.action && !['upsert', 'delete'].includes(op?.action)) p.push(`${at}.action must be "upsert" or "delete"`);
    const ids = ['id', 'sc_url'].filter((k) => typeof op?.[k] === 'string' && op[k].trim());
    if (GUARDS.identity && ids.length !== 1) p.push(`${at}: exactly one identity (id or sc_url) required, got ${ids.length}`);
    if (op?.fields !== undefined) {
      if (typeof op.fields !== 'object' || op.fields === null || Array.isArray(op.fields)) { p.push(`${at}.fields must be an object`); return; }
      for (const [k, v] of Object.entries(op.fields)) {
        if (GUARDS.reserved && (/^sc_/i.test(k) || k === '@search.action')) p.push(`${at}.fields.${k}: reserved name (sc_* and @search.action)`);
        if (GUARDS.strings && typeof v !== 'string') p.push(`${at}.fields.${k}: value must be a string (got ${Array.isArray(v) ? 'array' : typeof v})`);
        else if (GUARDS.isoDate && typeof v === 'string' && ISO_DT.test(v) && !COMPACT_DT.test(v)) p.push(`${at}.fields.${k}: ISO datetime "${v}" is rejected; use YYYYMMDDTHHMMSSZ`);
      }
    }
  });
  return p;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--endpoint') o.endpoint = v();
    else if (a === '--source') o.source = v();
    else if (a === '--file') o.file = v();
    else if (a === '--yes') o.yes = true;
    else if (a === '--key-env') o.keyEnv = v();
    else if (a === '--env-file') o.envFile = v();
    else if (a === '--json') o.json = true;
    else if (a === '--key' || a === '--apikey' || a === '--api-key') { o.keyArgv = true; v(); }
    else if (a === '--self-test') o.selfTest = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}
function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) { const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}

export async function main(argv, { fetchImpl = globalThis.fetch, env = process.env, log = console.log, readFile = (f) => readFileSync(f, 'utf8') } = {}) {
  let o; try { o = parseArgs(argv); } catch (e) { log(`usage: ${e.message}`); return 2; }
  if (o.keyArgv && GUARDS.keyArgv) { log('usage: the ApiKey is never accepted on argv; set SITECORE_SEARCH_PUSH_APIKEY (or --key-env NAME)'); return 2; }
  if (GUARDS.explicitSource && (!o.source || !o.source.trim() || /^(\*|all|any)$/i.test(o.source.trim()))) { log('usage: --source <source id> is required and must name ONE source (the key is instance-wide; the tool never guesses a target)'); return 2; }
  if (!o.endpoint || !o.file) { log('usage: --endpoint <base_url> and --file <ops.json> are required'); return 2; }
  if (GUARDS.https && !/^https:\/\//i.test(o.endpoint)) { log('usage: --endpoint must be https://'); return 2; }
  let doc; try { doc = JSON.parse(readFile(o.file)); } catch (e) { log(`FAIL  cannot read ${o.file}: ${e.message}`); return 1; }
  const problems = validate(doc);
  if (problems.length) { for (const x of problems) log(`FAIL  ${x}`); return 1; }
  const n = doc.operations.length;
  const url = `${o.endpoint.replace(/\/$/, '')}/v1/index/${encodeURIComponent(o.source.trim())}/push`;
  if (!o.yes && GUARDS.requireYes) { log(`PASS  ${n} operation(s) valid. Not sent: add --yes to POST to ${url} (writes the LIVE index; a later reindex of a content/site source wipes it).`); return 0; }
  const vars = o.envFile ? { ...env, ...loadEnvFile(o.envFile) } : env;
  const key = vars[o.keyEnv || 'SITECORE_SEARCH_PUSH_APIKEY'];
  if (!key) { log(`usage: ${o.keyEnv || 'SITECORE_SEARCH_PUSH_APIKEY'} is not set`); return 2; }
  const scrub = (s) => (GUARDS.redact ? String(s).split(key).join('<redacted>') : String(s));
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `ApiKey ${key}` }, body: JSON.stringify(doc) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  if (o.json) log(scrub(JSON.stringify({ status: r.status, body: json ?? text }, null, 2)));
  if (r.status === 200) { log(`PASS  200: ${n} operation(s) accepted`); return 0; }
  if (r.status === 207) {
    const failed = (json?.results || []).filter((x) => x && x.succeeded === false);
    log(`${failed.length ? 'FAIL' : 'PASS'}  207 partial: ${failed.length} of ${n} failed`);
    for (const f of failed) log(scrub(`      op[${f.index}] ${f.action} key=${f.key} status=${f.statusCode}`));
    return failed.length && GUARDS.partialFails ? 1 : 0;
  }
  const hint = { 400: 'invalid body or unknown field', 401: 'key missing/invalid/revoked (scope search.pushapi:m)', 403: 'key lacks search.pushapi:m', 404: 'source missing, unpublished, or another instance', 413: 'payload > 512 KiB', 503: 'ingestion disabled' }[r.status] || '';
  log(scrub(`FAIL  HTTP ${r.status} ${hint} ${text.slice(0, 300)}`));
  return 1;
}

// ---------------------------------------------------------------- self-test
export async function selfTest({ quiet = false } = {}) {
  const KEY = 'pushApiKeySECRET1234567890';
  const good = { operations: [{ action: 'upsert', id: 'd1', fields: { title: 'A', published: '20261002T120000Z' } }, { action: 'delete', id: 'd2' }] };
  const res = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  const run = async (argv, { doc = good, status = 200, body = {} } = {}) => {
    const calls = []; const lines = [];
    const code = await main(argv, { fetchImpl: async (url, init) => { calls.push({ url, init }); return res(status, typeof body === 'function' ? body(init) : body); }, env: { SITECORE_SEARCH_PUSH_APIKEY: KEY }, log: (l) => lines.push(l), readFile: () => JSON.stringify(doc) });
    return { code, calls, text: lines.join('\n') };
  };
  const base = ['--endpoint', 'https://ingest.example.test', '--source', 'src-1', '--file', 'ops.json'];
  const ops = (k) => ({ operations: Array.from({ length: k }, (_, i) => ({ action: 'upsert', id: `d${i}`, fields: { title: 't' } })) });
  const one = (op) => ({ operations: [op] });
  const cases = [
    ['valid without --yes: no network call', async () => { const r = await run(base); return r.code === 0 && r.calls.length === 0; }],
    ['valid with --yes: one POST, ApiKey header, /v1/index/<id>/push', async () => { const r = await run([...base, '--yes']); const c = r.calls[0]; return r.code === 0 && r.calls.length === 1 && c.init.headers.authorization === `ApiKey ${KEY}` && c.url === 'https://ingest.example.test/v1/index/src-1/push'; }],
    ['missing --source refused, no call', async () => { const r = await run(['--endpoint', 'https://x.test', '--file', 'f', '--yes']); return r.code === 2 && r.calls.length === 0; }],
    ['--source all refused', async () => (await run(['--endpoint', 'https://x.test', '--source', 'all', '--file', 'f', '--yes'])).code === 2],
    ['key on argv refused', async () => (await run([...base, '--key', KEY, '--yes'])).code === 2],
    ['http endpoint refused', async () => (await run(['--endpoint', 'http://x.test', '--source', 's', '--file', 'f', '--yes'])).code === 2],
    ['51 operations refused, no call', async () => { const r = await run([...base, '--yes'], { doc: ops(51) }); return r.code === 1 && r.calls.length === 0; }],
    ['0 operations refused', async () => (await run([...base, '--yes'], { doc: ops(0) })).code === 1],
    ['> 512 KiB refused', async () => (await run([...base, '--yes'], { doc: one({ action: 'upsert', id: 'big', fields: { body: 'x'.repeat(MAX_BYTES) } }) })).code === 1],
    ['numeric value refused', async () => (await run([...base, '--yes'], { doc: one({ action: 'upsert', id: 'a', fields: { price: 12 } }) })).code === 1],
    ['ISO datetime refused', async () => (await run([...base, '--yes'], { doc: one({ action: 'upsert', id: 'a', fields: { d: '2026-10-02T12:00:00Z' } }) })).code === 1],
    ['sc_* field refused', async () => (await run([...base, '--yes'], { doc: one({ action: 'upsert', id: 'a', fields: { sc_item_id: 'x' } }) })).code === 1],
    ['missing identity refused', async () => (await run([...base, '--yes'], { doc: one({ action: 'upsert', fields: { t: 'x' } }) })).code === 1],
    ['bad action refused', async () => (await run([...base, '--yes'], { doc: one({ action: 'replace', id: 'a' }) })).code === 1],
    ['207 with a failed op → exit 1', async () => (await run([...base, '--yes'], { status: 207, body: { results: [{ action: 'upsert', index: 0, key: 'd1', statusCode: 200, succeeded: true }, { action: 'delete', index: 1, key: 'd2', statusCode: 400, succeeded: false }] } })).code === 1],
    ['207 all succeeded → exit 0', async () => (await run([...base, '--yes'], { status: 207, body: { results: [{ succeeded: true }] } })).code === 0],
    ['key never printed (server echoes it)', async () => { const r = await run([...base, '--yes', '--json'], { status: 401, body: (init) => ({ error: `bad key ${init.headers.authorization}` }) }); return r.code === 1 && !r.text.includes(KEY); }],
  ];
  let failed = 0;
  for (const [name, fn] of cases) { let ok = false; try { ok = await fn(); } catch { ok = false; } if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  if (quiet) return failed;
  for (const g of Object.keys(GUARDS)) { GUARDS[g] = false; const n = await selfTest({ quiet: true }); GUARDS[g] = true; const ok = n > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: guard "${g}" disabled is detected (${n} case(s) fail)`); if (!ok) failed++; }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); process.exitCode = argv.includes('--self-test') ? await selfTest() : await main(argv); }
