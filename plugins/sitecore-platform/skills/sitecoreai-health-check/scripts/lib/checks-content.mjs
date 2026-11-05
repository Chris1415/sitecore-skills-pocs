// Content checks: R1 + D11 (Edge census), the content graph (L1-L6, T2, L5, M1, D12), R2/R3 joins, W5 drift.
// Authoring sees master; Edge live sees what is published; preview is NEVER evidence of publication.
import { result, addFinding, unknown, skipped } from './findings.mjs';
import { analyzeGraph, norm } from './detect.mjs';
import { edge, layoutProbe, errs } from './sitecore.mjs';

const ROUTES_Q = (first) => `query($s:String!,$l:String!,$a:String){ site{ siteInfo(site:$s){ routes(language:$l, first:${first}, after:$a){ total pageInfo{ endCursor hasNext } results{ routePath route{ id } } } } } }`;

// Flat route selections pass at first:100 on live delivery; the CM-hosted preview rejects them as too complex,
// so preview pages at 10, and any complexity error drops to 10 and restarts.
export async function routeCensus(ctxId, site, lang, kind, first = kind === 'preview' ? 10 : 100) {
  const all = []; let after = null, total = null, pages = 0;
  do {
    const r = await edge(ctxId, ROUTES_Q(first), { s: site, l: lang, a: after }, { kind, label: `routes-${kind}` });
    const e = errs(r.json);
    if (e && first > 10 && /too complex/i.test(e.join(' '))) return routeCensus(ctxId, site, lang, kind, 10);
    if (r.status !== 200 || e) return { err: `HTTP ${r.status} ${(e || [r.err]).join(' | ').slice(0, 200)}` };
    const rr = r.json?.data?.site?.siteInfo?.routes;
    if (!rr) return { err: `site "${site}" has no siteInfo on the ${kind} context` };
    total ??= rr.total; all.push(...rr.results); pages++;
    after = rr.pageInfo?.hasNext ? rr.pageInfo.endCursor : null;
  } while (after && pages < 200);
  return { total, received: all.length, routes: all.map((x) => ({ routePath: x.routePath, id: x.route?.id ? norm(x.route.id) : null })) };
}

/** Components that carry a dataSource but no fields: the Edge-side signature of a missing datasource (probe P7). */
export function deadDatasources(route) {
  const out = [];
  const walk = (phs, prefix) => { for (const [ph, comps] of Object.entries(phs || {})) for (const c of comps || []) { if (!c || typeof c !== 'object') continue; if (c.dataSource && /[0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}/.test(c.dataSource) && c.fields == null) out.push({ placeholder: prefix + ph, componentName: c.componentName, dataSource: c.dataSource }); walk(c.placeholders, `${prefix}${ph}/`); } };
  walk(route?.placeholders, '');
  return out;
}
const compSet = (route) => { const m = {}; const walk = (phs, p) => { for (const [ph, cs] of Object.entries(phs || {})) for (const c of cs || []) { if (!c?.componentName) continue; (m[p + ph] ||= []).push(c.componentName); walk(c.placeholders, `${p}${ph}/`); } }; walk(route?.placeholders, ''); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.join(',')])); };

