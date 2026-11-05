#!/usr/bin/env node
// edge-admin.mjs — Experience Edge Admin API CLI (webhooks, settings, cache clear).
// Dependency-free, Node 18+. Read-only unless --yes. Secrets are redacted in all output.
// There is deliberately NO content-delete command, and the request layer refuses /content.

const HELP = `Usage: node edge-admin.mjs <command> [options]

Commands (read-only):
  token                              Mint a token and print its tenant claims + scopes (never the token)
  webhooks list                      Table of webhooks with the last run
  webhooks get <id>                  One webhook, headers redacted, lastRuns listed
  settings get                       Edge cache settings
Commands (write; dry run unless --yes):
  webhooks create --label L --uri https://… --mode OnUpdate|OnEnd [--method POST|GET]
                  [--header k=v|k=env:NAME]... [--body S (OnEnd)] [--body-include JSON (OnUpdate)]
                  [--created-by S] [--allow-duplicate]
  webhooks update <id> [same flags] [--remove-header k]...   GET -> merge -> PUT -> GET and verify
  webhooks enable <id> | webhooks disable <id>
  webhooks delete <id>               Prints a redacted snapshot first
  cache clear                        DELETE /cache: environment-wide Edge cache clear

Options:
  --yes                Execute a write (otherwise print the plan and exit 0)
  --id-env NAME        Env var with the Edge administration client id   (default SITECORE_EDGE_CLIENT_ID)
  --secret-env NAME    Env var with the client secret                     (default SITECORE_EDGE_CLIENT_SECRET)
  --audience URL       Token audience (default https://api.sitecorecloud.io)
  --base URL           Admin base (default https://edge.sitecorecloud.io/api/admin/v1)
  --auth-url URL       Token endpoint (default https://auth.sitecorecloud.io/oauth/token)
  --runs N             lastRuns rows to show (default 10)
  --json               Machine-readable output (still redacted)
  --self-test          Run the built-in tests against a fake fetch

Exit: 0 ok / dry run, 1 failure, 2 usage. The credential must be an Edge administration client;
org and environment automation clients get 401 "edge.cdn.11 ... Failed to find tenant".`;

const DEFAULTS = {
  idEnv: 'SITECORE_EDGE_CLIENT_ID', secretEnv: 'SITECORE_EDGE_CLIENT_SECRET',
  audience: 'https://api.sitecorecloud.io', base: 'https://edge.sitecorecloud.io/api/admin/v1',
  authUrl: 'https://auth.sitecorecloud.io/oauth/token', runs: 10,
};
const EDITABLE = ['label', 'uri', 'method', 'headers', 'body', 'bodyInclude', 'createdBy', 'executionMode', 'disabled'];
const MODES = ['OnEnd', 'OnUpdate'];

class UsageError extends Error {}

export function parseArgs(argv) {
  const o = { ...DEFAULTS, pos: [], header: [], removeHeader: [] };
  const valued = { '--id-env': 'idEnv', '--secret-env': 'secretEnv', '--audience': 'audience', '--base': 'base', '--auth-url': 'authUrl',
    '--runs': 'runs', '--label': 'label', '--uri': 'uri', '--mode': 'mode', '--method': 'method', '--body': 'body',
    '--body-include': 'bodyInclude', '--created-by': 'createdBy' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in valued) { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); o[valued[a]] = argv[++i]; }
    else if (a === '--header') o.header.push(argv[++i]);
    else if (a === '--remove-header') o.removeHeader.push(argv[++i]);
    else if (a === '--yes') o.yes = true;
    else if (a === '--json') o.json = true;
    else if (a === '--allow-duplicate') o.allowDuplicate = true;
    else if (a === '--self-test') o.selfTest = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else o.pos.push(a);
  }
  o.runs = Number(o.runs) || DEFAULTS.runs;
  return o;
}

export function decodeClaims(jwt) {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const c = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    const pick = (suffix) => { const k = Object.keys(c).find((x) => x === suffix || x.endsWith('/' + suffix)); return k ? c[k] : undefined; };
    return { tenant_name: pick('tenant_name'), tenant_id: pick('tenant_id'), org_id: pick('org_id'), region: pick('sc_org_region'), scope: c.scope, exp: c.exp };
  } catch { return {}; }
}

