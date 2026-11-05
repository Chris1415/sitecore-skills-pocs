#!/usr/bin/env node
// build-template.mjs: turn a site-template spec into live CM items through Authoring GraphQL, so the template
// lists in the Create Site dialog immediately (no deploy, publish or index rebuild).
//   validate spec → live lint (read-only) → [--dry-run stops here] → write items → confirm via solutionTemplates.
//
// Usage:
//   node build-template.mjs --spec <file.json> --cm-host <xmc-….sitecorecloud.io> --client-prefix <PREFIX> [--env-file <.env>]
//        [--dry-run] [--component-map <head-app>/.sitecore/component-map.ts] [--out <dir>]
// Auth: <PREFIX>_ID / <PREFIX>_SECRET (automation client with write access to the CM). Never on argv.
// Exit: 0 built (or dry-run clean) · 1 lint/live failure · 2 usage or spec error.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join, basename, extname } from 'node:path';
import { parseArgs, mintToken, makeClient, fieldMap } from './lib/client.mjs';
import { validateSpec, renderingsUsed, walkComponents, componentMapKeys } from './lib/spec.mjs';
import { emitSiteSetup, emitConfigureHost } from './lib/emit-ps.mjs';
import { resolveDatasourceExtras } from './lib/children.mjs';

export const T = {
  solutionTemplate: '{1B2DFD3B-F2F2-4F40-A75C-F6C2490919C4}', setupRoot: '{BED31D6F-D968-45A9-B54E-12D7F977D861}',
  executeScript: '{BC9BB684-36DF-4285-888B-D8B4D87B10DE}', postSetupStep: '{8FF2FEBF-F6D2-461D-9ED3-8B0CB5D9D86F}',
  settingsFolder: '{B4D86F9B-E917-4D68-978E-741361332174}', folder: '{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}',
  psModule: '{6D82FCD8-C379-443C-97A9-C6423C71E7D5}', psLibrary: '{AB154D3D-1126-4AB4-AC21-8B86E6BD70EA}',
  psScript: '{DD22F1B3-BD87-4DB2-9E7D-F7A496888D43}', template: '{AB86861A-6030-46C5-B394-E8F99E8B87DB}',
  templateFolder: '{0437FEE2-44C9-46A6-ABE9-28858D9FEE8C}', templateSection: '{E269FBB5-3750-427A-9149-7AA950B49301}',
  templateField: '{455A3E98-A627-4B40-8035-E683A0331AC7}', mediaFolder: '{FE5DD826-48C6-436D-B87A-7C4210C7413B}',
};
// Base templates of a collection's "Page" as the Empty/Basic tenant setup creates it; module page types inherit the same set.
export const PAGE_BASES = ['{47151711-26CA-434E-8132-D3E0B7D26683}', '{371D5FBB-5498-4D94-AB2B-E3B70EEBE78C}',
  '{F39A594A-7BC9-4DB0-BAA1-88543409C1F9}', '{6650FB34-7EA1-4245-A919-5CC0F002A6D7}', '{4414A1F9-826A-4647-8DF4-ED6A95E64C43}'];
// Own fields of every collection's "Page" (created per collection by the tenant setup); collection page types inherit them.
export const COLLECTION_PAGE_FIELDS = ['Title', 'Content'];
const EMPTY_TEMPLATE = '/sitecore/system/Settings/Foundation/JSS Experience Accelerator/Scaffolding/Templates/Empty Site';
const BASIC_SETUP = '/sitecore/system/Settings/Feature/JSS Experience Accelerator/Basic Site/Basic Site Setup';

export const paths = s => ({
  settings: `/sitecore/system/Settings/${s.layer}/${s.module}`,
  setup: `/sitecore/system/Settings/${s.layer}/${s.module}/${s.name} Setup`,
  templateItem: `/sitecore/system/Settings/${s.layer}/${s.module}/Templates/${s.name}`,
  scripts: `/sitecore/system/Modules/PowerShell/Script Library/${s.name}`,
  pageTypes: `/sitecore/templates/${s.layer}/${s.module}`,
  media: `/sitecore/media library/${s.layer}/${s.module}`,
});

async function templateFieldNames(api, templateId) {
  const d = await api.gql(`query($id:ID!){itemTemplate(where:{templateId:$id}){fields(first:400){nodes{name}}}}`, { id: templateId });
  return new Set((d.itemTemplate?.fields.nodes || []).map(f => f.name));
}

