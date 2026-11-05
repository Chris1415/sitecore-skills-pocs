#!/usr/bin/env node
// extract-spec.mjs: read an existing site (or one page of it) back into a spec — "save this site / page as a template".
//   site mode      → a site-template spec for build-template.mjs (pages, page types, layouts, datasources, partials, host)
//   --page <path>  → a page-blueprint spec for build-blueprint.mjs (one page, offered in --target-site or the same site)
// Read-only. What cannot travel is reported, never silently dropped: personalization/test rules, parameters or links that
// point at items inside the source site, datasources with child items, more than one page design.
//
// Usage:
//   node extract-spec.mjs --site <name> --cm-host <host> --client-prefix <PREFIX> [--env-file <.env>] --out <spec.json>
//        [--name "<Template name>"] [--module <slug>] [--description "…"]
//   node extract-spec.mjs --site <name> --page "<path under Home>" [--target-site <name>] --out <blueprint.json> …
// Exit: 0 written · 1 live failure · 2 usage.
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs, mintToken, makeClient, fieldMap } from './lib/client.mjs';
import { OOTB_RENDERINGS_ROOT, CONTAINER, validateBlueprintSpec } from './lib/spec.mjs';
import { parseLayoutXml, nestRenderings } from './lib/layout.mjs';

const PAGE_DATA = '{1C82E550-EBCD-4E5D-8ABD-D50D0809541E}';
const PARTIAL_DESIGN = '{FD2059FD-6043-4DFE-8C04-E2437CE87634}';
const BASE_FIELDS_TEMPLATE_IDS = ['{47151711-26CA-434E-8132-D3E0B7D26683}', '{371D5FBB-5498-4D94-AB2B-E3B70EEBE78C}',
  '{F39A594A-7BC9-4DB0-BAA1-88543409C1F9}', '{6650FB34-7EA1-4245-A919-5CC0F002A6D7}', '{4414A1F9-826A-4647-8DF4-ED6A95E64C43}'];
