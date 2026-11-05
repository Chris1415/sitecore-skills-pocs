#!/usr/bin/env node
// revalidate-controls.mjs — known-good / known-bad control set for a Content SDK
// POST /api/revalidate route. Dependency-free (Node 18+ global fetch).
// Never prints the secret; never follows redirects (an SSO 302 is not a pass).

const HELP = `Usage: node revalidate-controls.mjs --url <https://host/api/revalidate> --item <page-item-guid> [options]

  --url <url>           The deployed revalidate route (required)
  --item <guid>         A real page item id, any GUID format (required for the good controls)
  --site <name>         Site name for the DictionaryEntry row (default: website)
  --locale <code>       entity_culture for the rows (default: en)
  --secret-env <NAME>   Env var holding the revalidate secret (default: SITECORE_REVALIDATE_SECRET)
  --bypass-env <NAME>   Env var holding a Vercel protection-bypass secret, sent as
                        x-vercel-protection-bypass (default: VERCEL_AUTOMATION_BYPASS_SECRET, optional)
  --only-bad            Run only the no-secret / wrong-secret controls (no tags revalidated)
  --dry-run             Print the planned requests (secrets redacted) and exit
  --self-test           Run the built-in judge + redaction tests and exit
  --json                Print results as JSON

Exit code: 0 all PASS (SKIP and INFO do not fail), 1 any FAIL, 2 usage error.
Note: the good controls really call revalidateTag on the target for the given item.`;

