#!/usr/bin/env node
// Read-only doctor: X0 binding, X1 credential matrix, then the checks in run order; writes
// doctor-report-<date>.md + .json. Exit 0 clean / 1 findings >= P1 or UNKNOWN / 2 harness error.
// Usage (Git Bash: prefix MSYS_NO_PATHCONV=1 when passing /sitecore/... or /route values):
//   node doctor.mjs --env <cmEnvId> --site <siteName> [--url <live url>] [--lang en[,de-DE]] [--scope env|site|page] [--page /route]
//     [--root /sitecore/content/<collection>/<site>] [--visibility public|private] [--eh-env <id>] [--checks <ids|families>]
//     [--org <label> | --org-client-prefix P --edge-client-prefix P] [--env-file <creds>] [--auth-cookie <c>]
//     [--app-env-file <pulled .env>] [--out <dir>] [--redact] [--max-routes 500] [--max-pages 60] [--drift 10]
//     [--log-max-bytes 5000000] [--rate-edge 8] [--request-log <path>] [--max-language-items 800]
// --lang: the census (R1/D11) runs per language; graph, drift and D1 use the first; W3 checks exactly these
// languages, or every environment + version language when --lang is absent.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stats, setRate, setRequestLog, redact as baseRedact, tokenClaims, addSecret } from './lib/http.mjs';
import { parseArgs, loadEnv, credentialPrefixes, sitecorePathArg, routePathArg, isMain, today } from './lib/env.mjs';
import { result, unknown, skipped, buildReport } from './lib/findings.mjs';
import { selectChecks, ALL_IDS, TITLES, NOT_RUN, FAMILIES } from './lib/catalogue.mjs';
import { client, readEnvironment, errs } from './lib/sitecore.mjs';
import { checkO3, checkO4, checkO5, checkE2, checkE3, checkD10 } from './lib/checks-env.mjs';
import { checkD3, checkD4, checkE1, checkD8, checkSmall } from './lib/checks-delivery.mjs';
import { checkCensus, checkGraph, checkW5 } from './lib/checks-content.mjs';
import { checkO1, checkO2, confirmTemplateGone } from './lib/checks-logs.mjs';
import { checkW3, parseLangs, mergeLanguageResults } from './lib/checks-language.mjs';
import { checkEdgeContext } from './check-edge-context.mjs';
import { checkRobots } from './check-live-robots.mjs';
import { checkMedia } from './check-media-delivery.mjs';
import { checkLiveTemplates } from './check-live-templates.mjs';
import { crawl } from './crawl-live-links.mjs';

export const VERSION = '0.1.1';
const ENV_SCOPE = new Set([...FAMILIES.binding, ...FAMILIES.ops, ...FAMILIES.logs, 'E2', 'E3', 'E4', 'D10']);

