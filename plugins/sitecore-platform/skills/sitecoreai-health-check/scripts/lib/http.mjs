// The ONE request layer of the health check. Every network call goes through request(); guard()
// refuses anything that could write. Lines tagged GUARD:<name> are mutation-tested
// (__tests__/http.mutation.test.mjs removes each one and expects a test to fail).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class ReadOnlyViolation extends Error {
  constructor(msg) { super(`read-only: ${msg}`); this.code = 'READ_ONLY'; }
}
const refuse = (msg) => { throw new ReadOnlyViolation(msg); };

export const TOKEN_URL = 'https://auth.sitecorecloud.io/oauth/token';
// GraphQL transports the doctor may POST a QUERY to: Authoring, Edge delivery, CM preview, legacy Edge.
const GRAPHQL_PATHS = [/\/sitecore\/api\/authoring\/graphql\/v1\/?$/i, /\/v1\/content\/api\/graphql\/v1\/?$/i, /\/sitecore\/api\/graph\/edge\/?$/i, /^\/api\/graphql\/v1\/?$/i];
// Edge Admin read verbs only: the Edge administration client also holds edge.content:clearall.
const EDGE_ADMIN_READ = /^\/api\/admin\/v1\/(webhooks(\/[A-Za-z0-9-]+)?|settings)\/?$/i;

/** Strip GraphQL comments and string literals so a keyword inside a value never counts. */
function stripGraphql(src) {
  return String(src).replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/#[^\n\r]*/g, '');
}

/** Operation types of a GraphQL document, parsed (not keyword-matched). Anonymous `{…}` = query. */
export function graphqlOperations(src) {
  const s = stripGraphql(src);
  const ops = []; let depth = 0, parens = 0, pending = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '{' && parens === 0) { if (depth === 0) { if (pending !== 'fragment') ops.push(pending || 'query'); pending = null; } depth++; }
    else if (c === '}' && parens === 0) depth--;
    else if (depth === 0 && parens === 0 && /[A-Za-z_]/.test(c)) {
      const w = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
      if (!pending && ['query', 'mutation', 'subscription', 'fragment'].includes(w)) pending = w;
      i += w.length - 1;
    }
  }
  return ops;
}

function parseJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

/** Throws ReadOnlyViolation for anything that is not a read. Pure: no I/O. */
export function guard({ method = 'GET', url, headers = {}, body } = {}) {
  const m = String(method).toUpperCase();
  let u; try { u = new URL(url); } catch { refuse(`unparseable URL ${url}`); }
  if (!['GET', 'HEAD', 'POST'].includes(m)) refuse(`${m} is not a read verb`); // GUARD:verb
  const isAdmin = /(^|\.)edge\.sitecorecloud\.io$/i.test(u.hostname) && /^\/api\/admin\//i.test(u.pathname);
  if (isAdmin && /\/content(\/|$)/i.test(u.pathname)) refuse('Edge Admin /content routes are never called'); // GUARD:edge-admin-content
  if (isAdmin && !EDGE_ADMIN_READ.test(u.pathname)) refuse(`Edge Admin path ${u.pathname} is not on the read allowlist`); // GUARD:edge-admin-allowlist
  if (m !== 'POST') return; // a POST to Edge Admin falls through to post-allowlist below
  if (url === TOKEN_URL || `${u.origin}${u.pathname}` === TOKEN_URL) {
    if (!/grant_type=client_credentials/.test(String(body ?? ''))) refuse('token endpoint: client_credentials only'); // GUARD:token-grant
    return;
  }
  if (GRAPHQL_PATHS.some((re) => re.test(u.pathname))) {
    const parsed = parseJson(typeof body === 'string' ? body : JSON.stringify(body ?? null));
    const docs = (Array.isArray(parsed) ? parsed : [parsed]).map((x) => x?.query);
    if (!docs.length || docs.some((q) => typeof q !== 'string')) refuse('GraphQL POST without a query document'); // GUARD:gql-shape
    for (const q of docs) {
      const ops = graphqlOperations(q);
      if (!ops.length) refuse('GraphQL document has no parseable operation'); // GUARD:gql-unparseable
      if (ops.some((o) => o !== 'query')) refuse(`GraphQL ${ops.filter((o) => o !== 'query').join(',')} refused`); // GUARD:gql-mutation
    }
    return;
  }
  // D4 probe: a NON-JSON body with no secret cannot revalidate (401 = secret set, 400 invalid JSON = open).
  if (/\/api\/revalidate\/?$/i.test(u.pathname)) {
    if (parseJson(String(body ?? '')) !== undefined) refuse('revalidate probe: a JSON body can revalidate on 2.4.0'); // GUARD:revalidate-json
    if (Object.keys(headers).some((h) => /secret|authorization|bypass|cookie/i.test(h))) refuse('revalidate probe: no credential headers'); // GUARD:revalidate-headers
    return;
  }
  refuse(`POST to ${u.host}${u.pathname} is not an allowlisted read`); // GUARD:post-allowlist
}

