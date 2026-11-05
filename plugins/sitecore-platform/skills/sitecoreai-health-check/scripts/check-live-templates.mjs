#!/usr/bin/env node
// T6 live-template gate (a go-live gate, also run by the doctor). LIVE Edge names an item whose template is not
// published `UnknownTemplate`; preview reads master and hides it. A head app that keys on the template name (page
// type, site look) then renders a fallback on live only. Walks the site root on the LIVE context id. A template that
// is not on Edge at all is a different answer, a GraphQL error; one such item fails a whole list query that reads it.
// Usage: node check-live-templates.mjs --root <site root path> [--context-id <live id> | env SITECORE_EDGE_CONTEXT_ID]
//        [--lang en] [--skip Dictionary,Data] [--json]
import { parseArgs, loadEnv, isMain, sitecorePathArg } from './lib/env.mjs';
import { result, addFinding, unknown } from './lib/findings.mjs';
import { runGateCli } from './lib/gate.mjs';
import { edge, errs } from './lib/sitecore.mjs';

export const UNKNOWN_TEMPLATE = 'UnknownTemplate';
const MAX_ITEMS = 2000;
// Two queries: children(first:100) with template{} exceeds Edge's complexity budget, and a template error must name its own item.
const CHILDREN_Q = 'query($p:String!,$l:String!,$a:String){ item(path:$p, language:$l){ path children(first:10, after:$a){ pageInfo{ hasNext endCursor } results{ path name } } } }';
const TEMPLATE_Q = 'query($p:String!,$l:String!){ item(path:$p, language:$l){ path template{ name } } }';
const NOT_ON_EDGE = /Template with id \S+ was not found/i;

/** Pure verdict over walked items (fixture-testable). An absent root is UNKNOWN, never a pass. */
export function templatesVerdict({ root, items, truncated = false }) {
  const r = result('T6', 'Every item resolves its template on LIVE Edge', { layer: 'CT' });
  if (!items.length) return unknown(r, `site root ${root} is not on LIVE Edge (unpublished, wrong context id or wrong path)`);
  const bad = items.filter((i) => i.template?.name === UNKNOWN_TEMPLATE);
  for (const i of bad) addFinding(r, { severity: 'P0', blocker: true, title: `${UNKNOWN_TEMPLATE} on live: ${i.path}`, evidence: 'LIVE Edge template.name = UnknownTemplate', remediation: 'Publish the item\'s template (page types often live in the collection\'s template folder, outside the site subtree), then republish the item so the head app re-reads it.', fix_owner: 'cms' });
  const missing = items.filter((i) => i.templateMissing);
  if (missing.length) addFinding(r, { severity: 'P2', title: `${missing.length} of ${items.length} items: template{} errors on live (template not on Edge)`, evidence: missing.slice(0, 5).map((i) => i.path).join(', '), remediation: 'Fields, layout and routes are unaffected, but one such item fails a whole list query that reads template{}: check the head app does not read it, and key list walks on a signature field.', may_be_intentional: true, fix_owner: 'code' });
  r.notes.push(`${items.length} items walked, ${bad.length} with ${UNKNOWN_TEMPLATE}, ${missing.length} with a template not on Edge${truncated ? ` (stopped at ${MAX_ITEMS})` : ''}`);
  return r;
}

/** Walks `root` depth-first through `query(q, vars)`; subtrees whose name is in `skip` are not entered. */
export async function walkLive(query, root, { lang = 'en', skip = ['Dictionary'] } = {}) {
  const items = []; let truncated = false;
  async function walk(path) {
    if (items.length >= MAX_ITEMS) { truncated = true; return; }
    const t = await query(TEMPLATE_Q, { p: path, l: lang });
    const te = errs(t);
    if (te && !NOT_ON_EDGE.test(te[0])) throw new Error(`Edge error at ${path}: ${te[0]}`);
    if (te) items.push({ path, template: null, templateMissing: true });
    else if (!t?.data?.item) return;
    else items.push({ path: t.data.item.path, template: t.data.item.template });
    let after = null;
    do {
      const j = await query(CHILDREN_Q, { p: path, l: lang, a: after });
      const e = errs(j); if (e) throw new Error(`Edge error at ${path}: ${e[0]}`);
      const it = j?.data?.item; if (!it) return;
      for (const c of it.children?.results ?? []) if (!skip.includes(c.name)) await walk(c.path);
      after = it.children?.pageInfo?.hasNext ? it.children.pageInfo.endCursor : null;
    } while (after);
  }
  await walk(root);
  return { items, truncated };
}

export async function checkLiveTemplates({ contextId, root, lang = 'en', skip, query }) {
  const q = query || (async (qq, vars) => { const x = await edge(contextId, qq, vars, { label: 'edge-templates' }); if (x.status !== 200) throw new Error(`Edge HTTP ${x.status}`); return x.json; });
  const { items, truncated } = await walkLive(q, root, { lang, skip });
  return { results: [templatesVerdict({ root, items, truncated })] };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(); const env = loadEnv(a);
  const root = sitecorePathArg(a.root, 'root');
  const contextId = a['context-id'] || env.SITECORE_EDGE_CONTEXT_ID || null;
  if (!root || !contextId) { console.error('usage: check-live-templates.mjs --root <site root path> [--context-id <LIVE context id> | env SITECORE_EDGE_CONTEXT_ID] [--lang en] [--skip Dictionary]'); process.exit(2); }
  const skip = a.skip ? String(a.skip).split(',').map((s) => s.trim()) : undefined;
  runGateCli('check-live-templates', () => checkLiveTemplates({ contextId, root, lang: a.lang || 'en', skip }));
}