export async function checkCensus(ctx, want) {
  const r1 = result('R1', 'Edge route census: no route:null / item:null', { layer: 'CT/DL', surface: 'E' });
  const d11 = result('D11', 'Preview vs live route/component diff', { layer: 'CT/DL', surface: 'E + P' });
  const live = await routeCensus(ctx.ids.live, ctx.site, ctx.lang, 'live');
  if (live.err) return [unknown(r1, live.err), unknown(d11, 'live census failed')];
  if (live.total !== live.received) unknown(r1, `routes total ${live.total} != received ${live.received} (silent truncation)`);
  ctx.store.census = { live: live.routes };
  let list = live.routes.map((x) => x.routePath);
  if (ctx.page) list = list.filter((p) => p === ctx.page);
  if (ctx.page && !list.length) addFinding(r1, { severity: 'P0', blocker: true, title: `Route ${ctx.page} is not in the live census (unpublished, renamed, or a space/%20 path)`, remediation: 'Live Edge resolves only the hyphenated route; publish the page or fix its name.', fix_owner: 'cms' });
  const max = ctx.opts.maxRoutes; const layouts = {};
  for (const p of list.slice(0, max)) {
    const L = await layoutProbe(ctx.ids.live, ctx.site, p, ctx.lang, 'live');
    if (L.status === 0 || L.errors) { r1.notes.push(`layout ${p}: ${L.err || L.errors?.[0]}`); continue; }
    layouts[p] = L.route;
    if (L.itemNull || L.routeNull) addFinding(r1, { severity: 'P0', blocker: true, title: `Live route ${p} answers ${L.itemNull ? 'item:null' : 'route:null'} at HTTP 200`, url: ctx.base ? `${ctx.base}${p}` : null, remediation: 'Look for an internal General Link without id= on the page or its datasources, or a misconfigured params template; publish after fixing master.', fix_owner: 'cms' });
    for (const d of deadDatasources(L.route)) addFinding(r1, { check: 'L4', severity: 'P1', title: `Component ${d.componentName} on ${p} has a dataSource but no fields on live Edge (missing or unpublished datasource)`, target: d.dataSource, url: ctx.base ? `${ctx.base}${p}` : null, evidence: `placeholder ${d.placeholder}`, fix_owner: 'cms' });
  }
  if (list.length > max) r1.notes.push(`${list.length - max} routes over --max-routes not probed`);
  ctx.store.layouts = layouts;
  if (r1.status !== 'unknown' && !r1.findings.length) r1.notes.push(`${live.total} live routes, ${Object.keys(layouts).length} layouts, 0 null`);
  if (!want.has('D11')) return [r1, skipped(d11, 'not selected')];
  if (!ctx.ids.preview) return [r1, skipped(d11, 'no preview context id')];
  const prev = await routeCensus(ctx.ids.preview, ctx.site, ctx.lang, 'preview');
  if (prev.err) return [r1, unknown(d11, prev.err)];
  const ls = new Set(live.routes.map((x) => x.routePath)); const ps = new Set(prev.routes.map((x) => x.routePath));
  const onlyPrev = [...ps].filter((p) => !ls.has(p)); const onlyLive = [...ls].filter((p) => !ps.has(p));
  if (onlyPrev.length) addFinding(d11, { severity: 'P3', title: `${onlyPrev.length} route(s) exist on preview only (never published)`, items: onlyPrev, may_be_intentional: true, fix_owner: 'cms' });
  if (onlyLive.length) addFinding(d11, { severity: 'P2', title: `${onlyLive.length} route(s) live on Edge but gone from master (stale published routes)`, items: onlyLive, remediation: 'Publish the parent to remove them, or run an EdgeOrphans scan (UI).', fix_owner: 'cms' });
  const diffs = [];
  for (const p of Object.keys(layouts).filter((x) => ps.has(x)).slice(0, max)) {
    const P = await layoutProbe(ctx.ids.preview, ctx.site, p, ctx.lang, 'preview');
    if (!P.route || !layouts[p]) continue;
    const a = compSet(layouts[p]), b = compSet(P.route);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) diffs.push(`${p} [${k}] live=${a[k] ?? '-'} preview=${b[k] ?? '-'}`);
  }
  if (diffs.length) addFinding(d11, { severity: 'P3', title: `${diffs.length} placeholder(s) differ between preview and live (unpublished changes)`, items: diffs, may_be_intentional: true, fix_owner: 'cms' });
  d11.notes.push(`${prev.total} preview / ${live.total} live routes`);
  return [r1, d11];
}

const SEARCH = (scope, lang, idx) => `{ search(query:{ index:"sitecore_master_index", latestVersionOnly:true, language:${JSON.stringify(lang)}, searchStatement:{ criteria:[{ field:"_fullpath", criteriaType:STARTSWITH, value:${JSON.stringify(scope.toLowerCase())} }] }, paging:{ pageSize:500, pageIndex:${idx} } }){ totalCount results{ itemId path templateName templateId } } }`;

