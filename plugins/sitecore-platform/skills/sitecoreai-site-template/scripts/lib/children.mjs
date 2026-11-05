// Datasource extras: `datasource.children` (child items under the datasource) and `datasource.insertOptions` (templates
// written to the datasource item's __Masters). Static validation, live lint and the smoke read-back. Pure apart from `api`.

const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/;
const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
const DS_KEYS = new Set(['name', 'fields', 'template', 'children', 'insertOptions']);
const CHILD_KEYS = new Set(['name', 'template', 'fields', 'sortOrder', 'children']);

export const isGuid = s => GUID.test(String(s));
export const braced = s => `{${String(s).replace(/[{}]/g, '').toUpperCase()}}`;
const plain = s => String(s).replace(/[{}]/g, '').toUpperCase();

export function* walkChildren(children, path = '') {
  for (const ch of children || []) { yield { ch, path: `${path}/${ch.name}` }; yield* walkChildren(ch.children, `${path}/${ch.name}`); }
}
export const countChildren = children => [...walkChildren(children)].length;

/** Every template reference (path or id) a datasource needs: insert options plus child templates. */
export function templateRefs(ds) {
  const out = new Set(ds?.insertOptions || []);
  for (const { ch } of walkChildren(ds?.children)) if (ch.template) out.add(ch.template);
  return [...out];
}

/** Static checks + normalisation of one datasource object. Mutates `ds`: child templates default, __Sortorder is explicit. */
export function normaliseDatasourceExtras(ds, where, errors, warnings) {
  for (const k of Object.keys(ds)) if (!DS_KEYS.has(k)) warnings.push(`${where}: datasource "${ds.name}": unknown key "${k}" is ignored`);
  if (ds.insertOptions !== undefined && !(Array.isArray(ds.insertOptions) && ds.insertOptions.every(x => typeof x === 'string' && x.trim())))
    { errors.push(`${where}: datasource "${ds.name}": insertOptions must be an array of template paths or ids`); ds.insertOptions = []; }
  if (ds.children !== undefined && !Array.isArray(ds.children))
    { errors.push(`${where}: datasource "${ds.name}": children must be an array`); ds.children = []; }
  const fallback = ds.insertOptions?.length === 1 ? ds.insertOptions[0] : null;
  const level = (list, at) => {
    const seen = new Set();
    list.forEach((ch, i) => {
      const w = `${where}: datasource "${ds.name}" child "${ch?.name ?? i}"`;
      if (!ch || typeof ch !== 'object') { errors.push(`${w}: must be an object`); return; }
      for (const k of Object.keys(ch)) if (!CHILD_KEYS.has(k)) warnings.push(`${w}: unknown key "${k}" is ignored`);
      if (typeof ch.name !== 'string' || !NAME.test(ch.name)) errors.push(`${w}: name must be item-safe (letters, digits, space, - _)`);
      else if (seen.has(ch.name.toLowerCase())) errors.push(`${w}: duplicate child "${ch.name}" under ${at}`);
      else seen.add(ch.name.toLowerCase());
      if (ch.fields === undefined) ch.fields = {};
      if (typeof ch.fields !== 'object' || Array.isArray(ch.fields) || ch.fields === null) { errors.push(`${w}: fields: object of { FieldName: value } required`); ch.fields = {}; }
      ch.template ||= fallback;
      if (!ch.template) errors.push(`${w}: no template (set "template", or give the datasource exactly one insertOptions entry to default to)`);
      if (ch.sortOrder !== undefined && !Number.isInteger(ch.sortOrder)) errors.push(`${w}: sortOrder must be an integer`);
      if (ch.fields.__Sortorder === undefined) ch.fields.__Sortorder = String(Number.isInteger(ch.sortOrder) ? ch.sortOrder : (i + 1) * 100);
      delete ch.sortOrder;
      if (ch.children !== undefined && !Array.isArray(ch.children)) { errors.push(`${w}: children must be an array`); ch.children = []; }
      if (ch.children?.length) level(ch.children, `${at}/${ch.name}`);
    });
  };
  if (ds.children) level(ds.children, ds.name);
}

async function templateFields(api, id, cache) {
  cache[id] ||= api.gql('query($id:ID!){itemTemplate(where:{templateId:$id}){fields(first:400){nodes{name}}}}', { id })
    .then(d => new Set((d.itemTemplate?.fields.nodes || []).map(f => f.name)));
  return cache[id];
}

/** Live lint of one datasource's extras: resolves every template ref to an id (res.templateIds), requires data templates,
 *  and checks child field names against the child's template. __-prefixed fields are standard fields and always allowed. */
export async function resolveDatasourceExtras(api, ds, where, errors, warnings, res) {
  res.templateIds ||= {}; res.templateFieldCache ||= {};
  for (const ref of templateRefs(ds)) {
    if (res.templateIds[ref]) continue;
    const it = await api.item(ref);
    if (!it) { errors.push(`${where}: datasource "${ds.name}": template not found: ${ref}`); continue; }
    if (it.template.name !== 'Template') { errors.push(`${where}: datasource "${ds.name}": ${ref} is not a data template (it is a ${it.template.name})`); continue; }
    res.templateIds[ref] = braced(it.itemId);
  }
  for (const { ch, path } of walkChildren(ds.children)) {
    const id = res.templateIds[ch.template];
    if (!id) continue;
    const names = await templateFields(api, id, res.templateFieldCache);
    for (const k of Object.keys(ch.fields)) if (!k.startsWith('__') && !names.has(k))
      errors.push(`${where}: datasource "${ds.name}" child ${path}: field "${k}" does not exist on ${ch.template}`);
  }
}

/** Smoke read-back for one created datasource: descendant count == spec, and __Masters == the resolved insert options. */
export async function checkDatasourceExtras(api, dsPath, ds, check) {
  if (ds.children?.length) {
    const count = async p => { let n = 0; for (const c of await api.children(p)) n += 1 + await count(c.path); return n; };
    const got = await count(dsPath), want = countChildren(ds.children);
    check(got === want, `datasource ${dsPath}: ${got}/${want} child items`);
  }
  if (ds.insertOptions?.length) {
    const want = [];
    for (const ref of ds.insertOptions) want.push(isGuid(ref) ? plain(ref) : plain((await api.item(ref))?.itemId ?? 'missing'));
    const d = await api.gql('query($p:String!){item(where:{path:$p}){m:field(name:"__Masters"){value}}}', { p: dsPath });
    const got = String(d.item?.m?.value || '').split('|').filter(Boolean).map(plain);
    check(want.length === got.length && want.every(w => got.includes(w)), `datasource ${dsPath}: __Masters ${got.length}/${want.length} insert options`);
  }
}
