// Site-template spec: static validation and normalisation. No network. The spec format is in references/spec-format.md.
import { normaliseDatasourceExtras } from './children.mjs';

export const OOTB_RENDERINGS_ROOT = '/sitecore/layout/Renderings/Feature/JSS Experience Accelerator';
export const CONTAINER = `${OOTB_RENDERINGS_ROOT}/Page Structure/Container`;

export const renderingPath = r => (r.startsWith('/sitecore/') ? r : `${OOTB_RENDERINGS_ROOT}/${r.replace(/^\/+/, '')}`);

// Characters a Sitecore item name cannot hold; a dictionary key's item name replaces each with '-'. The emitter sends this same pattern to PowerShell.
export const DICT_NAME_INVALID = /[\\/:?"<>|*\[\]]/g;
export const dictItemName = key => String(key).replace(DICT_NAME_INVALID, '-');
// Placeholders reach layout XML and a PowerShell string, and captured layouts copy them verbatim.
const PLACEHOLDER = /^\/?[A-Za-z0-9_{}/-]+$/;
const placeholderErrors = (components, where) => [...walkComponents(components)]
  .filter(({ c }) => c.placeholder !== undefined && !PLACEHOLDER.test(String(c.placeholder)))
  .map(({ c }) => `${where}: placeholder ${JSON.stringify(c.placeholder)} is not allowed (letters, digits, _ { } / -)`);

/** Walk every component of a page or partial, depth first, with its parent placeholder resolved later by the emitter. */
export function* walkComponents(components, owner) {
  for (const c of components || []) { yield { c, owner }; yield* walkComponents(c.children, owner); }
}

/** Returns { spec, errors[], warnings[] }; spec is normalised (defaults filled, Home = path ''). */
export function validateSpec(input) {
  const errors = [], warnings = [];
  const s = structuredClone(input || {});
  const req = (k, cond, msg) => { if (!cond) errors.push(`${k}: ${msg}`); };
  req('name', typeof s.name === 'string' && s.name.trim(), 'required (the title shown in the Create Site dialog)');
  req('module', typeof s.module === 'string' && /^[a-z0-9][a-z0-9-]{1,48}$/.test(s.module), 'required, lowercase slug [a-z0-9-] (used in every item path)');
  req('description', typeof s.description === 'string' && s.description.trim(), 'required (the dialog card subtitle)');
  req('renderingHost', typeof s.renderingHost === 'string' && s.renderingHost.trim(), 'required (Rendering Host item name = the xmcloud.build.json renderingHosts key)');
  s.layer ||= 'Project';
  req('layer', ['Project', 'Feature', 'Foundation'].includes(s.layer), 'Project | Feature | Foundation');
  s.sortOrder ??= 100;
  req('sortOrder', Number.isInteger(s.sortOrder), 'integer (__Sortorder; lower = earlier in the dialog)');
  s.language ||= 'en';
  s.contents ||= {};
  req('contents', typeof s.contents === 'object' && !Array.isArray(s.contents), 'object of { section: "text" }');
  s.pageTypes ||= [];
  s.partials ||= [];
  s.pages ||= [];
  s.availableRenderings ||= [];
  s.blueprints ||= [];
  s.dictionary ||= [];
  s.settings ||= {};
  const dictNames = new Set();
  for (const d of s.dictionary) {
    req('dictionary', d.key && typeof d.phrase === 'string', 'each entry needs key + phrase');
    const itemName = dictItemName(d.key).toLowerCase();
    if (dictNames.has(itemName)) errors.push(`dictionary: key "${d.key}" gives the same item name as another key ("${dictItemName(d.key)}", case-insensitive)`);
    dictNames.add(itemName);
  }
  const KNOWN = new Set(['name','module','description','renderingHost','layer','sortOrder','language','contents','thumbnail','homeType','pageTypes','pages','partials','blueprints','availableRenderings','dictionary','settings']);
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) warnings.push('unknown top-level key "' + k + '" is ignored');

  const typeNames = new Set(), typeNamesLower = new Set();
  for (const t of s.pageTypes) {
    req(`pageTypes[${t.name}]`, typeof t.name === 'string' && /^[A-Za-z0-9 ]{2,60}$/.test(t.name), 'name: letters, digits, spaces');
    if (typeNamesLower.has(String(t.name).toLowerCase())) errors.push(`pageTypes: duplicate "${t.name}" (item names are case-insensitive)`);
    typeNames.add(t.name); typeNamesLower.add(String(t.name).toLowerCase());
    t.fields ||= [];
    for (const f of t.fields) {
      req(`pageTypes[${t.name}].fields`, f.name && f.type, 'each field needs name + type (e.g. "Single-Line Text", "Rich Text", "Image", "General Link")');
      f.section ||= 'Content';
    }
    if (t.insertOptions) for (const io of t.insertOptions) if (!s.pageTypes.some(x => x.name === io)) errors.push(`pageTypes[${t.name}].insertOptions: unknown type "${io}"`);
  }
  if (s.homeType && !typeNames.has(s.homeType)) errors.push(`homeType: unknown page type "${s.homeType}"`);
  if (!s.homeType && s.pageTypes.length) warnings.push('homeType not set: Home stays the collection "Page" template; insert options are set on the Home item only');

  if (!s.pages.some(p => (p.path ?? '') === '')) s.pages.unshift({ path: '' });
  const paths = new Set(), pathsLower = new Set();
  for (const p of s.pages) {
    p.path = (p.path ?? '').replace(/^\/+|\/+$/g, '').replace(/^Home(\/|$)/, '');
    if (pathsLower.has(p.path.toLowerCase())) errors.push(`pages: duplicate path "${p.path || 'Home'}" (item names are case-insensitive)`);
    paths.add(p.path); pathsLower.add(p.path.toLowerCase());
    if (p.path && p.path.split('/').some(seg => !/^[A-Za-z0-9][A-Za-z0-9 -]{0,79}$/.test(seg))) errors.push(`pages["${p.path}"]: segments must be item-safe names`);
    if (p.path === '' && p.type && p.type !== s.homeType) errors.push('pages[Home].type: set "homeType" instead');
    if (p.path && !p.type && s.pageTypes.length) errors.push(`pages["${p.path}"]: type required (one of ${[...typeNames].join(', ')})`);
    if (p.type && !typeNames.has(p.type)) errors.push(`pages["${p.path}"]: unknown type "${p.type}"`);
    p.fields ||= {};
    p.components ||= [];
  }
  for (const p of s.pages) {
    const parent = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : (p.path ? '' : null);
    if (parent !== null && !paths.has(parent)) errors.push(`pages["${p.path}"]: parent "${parent}" is not declared`);
  }
  // parents before children
  s.pages.sort((a, b) => (a.path === '' ? -1 : b.path === '' ? 1 : a.path.split('/').length - b.path.split('/').length));

  for (const pd of s.partials) {
    req(`partials[${pd.name}]`, typeof pd.name === 'string' && /^[A-Za-z0-9 ]{2,60}$/.test(pd.name), 'name required');
    req(`partials[${pd.name}].placeholder`, typeof pd.placeholder === 'string', 'placeholder required (headless-header | headless-footer | …)');
    pd.components ||= [];
  }

  const checkComponents = (list, where, defaultPh) => {
    const dsNames = new Set();
    for (const { c } of walkComponents(list)) {
      if (!c.rendering) { errors.push(`${where}: component without "rendering"`); continue; }
      c.renderingPath = renderingPath(c.rendering);
      if (c.children?.length && c.renderingPath !== CONTAINER) errors.push(`${where}: only Page Structure/Container takes "children" (got ${c.rendering})`);
      if (typeof c.datasource === 'object' && c.datasource) {
        if (!c.datasource.name) errors.push(`${where}: datasource object needs a "name"`);
        if (dsNames.has(String(c.datasource.name).toLowerCase())) errors.push(`${where}: duplicate datasource name "${c.datasource.name}"`);
        dsNames.add(String(c.datasource.name).toLowerCase());
        c.datasource.fields ||= {};
        normaliseDatasourceExtras(c.datasource, where, errors, warnings);
      }
      c.params ||= {};
    }
    for (const c of list) c.placeholder ||= defaultPh;
    errors.push(...placeholderErrors(list, where));
  };
  for (const p of s.pages) checkComponents(p.components, `pages["${p.path || 'Home'}"]`, 'headless-main');
  for (const pd of s.partials) checkComponents(pd.components, `partials["${pd.name}"]`, pd.placeholder);

  for (const bp of s.blueprints) {
    errors.push(...blueprintErrors(bp, typeNames, 'blueprints'));
    if (!bp.type && s.pageTypes.length) errors.push(`blueprints[${bp.name}]: type required (one of ${[...typeNames].join(', ')})`);
    checkComponents(bp.components, `blueprints["${bp.name}"]`, 'headless-main');
  }
  if (new Set(s.blueprints.map(b => String(b.name).toLowerCase())).size !== s.blueprints.length) errors.push('blueprints: duplicate names');
  if (new Set(s.partials.map(pd => String(pd.name).toLowerCase())).size !== s.partials.length) errors.push('partials: duplicate names');

  for (const ar of s.availableRenderings) {
    req('availableRenderings', ar.name && Array.isArray(ar.renderings) && ar.renderings.length, 'each entry needs name + renderings[]');
    ar.renderings = (ar.renderings || []).map(renderingPath);
  }
  return { spec: s, errors, warnings };
}