export function parseArgs(argv) {
  const a = { site: 'website', locale: 'en', secretEnv: 'SITECORE_REVALIDATE_SECRET', bypassEnv: 'VERCEL_AUTOMATION_BYPASS_SECRET' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--url') a.url = next();
    else if (k === '--item') a.item = next();
    else if (k === '--site') a.site = next();
    else if (k === '--locale') a.locale = next();
    else if (k === '--secret-env') a.secretEnv = next();
    else if (k === '--bypass-env') a.bypassEnv = next();
    else if (k === '--only-bad') a.onlyBad = true;
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--self-test') a.selfTest = true;
    else if (k === '--json') a.json = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

/** Edge sends item ids as dashless uppercase GUIDs (doc example; live shape probe-gated P4). */
export function toEdgeGuid(id) {
  const hex = String(id).replace(/[{}-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(hex)) throw new Error(`--item is not a GUID: ${id}`);
  return hex;
}

export function buildControls({ item, site, locale, secret }) {
  const wrong = 'wrong-' + Math.random().toString(36).slice(2, 10);
  const guid = item ? toEdgeGuid(item) : null;
  const onUpdate = guid && {
    invocation_id: `controls-${Date.now()}`,
    updates: [
      { identifier: guid, entity_definition: 'Item', operation: 'Update', entity_culture: locale },
      { identifier: `${guid}-layout`, entity_definition: 'LayoutData', operation: 'Update', entity_culture: locale },
    ],
    continues: false,
  };
  const dictRow = guid && {
    invocation_id: `controls-dict-${Date.now()}`,
    updates: [{ identifier: `${site}-${guid.toLowerCase()}-controlkey-${locale}`, entity_definition: 'DictionaryEntry', operation: 'Update', entity_culture: locale }],
    continues: false,
  };
  const sample = onUpdate || { invocation_id: 'controls', updates: [{ identifier: '00000000000000000000000000000000', entity_definition: 'Item', operation: 'Update', entity_culture: locale }], continues: false };
  return [
    { name: 'no-secret', kind: 'bad', secret: undefined, body: sample, expect: '401 (200 = endpoint is OPEN)' },
    { name: 'wrong-secret', kind: 'bad', secret: wrong, body: sample, expect: '401' },
    { name: 'onupdate-item+layout', kind: 'good', secret, body: onUpdate, expect: '200, revalidated, tagsCount>=1' },
    { name: 'dictionary-entry-row', kind: 'good', secret, body: dictRow, expect: '200, tagsCount>=1' },
    { name: 'empty-object', kind: 'info', secret, body: {}, expect: 'info: 400 on 2.5.x; 200 on 2.4.x with sites (sitewide dict purge)' },
  ];
}

/** Pure verdict for one control. Exported so the self-test can mutate inputs. */
export function judge(control, res) {
  if (control.skip) return { verdict: 'SKIP', why: control.skip };
  if (!res) return { verdict: 'FAIL', why: 'no response' };
  if (res.error) return { verdict: control.kind === 'info' ? 'INFO' : 'FAIL', why: res.error };
  // Live 2026-10-02: a protected Vercel deployment answers 401 itself, so a bad control would "pass"
  // without the route ever running. Treat the platform's answer as a failure of every control.
  if (res.protectedBy) return { verdict: 'FAIL', why: `${res.status} from ${res.protectedBy}, not the route (send the bypass header)` };
  const s = res.status;
  if (s >= 300 && s < 400) return { verdict: control.kind === 'info' ? 'INFO' : 'FAIL', why: `redirect ${s} (protection/SSO in front of the route?)` };
  if (control.kind === 'bad') {
    if (s === 401) return { verdict: 'PASS', why: '401' };
    if (s === 200) return { verdict: 'FAIL', why: '200 without a valid secret: the endpoint is OPEN (secret unset?)' };
    return { verdict: 'FAIL', why: `expected 401, got ${s}` };
  }
  if (control.kind === 'info') return { verdict: 'INFO', why: `${s}${res.json?.tagsCount != null ? ` tagsCount=${res.json.tagsCount}` : ''}` };
  if (s !== 200) return { verdict: 'FAIL', why: `expected 200, got ${s}` };
  if (!res.json || res.json.revalidated !== true) return { verdict: 'FAIL', why: '200 but body lacks revalidated:true (not the SDK handler?)' };
  if (!(res.json.tagsCount >= 1)) return { verdict: 'FAIL', why: `tagsCount=${res.json.tagsCount}` };
  return { verdict: 'PASS', why: `200 tagsCount=${res.json.tagsCount}` };
}

export function makeRedactor(secrets) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 4);
  return (text) => list.reduce((t, s) => t.split(s).join('***'), String(text));
}

async function send(fetchImpl, url, control, bypass) {
  const headers = { 'content-type': 'application/json' };
  if (control.secret !== undefined) headers['x-revalidate-secret'] = control.secret;
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  try {
    const r = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(control.body), redirect: 'manual' });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const cookie = r.headers?.get?.('set-cookie') ?? '';
    const protectedBy = json?.protection || /_vercel_sso_nonce/.test(cookie) ? 'Vercel Deployment Protection' : undefined;
    return { status: r.status, json, text: text.slice(0, 200), protectedBy };
  } catch (e) {
    return { error: e.message };
  }
}

