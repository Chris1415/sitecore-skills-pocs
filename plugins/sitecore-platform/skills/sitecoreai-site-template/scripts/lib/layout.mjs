// Layout XML both ways: spec components → __Final Renderings XML (local: datasources, dynamic placeholder ids, nested
// containers), and __Final/__Renderings XML → spec components (for the extractor). Pure; ids are resolved by the caller.
import { CONTAINER } from './spec.mjs';

export const DEFAULT_DEVICE = '{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}';
export const GRID_DEFAULT = '{7465D855-992E-4DC2-9855-A03250DFA74B}';
const xmlAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const unXml = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Build a layout from spec components. `renderingIds[path]` = rendering item id; `uid(n)` returns a braced GUID.
 *  Returns { xml, datasources: [{ name, renderingPath, fields }] } — the caller creates the datasources under <page>/Data. */
export function buildLayoutXml(components, renderingIds, uid) {
  let n = 0;
  const rows = [], datasources = [];
  const walk = (list, parentPh) => {
    for (const c of list) {
      const ph = parentPh ?? c.placeholder;
      const dyn = ++n;
      const params = { GridParameters: GRID_DEFAULT, DynamicPlaceholderId: String(dyn), ...(c.params || {}) };
      const par = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      let ds = '';
      if (typeof c.datasource === 'string') ds = c.datasource;
      else if (c.datasource) { ds = `local:/Data/${c.datasource.name}`; datasources.push({ name: c.datasource.name, renderingPath: c.renderingPath, template: c.datasourceTemplatePath || c.datasource.template, fields: c.datasource.fields || {}, children: c.datasource.children || [], insertOptions: c.datasource.insertOptions || [] }); }
      const id = renderingIds[c.renderingPath];
      if (!id) throw new Error(`no rendering id for ${c.renderingPath}`);
      rows.push(`<r uid="${uid(dyn)}"${ds ? ` s:ds="${xmlAttr(ds)}"` : ''} s:id="${id}" s:par="${xmlAttr(par)}" s:ph="${xmlAttr(ph)}" />`);
      if (c.renderingPath === CONTAINER && c.children?.length) walk(c.children, `${ph.startsWith('/') ? ph : '/' + ph}/container-${dyn}`);
    }
  };
  walk(components, null);
  return { xml: `<r xmlns:p="p" xmlns:s="s" p:p="1"><d id="${DEFAULT_DEVICE}">${rows.join('')}</d></r>`, datasources };
}

/** Parse renderings from a layout XML (default device). Personalization (<rls>) and tests are reported, not kept. */
export function parseLayoutXml(xml, device = DEFAULT_DEVICE) {
  if (!xml) return { renderings: [], dropped: [] };
  const d = xml.match(new RegExp(`<d[^>]*id="${device.replace(/[{}]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</d>`, 'i'));
  const body = d ? d[1] : '';
  const dropped = [];
  if (/<rls>|<rl[ >]|s:mvt=|<mvt/i.test(body)) dropped.push('personalization or test rules');
  const renderings = [...body.matchAll(/<r\s([^>]*?)\/?>(?:[\s\S]*?<\/r>)?/g)].map(m => {
    const a = Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map(x => [x[1], unXml(x[2])]));
    const params = Object.fromEntries((a['s:par'] || '').replace(/^\?/, '').split('&').filter(Boolean).map(kv => kv.split('=').map(s => decodeURIComponent(s.replace(/\+/g, ' ')))));
    return { uid: a.uid, id: a['s:id'], ph: a['s:ph'] || '', ds: a['s:ds'] || '', params };
  }).filter(r => r.id);
  return { renderings, dropped };
}

/** Rebuild the component tree: a rendering whose placeholder is "<parent ph>/container-<dyn>" becomes a child of the
 *  Container with that DynamicPlaceholderId. Returns roots with `children`. */
export function nestRenderings(renderings, containerId) {
  const nodes = renderings.map(r => ({ ...r, children: [] }));
  const key = ph => ph.replace(/^\/+/, '');
  const byPh = new Map();
  const containers = nodes.filter(n => n.id.toUpperCase() === containerId.toUpperCase());
  for (const c of containers) byPh.set(`${key(c.ph)}/container-${c.params.DynamicPlaceholderId}`, c);
  const roots = [];
  for (const n of nodes) {
    const parent = byPh.get(key(n.ph));
    if (parent && parent !== n) parent.children.push(n); else roots.push(n);
  }
  return roots;
}