/** Read-only checks against the CM. Returns { errors, warnings, resolved }. */
export async function lint(api, spec, { componentMap } = {}) {
  const errors = [], warnings = [];
  const resolved = { datasourceTemplates: {}, componentNames: {}, renderingIds: {}, templateIds: {} };
  const rItems = {};
  for (const r of renderingsUsed(spec)) {
    const it = await api.item(r, true);
    if (!it) { errors.push(`rendering not found: ${r}`); continue; }
    rItems[r] = fieldMap(it);
    resolved.renderingIds[r] = it.itemId.toUpperCase();
    resolved.componentNames[r] = rItems[r].componentName || null;
    if (componentMap && rItems[r].componentName && !componentMap.has(rItems[r].componentName))
      errors.push(`componentName "${rItems[r].componentName}" (${r}) is not registered in the head app's component map`);
  }
  const dsFields = {};
  for (const owner of [...spec.pages, ...spec.partials, ...spec.blueprints]) for (const { c } of walkComponents(owner.components)) {
    if (c.datasource && typeof c.datasource === 'object')
      await resolveDatasourceExtras(api, c.datasource, owner.path !== undefined ? `page "${owner.path || 'Home'}"` : `"${owner.name}"`, errors, warnings, resolved);
    if (!c.datasource || typeof c.datasource !== 'object' || !rItems[c.renderingPath]) continue;
    const tplPath = c.datasource.template || rItems[c.renderingPath]['Datasource Template'];
    if (!tplPath) { errors.push(`${c.renderingPath} has no "Datasource Template"; set datasource.template or give a datasource path string`); continue; }
    const tplItem = await api.item(tplPath);
    if (!tplItem) { errors.push(`datasource template not found: ${tplPath}`); continue; }
    // Scripts get the template ID, never the path: in the Create Site dialog SPE resolves a template PATH against the
    // job's context database (not master), New-Item returns null and the scaffold aborts (measured 2026-10-19).
    c.datasourceTemplatePath = tplItem.itemId.toUpperCase();
    resolved.datasourceTemplates[c.renderingPath] ||= c.datasourceTemplatePath;
    if (tplItem.template.name === 'Branch') { warnings.push(`${c.renderingPath}: datasource is a branch (${tplPath}); field names are not checked`); continue; }
    dsFields[tplPath] ||= await templateFieldNames(api, tplItem.itemId);
    for (const k of Object.keys(c.datasource.fields)) if (!dsFields[tplPath].has(k))
      errors.push(`datasource field "${k}" does not exist on ${tplPath} (component ${c.rendering}, datasource "${c.datasource.name}")`);
  }
  const baseFields = new Set(COLLECTION_PAGE_FIELDS);
  for (const id of PAGE_BASES) for (const f of await templateFieldNames(api, id)) baseFields.add(f);
  const fieldOwners = [...spec.pages, ...spec.blueprints.map(b => ({ ...b, path: `blueprint ${b.name}` }))];
  for (const p of fieldOwners) {
    const type = spec.pageTypes.find(t => t.name === (p.path ? p.type : spec.homeType));
    const allowed = new Set([...baseFields, ...(type?.fields || []).map(f => f.name)]);
    for (const k of Object.keys(p.fields)) if (!allowed.has(k)) errors.push(`page "${p.path || 'Home'}": field "${k}" is neither on the page type nor on the base page templates`);
  }
  if (!(await api.item(`/sitecore/system/Settings/Services/Rendering Hosts/${spec.renderingHost}`)))
    warnings.push(`rendering host "${spec.renderingHost}" does not exist on this CM; sites will bind to a dangling host until it is deployed`);
  const empty = fieldMap(await api.item(EMPTY_TEMPLATE, true));
  const basic = fieldMap(await api.item(BASIC_SETUP, true));
  if (!empty['Site Modules'] || !basic.Dependencies) errors.push('could not read the Empty template / Basic Site Setup reference items');
  resolved.siteModules = empty['Site Modules'];
  resolved.tenantModules = empty['Tenant Modules'];
  resolved.dependencies = basic.Dependencies;
  const existing = await api.item(paths(spec).templateItem);
  if (existing) warnings.push(`template item exists (${existing.itemId}); this run updates it in place`);
  return { errors, warnings, resolved };
}