/** Collects every secret seen so any printed line can be scrubbed. */
export function makeScrubber() {
  const secrets = new Set();
  const add = (v) => { if (typeof v === 'string' && v.length >= 4) secrets.add(v); };
  const scrub = (text) => [...secrets].reduce((t, s) => t.split(s).join('***'), String(text));
  return { add, scrub };
}

export function redactWebhook(w, scrubber) {
  if (!w || typeof w !== 'object') return w;
  const copy = { ...w };
  if (copy.headers && typeof copy.headers === 'object') {
    copy.headers = Object.fromEntries(Object.entries(copy.headers).map(([k, v]) => { scrubber?.add(v); return [k, '***']; }));
  }
  return copy;
}

export function assertNotContentWipe(method, path) {
  if (/^\/content(\/|\?|$)/i.test(path)) throw new Error(`refused: ${method} ${path} — the /content route (environment wipe) is never called by this tool`);
}

function parseHeaders(list, env, scrubber) {
  const out = {};
  for (const h of list) {
    const i = (h || '').indexOf('=');
    if (i < 1) throw new UsageError(`--header expects k=v or k=env:NAME, got "${h}"`);
    const k = h.slice(0, i).trim();
    let v = h.slice(i + 1);
    if (v.startsWith('env:')) {
      const name = v.slice(4);
      v = env[name];
      if (!v) throw new UsageError(`--header ${k}: env var ${name} is not set`);
    }
    scrubber.add(v);
    out[k] = v;
  }
  return out;
}

export function validateWebhook(w) {
  if (!w.uri || !/^https:\/\//i.test(w.uri)) throw new UsageError('uri must be https:// (Edge does not support HTTP; use a tunnel for local)');
  if (!MODES.includes(w.executionMode)) throw new UsageError(`executionMode must be one of ${MODES.join('|')}`);
  if (!['GET', 'POST'].includes(w.method)) throw new UsageError('method must be GET or POST');
  // Edge echoes body: "" on every OnUpdate webhook (live 2026-10-02), so an empty string is "no body".
  if (w.executionMode === 'OnUpdate' && w.body) throw new UsageError('body is OnEnd only; use --body-include for OnUpdate');
  if (w.executionMode === 'OnEnd' && w.bodyInclude != null) throw new UsageError('bodyInclude is OnUpdate only');
  if (w.bodyInclude != null && (typeof w.bodyInclude !== 'object' || Array.isArray(w.bodyInclude))) throw new UsageError('bodyInclude must be a JSON object');
  if (!w.label) throw new UsageError('label is required');
}

function editableOf(w) {
  const o = {};
  for (const k of EDITABLE) if (w[k] !== undefined && w[k] !== null) o[k] = w[k];
  return o;
}

function fmtRuns(runs = [], n) {
  const sorted = [...runs].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, n);
  if (!sorted.length) return ['  (no runs yet)'];
  return sorted.map((r) => `  ${String(r.timestamp).padEnd(28)} ${r.success ? 'OK  ' : 'FAIL'}  ${String(r.message ?? '').slice(0, 140)}`);
}