/** Content graph + R2/R3. Returns result objects for every graph check id it ran. */
export async function checkGraph(ctx, want) {
  const ids = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'T2', 'M1', 'D12', 'R2', 'R3'];
  const R = Object.fromEntries(ids.map((id) => [id, result(id, '', { layer: 'CT', surface: 'A + E' })]));
  const out = () => ids.filter((id) => want.has(id)).map((id) => R[id]);
  const fail = (why) => { for (const id of ids) unknown(R[id], why); return out(); };
  let scope = ctx.root;
  if (ctx.page) {
    const routeItem = ctx.store.layouts?.[ctx.page]?.itemId;
    if (!routeItem) return fail(`page ${ctx.page} has no live route item id to scope the graph`);
    const p = await ctx.org.agql(ctx.cmHost, `{ item(where:{ itemId:"${norm(routeItem)}" }){ path } }`, null, { label: 'page-path' });
    scope = p.json?.data?.item?.path; if (!scope) return fail('page item not readable on Authoring');
  }
  const inventory = []; let total = null;
  for (let i = 0; i < 400; i++) {
    const r = await ctx.org.agql(ctx.cmHost, SEARCH(scope, ctx.lang, i), null, { label: 'inventory' });
    const e = errs(r.json); if (r.status !== 200 || e) return fail(`inventory search failed: HTTP ${r.status} ${(e || []).join(' | ').slice(0, 160)}`);
    const s = r.json.data.search; total ??= s.totalCount; inventory.push(...s.results);
    if (s.results.length < 500) break;
  }
  if (total !== inventory.length) return fail(`inventory totalCount ${total} != received ${inventory.length}`);
  const sl = scope.toLowerCase();
  const inv = inventory.filter((x) => { const p = x.path.toLowerCase(); return p === sl || p.startsWith(`${sl}/`); });
  const items = {};
  const readable = inv.filter((x) => x.templateName);
  for (let i = 0; i < readable.length; i += 25) {
    const chunk = readable.slice(i, i + 25);
    const sel = chunk.map((x, k) => `i${k}: item(where:{itemId:"${norm(x.itemId)}", language:${JSON.stringify(ctx.lang)}}){ itemId path hasPresentation fields(excludeStandardFields:true, ownFields:false, withLanguageFallback:false, first:200){ nodes{ name value templateField{ typeKey } } } r: field(name:"__Renderings"){ value } f: field(name:"__Final Renderings"){ value } }`).join(' ');
    const r = await ctx.org.agql(ctx.cmHost, `{ ${sel} }`, null, { label: 'fields' });
    if (r.status !== 200) return fail(`fields batch HTTP ${r.status}`);
    chunk.forEach((x, k) => {
      const it = r.json?.data?.[`i${k}`]; if (!it) return;
      items[norm(it.itemId)] = { path: it.path, hasPresentation: it.hasPresentation,
        fields: [...(it.fields?.nodes ?? []).map((n) => ({ name: n.name, value: n.value, typeKey: n.templateField?.typeKey })), { name: '__Renderings', value: it.r?.value, typeKey: 'layout' }, { name: '__Final Renderings', value: it.f?.value, typeKey: 'layout' }] };
    });
  }
  const first = analyzeGraph({ inventory: inv, items });
  const keys = [...first.targets.keys()]; const resolved = new Map();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const sel = chunk.map((k, n) => { const ref = first.targets.get(k).ref; return `t${n}: item(where:{${ref.id ? `itemId:"${ref.id}"` : `path:${JSON.stringify(ref.path)}`}}){ itemId path template{ templateId } }`; }).join(' ');
    const r = await ctx.org.agql(ctx.cmHost, `{ ${sel} }`, null, { label: 'resolve' });
    if (r.status !== 200) return fail(`resolve batch HTTP ${r.status}`);
    const byAlias = {}; for (const er of r.json?.errors || []) byAlias[er.path?.[0] ?? '*'] = `${byAlias[er.path?.[0] ?? '*'] || ''} ${er.message}`;
    chunk.forEach((k, n) => {
      const it = r.json?.data?.[`t${n}`];
      resolved.set(k, it ? { exists: true, id: norm(it.itemId), path: it.path } : { exists: false, brokenTemplate: /template/i.test(byAlias[`t${n}`] || '') });
    });
  }
  const edgeState = new Map(); let liveChecked = false;
  if (ctx.ids?.live) {
    liveChecked = true;
    const want2 = [...new Set([...[...resolved.values()].filter((v) => v.exists).map((v) => v.id), ...Object.keys(items)])];
    for (let i = 0; i < want2.length; i += 50) {
      const chunk = want2.slice(i, i + 50);
      const r = await edge(ctx.ids.live, `{ ${chunk.map((id, n) => `e${n}: item(path:"${id}", language:${JSON.stringify(ctx.lang)}){ id }`).join(' ')} }`, null, { label: 'edge-resolve' });
      if (r.status !== 200 || errs(r.json)) { liveChecked = false; R.L5.notes.push(`Edge batch failed: HTTP ${r.status}`); break; }
      chunk.forEach((id, n) => edgeState.set(id, !!r.json.data[`e${n}`]));
    }
  }
  const g = analyzeGraph({ inventory: inv, items, resolved, edgeState, liveChecked });
  for (const f of g.findings) {
    const res = R[f.check] || R.L3;
    addFinding(res, { severity: f.severity, title: f.title, item: f.item, itemId: f.itemId, target: f.target, field: f.field, evidence: [f.field && `field ${f.field}`, f.target && `target ${f.target}`, f.detail].filter(Boolean).join('; '), fix_owner: 'cms',
      remediation: f.check === 'T2' ? 'Restore the template (serialization) or delete the item; publishing it fails.' : f.check === 'L5' ? 'Publish the target, or remove the reference.' : 'Repoint or clear the field on master, verify on preview, then publish the item.' });
  }
  if (!liveChecked) skipped(R.L5, ctx.ids?.live ? 'Edge resolve failed' : 'no live context id');
  if (g.reverseIndex.d12Candidates.length) addFinding(R.D12, { severity: 'P3', title: `${g.reverseIndex.d12Candidates.length} data item(s) with no inbound reference (candidates)`, items: g.reverseIndex.d12Candidates, may_be_intentional: true, remediation: 'Candidates only: personalization rules, other languages and designs also count as use. Review before deleting.', fix_owner: 'cms' });
  // R2 / R3 joins against the live census
  const census = ctx.store.census?.live;
  if (!census || ctx.page) { skipped(R.R2, ctx.page ? 'page scope' : 'no live census'); skipped(R.R3, ctx.page ? 'page scope' : 'no live census'); }
  else {
    const liveIds = new Set(census.map((x) => x.id).filter(Boolean));
    const home = `${sl}/home`;
    const unpublished = Object.entries(items).filter(([id, it]) => it.hasPresentation && (it.path.toLowerCase() === home || it.path.toLowerCase().startsWith(`${home}/`)) && !liveIds.has(id));
    if (unpublished.length) addFinding(R.R2, { severity: 'P2', title: `${unpublished.length} master page(s) with presentation have no live route`, items: unpublished.map(([, it]) => it.path), may_be_intentional: true, remediation: 'Unpublished drafts are fine; build scaffolding (Components Preview) should be torn down, never published.', fix_owner: 'cms' });
    const invIds = new Set(inv.map((x) => norm(x.itemId)));
    const orphanCandidates = census.filter((x) => x.id && !invIds.has(x.id));
    for (let i = 0; i < orphanCandidates.length; i += 100) {
      const chunk = orphanCandidates.slice(i, i + 100);
      const r = await ctx.org.agql(ctx.cmHost, `{ ${chunk.map((x, n) => `o${n}: item(where:{itemId:"${x.id}"}){ itemId }`).join(' ')} }`, null, { label: 'orphan-check' });
      chunk.forEach((x, n) => { if (r.status === 200 && r.json?.data && r.json.data[`o${n}`] === null) addFinding(R.R3, { severity: 'P1', title: `Live route ${x.routePath} has no master item (stale Edge orphan)`, target: x.id, remediation: 'Smart-publish the parent to remove it, or run the EdgeOrphans scan (UI). Never republish blindly.', fix_owner: 'cms' }); });
    }
  }
  for (const id of ids) { R[id].title = { L1: 'General Link targets', L2: 'Rich-text dynamic links', L3: 'Reference fields resolve', L4: 'Datasources resolve', L5: 'Published item references unpublished item', L6: 'Rendering definitions resolve', T2: 'Items whose template is gone (site scope)', M1: 'Image field targets', D12: 'Unreferenced data items (candidates)', R2: 'Master page with no live route', R3: 'Live route with no master item' }[id]; if (R[id].status === 'pass') R[id].notes.push(`${inv.length} items, ${g.edges.length} edges, ${first.targets.size} targets`); }
  return out();
}

