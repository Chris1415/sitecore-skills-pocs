#!/usr/bin/env node
// probe-list-delivery.mjs: read-only check of how each component on a route receives its rows from Experience Edge.
// Classifies every placement's payload (standard fields, resolver `items`, ComponentQuery `data`, Multilist arrays,
// or a datasource that arrived with no fields), compares the rows under `datasource.children` with that item's
// `children.total` (a row past `first` is dropped silently), and checks ComponentQuery row fields are selected as
// `jsonValue`. With --editing-layout it reads a layout JSON captured in editing mode (logged server-side) and reports whether row fields carry
// editing metadata.
//
// Usage: node probe-list-delivery.mjs --context <edge context id> --site <site> --route <path> [--lang en]
//                                     [--endpoint <edge graphql url>] [--editing-layout <file>] [--json]
//        node probe-list-delivery.mjs --self-test
// Exit: 0 no FAIL (WARN lines are advisory) · 1 at least one FAIL (silent drop, rows not selected as jsonValue,
// rejected query, row fields without editing metadata) · 2 usage, an unresolved route (wrong context id, site or
// host), an unreachable endpoint, an editing capture with no route or no list placements, or lists present and not one
// row count verifiable: nothing is judged. A FAIL wins over the row-count exit 2; a bad capture file exits 2 regardless.
// The drop check sees delivered < total, so rows = total = first passes: keep first above the authored count by hand.
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENDPOINT = 'https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1';
const LAYOUT = 'query($s:String!,$p:String!,$l:String!){ layout(site:$s, routePath:$p, language:$l){ item{ rendered } } }';
const TOTAL = 'query($id:String!,$l:String!){ item(path:$id, language:$l){ children(first:1){ total } } }';
const TIMEOUT_MS = 20_000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An Edge item reference inside a field (Multilist / Treelist / resolver row): id + fields. */
const isItemRef = (v) => isObj(v) && typeof v.id === 'string' && isObj(v.fields);
const SCALAR_KEYS = ['id', 'name', 'displayName', 'url', 'path', 'template', '__typename', 'children', 'hasChildren'];

/** The rows of a ComponentQuery payload: the `results` (or array) under each `children` key. Arrays elsewhere (a
 *  Multilist `jsonValue` on the container, link lists) are field values, not rows. */
export function queryRows(data) {
  const rows = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isObj(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'children') {
        const list = Array.isArray(x) ? x : Array.isArray(x?.results) ? x.results : [];
        rows.push(...list.filter(isObj));
      } else if (k !== 'jsonValue') walk(x);
    }
  };
  walk(data);
  return rows;
}

/** The rows under the query's `datasource.children`: the only list whose length is comparable with the datasource
 *  item's own `children.total`. Null when the query reads another path. */
const datasourceRows = (data) => {
  const ch = data?.datasource?.children;
  const list = Array.isArray(ch) ? ch : Array.isArray(ch?.results) ? ch.results : null;
  return list ? list.filter(isObj).length : null;
};

/** A row's field selections. A reserved key is skipped unless it holds a field selection: a field aliased `name` or
 *  `url` and selected as { value } must still be judged. */
const rowFields = (row) => Object.entries(row).filter(([k, v]) => !SCALAR_KEYS.includes(k) || (isObj(v) && ('value' in v || 'jsonValue' in v)));

/** Classify one placement's payload. Returns { pattern, rows, dsRows, problems[] }. */
export function classify(c) {
  const f = c.fields;
  const problems = [];
  if (c.isContentResolved === false) problems.push('isContentResolved: false — the ComponentQuery was rejected (too complex or nested children); nothing reached the page');
  if (!c.dataSource) return { pattern: 'no-datasource', rows: 0, problems };
  if (!isObj(f) || Object.keys(f).length === 0) return { pattern: 'empty-fields', rows: 0, problems };
  if (Array.isArray(f.items)) {
    problems.push('resolver payload (items[]): content resolvers are not supported with Edge runtime publishing and drop the container fields — replace it');
    return { pattern: 'resolver', rows: f.items.length, dsRows: f.items.length, problems };
  }
  if (isObj(f.data)) {
    const rows = queryRows(f.data);
    // Correct: `field(name:"X"){ jsonValue }` → { jsonValue: … }. A `{ value }` selection, or a bare string, carries no
    // editing metadata. An absent field (null) is not judged.
    const plain = rows.flatMap((r) => rowFields(r).filter(([, v]) => typeof v === 'string' || (isObj(v) && !('jsonValue' in v) && !isItemRef(v))).map(([k]) => k));
    if (plain.length) problems.push(`ComponentQuery row fields not selected as jsonValue (no editing metadata): ${[...new Set(plain)].join(', ')}`);
    return { pattern: 'component-query', rows: rows.length, dsRows: datasourceRows(f.data), problems };
  }
  const lists = Object.entries(f).filter(([, v]) => Array.isArray(v) && v.some(isItemRef));
  if (lists.length) return { pattern: 'multilist', rows: lists.reduce((n, [, v]) => n + v.length, 0), lists: lists.map(([k]) => k), problems };
  return { pattern: 'standard', rows: 0, problems };
}

