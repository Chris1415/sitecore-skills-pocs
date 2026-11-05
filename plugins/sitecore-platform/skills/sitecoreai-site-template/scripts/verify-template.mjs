#!/usr/bin/env node
// verify-template.mjs: prove a site template works. Without --smoke it only checks the listing (read-only).
// With --smoke it creates a throwaway collection + site from the template, then asserts what the spec promised:
//   scaffold job finished without exceptions · every spec page exists with its page type · component counts per page ·
//   partial designs + page design mapping · rendering host resolves · (with --environment-id) Edge preview serves the componentNames.
// The throwaway site is removed afterwards unless --keep, and a site name that already exists is refused (exit 2) before anything is created.
// The collection is removed only if this run created it.
// --collection reuses an existing collection and --site-name names the site; both require --keep.
//
// Usage:
//   node verify-template.mjs --spec <file.json> --cm-host <host> --client-prefix <PREFIX> [--env-file <.env>]
//        [--smoke] [--keep] [--collection <name>] [--site-name <name>] [--environment-id <deploy env id>]
// Exit: 0 verified · 1 an assertion failed · 2 usage.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs, mintToken, makeClient, fieldMap, sleep as defaultSleep, DEPLOY_API } from './lib/client.mjs';
import { validateSpec, walkComponents } from './lib/spec.mjs';
import { paths } from './build-template.mjs';
import { checkDatasourceExtras } from './lib/children.mjs';

// Datasource child rows and __Masters: read back every datasource of a page/partial/blueprint page that declares them.
async function checkExtras(api, ownerPath, components, check) {
  for (const { c } of walkComponents(components))
    if (c.datasource && typeof c.datasource === 'object' && (c.datasource.children?.length || c.datasource.insertOptions?.length))
      await checkDatasourceExtras(api, `${ownerPath}/Data/${c.datasource.name}`, c.datasource, check);
}

// Generated names must stay unique per run, so a long module name gives way, never the stamp.
export function stampedName(prefix, module, stamp, max) {
  return `${prefix}-${module.slice(0, Math.max(0, max - prefix.length - stamp.length - 2))}-${stamp}`;
}

async function waitJob(api, handle, log, sleep, timeoutMs = 300000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    const d = await api.gql(`query($h:String){job(input:{handle:$h}){done status{jobState exceptions messages}}}`, { h: handle });
    last = d.job;
    if (!last || last.done) break;
    await sleep(3000);
  }
  log(`  job ${last?.status?.jobState ?? 'expired'} after ${Math.round((Date.now() - t0) / 1000)} s`);
  return last;
}