export async function checkW5(ctx) {
  const r = result('W5', 'Edge vs master drift (reverse drift = do not republish)', { layer: 'CT', surface: 'A + E' });
  const census = ctx.store.census?.live; if (!census) return skipped(r, 'no live census');
  const sample = census.filter((x) => x.id && (!ctx.page || x.routePath === ctx.page)).slice(0, ctx.opts.drift);
  let newer = 0;
  for (const x of sample) {
    const m = await ctx.org.agql(ctx.cmHost, `query($i:ID!){ item(where:{itemId:$i, language:${JSON.stringify(ctx.lang)}}){ path version u: field(name:"__Updated"){ value } } }`, { i: x.id }, { label: 'drift-master' });
    const e = await edge(ctx.ids.live, `query($i:String!){ item(path:$i, language:${JSON.stringify(ctx.lang)}){ version u: field(name:"__Updated"){ value } } }`, { i: x.id }, { label: 'drift-edge' });
    const mi = m.json?.data?.item, ei = e.json?.data?.item;
    if (!mi && ei && /template/i.test((errs(m.json) || []).join(' '))) addFinding(r, { severity: 'P1', reverse_drift: true, title: `Reverse drift: ${x.routePath} is broken on master but good on Edge`, target: x.id, evidence: (errs(m.json) || []).join(' | ').slice(0, 200), remediation: 'Do NOT republish: a publish would push the broken state live. Repair master, verify on preview, then publish only this item.', fix_owner: 'cms' });
    else if (mi && ei && (mi.u?.value || '') > (ei.u?.value || '')) newer++;
  }
  if (newer) addFinding(r, { severity: 'P3', title: `${newer}/${sample.length} sampled routes have master edits newer than Edge (unpublished changes)`, may_be_intentional: true, fix_owner: 'cms' });
  r.notes.push(`${sample.length} routes sampled (version + __Updated; __Revision is not on Edge)`);
  return r;
}