/** Walk a rendered layout's placeholders depth first. */
export function placements(route) {
  const out = [];
  const walk = (ph) => { for (const cs of Object.values(ph ?? {})) for (const c of cs ?? []) { if (c?.componentName) out.push(c); walk(c?.placeholders); } };
  walk(route?.placeholders);
  return out;
}

/** From a layout captured in editing mode: per list placement, how many row fields carry `metadata` (inline editing). */
export function editingMetadata(route) {
  const report = [];
  for (const c of placements(route)) {
    const f = c.fields;
    if (!isObj(f)) continue;
    let rows = [];
    if (Array.isArray(f.items)) rows = f.items.map((r) => r.fields ?? {});
    else if (isObj(f.data)) rows = queryRows(f.data).map((r) => Object.fromEntries(rowFields(r).map(([k, v]) => [k, isObj(v) && 'jsonValue' in v ? v.jsonValue : v])));
    else for (const v of Object.values(f)) if (Array.isArray(v)) rows.push(...v.filter(isItemRef).map((r) => r.fields));
    if (!rows.length) continue;
    const fields = rows.flatMap((r) => Object.values(r ?? {})).filter(isObj);
    const withMetadata = fields.filter((x) => isObj(x.metadata) || typeof x.editable === 'string').length;
    report.push({ component: c.componentName, rows: rows.length, fields: fields.length, withMetadata });
  }
  return report;
}

const routeOf = (captured) => captured?.sitecore?.route ?? captured?.data?.layout?.item?.rendered?.sitecore?.route ?? captured?.layout?.sitecore?.route ?? captured?.route;

