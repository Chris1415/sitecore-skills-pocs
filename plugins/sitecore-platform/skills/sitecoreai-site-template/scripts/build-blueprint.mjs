#!/usr/bin/env node
// build-blueprint.mjs: add a page blueprint (a prefilled page = branch template) to an EXISTING site, so marketers create
// a ready landing/campaign page from "Create a page" in Pages. No new site, hostname or deploy.
// The branch lives in the collection's own Branches folder and is offered through the insert options of `offerOn` page
// templates (their standard values, plus any item that overrides them with item-level __Masters, such as Home).
// Datasources are page-local (local:/Data/<name>) and `$name` in field values becomes the new page's name.
//
// Usage:
//   node build-blueprint.mjs --spec <blueprint.json> --cm-host <host> --client-prefix <PREFIX> [--env-file <.env>]
//        [--dry-run] [--component-map <map.ts>] [--smoke] [--environment-id <deploy env id>]
// Exit: 0 built (and smoke ok) · 1 lint / live failure · 2 usage or spec error.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs, mintToken, makeClient, fieldMap, sleep, DEPLOY_API } from './lib/client.mjs';
import { validateBlueprintSpec, walkComponents, componentMapKeys } from './lib/spec.mjs';
import { resolveDatasourceExtras, checkDatasourceExtras } from './lib/children.mjs';
import { buildLayoutXml } from './lib/layout.mjs';

const BRANCH = '{35E75C72-4985-4E09-88C3-0EAC6CD1E64F}', BRANCHES_FOLDER = '{2F5F8343-2A18-46A4-92A1-0F7AB0452741}';
const PAGE_DATA = '{1C82E550-EBCD-4E5D-8ABD-D50D0809541E}';

async function fieldNames(api, templateId) {
  const d = await api.gql('query($id:ID!){itemTemplate(where:{templateId:$id}){fields(first:400){nodes{name}}}}', { id: templateId });
  return new Set((d.itemTemplate?.fields.nodes || []).map(f => f.name));
}
const appendIds = (value, id) => [...new Set([...(value || '').split('|').filter(Boolean).map(x => x.toUpperCase()), id.toUpperCase()])].join('|');

