#!/usr/bin/env node
/**
 * probe-mms.mjs — why does a low-code (atoms) component render nothing?
 *
 * Reads a page's layout (from Edge GraphQL or a saved JSON file), finds every rendering whose
 * params carry ComponentRef, selects the Document path EXACTLY as the beta SDK does (lower-case
 * `fieldNames`, last path segment = variant, fallback `default`), fetches every path from
 * `{mms-host}/mms/<path>` the way StudioComponentServerWrapper does (no auth, no context id),
 * and judges each response against the beta's parser. A known-bad control path is fetched too;
 * if it does not fail, the run is marked untrustworthy.
 *
 * Usage:
 *   node probe-mms.mjs --layout-file layout.json [--mms-host <url>]
 *   node probe-mms.mjs --context-id <id> --site <name> --route </path> [--lang en] [--edge-url <url>] [--mms-host <url>]
 *   node probe-mms.mjs --self-test
 * mms-host default mirrors the SDK: env SITECORE_EDGE_PLATFORM_HOSTNAME, else https://edge-platform.sitecorecloud.io
 * (NOT sitecore.config edgeUrl, NOT NEXT_PUBLIC_SITECORE_EDGE_PLATFORM_HOSTNAME — the beta ignores both here).
 * Exit: 0 every ComponentRef would render · 1 at least one would render null · 2 usage error or untrustworthy control.
 * Dependency-free; Node 18+. Never prints the context id.
 */
import fs from 'node:fs';
import http from 'node:http';

const DEFAULT_EDGE = 'https://edge-platform.sitecorecloud.io';

/** Pure: walk a layout (rendered.sitecore or the full GraphQL response) and collect ComponentRef renderings. */
export function findComponentRefs(layout) {
  const root = layout?.data?.layout?.item?.rendered ?? layout?.rendered ?? layout;
  const route = root?.sitecore?.route ?? root?.route;
  const hits = [];
  const walk = (placeholders, trail) => {
    for (const [ph, list] of Object.entries(placeholders ?? {})) {
      for (const r of list ?? []) {
        if (r?.params?.ComponentRef) hits.push({ placeholder: [...trail, ph].join('/'), uid: r.uid, componentName: r.componentName, params: r.params, hasFields: !!r.fields && Object.keys(r.fields).length > 0 });
        if (r?.placeholders) walk(r.placeholders, [...trail, ph]);
      }
    }
  };
  walk(route?.placeholders, []);
  return hits;
}

/** Pure: the beta SDK's variant selection (StudioComponentServerWrapper). Returns path + warnings. */
export function selectVariantPath(componentRef, params = {}) {
  const warnings = [];
  const map = new Map();
  for (const part of String(componentRef).split('|')) {
    const p = part.trim();
    if (!p) continue;
    map.set(p.split('/').pop(), p);
  }
  const fieldNames = params.fieldNames ?? 'default';
  if (params.FieldNames !== undefined && params.fieldNames === undefined)
    warnings.push(`params.FieldNames="${params.FieldNames}" is ignored: the SDK reads lower-case fieldNames only`);
  const path = map.get(fieldNames) || map.get('default') || null;
  if (!path) warnings.push(`no path ends in "${fieldNames}" or "default": the SDK renders null (a ComponentRef param on a code component also lands here)`);
  return { path, all: [...map.values()], warnings };
}

/** Pure: would the beta parser accept this MMS response? */
export function judgeMmsResponse({ status, contentType, body }) {
  if (status !== 200) return { renders: false, reason: `HTTP ${status}: the SDK logs console.error and renders null` };
  if (/application\/json/i.test(contentType || ''))
    return { renders: false, reason: 'content-type application/json: the fetcher pre-parses it and the beta JSON.parse()s the object, so null' };
  let doc;
  try { doc = JSON.parse(body); } catch { return { renders: false, reason: 'body is not JSON: null' }; }
  if (!doc || typeof doc.root !== 'string' || !doc.elements || typeof doc.elements !== 'object')
    return { renders: false, reason: 'not a flat json-render Spec ({root, elements}): nothing renders' };
  const classes = new Set();
  for (const el of Object.values(doc.elements)) {
    const cn = el?.props?.className;
    if (typeof cn === 'string') cn.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
  }
  return { renders: true, reason: 'ok', name: doc.name, elements: Object.keys(doc.elements).length, classes: classes.size, types: [...new Set(Object.values(doc.elements).map((e) => e?.type))] };
}