export async function main(argv, { fetchImpl = globalThis.fetch, env = process.env, log = console.log } = {}) {
  let o;
  try { o = parseArgs(argv); } catch (e) { log(e.message); return 2; }
  if (o.help || !o.pos.length) { log(HELP); return o.help ? 0 : 2; }
  const sc = makeScrubber();
  const out = (s) => log(sc.scrub(s));
  const [group, verb, id] = o.pos;
  const cmd = `${group} ${verb ?? ''}`.trim();
  const known = ['token', 'webhooks list', 'webhooks get', 'webhooks create', 'webhooks update', 'webhooks enable', 'webhooks disable', 'webhooks delete', 'settings get', 'cache clear'];
  if (!known.includes(cmd)) { out(`unknown command "${cmd}" (there is no content-delete command, by design)\n`); out(HELP); return 2; }
  if (['webhooks get', 'webhooks update', 'webhooks enable', 'webhooks disable', 'webhooks delete'].includes(cmd) && !id) { out(`${cmd} needs <id>`); return 2; }

  const clientId = env[o.idEnv];
  const clientSecret = env[o.secretEnv];
  sc.add(clientSecret);
  if (!clientId || !clientSecret) { out(`missing credentials: set ${o.idEnv} and ${o.secretEnv} (an Edge administration client)`); return 2; }

  let token, claims;
  async function getToken() {
    if (token) return token;
    const r = await fetchImpl(o.authUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, audience: o.audience }).toString() });
    const text = await r.text();
    if (r.status !== 200) throw new Error(`token request failed: ${r.status} ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    token = j.access_token; sc.add(token);
    claims = { ...decodeClaims(token), expires_in: j.expires_in };
    return token;
  }
  async function api(method, path, body) {
    assertNotContentWipe(method, path);
    const t = await getToken();
    const headers = { authorization: `Bearer ${t}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetchImpl(o.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (r.status < 200 || r.status >= 300) {
      const hint = r.status === 401 ? ' (Edge Admin API needs an Edge administration client; automation clients get 401)' : '';
      const err = new Error(`${method} ${path} -> ${r.status}${hint} ${text.slice(0, 300)}`); err.status = r.status; throw err;
    }
    return { status: r.status, json, location: r.headers?.get?.('location') };
  }
  const target = () => `Target tenant: ${claims?.tenant_name ?? '?'} (${claims?.tenant_id ?? '?'}), org ${claims?.org_id ?? '?'}`;
  const dryRun = (plan) => { out(target()); out(`DRY RUN — would ${plan}`); out('Re-run with --yes to execute.'); return 0; };

  try {
    if (cmd === 'token') {
      await getToken();
      const scopes = String(claims.scope ?? '').split(' ').filter(Boolean);
      if (o.json) out(JSON.stringify({ ...claims, scope: scopes }, null, 2));
      else {
        out(target()); out(`Region: ${claims.region ?? '?'}   expires_in: ${claims.expires_in}s`);
        out(`Scopes: ${scopes.join(' ')}`);
        if (scopes.includes('edge.content:clearall')) out('Note: this credential can wipe the environment (edge.content:clearall). This tool never uses that scope.');
      }
      return 0;
    }
    if (cmd === 'webhooks list') {
      const { json } = await api('GET', '/webhooks');
      const list = (Array.isArray(json) ? json : []).map((w) => redactWebhook(w, sc));
      if (o.json) { out(JSON.stringify(list, null, 2)); return 0; }
      await getToken(); out(target());
      if (!list.length) { out('(no webhooks)'); return 0; }
      out(`${'id'.padEnd(38)} ${'mode'.padEnd(9)} ${'disabled'.padEnd(8)} ${'last run'.padEnd(36)} label | uri`);
      for (const w of list) {
        const last = [...(w.lastRuns ?? [])].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
        const lr = last ? `${last.success ? 'OK  ' : 'FAIL'} ${last.timestamp}` : '-';
        out(`${String(w.id).padEnd(38)} ${String(w.executionMode ?? 'OnEnd').padEnd(9)} ${String(!!w.disabled).padEnd(8)} ${lr.padEnd(36)} ${w.label ?? ''} | ${w.uri}`);
      }
      return 0;
    }
    if (cmd === 'webhooks get') {
      const { json } = await api('GET', `/webhooks/${encodeURIComponent(id)}`);
      const w = redactWebhook(json, sc);
      if (o.json) { out(JSON.stringify(w, null, 2)); return 0; }
      const { lastRuns, ...rest } = w;
      out(JSON.stringify(rest, null, 2));
      out(`lastRuns (newest first, max ${o.runs}):`);
      for (const l of fmtRuns(lastRuns, o.runs)) out(l);
      if (w.disabled) out('WARNING: disabled. Fix the receiver, then `webhooks enable <id> --yes`.');
      return 0;
    }
    if (cmd === 'settings get') {
      const { json } = await api('GET', '/settings');
      out(JSON.stringify(json, null, 2));
      return 0;
    }
    if (cmd === 'cache clear') {
      await getToken();
      if (!o.yes) return dryRun('DELETE /cache (environment-wide Edge cache clear, every site)');
      out(target());
      const { status } = await api('DELETE', '/cache');
      out(`cache clear accepted: ${status}`);
      return 0;
    }
    if (cmd === 'webhooks create') {
      const headers = parseHeaders(o.header, env, sc);
      const w = { label: o.label, uri: o.uri, method: (o.method ?? 'POST').toUpperCase(), headers, executionMode: o.mode, createdBy: o.createdBy };
      if (o.body != null) w.body = o.body;
      if (o.bodyInclude != null) { try { w.bodyInclude = JSON.parse(o.bodyInclude); } catch { throw new UsageError('--body-include is not valid JSON'); } }
      validateWebhook(w);
      const { json: existing } = await api('GET', '/webhooks');
      const dup = (existing ?? []).find((x) => String(x.uri).toLowerCase() === w.uri.toLowerCase());
      if (dup && !o.allowDuplicate) { out(target()); out(`refused: webhook ${dup.id} ("${dup.label}") already targets ${w.uri}. Update it, or pass --allow-duplicate.`); return 1; }
      const shown = JSON.stringify(editableOf(redactWebhook(w, sc)), null, 2);
      if (!o.yes) return dryRun(`POST /webhooks\n${shown}`);
      out(target());
      const r = await api('POST', '/webhooks', editableOf(w));
      out(`created: ${r.status} ${r.location ?? ''}`);
      out(JSON.stringify(redactWebhook(r.json, sc), null, 2));
      return 0;
    }
    if (['webhooks update', 'webhooks enable', 'webhooks disable'].includes(cmd)) {
      const path = `/webhooks/${encodeURIComponent(id)}`;
      const { json: cur } = await api('GET', path);
      redactWebhook(cur, sc); // registers existing header values with the scrubber
      const next = editableOf(cur);
      if (cmd === 'webhooks enable') next.disabled = false;
      else if (cmd === 'webhooks disable') next.disabled = true;
      else {
        for (const k of ['label', 'uri', 'createdBy']) if (o[k] != null) next[k] = o[k];
        if (o.method) next.method = o.method.toUpperCase();
        if (o.mode) next.executionMode = o.mode;
        if (o.body != null) next.body = o.body;
        if (o.bodyInclude != null) { try { next.bodyInclude = JSON.parse(o.bodyInclude); } catch { throw new UsageError('--body-include is not valid JSON'); } }
        next.headers = { ...(cur.headers ?? {}), ...parseHeaders(o.header, env, sc) };
        for (const k of o.removeHeader) delete next.headers[k];
      }
      next.executionMode = next.executionMode ?? cur.executionMode ?? 'OnEnd';
      next.method = next.method ?? 'POST';
      // Live 2026-10-02: Edge KEEPS a field the PUT omits or sends as null (so PUT is not a full replace for
      // body), and rejects body:"" under OnUpdate. A stored OnEnd body therefore survives a switch to OnUpdate
      // unless it is first blanked while still OnEnd. Plan that two-step PUT explicitly.
      const preClear = next.executionMode === 'OnUpdate' && !!cur.body && o.body == null;
      if (next.executionMode === 'OnUpdate' && o.body == null) delete next.body;
      if (next.executionMode === 'OnEnd' && o.bodyInclude == null) delete next.bodyInclude;
      validateWebhook(next);
      const before = JSON.stringify(editableOf(redactWebhook(cur, sc)));
      const after = JSON.stringify(editableOf(redactWebhook(next, sc)));
      const planned = `${preClear ? `PUT ${path} (step 1: blank the stored OnEnd body while still OnEnd)\n` : ''}PUT ${path}\nbefore: ${before}\nafter:  ${after}`;
      if (!o.yes) return dryRun(planned);
      out(target());
      if (preClear) await api('PUT', path, { ...editableOf(cur), executionMode: 'OnEnd', body: '' });
      await api('PUT', path, next);
      const { json: got } = await api('GET', path);
      const want = editableOf(next); const have = editableOf(got);
      const drift = Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(have[k]));
      if (have.executionMode === 'OnUpdate' && have.body) drift.push('body (stale OnEnd body kept by Edge)');
      if (have.executionMode === 'OnEnd' && have.bodyInclude != null) drift.push('bodyInclude (stale, kept by Edge)');
      if (drift.length) { out(`MISMATCH after PUT on: ${drift.join(', ')}`); return 1; }
      out(`updated and verified: ${path} (executionMode=${have.executionMode}, disabled=${!!have.disabled})`);
      return 0;
    }
    if (cmd === 'webhooks delete') {
      const path = `/webhooks/${encodeURIComponent(id)}`;
      const { json: cur } = await api('GET', path);
      const snap = JSON.stringify(editableOf(redactWebhook(cur, sc)), null, 2);
      if (!o.yes) return dryRun(`DELETE ${path}\nsnapshot (recreate with create; header values must be re-supplied):\n${snap}`);
      out(target()); out(`snapshot:\n${snap}`);
      const { status } = await api('DELETE', path);
      out(`deleted: ${status}`);
      return 0;
    }
  } catch (e) {
    if (e instanceof UsageError) { out(e.message); return 2; }
    out(`error: ${e.message}`);
    return 1;
  }
  return 2;
}