export async function main(argv, { log = console.log } = {}) {
  let o;
  try { o = parseArgs(argv, { spec: 1, cmHost: 1, clientPrefix: 1, envFile: 1, dryRun: 'flag', componentMap: 1, smoke: 'flag', environmentId: 1 }); }
  catch (e) { log(`usage: ${e.message}`); return 2; }
  if (!o.spec || !o.cmHost || !o.clientPrefix) { log('usage: --spec, --cm-host and --client-prefix are required'); return 2; }
  const { blueprint: b, errors, warnings } = validateBlueprintSpec(JSON.parse(readFileSync(o.spec, 'utf8')));
  for (const w of warnings) log(`WARN  ${w}`);
  if (errors.length) { errors.forEach(e => log(`ERROR ${e}`)); return 2; }
  const token = await mintToken(o);
  const api = makeClient({ cmHost: o.cmHost, token });

  // --- resolve the site, its collection and the page template ---
  const site = (await api.gql('query{solutionSites(input:{}){name rootItem{path}}}')).solutionSites.find(s => s.name === b.site);
  if (!site) { log(`ERROR site "${b.site}" not found`); return 1; }
  const root = site.rootItem.path, coll = root.split('/')[3];
  const tplRoot = `/sitecore/templates/Project/${coll}`, brRoot = `/sitecore/templates/Branches/Project/${coll}`;
  const lintErr = [];
  const pageTpl = await api.item(`${tplRoot}/${b.pageTemplate}`);
  if (!pageTpl) lintErr.push(`page template "${b.pageTemplate}" not in ${tplRoot} (have: ${(await api.children(tplRoot)).map(c => c.name).join(', ')})`);
  const offer = [];
  for (const t of b.offerOn) { const it = await api.item(`${tplRoot}/${t}`); if (!it) lintErr.push(`offerOn: "${t}" not in ${tplRoot}`); else offer.push(it); }

  // --- lint: renderings, component map, datasource + page fields ---
  const cmap = o.componentMap ? componentMapKeys(readFileSync(o.componentMap, 'utf8')) : null;
  const renderingIds = {}, dsTemplates = {};
  for (const { c } of walkComponents(b.components)) {
    if (renderingIds[c.renderingPath]) continue;
    const r = await api.item(c.renderingPath, true);
    if (!r) { lintErr.push(`rendering not found: ${c.renderingPath}`); continue; }
    renderingIds[c.renderingPath] = r.itemId.toUpperCase();
    const f = fieldMap(r);
    if (cmap && f.componentName && !cmap.has(f.componentName)) lintErr.push(`componentName "${f.componentName}" is not in the head app's component map`);
    if (f['Datasource Template']) dsTemplates[c.renderingPath] = f['Datasource Template'];
  }
  const dsFieldCache = {}, extras = { templateIds: {} };
  for (const { c } of walkComponents(b.components)) {
    if (!c.datasource || typeof c.datasource !== 'object') continue;
    await resolveDatasourceExtras(api, c.datasource, 'blueprint', lintErr, [], extras);
    const tp = c.datasource.template || dsTemplates[c.renderingPath];
    if (!tp) { lintErr.push(`${c.rendering} has no Datasource Template; set datasource.template or use a path string`); continue; }
    c.datasourceTemplatePath = tp;
    const t = await api.item(tp);
    if (!t) { lintErr.push(`datasource template not found: ${tp}`); continue; }
    if (t.template.name === 'Branch') continue;
    dsFieldCache[tp] ||= await fieldNames(api, t.itemId);
    for (const k of Object.keys(c.datasource.fields)) if (!dsFieldCache[tp].has(k)) lintErr.push(`datasource field "${k}" not on ${tp}`);
  }
  let hasTitle = false;
  if (pageTpl) {
    const pf = await fieldNames(api, pageTpl.itemId);
    hasTitle = pf.has('Title');
    for (const k of Object.keys(b.fields)) if (!pf.has(k)) lintErr.push(`page field "${k}" not on ${b.pageTemplate}`);
  }
  if (lintErr.length) { lintErr.forEach(e => log(`ERROR ${e}`)); return 1; }
  log(`lint ok: site ${b.site} (collection ${coll}), page template ${b.pageTemplate}, ${[...walkComponents(b.components)].length} components`);

  for (const { c } of walkComponents(b.components)) for (const [k, v] of Object.entries(c.params || {})) {
    if (!String(v).includes('site:')) continue;
    const parts = [];
    for (const part of String(v).split('|')) {
      if (!part.startsWith('site:')) { parts.push(part); continue; }
      const t = await api.item(`${root}/${part.slice(5)}`);
      if (t) parts.push(t.itemId.toUpperCase()); else log(`WARN  ${part} does not exist in ${b.site}; dropped from ${k}`);
    }
    c.params[k] = parts.join('|');
  }
  const { xml, datasources } = buildLayoutXml(b.components, renderingIds, () => `{${randomUUID().toUpperCase()}}`);
  if (o.dryRun) { log('dry run: layout'); log(xml); return 0; }

  // --- build the branch ---
  if (!(await api.item(brRoot))) await api.upsert('/sitecore/templates/Branches/Project', coll, BRANCHES_FOLDER);
  const branch = await api.upsert(brRoot, b.name, BRANCH);
  const pageFields = [...(hasTitle && !('Title' in b.fields) ? [{ name: 'Title', value: '$name' }] : []),
    ...Object.entries(b.fields).map(([name, value]) => ({ name, value })), { name: '__Final Renderings', value: xml }];
  await api.upsert(`${brRoot}/${b.name}`, '$name', pageTpl.itemId, pageFields);
  await api.upsert(`${brRoot}/${b.name}/$name`, 'Data', PAGE_DATA);
  for (const d of datasources) {
    const t = await api.item(d.template || dsTemplates[d.renderingPath]);
    const dsFields = Object.entries(d.fields).map(([name, value]) => ({ name, value }));
    if (d.insertOptions.length) dsFields.push({ name: '__Masters', value: d.insertOptions.map(r => extras.templateIds[r]).join('|') });
    await api.upsert(`${brRoot}/${b.name}/$name/Data`, d.name, t.itemId, dsFields);
    const writeKids = async (parent, list) => {
      for (const ch of list) {
        await api.upsert(parent, ch.name, extras.templateIds[ch.template], Object.entries(ch.fields).map(([name, value]) => ({ name, value })));
        if (ch.children?.length) await writeKids(`${parent}/${ch.name}`, ch.children);
      }
    };
    await writeKids(`${brRoot}/${b.name}/$name/Data/${d.name}`, d.children);
  }
  log(`branch    ${branch.id}  ${brRoot}/${b.name}`);

  // --- offer it: standard values of each offerOn template, plus items that override them (Home's item-level __Masters) ---
  const read = async p => (await api.gql('query($p:String!){item(where:{path:$p}){itemId(format: B) template{templateId(format: B)} m:field(name:"__Masters"){value}}}', { p })).item;
  for (const t of offer) {
    const sv = await read(`${tplRoot}/${t.name}/__Standard Values`);
    if (!sv) { log(`WARN  ${t.name} has no standard values; not offered there`); continue; }
    await api.gql('mutation($i:UpdateItemInput!){updateItem(input:$i){item{itemId}}}', { i: { itemId: sv.itemId, language: 'en', fields: [{ name: '__Masters', value: appendIds(sv.m?.value, branch.id) }] } });
    log(`offered   under every "${t.name}" page`);
  }
  const home = await read(`${root}/Home`);
  const homeSv = home && await read(`${tplRoot}/${(await api.item(home.template.templateId))?.name}/__Standard Values`);
  if (home && (home.m?.value || '') !== (homeSv?.m?.value || '')) {
    await api.gql('mutation($i:UpdateItemInput!){updateItem(input:$i){item{itemId}}}', { i: { itemId: home.itemId, language: 'en', fields: [{ name: '__Masters', value: appendIds(home.m?.value, branch.id) }] } });
    log('offered   under Home (it overrides insert options at item level)');
  }

  if (!o.smoke) return 0;
  // --- smoke: create a page from the branch like Pages does, check it, delete it ---
  const name = `zz-blueprint-check-${Date.now().toString(36)}`;
  const homeItem = await api.item(`${root}/Home`);
  const c = await api.gql('mutation($i:CreateItemInput!){createItem(input:$i){item{path}}}', { i: { name, templateId: branch.id, parent: homeItem.itemId, language: 'en' } });
  const path = c.createItem.item.path;
  const p = (await api.gql(`query($p:String!){item(where:{path:$p}){template{name} t:field(name:"Title"){value} f:field(name:"__Final Renderings"){value} children{nodes{name children{nodes{name}}}}}}`, { p: path })).item;
  const fails = [];
  const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
  check(p.template.name === b.pageTemplate, `page template ${p.template.name}`);
  if (hasTitle && !('Title' in b.fields)) check(p.t?.value === name, `$name expanded into Title ("${p.t?.value}")`);
  const dsCount = p.children.nodes.find(n => n.name === 'Data')?.children.nodes.length ?? 0;
  check(dsCount === datasources.length, `${dsCount}/${datasources.length} page-local datasources copied`);
  for (const d of datasources) await checkDatasourceExtras(api, `${path}/Data/${d.name}`, d, check);
  check(((p.f?.value || '').match(/s:id=/g) || []).length === [...walkComponents(b.components)].length, 'layout copied');
  if (o.environmentId) {
    const env = await (await fetch(`${DEPLOY_API}/environments/v1/${o.environmentId}`, { headers: { authorization: `Bearer ${token}` } })).json();
    let names = null;
    for (let i = 0; i < 10 && !names; i++) {
      const r = await fetch(`https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=${env.previewContextId}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'query($s:String!,$r:String!){layout(site:$s,routePath:$r,language:"en"){item{rendered}}}', variables: { s: b.site, r: `/${name}` } }) });
      const rd = (await r.json()).data?.layout?.item?.rendered?.sitecore;
      if (rd) { names = []; const w = ph => { for (const a of Object.values(ph || {})) for (const x of a) { names.push(x.componentName); w(x.placeholders); } }; w(rd.route.placeholders); }
      else await sleep(3000);
    }
    const want = [...walkComponents(b.components)].map(({ c: x }) => x.renderingPath.split('/').pop().replace(/ /g, ''));
    check(!!names && want.every(w => names.some(n => n.toLowerCase() === w.toLowerCase())), `edge preview: ${names ? names.join(', ') : 'no layout'}`);
  }
  await api.remove(path);
  log(`cleanup: removed ${path}`);
  log(fails.length ? `FAILED ${fails.length} check(s)` : 'VERIFIED');
  return fails.length ? 1 : 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'build-blueprint.mjs') main(process.argv.slice(2)).then(c => process.exit(c), e => { console.log(`ERROR ${e.message}`); process.exit(1); });