async function gql(endpoint, context, query, variables, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(`${endpoint}?sitecoreContextId=${encodeURIComponent(context)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: ctl.signal,
    });
    if (r.status !== undefined && r.status >= 400) return { transportError: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { transportError: e?.name === 'AbortError' ? `no answer within ${TIMEOUT_MS / 1000} s` : String(e?.message ?? e) };
  } finally {
    clearTimeout(t);
  }
}

/** The probe itself; returns { exit, lines, results, editing }. `fetchImpl` is injectable for the self-test. */
export async function probe({ context, site, route, lang = 'en', endpoint = DEFAULT_ENDPOINT, editingLayout }, fetchImpl = fetch) {
  const lines = [];
  const j = await gql(endpoint, context, LAYOUT, { s: site, p: route, l: lang }, fetchImpl);
  if (j?.transportError) return { exit: 2, lines: [`Edge did not answer: ${j.transportError}`], results: [], editing: [] };
  const r = j?.data?.layout?.item?.rendered?.sitecore?.route;
  if (!r) return { exit: 2, lines: [j?.errors?.[0]?.message ? `Edge rejected the layout query: ${j.errors[0].message}` : `route ${route} (${lang}) did not resolve on site ${site}: check the context id, site name and endpoint`], results: [], editing: [] };

  const results = [];
  let failed = 0;
  let countable = 0;
  let verified = 0;
  for (const c of placements(r)) {
    const k = classify(c);
    if ((k.pattern === 'no-datasource' || k.pattern === 'standard') && !k.problems.length) continue;
    const problems = [...k.problems];
    const notes = [];
    let total = null;
    // A query that reads another path has nothing to compare with the datasource's children: no lookup, nothing owed.
    const comparable = k.pattern === 'resolver' || k.pattern === 'empty-fields' || (k.pattern === 'component-query' && k.dsRows !== null);
    if (c.dataSource && comparable) {
      countable++;
      const t = await gql(endpoint, context, TOTAL, { id: c.dataSource, l: lang }, fetchImpl);
      total = t?.data?.item?.children?.total ?? null;
      if (total !== null) verified++;
      if (total === null) notes.push(`row count not verified: the datasource's children total did not come back (${t?.transportError ?? (t?.errors?.[0]?.message ?? 'item not on Edge in this language')})`);
    }
    if (total !== null && k.dsRows !== null && k.dsRows !== undefined && k.dsRows < total)
      problems.push(`silent drop: ${k.dsRows} of ${total} children delivered — ${k.pattern === 'resolver' ? 'replace the resolver; it has no paging control' : 'raise first above the authored row count'}`);
    if (k.pattern === 'component-query' && k.dsRows === null) notes.push('rows do not come from datasource.children: the drop check does not apply');
    if (k.pattern === 'empty-fields' && total && c.isContentResolved !== false) notes.push(`datasource has ${total} children but layout carries none: the head app reads them elsewhere (not editable in Pages)`);
    const fail = problems.some((p) => /silent drop|not selected as jsonValue|isContentResolved/.test(p));
    if (fail) failed++;
    results.push({ component: c.componentName, dataSource: c.dataSource, pattern: k.pattern, rows: k.rows, total, problems, notes });
    lines.push(`${fail ? 'FAIL' : problems.length || notes.length ? 'WARN' : 'ok  '}  ${c.componentName.padEnd(28)} ${k.pattern.padEnd(16)} rows ${k.rows}${total !== null ? `/${total}` : ''}${k.lists ? ` (${k.lists.join(', ')})` : ''}`);
    for (const p of [...problems, ...notes]) lines.push(`        - ${p}`);
  }

  if (countable) lines.push(`${verified} of ${countable} list placement(s) had their row count verified`);
  if (countable && !verified && !failed) lines.push('no row count could be verified: nothing about silent drops was judged');

  const editing = [];
  if (editingLayout !== undefined) {
    let captured;
    try { captured = JSON.parse(editingLayout); } catch { return { exit: 2, lines: [...lines, 'editing capture is not JSON'], results, editing }; }
    const cr = routeOf(captured);
    if (!cr) return { exit: 2, lines: [...lines, 'editing capture has no route (expected sitecore.route or a layout query response)'], results, editing };
    editing.push(...editingMetadata(cr));
    if (!editing.length) return { exit: 2, lines: [...lines, 'editing capture has no list placements: nothing to judge'], results, editing };
    for (const e of editing) {
      const ok = e.fields > 0 && e.withMetadata === e.fields;
      if (!ok) failed++;
      lines.push(`${ok ? 'ok  ' : 'FAIL'}  editing: ${e.component.padEnd(20)} ${e.withMetadata}/${e.fields} row fields carry metadata (${e.rows} rows)`);
    }
  }
  return { exit: failed ? 1 : countable && !verified ? 2 : 0, lines, results, editing };
}

// ---------------------------------------------------------------- self-test
const layoutOf = (cs) => ({ data: { layout: { item: { rendered: { sitecore: { route: { placeholders: { main: cs } } } } } } } });
const fetchDouble = (layoutBody, totals = {}, totalErrors = false) => async (_url, init) => {
  const { query, variables } = JSON.parse(init.body);
  let body;
  if (query.includes('layout(')) body = layoutBody;
  else if (totalErrors) body = { errors: [{ message: 'Query is too complex to execute' }] };
  else body = { data: { item: variables.id in totals ? { children: { total: totals[variables.id] } } : null } };
  return { status: 200, json: async () => body };
};
const jv = (v, meta) => ({ jsonValue: { value: v, ...(meta ? { metadata: {} } : {}) } });