/** Checks shared by template blueprints and standalone blueprint specs. */
function blueprintErrors(bp, typeNames, where) {
  const e = [];
  if (typeof bp.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 -]{1,60}$/.test(bp.name)) e.push(`${where}: name required (letters, digits, spaces, dashes)`);
  if (bp.type && typeNames && !typeNames.has(bp.type)) e.push(`${where}[${bp.name}]: unknown type "${bp.type}"`);
  bp.fields ||= {};
  bp.components ||= [];
  if (!bp.components.length) e.push(`${where}[${bp.name}]: a blueprint without components is just a page type`);
  // A blueprint is written as layout XML: no script runs at creation, so nothing could create a variant or resolve a site: token.
  for (const { c } of walkComponents(bp.components)) {
    if (c.variant) e.push(`${where}[${bp.name}]: ${c.rendering}: "variant" ("${c.variant}") is not supported in a blueprint; set params.FieldNames to the variant item id, or remove it`);
    for (const [k, v] of Object.entries(c.params || {})) if (/(^|\|)site:/.test(String(v))) e.push(`${where}[${bp.name}]: ${c.rendering}: params.${k} holds a site: token, which a blueprint cannot resolve; use the item id, or remove it`);
  }
  return e;
}

/** Standalone page-blueprint spec for an EXISTING site: { site, name, pageTemplate?, offerOn?, fields?, components }. */
export function validateBlueprintSpec(input) {
  const b = structuredClone(input || {});
  const warnings = [];
  const errors = blueprintErrors(b, null, 'blueprint');
  if (typeof b.site !== 'string' || !b.site) errors.push('site: required (the site the blueprint is offered in)');
  b.pageTemplate ||= 'Page';
  b.offerOn ||= [b.pageTemplate];
  const dsNames = new Set();
  for (const { c } of walkComponents(b.components)) {
    if (!c.rendering) { errors.push('blueprint: component without "rendering"'); continue; }
    c.renderingPath = renderingPath(c.rendering);
    if (c.children?.length && c.renderingPath !== CONTAINER) errors.push(`blueprint: only Page Structure/Container takes "children" (got ${c.rendering})`);
    if (c.datasource && typeof c.datasource === 'object') {
      if (!c.datasource.name) errors.push('blueprint: datasource object needs a "name"');
      if (dsNames.has(String(c.datasource.name).toLowerCase())) errors.push(`blueprint: duplicate datasource name "${c.datasource.name}"`);
      dsNames.add(String(c.datasource.name).toLowerCase()); c.datasource.fields ||= {};
      normaliseDatasourceExtras(c.datasource, 'blueprint', errors, warnings);
    }
    c.params ||= {};
  }
  for (const c of b.components) c.placeholder ||= 'headless-main';
  errors.push(...placeholderErrors(b.components, 'blueprint'));
  return { blueprint: b, errors, warnings };
}

/** Every distinct rendering path the spec uses (for the live lint). */
export function renderingsUsed(spec) {
  const out = new Set(spec.availableRenderings.flatMap(a => a.renderings));
  for (const owner of [...spec.pages, ...spec.partials, ...(spec.blueprints || [])]) for (const { c } of walkComponents(owner.components)) out.add(c.renderingPath);
  return [...out];
}

/** Keys registered in a Content SDK component map (`.sitecore/component-map.ts`). */
export function componentMapKeys(source) {
  return new Set([...source.matchAll(/\[\s*['"]([A-Za-z0-9_-]+)['"]\s*,/g)].map(m => m[1]));
}