async function uploadThumbnail(api, token, spec, file) {
  const name = `${spec.name} Site Preview`.replace(/[^A-Za-z0-9 -]/g, '');
  const ext = extname(file).slice(1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext];
  if (!mime) throw new Error(`thumbnail must be png/jpg/webp: ${file}`);
  const d = await api.gql(`mutation($i:UploadMediaInput!){uploadMedia(input:$i){presignedUploadUrl}}`, { i: {
    itemPath: `${spec.layer}/${spec.module}/${name}`, alt: `${spec.name} site template preview`, database: 'master', language: 'en',
    includeExtensionInItemName: false, overwriteExisting: true, versioned: false } });
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(file)], { type: mime }), `${name}.${ext}`);
  const r = await fetch(d.uploadMedia.presignedUploadUrl, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  if (!r.ok) throw new Error(`thumbnail upload failed: HTTP ${r.status}`);
  const media = await r.json();
  return `{${String(media.Id).replace(/[{}]/g, '').toUpperCase()}}`;
}

async function writeTemplate(api, token, spec, resolved, specDir, log) {
  const P = paths(spec);
  const manifest = { module: spec.module, name: spec.name, roots: P, items: {} };
  const rec = (k, r) => { manifest.items[k] = r.id; return r.id; };

  // 1. Module page types (shared by every site; collection types inherit them at site creation).
  resolved.pageTypeIds = {};
  if (spec.pageTypes.length) {
    await api.ensurePath(P.pageTypes, T.templateFolder);
    for (const t of spec.pageTypes) {
      const id = rec(`pageType:${t.name}`, await api.upsert(P.pageTypes, t.name, T.template,
        [{ name: '__Base template', value: PAGE_BASES.join('|') }, ...(t.icon ? [{ name: '__Icon', value: t.icon }] : [])]));
      resolved.pageTypeIds[t.name] = id;
      const sv = await api.upsert(`${P.pageTypes}/${t.name}`, '__Standard Values', id);
      await api.upsert(P.pageTypes, t.name, T.template, [{ name: '__Standard values', value: sv.id }]);
      for (const section of [...new Set(t.fields.map(f => f.section))]) {
        await api.upsert(`${P.pageTypes}/${t.name}`, section, T.templateSection);
        for (const f of t.fields.filter(x => x.section === section))
          await api.upsert(`${P.pageTypes}/${t.name}/${section}`, f.name, T.templateField, [{ name: 'Type', value: f.type }]);
      }
      log(`  page type   ${t.name} ${id}`);
    }
  }
  // 2. Scaffolding scripts.
  await api.upsert('/sitecore/system/Modules/PowerShell/Script Library', spec.name, T.psModule, [{ name: 'Enabled', value: '1' }]);
  await api.upsert(P.scripts, 'Functions', T.psLibrary);
  const setupScript = rec('script:setup', await api.upsert(`${P.scripts}/Functions`, `${spec.name} Site Setup`, T.psScript, [{ name: 'Script', value: emitSiteSetup(spec, resolved) }]));
  const hostScript = rec('script:host', await api.upsert(`${P.scripts}/Functions`, `${spec.name} Configure Rendering Host`, T.psScript, [{ name: 'Script', value: emitConfigureHost(spec) }]));
  log(`  scripts     ${P.scripts}/Functions`);
  // 3. Thumbnail.
  let thumb = '';
  if (spec.thumbnail) {
    await api.ensurePath(P.media, T.mediaFolder);
    const mediaId = await uploadThumbnail(api, token, spec, resolve(specDir, spec.thumbnail));
    manifest.items.thumbnail = mediaId;
    thumb = `<image mediaid="${mediaId}" />`;
    log(`  thumbnail   ${mediaId}`);
  }
  // 4. Setup root + actions.
  await api.ensurePath(P.settings, T.settingsFolder);
  const setup = rec('setup', await api.upsert(P.settings, `${spec.name} Setup`, T.setupRoot, [{ name: 'Name', value: spec.name }, { name: 'Dependencies', value: resolved.dependencies }]));
  rec('action:setup', await api.upsert(P.setup, 'Run Site Setup', T.executeScript, [{ name: 'Script', value: setupScript }, { name: '__Sortorder', value: '200' }]));
  rec('action:host', await api.upsert(P.setup, 'Configure Rendering Host', T.postSetupStep, [{ name: 'Script', value: hostScript }, { name: '__Sortorder', value: '300' }]));
  log(`  setup root  ${setup}`);
  // 5. The Solution template the dialog lists.
  await api.upsert(P.settings, 'Templates', T.folder);
  const contents = Object.entries(spec.contents).map(([name, content]) => ({ name, content }));
  const id = rec('template', await api.upsert(`${P.settings}/Templates`, spec.name, T.solutionTemplate, [
    { name: 'Name', value: spec.name }, { name: 'Description', value: spec.description },
    { name: 'Content', value: JSON.stringify(contents) },
    { name: 'Site Modules', value: `${resolved.siteModules}|${setup}` }, { name: 'Tenant Modules', value: resolved.tenantModules },
    { name: '__Sortorder', value: String(spec.sortOrder) }, { name: 'Enabled', value: '1' }, ...(thumb ? [{ name: '__Thumbnail', value: thumb }] : [])]));
  log(`  template    ${id}  ${P.templateItem}`);
  return manifest;
}