const DROP_PARAMS = new Set(['DynamicPlaceholderId', 'FieldNames', 'RenderingIdentifier', 'CSSStyles', 'Include in schema']);
const GUID = /\{?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}?/gi;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// Test seam: `mint` replaces the OAuth token mint (stub-server tests only).
export async function main(argv, { log = console.log, mint = mintToken } = {}) {
  let o;
  try { o = parseArgs(argv, { site: 1, page: 1, targetSite: 1, cmHost: 1, clientPrefix: 1, envFile: 1, out: 1, name: 1, module: 1, description: 1 }); }
  catch (e) { log(`usage: ${e.message}`); return 2; }
  if (!o.site || !o.cmHost || !o.clientPrefix || !o.out) { log('usage: --site, --cm-host, --client-prefix and --out are required'); return 2; }
  const api = makeClient({ cmHost: o.cmHost, token: await mint(o) });
  const warnings = [];
  const warn = m => { if (!warnings.includes(m)) warnings.push(m); };

  const site = (await api.gql('query{solutionSites(input:{}){name rootItem{path}}}')).solutionSites.find(s => s.name === o.site);
  if (!site) { log(`ERROR site "${o.site}" not found`); return 1; }
  const root = site.rootItem.path, coll = root.split('/')[3], home = `${root}/Home`;
  const inSite = p => p && p.toLowerCase().startsWith(root.toLowerCase() + '/');

  // --- item helpers ---
  const cache = new Map();
  const full = async idOrPath => {
    if (cache.has(idOrPath)) return cache.get(idOrPath);
    const it = await api.item(idOrPath, true);
    cache.set(idOrPath, it);
    return it;
  };
  const tplFieldCache = new Map();
  const templateFields = async templateId => {
    if (!tplFieldCache.has(templateId)) {
      const d = await api.gql('query($id:ID!){itemTemplate(where:{templateId:$id}){name fields(first:400){nodes{name type}}}}', { id: templateId });
      tplFieldCache.set(templateId, d.itemTemplate?.fields.nodes || []);
    }
    return tplFieldCache.get(templateId);
  };
  const baseFieldNames = new Set();
  for (const id of BASE_FIELDS_TEMPLATE_IDS) for (const f of await templateFields(id)) baseFieldNames.add(f.name);
  const contentValues = (it, allowed) => Object.fromEntries((it.fields?.nodes || [])
    .filter(n => !n.name.startsWith('__') && n.value !== '' && (!allowed || allowed.has(n.name))).map(n => [n.name, n.value]));

  /** Turn one rendering node into a spec component; resolves rendering, datasource and parameters. */
  async function component(node, ownerPath) {
    const r = await full(node.id);
    if (!r) { warn(`rendering ${node.id} on ${ownerPath} no longer exists; skipped`); return null; }
    const rf = fieldMap(r);
    const rendering = r.path.startsWith(OOTB_RENDERINGS_ROOT + '/') ? r.path.slice(OOTB_RENDERINGS_ROOT.length + 1) : r.path;
    const c = { rendering };
    const params = {};
    for (const [k, v] of Object.entries(node.params)) {
      if (DROP_PARAMS.has(k) || v === '') continue;
      // Ids of items inside the source site (Styles, NavigationRoot …) become site-relative tokens, resolved in the new site.
      let value = String(v);
      for (const g of value.match(GUID) || []) {
        const t = await full(g.replace(/[{}]/g, ''));
        if (t && inSite(t.path)) value = value.replace(g, `site:${t.path.slice(root.length + 1)}`);
      }
      params[k] = value;
    }
    if (node.params.FieldNames) {
      const v = await full(node.params.FieldNames.replace(/[{}]/g, ''));
      if (v && v.name !== 'Default') c.variant = v.name;
    }
    if (Object.keys(params).length) c.params = params;
    if (node.ds) {
      let ds = null;
      if (node.ds.startsWith('local:')) ds = await full(`${ownerPath}${node.ds.slice('local:'.length)}`);
      else if (/^\{?[0-9a-f-]{36}\}?$/i.test(node.ds)) ds = await full(node.ds.replace(/[{}]/g, ''));
      else if (node.ds.startsWith('/sitecore/')) ds = await full(node.ds);
      if (!ds) warn(`datasource "${node.ds}" of ${rendering} on ${ownerPath} does not resolve; dropped`);
      else if (!inSite(ds.path)) c.datasource = ds.path;                         // shared, global datasource: reference it
      else {
        const kids = await api.children(ds.path);
        if (kids.length) warn(`datasource ${ds.path} has ${kids.length} child item(s) (e.g. list rows); only its own fields travel; add them to the spec as datasource.children`);
        const fields = contentValues(ds);
        if (Object.values(fields).some(v => /linktype="internal"/.test(v))) warn(`datasource ${ds.name} on ${ownerPath} holds internal links into the source site`);
        c.datasource = { name: ds.name, fields };
        // Keep the item's own template when it differs from the rendering's Datasource Template (or there is none).
        const declared = rf['Datasource Template'] ? await full(rf['Datasource Template']) : null;
        const same = declared && declared.itemId.toUpperCase() === ds.template.templateId.toUpperCase();
        if (!same && declared?.template.name !== 'Branch') c.datasource.template = (await full(ds.template.templateId))?.path;
      }
    }
    if (node.children.length) c.children = (await Promise.all(node.children.map(ch => component(ch, ownerPath)))).filter(Boolean);
    return c;
  }
  async function layoutOf(it, ownerPath, prefer = 'final') {
    const f = fieldMap(it);
    const xml = (prefer === 'final' && f['__Final Renderings']) || f.__Renderings || f['__Final Renderings'] || '';
    const { renderings, dropped } = parseLayoutXml(xml);
    dropped.forEach(d => warn(`${ownerPath}: ${d} not extracted`));
    const roots = nestRenderings(renderings, (await full(CONTAINER)).itemId);
    const out = [];
    for (const n of roots) { const c = await component(n, ownerPath); if (c) { if (n.ph !== 'headless-main') c.placeholder = n.ph.replace(/^\//, ''); out.push(c); } }
    return out;
  }
  // de-duplicate datasource names per owner (a page may reuse names from different folders)
  const dedupe = comps => { const seen = new Map(); const walk = l => l.forEach(c => { if (c.datasource?.name) { const k = c.datasource.name; const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n > 1) c.datasource.name = `${k} ${n}`; } if (c.children) walk(c.children); }); walk(comps); return comps; };

  const typeName = t => (t === 'Page' ? 'Content Page' : t); // the collection's own "Page" exists in every collection

  // --- blueprint mode ---
  if (o.page) {
    const pagePath = `${home}/${o.page.replace(/^\/+|\/+$/g, '')}`;
    const pg = await full(pagePath);
    if (!pg) { log(`ERROR page not found: ${pagePath}`); return 1; }
    const tf = await templateFields(pg.template.templateId);
    const own = new Set(tf.map(f => f.name).filter(n => !baseFieldNames.has(n) && !n.startsWith('__')));
    own.delete('Title');
    const bp = { site: o.targetSite || o.site, name: o.name || `${pg.name} Blueprint`, pageTemplate: pg.template.name,
      fields: contentValues(pg, own), components: dedupe(await layoutOf(pg, pagePath)) };
    writeFileSync(o.out, JSON.stringify(bp, null, 2) + '\n');
    // What a blueprint cannot hold is written as captured and reported here; build-blueprint then refuses it (exit 2) until it is edited.
    for (const e of validateBlueprintSpec(bp).errors) warn(`build-blueprint will refuse this spec until it is edited: ${e}`);
    log(`wrote blueprint spec ${o.out}: "${bp.name}" from ${pagePath} [${pg.template.name}], ${bp.components.length} top-level components`);
    warnings.forEach(w => log(`WARN  ${w}`));
    return 0;
  }

  // --- site mode ---
  const pages = [];
  const walk = async (path, rel) => {
    const it = await full(path);
    if (!it) return;
    pages.push({ it, rel });
    for (const ch of await api.children(path)) {
      if (ch.template.templateId.toUpperCase() === PAGE_DATA || ch.name === 'Data') continue;
      await walk(ch.path, rel ? `${rel}/${ch.name}` : ch.name);
    }
  };
  await walk(home, '');
  const types = new Map();
  for (const { it } of pages) {
    if (types.has(it.template.name)) continue;
    const tf = await templateFields(it.template.templateId);
    const fields = tf.filter(f => !f.name.startsWith('__') && !baseFieldNames.has(f.name) && !['Title', 'Content'].includes(f.name))
      .map(f => ({ name: f.name, type: f.type }));
    types.set(it.template.name, { name: typeName(it.template.name), fields });
  }
  const specPages = [];
  for (const { it, rel } of pages) {
    const t = types.get(it.template.name);
    const allowed = new Set(['Title', 'Content', ...t.fields.map(f => f.name)]);
    const p = { path: rel, ...(rel ? { type: t.name } : {}), fields: contentValues(it, allowed), components: dedupe(await layoutOf(it, it.path)) };
    for (const v of Object.values(p.fields)) if (/linktype="internal"/.test(v)) warn(`page ${rel || 'Home'} has internal links into the source site`);
    specPages.push(p);
  }
  // partial designs (any depth under Presentation/Partial Designs)
  const partials = [];
  const walkPd = async path => {
    for (const ch of await api.children(path)) {
      if (ch.template.templateId.toUpperCase() === PARTIAL_DESIGN) {
        const it = await full(ch.path);
        const comps = dedupe(await layoutOf(it, ch.path, 'shared'));
        if (comps.length) partials.push({ name: ch.name, placeholder: comps[0].placeholder || 'headless-main', components: comps.map(c => ({ ...c, placeholder: c.placeholder || 'headless-main' })) });
      } else if (!/^__/.test(ch.name)) await walkPd(ch.path);
    }
  };
  await walkPd(`${root}/Presentation/Partial Designs`);
  const designs = await api.children(`${root}/Presentation/Page Designs`);
  if (designs.length > 1) warn(`${designs.length} page designs (${designs.map(d => d.name).join(', ')}); the template maps every page type to one Default design with all partials`);
  const grouping = fieldMap(await full(`${root}/Settings/Site Grouping/${o.site}`));
  const custom = new Set();
  const scan = l => l.forEach(c => { if (c.rendering.startsWith('/sitecore/')) custom.add(c.rendering); if (c.children) scan(c.children); });
  [...specPages, ...partials].forEach(p => scan(p.components));

  const name = o.name || `${o.site} Template`;
  const spec = {
    name, module: o.module || slug(name), description: o.description || `Captured from site "${o.site}".`,
    contents: { Pages: specPages.map(p => p.path || 'Home').join(', '), 'Captured from': `${o.site} (${coll})` },
    renderingHost: grouping.RenderingHost || 'Default',
    homeType: types.get(pages[0].it.template.name).name,
    pageTypes: [...types.values()],
    partials, pages: specPages,
    ...(custom.size ? { availableRenderings: [{ name: `${name} components`, renderings: [...custom] }] } : {}),
  };
  writeFileSync(o.out, JSON.stringify(spec, null, 2) + '\n');
  log(`wrote site-template spec ${o.out}: ${specPages.length} pages, ${spec.pageTypes.length} page types, ${partials.length} partials, host "${spec.renderingHost}"`);
  if (spec.renderingHost === 'Default') warn('the source site binds to the "Default" rendering host; set renderingHost to the real editing host before building');
  warnings.forEach(w => log(`WARN  ${w}`));
  return 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'extract-spec.mjs') main(process.argv.slice(2)).then(c => process.exit(c), e => { console.log(`ERROR ${e.message}`); process.exit(1); });