export async function runDoctor(a, env = loadEnv(a)) {
  const startedAt = new Date().toISOString(); const t0 = Date.now();
  const prefixes = credentialPrefixes(a, env);
  const site = a.site && a.site !== true ? String(a.site) : null;
  const page = routePathArg(a.page, 'page');
  const scope = a.scope || (page ? 'page' : site ? 'site' : 'env');
  const want = selectChecks(a.checks);
  const langs = parseLangs(a.lang);
  const ctx = { env, prefixes, site, page, scope, lang: langs?.[0] || 'en', langs, cmEnv: a.env && a.env !== true ? String(a.env) : null, ehEnv: a['eh-env'] || null,
    base: a.url ? String(a.url).replace(/\/$/, '') : null, visibility: a.visibility || 'public', cookie: a['auth-cookie'] || env.DOCTOR_GATE_COOKIE || null,
    root: sitecorePathArg(a.root, 'root'), ids: {}, store: {}, org: null, edgeAdmin: null,
    opts: { maxRoutes: Number(a['max-routes'] || 500), maxPages: Number(a['max-pages'] || (scope === 'page' ? 1 : 60)), drift: Number(a.drift || 10), logMaxBytes: Number(a['log-max-bytes'] || 5_000_000), maxLangItems: Number(a['max-language-items'] || 800) } };
  addSecret(ctx.cookie);
  if (a['rate-edge']) setRate('edge', Number(a['rate-edge']));
  const results = []; const credentials = []; const instruments = []; let harnessError = null; let linkCtx = null;
  const run = async (id, fn) => {
    if (!want.has(id)) return;
    try { const r = await fn(); for (const x of [].concat(r)) if (x) results.push(x); }
    catch (e) { results.push(unknown(result(id, TITLES[id] || id), `${e.code === 'READ_ONLY' ? 'REFUSED by the read-only guard: ' : ''}${e.message}`.slice(0, 300))); }
  };

  // ---- X0 binding ----
  const x0 = result('X0', 'Tenant binding: Deploy env host = Authoring host; ids from Deploy');
  if (ctx.cmEnv) {
    ctx.org = client(env, prefixes.org);
    try {
      const tok = await ctx.org.token(); ctx.claims = tokenClaims(tok);
      const e = await readEnvironment(ctx.org, ctx.cmEnv);
      if (!e.ok) throw new Error(`Deploy env read HTTP ${e.status}${e.err ? ` ${e.err}` : ''}`);
      if (e.env.type && e.env.type !== 'cm') throw new Error(`env ${ctx.cmEnv} is type "${e.env.type}", not a CM (an editing host's env read reports the CM host: pass the CM env id)`);
      ctx.cmEnvJson = e.env; ctx.cmHost = `https://${e.env.host}`; ctx.ids = { live: e.liveContextId, preview: e.previewContextId };
      if (a['cm-host'] && String(a['cm-host']).replace(/\/$/, '').toLowerCase() !== ctx.cmHost.toLowerCase()) throw new Error('--cm-host does not match the Deploy API host for this env (binding mismatch)');
      const probe = await ctx.org.agql(ctx.cmHost, '{ item(where:{ path:"/sitecore/content" }){ itemId } }', null, { label: 'x0-agql' });
      if (probe.status !== 200 || !probe.json?.data?.item) throw new Error(`Authoring probe failed: HTTP ${probe.status} ${(errs(probe.json) || []).join(' | ').slice(0, 120)}`);
      if (site && !ctx.root) {
        const s = await ctx.org.agql(ctx.cmHost, '{ sites(includeSystemSites:false){ name rootPath } }', null, { label: 'x0-sites' });
        const hit = (s.json?.data?.sites || []).find((x) => String(x.name).toLowerCase() === site.toLowerCase());
        if (hit?.rootPath) ctx.root = hit.rootPath; else x0.notes.push(`site root not resolved from Authoring sites (${(errs(s.json) || ['not found']).join(' ')}); pass --root for the content graph`);
      }
      x0.notes.push(`CM env ${ctx.cmEnv} -> host bound; Authoring answers; live${ctx.ids.preview ? ' + preview' : ''} context ids from Deploy${ctx.claims['https://auth.sitecorecloud.io/claims/tenant_name'] ? '' : ' (org token carries no tenant claim: the host comes from Deploy)'}`);
      linkCtx = { organization: ctx.claims['https://auth.sitecorecloud.io/claims/org_id'], tenantName: e.env.platformTenantName || e.env.tenantName || null, site, lang: ctx.lang, cmHost: ctx.cmHost };
      instruments.push('Deploy API (org client): environment, deployments, registrations, variables, context ids', 'Authoring GraphQL (org client): MASTER, the index for search inventory', 'Experience Edge, live context: what is PUBLISHED', 'Experience Edge, preview context: master in Edge shape, never evidence of publication', 'Monitoring API (org client): CM and editing-host log files');
    } catch (e) { harnessError = `X0 binding failed: ${e.message}`; unknown(x0, e.message); }
  } else skipped(x0, 'no --env: delivery-only run (Deploy, Authoring, Edge census and logs are skipped)');
  results.push(x0);
  if (ctx.base) instruments.push('HTTP (unfollowed) on the delivery URL: what an anonymous visitor gets', 'Real browser (Playwright, when installed): the hydrated DOM');

  // ---- X1 credential matrix ----
  const x1 = result('X1', 'Credential matrix');
  credentials.push({ name: 'org automation client', source: `${prefixes.org}_ID/_SECRET`, status: !ctx.cmEnv ? 'not used' : harnessError && !ctx.cmHost ? 'failed' : 'ok', enables: 'X0, O*, E2, E3, R1, graph, W5, logs' });
  if (want.has('D10') && ctx.cmEnv) {
    try { ctx.edgeAdmin = client(env, prefixes.edgeAdmin); await ctx.edgeAdmin.token(); credentials.push({ name: 'Edge administration client', source: `${prefixes.edgeAdmin}_ID/_SECRET`, status: 'ok (GET allowlist only)', enables: 'D10' }); }
    catch (e) { ctx.edgeAdmin = null; credentials.push({ name: 'Edge administration client', source: `${prefixes.edgeAdmin}_ID/_SECRET`, status: e.code === 'NO_CREDENTIAL' ? 'absent' : 'mint failed', enables: 'D10 (SKIPPED without it)' }); }
  }
  credentials.push({ name: 'tenant-scoped automation client', source: 'not wired in v0.1', status: 'absent', enables: 'O6, E4 (SKIPPED)' });
  credentials.push({ name: 'access-gate cookie', source: 'DOCTOR_GATE_COOKIE / --auth-cookie', status: ctx.cookie ? 'present' : 'absent', enables: ctx.visibility === 'private' ? 'authenticated robots + crawl (required)' : 'not needed (public)' });
  const { loadPlaywright } = await import('./crawl-live-links.mjs');
  const pw = await loadPlaywright(env);
  credentials.push({ name: 'Playwright', source: 'cwd or PLAYWRIGHT_MODULE', status: pw ? 'present' : 'absent', enables: 'hydrated crawl D5/D7/D9 (degraded to server HTML without it)' });
  x1.notes.push(credentials.map((c) => `${c.name}: ${c.status}`).join('; '));
  results.push(x1);

  const bound = ctx.cmEnv && !harnessError;
  const siteScoped = scope !== 'env' && site;
  if (bound) {
    await run('O4', () => checkO4(ctx));
    await run('O3', () => checkO3(ctx));
    await run('O5', () => checkO5(ctx));
    await run('E2', () => checkE2(ctx));
    await run('E3', () => checkE3(ctx));
    await run('D10', () => checkD10(ctx));
  }
  if (bound && siteScoped) await run('D1', async () => (await checkEdgeContext({ env, prefixes, cmEnv: ctx.cmEnv, site, lang: ctx.lang, appEnvFiles: [].concat(a['app-env-file'] ?? []), resolved: { liveContextId: ctx.ids.live, previewContextId: ctx.ids.preview } })).results);
  if (ctx.base && scope !== 'env') {
    let edgeRobots;
    if (bound && site) { try { const { edge } = await import('./lib/sitecore.mjs'); const x = await edge(ctx.ids.live, 'query($s:String!){ site{ siteInfo(site:$s){ robots } } }', { s: site }, { label: 'edge-robots' }); if (x.status === 200 && !errs(x.json)) edgeRobots = x.json?.data?.site?.siteInfo?.robots ?? null; } catch { /* compare skipped */ } }
    await run('D2', async () => (await checkRobots({ url: ctx.base, visibility: ctx.visibility, cookie: ctx.cookie, edgeRobots })).results);
    await run('D3', () => checkD3(ctx));
    await run('D4', () => checkD4(ctx));
    await run('E1', () => checkE1(ctx));
  }
  if (bound && siteScoped && (want.has('R1') || want.has('D11'))) {
    try {
      const primary = (await checkCensus(ctx, want)).filter((r) => want.has(r.check));
      for (const l of (ctx.langs || []).slice(1)) {
        try { mergeLanguageResults(primary, await checkCensus({ ...ctx, lang: l, store: {} }, want), l); }
        catch (e) { mergeLanguageResults(primary, [unknown(result('R1', TITLES.R1), e.message)], l); }
      }
      results.push(...primary);
    } catch (e) { results.push(unknown(result('R1', TITLES.R1), e.message)); }
  }
  if (ctx.base && scope !== 'env') { await run('D8', () => checkD8(ctx)); if (['D14', 'D15', 'D16'].some((x) => want.has(x))) { try { results.push(...(await checkSmall(ctx)).filter((r) => want.has(r.check))); } catch (e) { results.push(unknown(result('D16', TITLES.D16), e.message)); } } }
  const graphIds = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'T2', 'M1', 'D12', 'R2', 'R3'];
  if (bound && siteScoped && graphIds.some((x) => want.has(x))) {
    if (!ctx.root) for (const id of graphIds.filter((x) => want.has(x))) results.push(skipped(result(id, TITLES[id]), 'site root unknown: pass --root'));
    else { try { results.push(...(await checkGraph(ctx, want))); } catch (e) { results.push(unknown(result('L1', TITLES.L1), e.message)); } }
  }
  if (bound && siteScoped && ctx.root && ctx.ids.live) await run('T6', async () => (await checkLiveTemplates({ contextId: ctx.ids.live, root: ctx.root, lang: ctx.lang })).results);
  if (bound && siteScoped) await run('W5', () => checkW5(ctx));
  if (bound && siteScoped) await run('W3', () => checkW3(ctx));
  if (ctx.base && scope !== 'env' && ['D5', 'D7', 'D9'].some((x) => want.has(x))) {
    try { results.push(...(await crawl({ url: ctx.page ? `${ctx.base}${ctx.page}` : ctx.base, visibility: ctx.visibility, cookie: ctx.cookie, maxPages: ctx.opts.maxPages, env })).results.filter((r) => want.has(r.check) || r.check === 'D5')); }
    catch (e) { results.push(unknown(result('D5', TITLES.D5), e.message)); }
  }
  if (ctx.base && scope !== 'env') await run('D6', async () => (await checkMedia({ url: ctx.base, pages: [ctx.page || '/'], cookie: ctx.cookie })).results);
  if (bound && scope !== 'page' && (want.has('O1') || want.has('T2'))) {
    try {
      const o = await checkO1(ctx);
      if (want.has('O1')) results.push(o.o1);
      if (want.has('T2') && o.o1.status !== 'unknown') results.push(await confirmTemplateGone(ctx, o.subjects, o.tnfCount));
    } catch (e) { results.push(unknown(result('O1', TITLES.O1), e.message)); }
  }
  if (bound && scope !== 'page') await run('O2', () => checkO2(ctx));

  // Everything selected that did not run is SKIPPED with its reason: never silently absent.
  const ran = new Set(results.map((r) => r.check));
  for (const id of ALL_IDS) {
    if (!want.has(id) || ran.has(id)) continue;
    const why = NOT_RUN[id] || (!ctx.cmEnv && !ENV_SCOPE.has(id) && !ctx.base ? 'needs --env or --url'
      : !ctx.cmEnv ? 'needs --env (Deploy/Authoring/Edge)' : harnessError ? 'X0 binding failed'
      : !ENV_SCOPE.has(id) && scope === 'env' ? 'scope env (pass --site)' : !ctx.base && /^D|^E1/.test(id) ? 'needs --url (delivery surface)'
      : scope === 'page' && FAMILIES.logs.includes(id) ? 'scope page (logs are environment-wide)' : 'not applicable to this scope');
    results.push(skipped(result(id, TITLES[id]), why));
  }
  const cost = { ...stats, wallMs: Date.now() - t0 };
  const target = { scope, cmEnv: ctx.cmEnv, cmHost: ctx.cmHost, site, root: ctx.root, page, language: ctx.langs ? ctx.langs.join(',') : ctx.lang, url: ctx.base, visibility: ctx.visibility, ehEnv: ctx.ehEnv, checks: a.checks || 'all' };
  const redact = makeRedactor(a.redact ? { cmHost: ctx.cmHost, cmEnv: ctx.cmEnv, ehEnv: ctx.ehEnv, org: linkCtx?.organization, tenant: linkCtx?.tenantName, project: ctx.cmEnvJson?.projectId } : null);
  return buildReport({ target, instruments, credentials, results, cost, startedAt, finishedAt: new Date().toISOString(), linkCtx, version: VERSION, redact, harnessError });
}