export async function main(argv, { log = console.log } = {}) {
  let o;
  try { o = parseArgs(argv, { spec: 1, cmHost: 1, clientPrefix: 1, envFile: 1, dryRun: 'flag', componentMap: 1, out: 1 }); }
  catch (e) { log(`usage: ${e.message}`); return 2; }
  if (!o.spec || !o.cmHost || !o.clientPrefix) { log('usage: --spec, --cm-host and --client-prefix are required'); return 2; }
  const specDir = dirname(resolve(o.spec));
  const { spec, errors, warnings } = validateSpec(JSON.parse(readFileSync(o.spec, 'utf8')));
  if (spec.thumbnail && !existsSync(resolve(specDir, spec.thumbnail))) errors.push(`thumbnail file not found: ${spec.thumbnail}`);
  for (const w of warnings) log(`WARN  ${w}`);
  if (errors.length) { for (const e of errors) log(`ERROR ${e}`); return 2; }

  const token = await mintToken(o);
  const api = makeClient({ cmHost: o.cmHost, token });
  const cm = o.componentMap ? componentMapKeys(readFileSync(o.componentMap, 'utf8')) : null;
  const l = await lint(api, spec, { componentMap: cm });
  for (const w of l.warnings) log(`WARN  ${w}`);
  if (l.errors.length) { for (const e of l.errors) log(`ERROR ${e}`); return 1; }
  log(`lint ok: ${spec.pages.length} pages, ${spec.pageTypes.length} page types, ${spec.partials.length} partials, ${spec.blueprints.length} blueprints, ${renderingsUsed(spec).length} renderings`);

  const outDir = resolve(o.out || join(specDir, 'out'));
  mkdirSync(outDir, { recursive: true });
  l.resolved.pageTypeIds = Object.fromEntries(spec.pageTypes.map(t => [t.name, '{DRY-RUN}']));
  if (o.dryRun) {
    writeFileSync(join(outDir, `${spec.module}.site-setup.ps1`), emitSiteSetup(spec, l.resolved));
    writeFileSync(join(outDir, `${spec.module}.configure-host.ps1`), emitConfigureHost(spec));
    log(`dry run: scripts written to ${outDir}; nothing changed on the CM`);
    return 0;
  }
  const manifest = await writeTemplate(api, token, spec, l.resolved, specDir, log);
  writeFileSync(join(outDir, `${spec.module}.manifest.json`), JSON.stringify(manifest, null, 2));
  writeFileSync(join(outDir, `${spec.module}.site-setup.ps1`), emitSiteSetup(spec, l.resolved));
  const listed = (await api.gql('query{solutionTemplates{id name enabled thumbnailUrl}}')).solutionTemplates
    .find(t => t.id.toUpperCase() === manifest.items.template);
  if (!listed) { log(`FAIL  ${manifest.items.template} is not returned by solutionTemplates`); return 1; }
  log(`OK    "${listed.name}" lists in the Create Site dialog (enabled=${listed.enabled}, thumbnail=${listed.thumbnailUrl ? 'yes' : 'none'})`);
  log(`      manifest: ${join(outDir, `${spec.module}.manifest.json`)}`);
  return 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'build-template.mjs') main(process.argv.slice(2)).then(c => process.exit(c), e => { console.log(`ERROR ${e.message}`); process.exit(1); });
