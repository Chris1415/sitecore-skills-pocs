#!/usr/bin/env node
// Estate parity: compare one site's LIVE Edge delivery on two contexts (A = reference, B = candidate), e.g. the
// same site published on the source and the target tenant of an estate move. Read-only: Edge GraphQL queries
// plus an unfollowed GET of B's media, all through the guarded request layer. Context ids are read from files
// and only their last 4 characters are printed.
//
// Usage: node check-estate-parity.mjs --site <name> --a-ctx-file <f> --b-ctx-file <f>
//          [--lang en,de-DE] [--site-b <name>] [--exclude-route <regex>] [--pair /a=/b ...]
//          [--no-media-get] [--normalize-cm-host] [--json <out.json>] [--max-examples 5]
//
// Compares per route and language: route-set membership, component names and order per placeholder, component
// fields and params, route fields (title/meta/OG) and identity, dictionary entries, the media URL set, and that
// every B media URL answers 200 unfollowed. Normalized away by design: media host, tenant segment and
// hash/ttc/tt/rev/la/iar params; editing-metadata keys; fields named /thumbnail/i. --normalize-cm-host also drops
// the host of tenant-generated /sitecore/login/ item URLs (links to non-page items: CM host on one tenant,
// https://localhost on another) — opt-in, because on a page link the host can matter.
// Prove the instrument before trusting a 0: run A vs A (expect 0), a --pair of two different routes (expect 1)
// and --site-b <another site> (expect 1). Exit: 0 parity, 1 differences, 2 undecided.
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from './lib/http.mjs';
import { edge } from './lib/sitecore.mjs';
import { parseArgs, isMain, routePathArg, readEnvFile } from './lib/env.mjs';