// ---------------------------------------------------------------- self-test
function fakeJwt(claims) {
  const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b({ alg: 'none' })}.${b(claims)}.sig`;
}

export async function selfTest() {
  const HDR = 'header-secret-value-123';
  const CS = 'client-secret-value-456';
  const TOKEN = fakeJwt({ 'https://auth.sitecorecloud.io/claims/tenant_name': 'test-tenant', 'https://auth.sitecorecloud.io/claims/tenant_id': 't-1', scope: 'edge.webhooks:read edge.content:clearall' });
  const env = { SITECORE_EDGE_CLIENT_ID: 'cid', SITECORE_EDGE_CLIENT_SECRET: CS, REV: 'new-revalidate-secret-789' };
  const mk = () => {
    const state = { hooks: { '1': { id: '1', tenantId: 't-1', created: 'x', label: 'site OSR', uri: 'https://example.test/api/revalidate', method: 'POST',
      headers: { 'x-revalidate-secret': HDR }, executionMode: 'OnUpdate', disabled: false, lastRuns: [{ timestamp: '2026-10-02T10:00:00Z', success: false, message: 'Timeout' }] } }, calls: [] };
    const res = (status, body, headers = {}) => ({ status, text: async () => (body === undefined ? '' : JSON.stringify(body)), headers: { get: (k) => headers[k] } });
    const f = async (url, init) => {
      state.calls.push({ url, method: init.method, body: init.body });
      if (url.includes('oauth/token')) return res(200, { access_token: TOKEN, expires_in: 86400 });
      const path = url.replace(DEFAULTS.base, '');
      const m = path.match(/^\/webhooks\/(.+)$/);
      if (init.method === 'GET' && path === '/webhooks') return res(200, Object.values(state.hooks));
      if (init.method === 'GET' && m) return state.hooks[m[1]] ? res(200, state.hooks[m[1]]) : res(404, {});
      if (init.method === 'PUT' && m) { state.hooks[m[1]] = { ...JSON.parse(init.body), id: m[1] }; return res(204); }
      if (init.method === 'POST' && path === '/webhooks') { state.hooks['2'] = { ...JSON.parse(init.body), id: '2' }; return res(201, state.hooks['2'], { location: '/webhooks/2' }); }
      if (init.method === 'DELETE') return res(path === '/cache' ? 202 : 204);
      return res(404, {});
    };
    return { state, f };
  };
  const runCase = async (argv) => { const { state, f } = mk(); const lines = []; const code = await main(argv, { fetchImpl: f, env, log: (l) => lines.push(l) }); return { code, text: lines.join('\n'), state }; };
  const writes = (s) => s.calls.filter((c) => !c.url.includes('oauth') && c.method !== 'GET');
  const secretsAbsent = (t) => ![HDR, CS, TOKEN, env.REV].some((s) => t.includes(s));
  const cases = [];
  let r;
  r = await runCase(['webhooks', 'list']); cases.push(['list redacts header values + secrets', r.code === 0 && secretsAbsent(r.text) && r.text.includes('FAIL')]);
  r = await runCase(['webhooks', 'get', '1']); cases.push(['get redacts and prints lastRuns', r.code === 0 && secretsAbsent(r.text) && r.text.includes('Timeout')]);
  r = await runCase(['token']); cases.push(['token prints claims, never the token', r.code === 0 && secretsAbsent(r.text) && r.text.includes('test-tenant')]);
  const create = ['webhooks', 'create', '--label', 'b OSR', '--uri', 'https://b.test/api/revalidate', '--mode', 'OnUpdate', '--header', 'x-revalidate-secret=env:REV'];
  r = await runCase(create); cases.push(['create without --yes makes no write', r.code === 0 && writes(r.state).length === 0 && secretsAbsent(r.text)]);
  r = await runCase([...create, '--yes']); cases.push(['create --yes POSTs resolved header, output redacted', r.code === 0 && writes(r.state).length === 1 && writes(r.state)[0].body.includes(env.REV) && secretsAbsent(r.text)]);
  r = await runCase(['webhooks', 'create', '--label', 'dup', '--uri', 'https://example.test/api/revalidate', '--mode', 'OnUpdate', '--yes']); cases.push(['duplicate uri refused', r.code === 1 && writes(r.state).length === 0]);
  r = await runCase(['webhooks', 'create', '--label', 'h', '--uri', 'http://x.test/a', '--mode', 'OnEnd', '--yes']); cases.push(['http uri refused', r.code === 2 && writes(r.state).length === 0]);
  r = await runCase(['webhooks', 'disable', '1', '--yes']);
  const put = r.state.calls.find((c) => c.method === 'PUT'); const pb = put ? JSON.parse(put.body) : {};
  cases.push(['disable keeps executionMode + headers, drops read-only fields', r.code === 0 && pb.executionMode === 'OnUpdate' && pb.disabled === true && pb.headers?.['x-revalidate-secret'] === HDR && !('lastRuns' in pb) && !('id' in pb) && secretsAbsent(r.text)]);
  {
    // OnEnd -> OnUpdate with a stored body: Edge keeps an omitted body, so the tool must blank it first.
    const { state, f } = mk(); Object.assign(state.hooks['1'], { executionMode: 'OnEnd', body: '{"probe":1}' });
    const code = await main(['webhooks', 'update', '1', '--mode', 'OnUpdate', '--yes'], { fetchImpl: f, env, log: () => {} });
    const puts = state.calls.filter((c) => c.method === 'PUT').map((c) => JSON.parse(c.body));
    cases.push(['mode switch OnEnd->OnUpdate blanks the body first (two PUTs)', code === 0 && puts.length === 2 && puts[0].executionMode === 'OnEnd' && puts[0].body === '' && puts[1].executionMode === 'OnUpdate' && !('body' in puts[1])]);
  }
  r = await runCase(['webhooks', 'enable', '1']); cases.push(['enable without --yes makes no write', r.code === 0 && writes(r.state).length === 0]);
  r = await runCase(['cache', 'clear']); cases.push(['cache clear without --yes makes no write', r.code === 0 && writes(r.state).length === 0]);
  r = await runCase(['content', 'delete', '--yes']); cases.push(['no content-delete command', r.code === 2 && writes(r.state).length === 0]);
  cases.push(['redactWebhook masks header values on its own', redactWebhook({ headers: { 'x-revalidate-secret': HDR } }).headers['x-revalidate-secret'] === '***']);
  const s1 = makeScrubber(); s1.add(CS);
  cases.push(['scrubber masks registered secrets on its own', s1.scrub(`secret=${CS}`) === 'secret=***']);
  let refused = false; try { assertNotContentWipe('DELETE', '/content'); } catch { refused = true; }
  cases.push(['request layer refuses /content', refused]);
  r = await runCase(['webhooks', 'delete', '1']); cases.push(['delete without --yes makes no write, prints snapshot', r.code === 0 && writes(r.state).length === 0 && r.text.includes('snapshot') && secretsAbsent(r.text)]);
  let failed = 0;
  for (const [name, ok] of cases) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const argv = process.argv.slice(2);
  // exitCode, not process.exit(): exiting with keep-alive fetch sockets open aborts Node 24 on Windows (libuv UV_HANDLE_CLOSING assertion, exit 127).
  process.exitCode = argv.includes('--self-test') ? await selfTest() : await main(argv);
}