export async function run(args, { fetchImpl = globalThis.fetch, env = process.env, log = console.log } = {}) {
  if (!args.url || !/^https?:\/\//.test(args.url)) { log('error: --url <http(s)://…/api/revalidate> is required'); return 2; }
  const secret = env[args.secretEnv]?.trim() || undefined;
  const bypass = env[args.bypassEnv]?.trim() || undefined;
  const redact = makeRedactor([secret, bypass]);
  const controls = buildControls({ item: args.item, site: args.site, locale: args.locale, secret });
  for (const c of controls) {
    if (c.kind !== 'bad' && args.onlyBad) c.skip = '--only-bad';
    else if (c.kind !== 'bad' && !secret) c.skip = `${args.secretEnv} not set`;
    else if (c.kind === 'good' && !c.body) c.skip = '--item not given';
  }
  if (args.dryRun) {
    for (const c of controls) log(redact(`${c.name}: POST ${args.url} secret=${c.secret === undefined ? '(none)' : c.secret === secret ? '<correct>' : '<wrong>'} body=${JSON.stringify(c.body)}${c.skip ? ` [skip: ${c.skip}]` : ''}`));
    return 0;
  }
  const rows = [];
  for (const c of controls) {
    const res = c.skip ? null : await send(fetchImpl, args.url, c, bypass);
    const v = judge(c, res);
    rows.push({ control: c.name, expect: c.expect, status: res?.status ?? '-', verdict: v.verdict, detail: v.why });
  }
  if (args.json) log(redact(JSON.stringify(rows, null, 2)));
  else {
    log(redact(`Target: ${args.url}   secret: ${secret ? 'set (redacted)' : 'NOT SET'}   bypass: ${bypass ? 'set (redacted)' : 'none'}`));
    const w = [22, 6, 7];
    log(`${'control'.padEnd(w[0])} ${'status'.padEnd(w[1])} ${'verdict'.padEnd(w[2])} detail`);
    for (const r of rows) log(redact(`${r.control.padEnd(w[0])} ${String(r.status).padEnd(w[1])} ${r.verdict.padEnd(w[2])} ${r.detail}`));
  }
  return rows.some((r) => r.verdict === 'FAIL') ? 1 : 0;
}

async function selfTest() {
  const SECRET = 'self-test-secret-value';
  const out = [];
  const fake = (mode) => async (_url, init) => {
    const h = init.headers['x-revalidate-secret'];
    const body = JSON.parse(init.body);
    const ok = mode === 'open' || h === SECRET;
    const status = !ok ? 401 : (body.updates?.length ? 200 : 400);
    return { status, text: async () => JSON.stringify(status === 200 ? { revalidated: true, tagsCount: 1, echo: h } : { error: 'x' }) };
  };
  const cases = [];
  const base = { url: 'https://example.test/api/revalidate', item: '{12345678-1234-4234-8234-123456789ABC}', site: 'website', locale: 'en', secretEnv: 'S', bypassEnv: 'B' };
  out.length = 0;
  cases.push(['secure route passes', (await run(base, { fetchImpl: fake('secure'), env: { S: SECRET }, log: (l) => out.push(l) })) === 0]);
  cases.push(['secret never printed', !out.join('\n').includes(SECRET)]);
  cases.push(['redactor masks secrets', makeRedactor([SECRET])(`x-revalidate-secret: ${SECRET}`) === 'x-revalidate-secret: ***']);
  cases.push(['open route fails', (await run(base, { fetchImpl: fake('open'), env: { S: SECRET }, log: () => {} })) === 1]);
  cases.push(['wrong-secret 200 fails', judge({ kind: 'bad' }, { status: 200 }).verdict === 'FAIL']);
  cases.push(['redirect is not a pass', judge({ kind: 'bad' }, { status: 302 }).verdict === 'FAIL']);
  cases.push(['200 without tags fails', judge({ kind: 'good' }, { status: 200, json: { revalidated: true, tagsCount: 0 } }).verdict === 'FAIL']);
  cases.push(['Vercel protection 401 is not a bad-control pass', judge({ kind: 'bad' }, { status: 401, protectedBy: 'Vercel Deployment Protection' }).verdict === 'FAIL']);
  cases.push(['protected deployment fails the run', (await run(base, { fetchImpl: async () => ({ status: 401, headers: { get: () => '_vercel_sso_nonce=x' }, text: async () => '{"error":{"code":"401","message":"Protected deployment"},"protection":{}}' }), env: { S: SECRET }, log: () => {} })) === 1]);
  cases.push(['guid normalised to Edge form', toEdgeGuid('{12345678-1234-4234-8234-123456789abc}') === '12345678123442348234123456789ABC']);
  cases.push(['no secret: good controls skip, no fail', (await run(base, { fetchImpl: fake('secure'), env: {}, log: () => {} })) === 0]);
  let failed = 0;
  for (const [name, ok] of cases) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(HELP); process.exit(2); }
  if (args.help) { console.log(HELP); process.exit(0); }
  const code = args.selfTest ? await selfTest() : await run(args);
  process.exitCode = code; // not process.exit(): open fetch sockets abort Node 24 on Windows (exit 127)
}