const MEDIA_RE = /https?:\/\/[^\s"'<>)]+?\/(?:-\/)?(?:jss)?media\/[^\s"'<>)]+/gi;
const EDIT_KEYS = new Set(['metadata', 'editable', 'editableFirstPart', 'editableLastPart']);
const THUMB = /thumbnail/i;

export function normMediaUrl(u) {
  let [base, q = ''] = String(u).replace(/&amp;/g, '&').split('?');
  base = base.replace(/^https?:\/\/[^/]+\/(?:[^/]+\/)?(?:-\/)?(?:jss)?media\//i, 'MEDIA/').toLowerCase();
  const kept = q.split('&').filter((kv) => kv && !/^(hash|ttc|tt|rev|la|iar)=/i.test(kv)).sort().join('&');
  return kept ? `${base}?${kept}` : base;
}
export function normStr(s, { normalizeCmHost = false } = {}) {
  const t = normalizeCmHost ? s.replace(/https?:\/\/[^/\s"']+(\/sitecore\/login\/)/gi, 'CMHOST$1') : s;
  return t.replace(MEDIA_RE, (m) => normMediaUrl(m)).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}
export function flatten(o, opts = {}, pre = '', out = {}) {
  if (o === null || o === undefined) return out;
  if (typeof o !== 'object') { out[pre] = typeof o === 'string' ? normStr(o, opts) : o; return out; }
  for (const [k, v] of Object.entries(o)) {
    if (EDIT_KEYS.has(k) || THUMB.test(k)) continue;
    flatten(v, opts, pre ? `${pre}.${k}` : k, out);
  }
  return out;
}
function collectMedia(o, set) {
  if (typeof o === 'string') { for (const m of o.match(MEDIA_RE) || []) set.add(m.replace(/&amp;/g, '&')); return; }
  if (o && typeof o === 'object') for (const v of Object.values(o)) collectMedia(v, set);
}
/** Placeholder-qualified component list: [{ key: 'main[0]', ph, name, fields, params }]. */
export function components(route) {
  const out = [];
  const walk = (phs, prefix) => {
    for (const [ph, list] of Object.entries(phs || {})) {
      (list || []).forEach((c, i) => {
        if (!c || !c.componentName) return;
        const key = `${prefix}${ph}[${i}]`;
        out.push({ key, ph: prefix + ph, name: c.componentName, fields: c.fields, params: c.params });
        walk(c.placeholders, `${key}/`);
      });
    }
  };
  walk(route?.placeholders, '');
  return out;
}
function diffMaps(a, b) {
  const d = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) d.push({ k, a: a[k], b: b[k] });
  return d;
}
const clip = (v) => (v === undefined ? '(absent)' : String(v).slice(0, 90));

/** Pure comparison of two rendered routes (fixture-testable). */
export function compareRoutes(ra, rb, opts = {}) {
  const max = opts.maxExamples ?? 5;
  const ca = components(ra), cb = components(rb);
  const sig = (cs) => { const m = {}; for (const c of cs) (m[c.ph] ??= []).push(c.name); return m; };
  const sa = sig(ca), sb = sig(cb);
  const structureDiffs = [...new Set([...Object.keys(sa), ...Object.keys(sb)])]
    .filter((ph) => JSON.stringify(sa[ph]) !== JSON.stringify(sb[ph]))
    .map((ph) => ({ ph, a: (sa[ph] || []).join(','), b: (sb[ph] || []).join(',') }));
  const kb = Object.fromEntries(cb.map((c) => [c.key, c]));
  const fd = [];
  for (const x of ca) {
    const y = kb[x.key];
    if (!y || x.name !== y.name) continue;
    for (const d of diffMaps(flatten({ fields: x.fields, params: x.params }, opts), flatten({ fields: y.fields, params: y.params }, opts))) fd.push({ comp: `${x.key}:${x.name}`, ...d });
  }
  const ident = (r) => ({ name: r.name, displayName: r.displayName, templateName: r.templateName, itemLanguage: r.itemLanguage, fields: r.fields });
  const rf = diffMaps(flatten(ident(ra), opts), flatten(ident(rb), opts));
  const ma = new Set(), mb = new Set(); collectMedia(ra, ma); collectMedia(rb, mb);
  const na = new Set([...ma].map(normMediaUrl)), nb = new Set([...mb].map(normMediaUrl));
  const row = {
    compsA: ca.length, compsB: cb.length, structureDiffs,
    fieldDiffs: fd.length, fieldExamples: fd.slice(0, max).map((d) => ({ comp: d.comp, k: d.k, a: clip(d.a), b: clip(d.b) })),
    routeFieldDiffs: rf.length, routeFieldExamples: rf.slice(0, max).map((d) => ({ k: d.k, a: clip(d.a), b: clip(d.b) })),
    mediaA: na.size, mediaB: nb.size, mediaOnlyA: [...na].filter((x) => !nb.has(x)), mediaOnlyB: [...nb].filter((x) => !na.has(x)), mediaUrlsB: [...mb],
  };
  row.differs = Boolean(structureDiffs.length || fd.length || rf.length || row.mediaOnlyA.length || row.mediaOnlyB.length);
  return row;
}

async function q(ctx, query, variables, label) {
  const r = await edge(ctx, query, variables, { label });
  if (r.status !== 200 || (r.json?.errors && !r.json?.data)) throw new Error(`Edge HTTP ${r.status}${r.err ? ` ${r.err}` : ''} ${JSON.stringify(r.json?.errors || '').slice(0, 160)}`);
  return r.json;
}
async function listRoutes(ctx, site, lang) {
  const out = []; let after = null;
  do {
    const j = await q(ctx, 'query($s:String!,$l:String!,$a:String){site{siteInfo(site:$s){routes(language:$l,first:100,after:$a){pageInfo{hasNext endCursor} results{routePath}}}}}', { s: site, l: lang, a: after }, 'parity-routes');
    const r = j.data?.site?.siteInfo?.routes;
    if (!r) throw new Error(`site ${site} not found on context`);
    out.push(...r.results.map((x) => x.routePath));
    after = r.pageInfo.hasNext ? r.pageInfo.endCursor : null;
  } while (after);
  return out;
}
async function dictionary(ctx, site, lang) {
  const out = new Map(); let after = null;
  do {
    const j = await q(ctx, 'query($s:String!,$l:String!,$a:String){site{siteInfo(site:$s){dictionary(language:$l,first:100,after:$a){pageInfo{hasNext endCursor} results{key value}}}}}', { s: site, l: lang, a: after }, 'parity-dictionary');
    const d = j.data?.site?.siteInfo?.dictionary;
    if (!d) throw new Error('dictionary unavailable');
    for (const x of d.results) out.set(x.key, x.value);
    after = d.pageInfo.hasNext ? d.pageInfo.endCursor : null;
  } while (after);
  return out;
}
const layout = async (ctx, site, p, lang) =>
  (await q(ctx, 'query($s:String!,$p:String!,$l:String!){layout(site:$s,routePath:$p,language:$l){item{rendered}}}', { s: site, p, l: lang }, 'parity-layout')).data?.layout?.item?.rendered?.sitecore ?? null;

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } })); }