// ---- secrets + redaction ----
const SECRETS = new Set();
export function addSecret(v) { if (v && String(v).length >= 8) SECRETS.add(String(v)); }
export function redact(s) {
  if (s == null) return s;
  const isStr = typeof s === 'string';
  let out = isStr ? s : JSON.stringify(s);
  for (const v of SECRETS) out = out.split(v).join('<redacted>');
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>');
  out = out.replace(/sitecoreContextId=[^&"\s\\]+/g, 'sitecoreContextId=<ctx>');
  out = out.replace(/(\\?"[A-Za-z_]*[cC]ontext_?[iI]d\\?"\s*:\s*\\?")[^"\\]+/g, '$1<ctx>');
  out = out.replace(/sent ".*?" expected ".*?"/g, 'sent "<redacted>" expected "<redacted>"');
  out = out.replace(/(client_secret=)[^&\s"]+/g, '$1<redacted>');
  return isStr ? out : JSON.parse(out);
}

// ---- rate limiting: minimum spacing per key; caps cannot be raised by a caller ----
export const RATE_CAPS = { edge: 80, 'edge-preview': 5, default: 20 };
const rates = { edge: 8, 'edge-preview': 4, default: 10 };
const last = new Map();
export function setRate(key, rps) {
  const cap = RATE_CAPS[key] ?? RATE_CAPS.default;
  if (!(rps > 0) || rps > cap) throw new RangeError(`rate ${key}=${rps} exceeds the cap ${cap} rps`); // GUARD:rate-cap
  rates[key] = rps;
}
export function rateKey(url, hint) {
  if (hint) return hint;
  const u = new URL(url);
  if (/\/sitecore\/api\/graph\/edge/i.test(u.pathname)) return 'edge-preview';
  if (/edge-platform\.sitecorecloud\.io$/i.test(u.hostname)) return 'edge';
  return 'default';
}
async function throttle(key) {
  const gap = 1000 / (rates[key] ?? rates.default);
  const now = Date.now(); const next = Math.max(now, (last.get(key) ?? 0) + gap);
  last.set(key, next);
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}
export function _resetRates() { last.clear(); Object.assign(rates, { edge: 8, 'edge-preview': 4, default: 10 }); }

// ---- request ----
let fetchImpl = (...a) => globalThis.fetch(...a);
export function _setFetchForTests(fn) { fetchImpl = fn ?? ((...a) => globalThis.fetch(...a)); }
let LOG = null;
export function setRequestLog(path) { LOG = path; if (path) mkdirSync(dirname(path), { recursive: true }); }
export const stats = { calls: 0, byHost: {}, bytes: 0, ms: 0, s429: 0, refused: 0 };

/**
 * Guarded, throttled, UNFOLLOWED request. Never throws for HTTP errors: returns
 * { status, headers, text, json, ms, err } where status 0 + err = transport failure (UNKNOWN).
 */
export async function request(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  try { guard({ method, url, headers: opts.headers, body: opts.body }); } catch (e) { stats.refused++; throw e; }
  const init = { method, headers: opts.headers, body: opts.body, signal: AbortSignal.timeout(opts.timeoutMs || 60000) };
  init.redirect = 'manual'; // GUARD:redirect
  await throttle(rateKey(url, opts.rateKey)); // GUARD:throttle
  const t0 = Date.now(); let status = 0, text = '', headers = {}, err = null;
  try {
    const r = await fetchImpl(url, init);
    status = r.status; headers = Object.fromEntries(r.headers.entries());
    if (method !== 'HEAD') text = opts.maxBytes ? await readCapped(r, opts.maxBytes) : await r.text();
  } catch (e) { err = String(e?.cause?.code || e?.name || e?.message || e); }
  const ms = Date.now() - t0;
  const host = new URL(url).host;
  stats.calls++; stats.byHost[host] = (stats.byHost[host] || 0) + 1; stats.bytes += text.length; stats.ms += ms; if (status === 429) stats.s429++;
  if (LOG) appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), label: opts.label || '', method, url: redact(url), status, ms, bytes: text.length, err }) + '\n');
  return { status, headers, text, json: parseJson(text) ?? null, ms, err };
}
async function readCapped(r, max) {
  if (!r.body?.getReader) return (await r.text()).slice(0, max);
  const reader = r.body.getReader(); const chunks = []; let n = 0;
  while (n < max) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); n += value.length; }
  try { await reader.cancel(); } catch { /* already closed */ }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

/** GraphQL query POST (the guard parses the document and refuses any mutation). */
export function gql(endpoint, query, variables, opts = {}) {
  return request(endpoint, { ...opts, method: 'POST', headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: JSON.stringify({ query, variables: variables ?? undefined }) });
}

const TOKENS = new Map();
/** client_credentials mint from <prefix>_ID / <prefix>_SECRET in env. The token is registered as a secret. */
export async function mintToken(env, prefix) {
  if (TOKENS.has(prefix)) return TOKENS.get(prefix);
  const id = env[`${prefix}_ID`], secret = env[`${prefix}_SECRET`];
  if (!id || !secret) { const e = new Error(`credential ${prefix}_ID / _SECRET not set`); e.code = 'NO_CREDENTIAL'; throw e; }
  addSecret(id); addSecret(secret);
  const r = await request(TOKEN_URL, { method: 'POST', label: 'token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, audience: 'https://api.sitecorecloud.io' }).toString() });
  const tok = r.json?.access_token;
  if (!tok) { const e = new Error(`token mint failed for ${prefix}: HTTP ${r.status}`); e.code = 'MINT_FAILED'; throw e; }
  addSecret(tok); TOKENS.set(prefix, tok); return tok;
}
export function tokenClaims(tok) {
  try { return JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return {}; }
}