async function edgeComponents(previewCtx, site, route) {
  const r = await fetch(`https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=${previewCtx}`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query($s:String!,$r:String!){layout(site:$s,routePath:$r,language:"en"){item{rendered}}}', variables: { s: site, r: route } }) });
  const rd = (await r.json()).data?.layout?.item?.rendered?.sitecore;
  if (!rd) return null;
  const names = [];
  const walk = ph => { for (const arr of Object.values(ph || {})) for (const c of arr) { names.push(c.componentName); walk(c.placeholders); } };
  walk(rd.route?.placeholders);
  return names;
}

// Test seam: `mint` replaces the OAuth token mint, `sleep` the settle delays and `now` the clock behind generated names (stub-server tests only).
export async function main(argv, { log = console.log, mint = mintToken, sleep = defaultSleep, now = () => new Date() } = {}) {
  let o;
  try { o = parseArgs(argv, { spec: 1, cmHost: 1, clientPrefix: 1, envFile: 1, smoke: 'flag', keep: 'flag', collection: 1, siteName: 1, environmentId: 1 }); }
  catch (e) { log(`usage: ${e.message}`); return 2; }
  if (!o.spec || !o.cmHost || !o.clientPrefix) { log('usage: --spec, --cm-host and --client-prefix are required'); return 2; }
  const { spec, errors } = validateSpec(JSON.parse(readFileSync(o.spec, 'utf8')));
  if (errors.length) { errors.forEach(e => log(`ERROR ${e}`)); return 2; }
  if (o.collection && !o.keep) { log('usage: --collection reuses an existing collection and must be paired with --keep (cleanup only ever removes a collection this run created)'); return 2; }
  if (o.siteName && !o.keep) { log('usage: --site-name must be paired with --keep (without it, cleanup would remove the named site)'); return 2; }
  const token = await mint(o);
  const api = makeClient({ cmHost: o.cmHost, token });
  const fails = [];
  const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };

  const tplItem = await api.item(paths(spec).templateItem);
  check(!!tplItem, `template item ${paths(spec).templateItem}`);
  if (!tplItem) return 1;
  const listed = (await api.gql('query{solutionTemplates{id name enabled thumbnailUrl}}')).solutionTemplates.find(t => t.id.toUpperCase() === tplItem.itemId.toUpperCase());
  check(!!listed && listed.enabled, `listed and enabled in solutionTemplates as "${listed?.name}"`);
  if (spec.thumbnail) check(!!listed?.thumbnailUrl, 'thumbnail resolves');
  if (!o.smoke) return fails.length ? 1 : 0;

  // --- smoke: create a throwaway site in a fresh collection ---
  const stamp = now().toISOString().replace(/\D/g, '').slice(4, 12);
  const collName = o.collection || stampedName('zz-verify', spec.module, stamp, 50);
  const siteName = o.siteName || stampedName('verify', spec.module, stamp, 60); // site names are unique CM-wide, not per collection
  // A site that already exists is not this run's to touch: createSite can report the conflict only inside the job, and cleanup would then remove it.
  const existingSite = (await api.gql('query{solutionSites(input:{}){name}}')).solutionSites.find(s => s.name.toLowerCase() === siteName.toLowerCase());
  if (existingSite) { log(`usage: site ${existingSite.name} already exists on this CM; choose another --site-name (nothing was created or removed)`); return 2; }
  let createdSite = false; // cleanup removes the site only when THIS run created it
  let createdColl = false; // cleanup removes the collection only when THIS run created it
  let coll = (await api.gql('query{siteCollections{id name}}')).siteCollections.find(c => c.name === collName);
  if (!coll) {
    createdColl = true;
    await api.gql('mutation($i:CreateSiteCollectionInput!){createSiteCollection(input:$i){job{handle}}}', { i: { name: collName } });
    for (let i = 0; i < 40 && !coll; i++) { await sleep(3000); coll = (await api.gql('query{siteCollections{id name}}')).siteCollections.find(c => c.name === collName); }
  }
  check(!!coll, `collection ${collName}`);
  if (!coll) return 1;
  const cleanup = async () => {
    const removal = (mutation, id, what) => api.gql(mutation, { i: id }).then(() => `${what} removed`, e => { log(`WARN  ${what}: ${e.message}`); return `${what} NOT removed`; });
    const parts = [];
    if (createdSite) {
      parts.push(await removal('mutation($i:RemoveSiteInput!){removeSite(input:$i){job{handle}}}', { siteName }, `site ${siteName}`));
      await sleep(5000);
    }
    parts.push(createdColl ? await removal('mutation($i:RemoveSiteCollectionInput!){removeSiteCollection(input:$i){job{handle}}}', { id: coll.id }, `collection ${collName}`)
      : `collection ${collName} pre-existed and was left in place`);
    log(`cleanup: ${parts.join('; ')}`);
  };
  let cs;
  try {
    cs = await api.gql('mutation($i:CreateSiteInput!){createSite(input:$i){job{handle}}}',
      { i: { siteName, templateId: tplItem.itemId, collectionId: coll.id, language: spec.language, hostName: '*' } });
    createdSite = true;
  } catch (e) {
    check(false, `createSite: ${e.message}`);
    if (!o.keep) await cleanup();
    log(`FAILED ${fails.length} check(s)`);
    return 1;
  }
  const job = await waitJob(api, cs.createSite.job.handle, log, sleep);
  const exc = String(job?.status?.exceptions ?? '').replace(/^\[\s*\]$/, '').trim();
  log(`  job status: ${JSON.stringify(job?.status ?? null).slice(0, 300)}`);
  check(!!job?.done && !exc, `scaffold job finished without exceptions${exc ? ': ' + exc.slice(0, 400) : job?.done ? '' : ': the job is gone or timed out'}`);
  const root = `/sitecore/content/${collName}/${siteName}`;
  let site;
  for (let i = 0; i < 40 && !site; i++) { site = await api.item(`${root}/Home`); if (!site) await sleep(3000); }
  await sleep(5000); // ExecuteScript + PostSetupStep finish after the Home item appears

  for (const p of spec.pages) {
    const path = p.path ? `${root}/Home/${p.path}` : `${root}/Home`;
    const d = await api.gql(`query($p:String!){item(where:{path:$p}){template{name} f:field(name:"__Final Renderings"){value} s:field(name:"__Renderings"){value}}}`, { p: path });
    const want = [...walkComponents(p.components)].length;
    const typeName = p.path ? p.type : spec.homeType;
    const xml = (d.item?.f?.value || '') + (d.item?.s?.value || '');
    const got = (xml.match(/s:id=/g) || []).length;
    check(!!d.item && (!typeName || d.item.template.name === typeName) && got >= want,
      `page ${p.path || 'Home'}: ${d.item ? `[${d.item.template.name}]` : 'missing'}, ${got}/${want} components`);
    await checkExtras(api, path, p.components, check);
  }
  for (const pd of spec.partials) {
    const d = await api.gql(`query($p:String!){item(where:{path:$p}){s:field(name:"__Renderings"){value}}}`, { p: `${root}/Presentation/Partial Designs/${pd.name}` });
    const got = ((d.item?.s?.value || '').match(/s:id=/g) || []).length;
    check(!!d.item && got >= [...walkComponents(pd.components)].length, `partial ${pd.name}: ${got} components`);
    await checkExtras(api, `${root}/Presentation/Partial Designs/${pd.name}`, pd.components, check);
  }
  if (spec.partials.length) {
    const designs = fieldMap(await api.item(`${root}/Presentation/Page Designs`, true));
    check(!!designs.TemplatesMapping, 'page design mapping set');
  }
  // Insert options on Home: every page type (and blueprint) must be offered, not the skeleton's item-level "Base Page".
  const io = (await api.gql('query($p:String!){item(where:{path:$p}){insertOptions{name}}}', { p: `${root}/Home` })).item?.insertOptions.map(t => t.name) || [];
  if (spec.pageTypes.length) check(spec.pageTypes.every(t => io.includes(t.name)) && spec.blueprints.every(b => io.includes(b.name)), `Home offers ${io.join(', ') || 'nothing'}`);
  for (const bp of spec.blueprints) {
    const br = await api.item(`/sitecore/templates/Branches/Project/${collName}/${bp.name}`);
    check(!!br, `blueprint "${bp.name}" in the collection's Branches folder`);
    if (!br) continue;
    const pageName = `zz-${bp.name.replace(/[^A-Za-z0-9]+/g, '-')}`;
    const home = await api.item(`${root}/Home`);
    const c = await api.gql('mutation($i:CreateItemInput!){createItem(input:$i){item{path}}}', { i: { name: pageName, templateId: br.itemId, parent: home.itemId, language: spec.language } });
    const pg = (await api.gql(`query($p:String!){item(where:{path:$p}){template{name} t:field(name:"Title"){value} f:field(name:"__Final Renderings"){value}}}`, { p: c.createItem.item.path })).item;
    const want = [...walkComponents(bp.components)].length;
    const got = ((pg.f?.value || '').match(/s:id=/g) || []).length;
    check(pg.template.name === bp.type && got === want && (bp.fields?.Title || pg.t?.value === pageName),
      `page from blueprint "${bp.name}": [${pg.template.name}], ${got}/${want} components, Title "${pg.t?.value}"`);
    await checkExtras(api, c.createItem.item.path, bp.components, check);
    await api.remove(c.createItem.item.path);
  }
  const grouping = fieldMap(await api.item(`${root}/Settings/Site Grouping/${siteName}`, true));
  const host = await api.item(`/sitecore/system/Settings/Services/Rendering Hosts/${grouping.RenderingHost}`);
  check(grouping.RenderingHost === spec.renderingHost && !!host, `rendering host "${grouping.RenderingHost}" ${host ? 'resolves' : 'DOES NOT EXIST'}`);

  let edgeSkipped = o.environmentId ? '' : 'no --environment-id';
  if (o.environmentId) {
    const env = await (await fetch(`${DEPLOY_API}/environments/v1/${o.environmentId}`, { headers: { authorization: `Bearer ${token}` } })).json();
    if (!env.previewContextId) { edgeSkipped = 'no previewContextId from the Deploy API'; log('WARN  no previewContextId from the Deploy API; Edge check skipped'); }
    else for (const p of spec.pages) {
      const route = '/' + (p.path || '');
      let names = null;
      for (let i = 0; i < 10 && !names; i++) { names = await edgeComponents(env.previewContextId, siteName, route.replace(/ /g, '-')); if (!names) await sleep(3000); }
      const want = [...walkComponents(p.components)].map(({ c }) => c.renderingPath.split('/').pop().replace(/ /g, ''));
      const missing = want.filter(w => !(names || []).some(n => n.toLowerCase() === w.toLowerCase()));
      check(!!names && !missing.length, `edge preview ${route}: ${names ? names.join(', ') || '(empty)' : 'no layout'}${missing.length ? ' — missing ' + missing.join(', ') : ''}`);
    }
  }

  if (!o.keep) await cleanup();
  else log(`kept: ${root}`);
  log(fails.length ? `FAILED ${fails.length} check(s)` : `VERIFIED${edgeSkipped ? ` (Edge preview NOT checked: ${edgeSkipped})` : ''}`);
  return fails.length ? 1 : 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'verify-template.mjs') main(process.argv.slice(2)).then(c => process.exit(c), e => { console.log(`ERROR ${e.message}`); process.exit(1); });