/** Runs the comparison; returns { code, report }. Never prints a context id. */
export async function checkEstateParity({ a, b, site, siteB = site, langs = ['en'], exclude = null, pairs = [], mediaGet = true, normalizeCmHost = false, maxExamples = 5 }) {
  const opts = { normalizeCmHost, maxExamples };
  const report = { site, siteB, a: `…${a.slice(-4)}`, b: `…${b.slice(-4)}`, langs, routes: [], dictionary: {}, routeSet: {}, media: {}, undecided: [], emptyLangs: [] };
  let diffs = 0; const allB = new Set();
  for (const lang of langs) {
    try {
      const [da, db] = await Promise.all([dictionary(a, site, lang), dictionary(b, siteB, lang)]);
      const changed = [...new Set([...da.keys(), ...db.keys()])].filter((k) => da.get(k) !== db.get(k));
      report.dictionary[lang] = { a: da.size, b: db.size, diffs: changed.length, examples: changed.slice(0, maxExamples).map((k) => ({ k, a: clip(da.get(k)), b: clip(db.get(k)) })) };
      if (changed.length) diffs++;
    } catch (e) { report.undecided.push(`dictionary ${lang}: ${e.message}`); }
    let work;
    if (pairs.length) work = pairs;
    else {
      let ra, rb;
      try { [ra, rb] = await Promise.all([listRoutes(a, site, lang), listRoutes(b, siteB, lang)]); } catch (e) { report.undecided.push(`routes ${lang}: ${e.message}`); continue; }
      if (exclude) { ra = ra.filter((r) => !exclude.test(r)); rb = rb.filter((r) => !exclude.test(r)); }
      const onlyA = ra.filter((r) => !rb.includes(r)), onlyB = rb.filter((r) => !ra.includes(r));
      report.routeSet[lang] = { a: ra.length, b: rb.length, onlyA, onlyB };
      if (!ra.length) report.emptyLangs.push(lang);
      if (onlyA.length || onlyB.length) diffs++;
      work = ra.map((r) => [r, r]);
    }
    await pool(work, 4, async ([pa, pb]) => {
      const row = { lang, route: pa === pb ? pa : `${pa} ⇄ ${pb}` };
      let la, lb;
      try { [la, lb] = await Promise.all([layout(a, site, pa, lang), layout(b, siteB, pb, lang)]); } catch (e) { row.error = e.message; report.undecided.push(`layout ${lang} ${row.route}: ${e.message}`); report.routes.push(row); return; }
      if (!la?.route) { row.error = 'no route on A'; report.undecided.push(`layout ${lang} ${row.route}: A returned no route`); report.routes.push(row); return; }
      if (!lb?.route) { row.missingOnB = true; diffs++; report.routes.push(row); return; }
      const c = compareRoutes(la.route, lb.route, opts);
      for (const u of c.mediaUrlsB) allB.add(u);
      delete c.mediaUrlsB;
      if (c.differs) diffs++;
      report.routes.push({ ...row, ...c });
    });
  }
  if (!pairs.length && report.emptyLangs.length === langs.length) report.undecided.push('A lists 0 routes in every language');
  if (mediaGet && allB.size) {
    const bad = [];
    await pool([...allB], 6, async (u) => {
      const r = await request(u, { maxBytes: 512, label: 'parity-media' });
      if (r.status !== 200) bad.push({ u: normMediaUrl(u), status: r.status || `ERR ${r.err}` });
    });
    report.media = { checkedB: allB.size, non200: bad.length, examples: bad.slice(0, maxExamples) };
    if (bad.length) diffs++;
  }
  report.routes.sort((x, y) => (x.lang + x.route).localeCompare(y.lang + y.route));
  report.diffGroups = diffs;
  return { code: report.undecided.length ? 2 : diffs ? 1 : 0, report };
}