async function selfTest() {
  let failed = 0;
  const say = (ok, name) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
  const args = { context: 'ctx', site: 's', route: '/' };
  const cq = (rows, extra = {}) => ({ componentName: 'Tabs', dataSource: 'ds', fields: { data: { datasource: { ...extra, children: { results: rows } } } } });
  const goodRows = [{ id: '1', title: jv('A'), text: jv('x') }, { id: '2', title: jv('B'), text: jv('y') }];
  const text = (r) => r.lines.join('\n');

  let r = await probe(args, fetchDouble(layoutOf([cq(goodRows)]), { ds: 2 }));
  say(r.exit === 0 && r.results[0].pattern === 'component-query' && r.results[0].problems.length === 0, 'ComponentQuery with every row field as jsonValue passes');
  r = await probe(args, fetchDouble(layoutOf([cq(goodRows)]), { ds: 3 }));
  say(r.exit === 1 && /silent drop: 2 of 3/.test(text(r)), 'more children than delivered rows fails (silent drop)');
  r = await probe(args, fetchDouble(layoutOf([cq([{ id: '1', title: { value: 'A' } }, { id: '2', title: { value: 'B' } }])]), { ds: 2 }));
  say(r.exit === 1 && /not selected as jsonValue.*title/.test(text(r)), 'rows selected as { value } (no jsonValue) fail');
  r = await probe(args, fetchDouble(layoutOf([cq([{ id: '1', title: 'raw' }])]), { ds: 1 }));
  say(r.exit === 1 && /not selected as jsonValue/.test(text(r)), 'a bare string row field fails');
  r = await probe(args, fetchDouble(layoutOf([cq(goodRows, { heading: { jsonValue: [{ id: 'x', fields: {} }, { id: 'y', fields: {} }, { id: 'z', fields: {} }] } })]), { ds: 3 }));
  say(r.exit === 1 && r.results[0].rows === 2, 'a Multilist array on the container is not counted as rows (the drop stays visible)');
  r = await probe(args, fetchDouble(layoutOf([cq(goodRows)]), {}, true));
  say(r.exit === 2 && /row count not verified/.test(text(r)) && /0 of 1 list placement/.test(text(r)), 'when no row count can be verified the run exits 2, never as ok');
  r = await probe(args, fetchDouble(layoutOf([cq(goodRows), { ...cq(goodRows), dataSource: 'gone' }]), { ds: 2 }));
  say(r.exit === 0 && /1 of 2 list placement/.test(text(r)) && /^WARN/m.test(text(r)), 'a partly verified route says how many and warns on the rest');
  r = await probe(args, fetchDouble(layoutOf([{ ...cq(goodRows), dataSource: '{6A1827C6-6432-54C4-8665-36685F415236}' }]), { '{6A1827C6-6432-54C4-8665-36685F415236}': 3 }));
  say(r.exit === 1 && /silent drop: 2 of 3/.test(text(r)), 'a braced GUID datasource, the form layout data delivers, is looked up as given');
  r = await probe(args, fetchDouble(layoutOf([{ componentName: 'CtxList', dataSource: '', isContentResolved: false, fields: {} }])));
  say(r.exit === 1 && /isContentResolved/.test(text(r)), 'a rejected ComponentQuery on a placement without a datasource fails');
  r = await probe(args, fetchDouble(layoutOf([cq([{ id: '1', name: { value: 'A' }, url: { path: '/a' } }])]), { ds: 1 }));
  say(r.exit === 1 && /jsonValue \(no editing metadata\): name$/m.test(text(r)), 'a field aliased like a reserved key is still judged, and only that field');
  r = await probe(args, fetchDouble(layoutOf([cq([{ id: '1', name: 'A', url: { path: '/a' }, template: { name: 'T' }, title: jv('A') }])]), { ds: 1 }));
  say(r.exit === 0 && r.results[0].problems.length === 0, 'real id, name, url and template selections on a row are not flagged');
  r = await probe(args, fetchDouble(layoutOf([cq([{ id: '1', title: { value: 'A' } }])]), {}, true));
  say(r.exit === 1 && /0 of 1 list placement/.test(text(r)), 'a FAIL wins over the exit 2 for an unverifiable row count');
  r = await probe(args, fetchDouble(layoutOf([{ componentName: 'Other', dataSource: 'ds', fields: { data: { search: { children: { results: [{ id: '1', title: jv('A') }] } } } } }]), {}, true));
  say(r.exit === 0 && /drop check does not apply/.test(text(r)) && !/list placement/.test(text(r)), 'a query reading another path owes no row count and does not exit 2');
  r = await probe(args, fetchDouble(layoutOf([cq([{ id: '1', link: { id: 'x', fields: {} }, title: jv('A') }])]), { ds: 1 }));
  say(r.exit === 0, 'an item reference in a row is not flagged as a plain selection');
  r = await probe(args, fetchDouble(layoutOf([{ componentName: 'List', dataSource: 'ds', fields: { items: [{ id: '1', fields: {} }] } }]), { ds: 1 }));
  say(r.exit === 0 && r.results[0].pattern === 'resolver' && /^WARN.*resolver/m.test(text(r)), 'a resolver payload is classified and warned');
  r = await probe(args, fetchDouble(layoutOf([{ componentName: 'Clients', dataSource: 'ds', fields: {} }]), { ds: 191 }));
  say(r.exit === 0 && /191 children but layout carries none/.test(text(r)), 'a datasource with children but empty fields is reported as read elsewhere');
  r = await probe(args, fetchDouble(layoutOf([{ componentName: 'Slider', dataSource: 'ds', fields: { Source: [{ id: 'a', fields: { Image: { value: {} } } }] } }])));
  say(r.exit === 0 && r.results[0].pattern === 'multilist' && r.results[0].rows === 1, 'a Multilist of items is classified with its count');
  r = await probe(args, fetchDouble(layoutOf([{ componentName: 'Tabs', dataSource: 'ds', isContentResolved: false, fields: {} }]), { ds: 4 }));
  say(r.exit === 1 && /isContentResolved/.test(text(r)) && !/reads them elsewhere/.test(text(r)), 'a rejected ComponentQuery fails, without blaming the head app');
  r = await probe(args, fetchDouble({ data: { layout: null } }));
  say(r.exit === 2, 'an unresolved route exits 2 and judges nothing');
  r = await probe(args, async () => ({ status: 502, json: async () => { throw new Error('not json'); } }));
  say(r.exit === 2 && /HTTP 502/.test(text(r)), 'an HTTP error from Edge exits 2 with a short message');
  const capture = (meta) => JSON.stringify({ sitecore: { route: { placeholders: { main: [cq(goodRows.map((x) => ({ ...x, title: jv('A', meta), text: jv('x', meta) })))] } } } });
  r = await probe({ ...args, editingLayout: capture(true) }, fetchDouble(layoutOf([cq(goodRows)]), { ds: 2 }));
  say(r.exit === 0 && /4\/4 row fields carry metadata/.test(text(r)), 'a Pages capture whose row fields carry metadata passes');
  r = await probe({ ...args, editingLayout: capture(false) }, fetchDouble(layoutOf([cq(goodRows)]), { ds: 2 }));
  say(r.exit === 1 && /0\/4/.test(text(r)), 'a Pages capture without metadata on row fields fails');
  const half = JSON.stringify({ sitecore: { route: { placeholders: { main: [cq(goodRows.map((x, i) => ({ ...x, title: jv('A', i === 0), text: jv('x', i === 0) })))] } } } });
  r = await probe({ ...args, editingLayout: half }, fetchDouble(layoutOf([cq(goodRows)]), { ds: 2 }));
  say(r.exit === 1 && /2\/4/.test(text(r)), 'a Pages capture with metadata on only some row fields fails');
  r = await probe({ ...args, editingLayout: JSON.stringify({ something: 'else' }) }, fetchDouble(layoutOf([cq(goodRows)]), { ds: 2 }));
  say(r.exit === 2 && /no route/.test(text(r)), 'a capture of the wrong shape exits 2 instead of passing');
  r = await probe({ ...args, editingLayout: JSON.stringify({ sitecore: { route: { placeholders: {} } } }) }, fetchDouble(layoutOf([cq(goodRows)]), { ds: 2 }));
  say(r.exit === 2 && /no list placements/.test(text(r)), 'a capture without list placements exits 2 instead of passing');
  console.log(failed ? `${failed} self-test case(s) failed` : 'self-test: all cases passed');
  return failed ? 1 : 0;
}

