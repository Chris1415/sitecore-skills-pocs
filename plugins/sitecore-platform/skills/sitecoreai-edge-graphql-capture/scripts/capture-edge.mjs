#!/usr/bin/env node
/**
 * capture-edge.mjs — one-shot Experience Edge snapshot (SKILL.md § Minimal capture).
 *
 *   SITECORE_EDGE_CONTEXT_ID=… node scripts/capture-edge.mjs --site <siteName> [--language en] [--out edge-snapshot] [--types Item,LayoutData,…] [--max-routes 50]
 *
 * Writes the canonical edge-snapshot layout: type-<T>.json (per-type introspection — the full
 * IntrospectionQuery is >15 levels deep and Edge rejects it), sites.json, routes.json (ALL pages,
 * paginated with `after`), layouts/<route>.json (one layout per route, capped by --max-routes).
 *
 * No auth header — the contextId in the query string IS the access control. No dependencies;
 * Node 18+. Exit 1 on any Edge error (the response is still written so the error is inspectable —
 * a playground's edge-snapshot/introspection.json is exactly such a capture).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CTX = opt('--context-id', process.env.SITECORE_EDGE_CONTEXT_ID);
const SITE = opt('--site');
const LANG = opt('--language', 'en');
const OUT = opt('--out', 'edge-snapshot');
const TYPES = opt('--types', 'Item,ItemField,LayoutData,RoutesResult,SearchPredicate,SiteData,SiteInfo').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_ROUTES = Number(opt('--max-routes', '50'));
if (!CTX || !SITE) { console.error('usage: capture-edge.mjs --site <siteName> [--language en] [--out dir] [--types A,B] [--max-routes N]   (SITECORE_EDGE_CONTEXT_ID or --context-id required)'); process.exit(2); }

const EDGE_URL = `https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=${encodeURIComponent(CTX)}`;
let failures = 0;
async function post(query, variables, file) {
  const res = await fetch(EDGE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(variables ? { query, variables } : { query }) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (file) writeFileSync(join(OUT, file), JSON.stringify(json, null, 2) + '\n');
  if (!res.ok || json.errors) { failures++; console.error(`  ✖ ${file ?? 'query'}: HTTP ${res.status}${json.errors ? ' — ' + json.errors.map((e) => e.message).join('; ').slice(0, 200) : ''}`); }
  return json;
}

mkdirSync(join(OUT, 'layouts'), { recursive: true });
console.log(`Edge snapshot → ${OUT}/  (site ${SITE}, language ${LANG})`);

// 1. per-type introspection — one POST per type, never the full IntrospectionQuery (15-depth limit)
for (const T of TYPES) {
  const j = await post(`{ __type(name: "${T}") { name kind fields { name description args { name type { name kind } } type { name kind ofType { name kind } } } } }`, null, `type-${T}.json`);
  console.log(`  type-${T}.json  ${j?.data?.__type ? `${j.data.__type.fields?.length ?? 0} fields` : 'NULL — type does not exist on this tenant'}`);
}

// 2. sites
const sites = await post('{ site { allSiteInfo { total results { name hostname language rootPath } } } }', null, 'sites.json');
console.log(`  sites.json  ${sites?.data?.site?.allSiteInfo?.total ?? '?'} site(s)`);

// 3. routes — paginate with `after`; a single page silently truncates any real site. Page size stays
// at 10: `first: 50` + pageInfo exceeded the complexity limit on the first live run (2026-09-16).
const routes = [];
let after = null;
do {
  const j = await post(`query ($sn: String!, $ln: String!, $after: String) { site { siteInfo(site: $sn) { name rootPath routes(first: 10, language: $ln, after: $after) { total pageInfo { hasNext endCursor } results { routePath } } } } }`, { sn: SITE, ln: LANG, after });
  const r = j?.data?.site?.siteInfo?.routes;
  if (!r) { after = null; break; }
  routes.push(...r.results.map((x) => x.routePath));
  after = r.pageInfo?.hasNext ? r.pageInfo.endCursor : null;
} while (after);
writeFileSync(join(OUT, 'routes.json'), JSON.stringify({ site: SITE, language: LANG, total: routes.length, routes }, null, 2) + '\n');
console.log(`  routes.json  ${routes.length} route(s)`);

// 4. one layout per route
const take = routes.slice(0, MAX_ROUTES);
for (const rp of take) {
  const safe = rp.replace(/\//g, '_').replace(/^_/, '') || 'root';
  const j = await post('query ($rp: String!, $ln: String!, $sn: String!) { layout(routePath: $rp, language: $ln, site: $sn) { item { rendered } } }', { rp, ln: LANG, sn: SITE }, `layouts/${safe}.json`);
  console.log(`  layouts/${safe}.json  ${j?.data?.layout?.item ? 'ok' : 'no layout'}`);
}
if (routes.length > take.length) console.log(`  (${routes.length - take.length} more route(s) skipped — raise --max-routes)`);
console.log(failures ? `\n${failures} request(s) returned errors — see the files.` : '\nSnapshot complete.');
process.exit(failures ? 1 : 0);