function print(report, code) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`estate-parity site=${report.site}${report.siteB !== report.site ? ` site-b=${report.siteB}` : ''} A=${report.a} B=${report.b} langs=${report.langs.join(',')}`);
  console.log(`\n${pad('lang', 6)} ${pad('route', 44)} ${pad('comps A/B', 10)} ${pad('struct', 6)} ${pad('fields', 6)} ${pad('routeF', 6)} ${pad('media A/B', 10)} media±`);
  for (const r of report.routes) {
    if (r.error || r.missingOnB) { console.log(`${pad(r.lang, 6)} ${pad(r.route, 44)} ${r.error ? `ERROR ${r.error}` : 'MISSING ON B'}`); continue; }
    console.log(`${pad(r.lang, 6)} ${pad(r.route.slice(0, 44), 44)} ${pad(`${r.compsA}/${r.compsB}`, 10)} ${pad(r.structureDiffs.length, 6)} ${pad(r.fieldDiffs, 6)} ${pad(r.routeFieldDiffs, 6)} ${pad(`${r.mediaA}/${r.mediaB}`, 10)} ${r.mediaOnlyA.length + r.mediaOnlyB.length}`);
  }
  for (const [l, rs] of Object.entries(report.routeSet)) console.log(`\nroutes ${l}: A ${rs.a}, B ${rs.b}; only A ${JSON.stringify(rs.onlyA)}; only B ${JSON.stringify(rs.onlyB)}`);
  for (const [l, d] of Object.entries(report.dictionary)) console.log(`dictionary ${l}: A ${d.a}, B ${d.b}, value diffs ${d.diffs}${d.diffs ? ' ' + JSON.stringify(d.examples) : ''}`);
  if (report.media.checkedB !== undefined) console.log(`media GET (B, unfollowed): ${report.media.checkedB} checked, ${report.media.non200} non-200${report.media.non200 ? ' ' + JSON.stringify(report.media.examples) : ''}`);
  const detail = report.routes.filter((r) => r.differs);
  if (detail.length) console.log('\nDIFFERENCES');
  for (const r of detail) {
    console.log(`- [${r.lang}] ${r.route}`);
    for (const s of r.structureDiffs) console.log(`    structure ${s.ph}: A=[${s.a}] B=[${s.b}]`);
    for (const f of r.fieldExamples) console.log(`    field ${f.comp} ${f.k}: A=${f.a} | B=${f.b}`);
    if (r.fieldDiffs > r.fieldExamples.length) console.log(`    … ${r.fieldDiffs - r.fieldExamples.length} more field diffs`);
    for (const f of r.routeFieldExamples) console.log(`    route ${f.k}: A=${f.a} | B=${f.b}`);
    for (const m of r.mediaOnlyA.slice(0, 5)) console.log(`    media only A: ${m}`);
    for (const m of r.mediaOnlyB.slice(0, 5)) console.log(`    media only B: ${m}`);
  }
  if (report.emptyLangs.length) console.log(`languages with no routes on A: ${report.emptyLangs.join(',')}`);
  if (report.undecided.length) { console.log('\nUNDECIDED'); for (const u of report.undecided) console.log(`- ${u}`); }
  console.log(`\nresult: ${code === 0 ? 'PARITY' : code === 1 ? `DIFFERENCES (${report.diffGroups} groups)` : 'UNDECIDED'} (exit ${code})`);
}

/** A context file holds either a bare id or an env file carrying SITECORE_EDGE_CONTEXT_ID. */
export function readContextFile(f) {
  const raw = readFileSync(f, 'utf8').replace(/^﻿/, '').trim();
  const v = /^[A-Za-z0-9_-]{8,}$/.test(raw) ? raw : readEnvFile(f).SITECORE_EDGE_CONTEXT_ID;
  if (!v || !/^[A-Za-z0-9_-]{8,}$/.test(v)) throw new Error(`${f} holds neither a bare context id nor SITECORE_EDGE_CONTEXT_ID`);
  return v;
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  if (!a.site || !a['a-ctx-file'] || !a['b-ctx-file']) { console.error('usage: check-estate-parity.mjs --site <name> --a-ctx-file <f> --b-ctx-file <f> [--lang en,de-DE] [--site-b <name>] [--exclude-route <re>] [--pair /a=/b] [--no-media-get] [--normalize-cm-host] [--json <out>]'); process.exitCode = 2; }
  else {
    try {
      const pairs = [].concat(a.pair ?? []).map((p) => String(p).split('=').map((x, i) => routePathArg(x, `pair[${i}]`)));
      const { code, report } = await checkEstateParity({
        a: readContextFile(a['a-ctx-file']), b: readContextFile(a['b-ctx-file']), site: String(a.site), siteB: a['site-b'] ? String(a['site-b']) : String(a.site),
        langs: String(a.lang || 'en').split(',').map((s) => s.trim()).filter(Boolean), exclude: a['exclude-route'] ? new RegExp(a['exclude-route'], 'i') : null,
        pairs, mediaGet: !a['no-media-get'], normalizeCmHost: Boolean(a['normalize-cm-host']), maxExamples: Number(a['max-examples'] || 5),
      });
      print(report, code);
      if (a.json) writeFileSync(a.json, JSON.stringify(report, null, 1));
      process.exitCode = code;
    } catch (e) { console.error(`check-estate-parity: ${e.message}`); process.exitCode = 2; }
  }
}