async function main(argv) {
  const arg = (n) => { const i = argv.indexOf(`--${n}`); const v = i >= 0 ? argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : undefined; };
  const context = arg('context'), site = arg('site'), route = arg('route');
  if (!context || !site || !route) {
    console.log('usage: probe-list-delivery.mjs --context <id> --site <site> --route <path> [--lang en] [--endpoint <url>] [--editing-layout <file>] [--json] | --self-test');
    return 2;
  }
  let editingLayout;
  if (argv.includes('--editing-layout')) {
    const file = arg('editing-layout');
    if (!file) { console.log('--editing-layout needs a file'); return 2; }
    editingLayout = readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); // Windows redirects write a BOM
  }
  const r = await probe({ context, site, route, lang: arg('lang') ?? 'en', endpoint: arg('endpoint') ?? DEFAULT_ENDPOINT, editingLayout });
  if (argv.includes('--json')) console.log(JSON.stringify({ exit: r.exit, results: r.results, editing: r.editing, messages: r.lines }, null, 2));
  else console.log(r.lines.join('\n') || 'no list-shaped placements on this route');
  return r.exit;
}

const same = (a, b) => { try { return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase(); } catch { return false; } };
if (process.argv[1] && same(fileURLToPath(import.meta.url), process.argv[1])) {
  const argv = process.argv.slice(2);
  (argv.includes('--self-test') ? selfTest() : main(argv)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(`probe-list-delivery: ${e?.message ?? e}`); process.exitCode = 2; }
  );
}