/** Base redaction always; --redact also masks hosts, env/org/project ids and tenant names (for shared copies). */
export function makeRedactor(values) {
  return (x) => {
    let s = JSON.stringify(baseRedact(x));
    if (values) {
      const pairs = [[values.cmHost?.replace(/^https?:\/\//, ''), '<cm-host>'], [values.cmEnv, '<cm-env>'], [values.ehEnv, '<eh-env>'], [values.org, '<org>'], [values.tenant, '<tenant>'], [values.project, '<project>']];
      for (const [v, ph] of pairs) if (v && v.length >= 6) s = s.split(v).join(ph);
      s = s.replace(/xmc-[a-z0-9-]+\.sitecorecloud\.io/gi, '<xmc-host>').replace(/edge\.sitecorecloud\.io\/[^/\s"\\]+\/media/gi, 'edge.sitecorecloud.io/<tenant>/media');
    }
    return JSON.parse(s);
  };
}

function nextFree(dir, stem, ext) {
  let p = join(dir, `${stem}${ext}`); let i = 2;
  while (existsSync(p)) p = join(dir, `${stem}-${i++}${ext}`);
  return p;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  if (a.help || (!a.env && !a.url)) { console.error('usage: doctor.mjs --env <cmEnvId> --site <siteName> [--url <live url>] [...] (see the header of this file)'); process.exit(2); }
  try {
    const env = loadEnv(a);
    const out = resolve(a.out && a.out !== true ? String(a.out) : '.');
    mkdirSync(out, { recursive: true });
    if (a['request-log']) setRequestLog(resolve(String(a['request-log'])));
    const rep = await runDoctor(a, env);
    const stem = `doctor-report-${today()}`;
    const md = nextFree(out, stem, '.md'); const json = md.replace(/\.md$/, '.json');
    writeFileSync(md, rep.md); writeFileSync(json, JSON.stringify(rep.json, null, 1));
    const s = rep.json.summary;
    console.log(`doctor: exit ${rep.exitCode} | P0 ${s.P0} P1 ${s.P1} P2 ${s.P2} P3 ${s.P3} | UNKNOWN ${s.unknown} SKIPPED ${s.skipped} passed ${s.passed} | ${rep.json.cost.calls} calls, ${rep.json.cost.wallMs} ms`);
    console.log(`report: ${md}`);
    if (rep.json.harnessError) console.error(rep.json.harnessError);
    process.exitCode = rep.exitCode;
  } catch (e) { console.error(baseRedact(`doctor: harness error: ${e.message}`)); process.exitCode = 2; }
}