async function fetchMms(host, p) {
  const url = new URL(p.startsWith('/') ? `/mms${p}` : `/mms/${p}`, host).toString();
  try {
    const r = await fetch(url, { headers: { accept: '*/*' } });
    const body = await r.text();
    return { url, status: r.status, contentType: r.headers.get('content-type'), cacheControl: r.headers.get('cache-control'), age: r.headers.get('age'), body };
  } catch (e) { return { url, status: 0, contentType: null, body: '', error: e.message }; }
}

function args(argv) {
  const a = { lang: 'en', edgeUrl: DEFAULT_EDGE, mmsHost: process.env.SITECORE_EDGE_PLATFORM_HOSTNAME || DEFAULT_EDGE };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--self-test') a.selfTest = true;
    else if (k === '--layout-file') { a.layoutFile = v; i++; }
    else if (k === '--context-id') { a.contextId = v; i++; }
    else if (k === '--site') { a.site = v; i++; }
    else if (k === '--route') { a.route = v; i++; }
    else if (k === '--lang') { a.lang = v; i++; }
    else if (k === '--edge-url') { a.edgeUrl = v; i++; }
    else if (k === '--mms-host') { a.mmsHost = v; i++; }
    else if (k === '--help' || k === '-h') a.help = true;
    else { console.error('unknown argument ' + k); process.exit(2); }
  }
  if (!/^https?:\/\//.test(a.mmsHost)) a.mmsHost = 'https://' + a.mmsHost;
  return a;
}

export async function probe(layout, mmsHost, log = console.log) {
  const refs = findComponentRefs(layout);
  if (!refs.length) { log('no rendering with params.ComponentRef in this layout'); return 0; }
  const control = await fetchMms(mmsHost, 's3-probe-known-bad/' + Date.now() + '/default');
  if (control.status === 200) { log(`UNTRUSTWORTHY: known-bad control ${control.url} returned 200`); return 2; }
  let bad = 0;
  for (const r of refs) {
    const sel = selectVariantPath(r.params.ComponentRef, r.params);
    log(`\n${r.componentName ?? '?'} [${r.placeholder}] uid=${r.uid ?? '?'} ComponentRef="${r.params.ComponentRef}" fields=${r.hasFields ? 'yes' : 'no'}`);
    for (const w of sel.warnings) log(`  WARN ${w}`);
    for (const p of sel.all) {
      const res = await fetchMms(mmsHost, p);
      const j = judgeMmsResponse(res);
      const chosen = p === sel.path ? ' <- selected' : '';
      log(`  ${p}${chosen}: HTTP ${res.status} ct=${res.contentType ?? '-'} cache=${res.cacheControl ?? '-'} -> ${j.renders ? `renders "${j.name}" (${j.elements} elements, ${j.classes} classes)` : j.reason}`);
      if (p === sel.path && !j.renders) bad++;
    }
    if (!sel.path) bad++;
  }
  log(`\ncontrol ${control.status} (must be non-200) · ${refs.length} ComponentRef rendering(s) · ${bad} would render null`);
  return bad ? 1 : 0;
}

async function main(a) {
  if (a.help) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); return 0; }
  let layout;
  if (a.layoutFile) layout = JSON.parse(fs.readFileSync(a.layoutFile, 'utf8').replace(/^﻿/, ''));
  else if (a.contextId && a.site && a.route) {
    const q = `query { layout(site:${JSON.stringify(a.site)}, routePath:${JSON.stringify(a.route)}, language:${JSON.stringify(a.lang)}){ item { rendered } } }`;
    const r = await fetch(`${a.edgeUrl.replace(/\/$/, '')}/v1/content/api/graphql/v1?sitecoreContextId=${encodeURIComponent(a.contextId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
    layout = await r.json();
    if (!layout?.data?.layout?.item) { console.log(`route not found on this context (HTTP ${r.status}); a live context will not see unpublished pages`); return 2; }
  } else { console.error('need --layout-file, or --context-id + --site + --route (see --help)'); return 2; }
  console.log(`mms host: ${a.mmsHost}`);
  return probe(layout, a.mmsHost);
}

async function selfTest() {
  let failed = 0;
  const t = (n, c) => { if (!c) { failed++; console.log('FAIL ' + n); } else console.log('ok   ' + n); };
  // Variant selection (beta 3.0.0-beta.atoms.20260930142740 behaviour, measured 2026-10-02)
  t('lower-case fieldNames selects the variant', selectVariantPath('a/x/default|a/x/Compact', { fieldNames: 'Compact' }).path === 'a/x/Compact');
  const up = selectVariantPath('a/x/default|a/x/Compact', { FieldNames: 'Compact' });
  t('Sitecore FieldNames falls back to default', up.path === 'a/x/default');
  t('Sitecore FieldNames raises a warning', up.warnings.some((w) => /ignored/.test(w)));
  t('missing variant falls back to default', selectVariantPath('a/x/default|a/x/Compact', { fieldNames: 'Nope' }).path === 'a/x/default');
  t('single non-default path selects nothing', selectVariantPath('a/x/page-param', {}).path === null);
  // Response judging
  const doc = JSON.stringify({ name: 'D', root: 'r', elements: { r: { type: 'Stack', props: { className: 'p-4 flex' }, children: [] } } });
  t('200 text/plain Spec renders', judgeMmsResponse({ status: 200, contentType: 'text/plain', body: doc }).renders);
  t('200 application/json is judged null (beta parser trap)', !judgeMmsResponse({ status: 200, contentType: 'application/json; charset=utf-8', body: doc }).renders);
  t('404 is null', !judgeMmsResponse({ status: 404, contentType: null, body: '' }).renders);
  t('bad JSON is null', !judgeMmsResponse({ status: 200, contentType: 'text/plain', body: '{nope' }).renders);
  t('nested (stale) Document shape is null', !judgeMmsResponse({ status: 200, contentType: 'text/plain', body: JSON.stringify({ name: 'D', root: { id: 'x', type: 'Stack', children: [] } }) }).renders);
  t('class count extracted', judgeMmsResponse({ status: 200, contentType: 'text/plain', body: doc }).classes === 2);
  // Layout walk incl. nested placeholders
  const layout = { sitecore: { route: { placeholders: { 'headless-main': [
    { uid: '1', componentName: 'Hosted', params: { ComponentRef: 'a/x/default' }, placeholders: { inner: [{ uid: '2', componentName: 'Code', params: { ComponentRef: 'a/y/default' } }] } },
    { uid: '3', componentName: 'Plain', params: {} } ] } } } };
  const refs = findComponentRefs(layout);
  t('finds top-level and nested ComponentRef renderings', refs.length === 2 && refs[1].placeholder === 'headless-main/inner');
  t('accepts a full GraphQL response envelope', findComponentRefs({ data: { layout: { item: { rendered: layout } } } }).length === 2);
  // End to end against an in-process mock MMS
  const srv = http.createServer((req, res) => {
    if (req.url === '/mms/a/x/default') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(doc); }
    else if (req.url === '/mms/a/y/default') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(doc); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => srv.listen(0, r));
  const host = `http://127.0.0.1:${srv.address().port}`;
  const quiet = () => {};
  t('e2e: one renderable + one application/json ref -> exit 1', (await probe(layout, host, quiet)) === 1);
  t('e2e: only renderable ref -> exit 0', (await probe({ sitecore: { route: { placeholders: { m: [{ params: { ComponentRef: 'a/x/default' } }] } } } }, host, quiet)) === 0);
  await new Promise((r) => srv.close(r));
  const liar = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(doc); });
  await new Promise((r) => liar.listen(0, r));
  t('e2e: a host that answers 200 to the known-bad control -> exit 2', (await probe(layout, `http://127.0.0.1:${liar.address().port}`, quiet)) === 2);
  await new Promise((r) => liar.close(r));
  console.log(failed ? `SELF-TEST FAILED (${failed})` : 'SELF-TEST PASSED');
  return failed ? 1 : 0;
}

const a = args(process.argv.slice(2));
process.exitCode = a.selfTest ? await selfTest() : await main(a);
