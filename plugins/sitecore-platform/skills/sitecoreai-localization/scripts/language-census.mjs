#!/usr/bin/env node
// language-census.mjs: READ-ONLY language census of one SitecoreAI site.
// CM side (Authoring GraphQL): environment languages, site fallback flags, every page / datasource /
// dictionary entry and the languages it has a version in. Edge side (optional, public context id):
// routes(language) and dictionary(language) per language. Then it diffs the three.
//
// Usage: node language-census.mjs --site <name> --cm https://<cm-host> [--cred-prefix SITECORE_AUTOMATION_CLIENT]
//          [--env-file .env] [--edge-context-env SITECORE_EDGE_CONTEXT_ID] [--langs en,de-DE] [--max-items 800] [--json] [--strict]
//        node language-census.mjs --self-test
// Credentials: <prefix>_ID / <prefix>_SECRET (client_credentials) from the environment or --env-file.
// Every GraphQL document goes through assertQuery(): a mutation is refused before any request.
// Exit: 0 report written · 1 --strict and at least one FAIL/WARN · 2 usage / auth / read error.
import { readFileSync, existsSync } from 'node:fs';

export const GUARDS = {
  'read-only': true, 'orphan-language': true, 'missing-page-version': true, 'dict-missing-version': true,
  'dict-empty-phrase': true, 'edge-route-missing': true, 'edge-dict-untranslated': true, 'unused-env-language': true, 'edge-dict-absent': true,
};

/** Refuse anything but a query (comments and strings stripped first). */
export function assertQuery(doc) {
  if (!GUARDS['read-only']) return;
  const s = String(doc).replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/#[^\n\r]*/g, '');
  if (/(^|[\s}])(mutation|subscription)\b/.test(s)) throw new Error('read-only: GraphQL mutation/subscription refused');
}

export async function gqlPost(url, query, variables, { token, fetchImpl = globalThis.fetch } = {}) {
  assertQuery(query);
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => null);
  if (!j || (j.errors && !j.data)) throw new Error(`GraphQL ${r.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  return j.data;
}

// ---------------------------------------------------------------- analysis (pure)
/**
 * snapshot = { site, defaultLanguage, envLanguages:[], siteFlags:{}, items:[{path, kind:'page'|'datasource', route?, languages:[]}],
 *              dictionary:[{key, languages:[], phrases:{lang:value}}], edge?:{ [lang]:{ routes:[], dictionary:{key:value} } }, targetLanguages:[] }
 */
export function analyze(s) {
  const f = []; const add = (rule, sev, msg, sample) => f.push({ rule, sev, msg, ...(sample ? { sample: sample.slice(0, 15), count: sample.length } : {}) });
  const env = new Set(s.envLanguages);
  const used = new Map();
  for (const it of [...s.items, ...s.dictionary]) for (const l of it.languages) used.set(l, (used.get(l) || 0) + 1);
  for (const [l, n] of used) if (!env.has(l) && GUARDS['orphan-language']) add('orphan-language', 'FAIL', `${n} item(s) have "${l}" versions but "${l}" is not an environment language: preview serves them, a publish cannot`, [...s.items, ...s.dictionary].filter((i) => i.languages.includes(l)).map((i) => i.path || i.key));
  for (const l of s.envLanguages) if (!used.has(l) && GUARDS['unused-env-language']) add('unused-env-language', 'INFO', `environment language "${l}" has no version in this site`);
  const pages = s.items.filter((i) => i.kind === 'page');
  for (const l of s.targetLanguages) {
    if (l === s.defaultLanguage) continue;
    const miss = pages.filter((p) => p.languages.includes(s.defaultLanguage) && !p.languages.includes(l));
    if (miss.length && GUARDS['missing-page-version']) add('missing-page-version', 'WARN', `${miss.length}/${pages.length} page(s) have no "${l}" version: /${l}/… 404s for them (no fallback in the SDK)`, miss.map((p) => p.route || p.path));
    const dm = s.dictionary.filter((d) => !d.languages.includes(l));
    if (dm.length && GUARDS['dict-missing-version']) add('dict-missing-version', 'WARN', `${dm.length}/${s.dictionary.length} dictionary entr(y/ies) have no "${l}" version: Edge returns the KEY as the phrase`, dm.map((d) => d.key));
    const de = s.dictionary.filter((d) => d.languages.includes(l) && (d.phrases?.[l] ?? '') === '');
    if (de.length && GUARDS['dict-empty-phrase']) add('dict-empty-phrase', 'WARN', `${de.length} dictionary entr(y/ies) have an empty "${l}" phrase: Edge returns the KEY`, de.map((d) => d.key));
  }
  if (s.edge) {
    for (const l of s.targetLanguages) {
      const e = s.edge[l]; if (!e) continue;
      const routes = new Set(e.routes.map((r) => r.toLowerCase()));
      const unpub = pages.filter((p) => p.languages.includes(l) && p.route && !routes.has(p.route.toLowerCase()));
      if (unpub.length && GUARDS['edge-route-missing']) add('edge-route-missing', 'WARN', `${unpub.length} page(s) have a "${l}" version in the CM but no "${l}" route on this Edge surface (unpublished, hidden, or never published in "${l}")`, unpub.map((p) => p.route));
      const cmKeys = s.dictionary.filter((d) => d.languages.includes(l)).map((d) => d.key);
      const absent = cmKeys.filter((k) => !(k in e.dictionary));
      if (absent.length && GUARDS['edge-dict-absent']) add('edge-dict-absent', 'WARN', `${absent.length}/${cmKeys.length} CM dictionary key(s) with a "${l}" version are absent from this Edge surface (the Dictionary item / site root was not republished after the entries changed)`, absent);
      const untr = Object.entries(e.dictionary).filter(([k, v]) => v === k).map(([k]) => k);
      if (untr.length && GUARDS['edge-dict-untranslated']) add('edge-dict-untranslated', 'WARN', `${untr.length}/${Object.keys(e.dictionary).length} Edge dictionary phrase(s) in "${l}" equal their key (missing or empty translation)`, untr);
    }
  }
  return f;
}

// ---------------------------------------------------------------- collection (network, query-only)
function readEnvFile(p) { const e = {}; if (!p || !existsSync(p)) return e; for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } return e; }

async function mint(id, secret) {
  const r = await fetch('https://auth.sitecorecloud.io/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, audience: 'https://api.sitecorecloud.io' }) });
  const j = await r.json().catch(() => ({})); if (!j.access_token) throw new Error(`token mint failed: HTTP ${r.status}`); return j.access_token;
}

async function collect({ site, cm, token, edgeCtx, langs, maxItems }) {
  const AG = `${cm.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`;
  const ag = (q, v) => gqlPost(AG, q, v, { token });
  const envLanguages = (await ag('query{ languages(first:100){ nodes{ name } } }')).languages.nodes.map((n) => n.name);
  const si = (await ag('query($s:String!){ site(siteName:$s){ rootPath startPath language dictionaryDomain properties{ key value } } }', { s: site })).site;
  if (!si) throw new Error(`site "${site}" not found on the CM`);
  const prop = (k) => si.properties?.find((p) => p.key === k)?.value?.[0];
  const start = `${si.rootPath}${si.startPath}`;
  const items = []; const queue = [{ path: start, inData: false }];
  const CH = 'query($p:String!,$a:String){ item(where:{path:$p}){ path template{ name } versions(allLanguages:true){ language{ name } } r: field(name:"__Renderings"){ value } children(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ path template{ name } } } } }';
  while (queue.length && items.length < maxItems) {
    const { path, inData } = queue.shift(); let after = null, node;
    do {
      const d = (await ag(CH, { p: path, a: after })).item; if (!d) break; node = node || d;
      for (const c of d.children.nodes) queue.push({ path: c.path, inData: inData || /data/i.test(d.template?.name || '') || /data/i.test(c.template?.name || '') });
      after = d.children.pageInfo.hasNextPage ? d.children.pageInfo.endCursor : null;
    } while (after);
    if (!node) continue;
    const isFolder = /folder|data/i.test(node.template?.name || '');
    const kind = node.r?.value ? 'page' : (!isFolder && (inData || /\/Data\//i.test(node.path)) ? 'datasource' : null);
    if (kind) items.push({ path: node.path, kind, route: kind === 'page' ? (node.path.slice(start.length) || '/') : undefined, languages: [...new Set(node.versions.map((v) => v.language.name))] });
  }
  const dictionary = [];
  if (si.dictionaryDomain) {
    const dq = [si.dictionaryDomain]; let guard = 0;
    while (dq.length && guard++ < 200) {
      const id = dq.shift(); let after = null;
      do {
        const d = (await ag('query($id:ID!,$a:String){ item(where:{itemId:$id}){ children(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ itemId path template{ templateId } k: field(name:"Key"){ value } versions(allLanguages:true){ language{ name } } } } } }', { id, a: after })).item;
        if (!d) break;
        for (const c of d.children.nodes) {
          if (String(c.template.templateId).replace(/[{}-]/g, '').toLowerCase() === '6d1cd89719364a3aa511289a94c2a7b1') dictionary.push({ id: c.itemId, path: c.path, key: c.k?.value ?? '', languages: [...new Set(c.versions.map((v) => v.language.name))], phrases: {} });
          else dq.push(c.itemId);
        }
        after = d.children.pageInfo.hasNextPage ? d.children.pageInfo.endCursor : null;
      } while (after);
    }
  }
  const versionLangs = new Set([...items, ...dictionary].flatMap((i) => i.languages));
  const targetLanguages = langs || [...new Set([...envLanguages, ...versionLangs])];
  for (const d of dictionary) for (const l of d.languages) if (targetLanguages.includes(l)) {
    const r = (await ag('query($id:ID!,$l:String!){ item(where:{itemId:$id, language:$l}){ p: field(name:"Phrase"){ value } } }', { id: d.id, l })).item; d.phrases[l] = r?.p?.value ?? '';
  }
  let edge;
  if (edgeCtx) {
    const EU = `https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=${encodeURIComponent(edgeCtx)}`;
    edge = {};
    for (const l of targetLanguages) {
      const routes = []; let after = null;
      do { const d = (await gqlPost(EU, 'query($s:String!,$l:String!,$f:Int,$a:String){ site{ siteInfo(site:$s){ routes(language:$l, first:$f, after:$a){ pageInfo{ hasNext endCursor } results{ routePath } } } } }', { s: site, l, f: 100, a: after })).site.siteInfo;
        if (!d) break; routes.push(...d.routes.results.map((r) => r.routePath)); after = d.routes.pageInfo.hasNext ? d.routes.pageInfo.endCursor : null; } while (after);
      const dict = {}; after = null;
      // first as a VARIABLE: Edge preview rejects a literal first >= 61 as "too complex".
      do { const d = (await gqlPost(EU, 'query($s:String!,$l:String!,$f:Int,$a:String){ site{ siteInfo(site:$s){ dictionary(language:$l, first:$f, after:$a){ pageInfo{ hasNext endCursor } results{ key value } } } } }', { s: site, l, f: 500, a: after })).site.siteInfo;
        if (!d) break; for (const r of d.dictionary.results) dict[r.key] = r.value; after = d.dictionary.pageInfo.hasNext ? d.dictionary.pageInfo.endCursor : null; } while (after);
      edge[l] = { routes, dictionary: dict };
    }
  }
  return { site, defaultLanguage: si.language || 'en', envLanguages, siteFlags: { enableItemLanguageFallback: prop('enableItemLanguageFallback'), enableFieldLanguageFallback: prop('enableFieldLanguageFallback'), languageEmbedding: prop('languageEmbedding') }, items, dictionary: dictionary.map(({ id, ...d }) => d), edge, targetLanguages };
}

function table(s, findings) {
  const lines = [`site ${s.site} · default ${s.defaultLanguage} · env languages ${s.envLanguages.join(', ')} · site fallback flags item=${s.siteFlags.enableItemLanguageFallback} field=${s.siteFlags.enableFieldLanguageFallback}`, '', 'language  pages  datasources  dict  dict-empty  edge-routes  edge-dict-untranslated'];
  for (const l of s.targetLanguages) {
    const pg = s.items.filter((i) => i.kind === 'page' && i.languages.includes(l)).length, ds = s.items.filter((i) => i.kind === 'datasource' && i.languages.includes(l)).length;
    const dv = s.dictionary.filter((d) => d.languages.includes(l)), de = dv.filter((d) => (d.phrases[l] ?? '') === '').length;
    const e = s.edge?.[l]; const ut = e ? Object.entries(e.dictionary).filter(([k, v]) => k === v).length : '-';
    lines.push(`${l.padEnd(9)} ${String(pg).padStart(5)}  ${String(ds).padStart(11)}  ${String(dv.length).padStart(4)}  ${String(de).padStart(10)}  ${String(e ? e.routes.length : '-').padStart(11)}  ${String(ut).padStart(22)}`);
  }
  lines.push('');
  for (const f of findings) lines.push(`${f.sev.padEnd(4)}  ${f.rule}: ${f.msg}${f.sample ? `\n        e.g. ${f.sample.slice(0, 5).join(', ')}` : ''}`);
  if (!findings.length) lines.push('OK    no findings');
  return lines.join('\n');
}

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const site = arg('--site'), cm = arg('--cm');
  if (!site || !cm) { console.log('usage: language-census.mjs --site <name> --cm https://<cm-host> [--cred-prefix P] [--env-file f] [--edge-context-env VAR] [--langs a,b] [--json] [--strict] | --self-test'); return 2; }
  const env = { ...readEnvFile(arg('--env-file')), ...process.env };
  const prefix = arg('--cred-prefix') || 'SITECORE_AUTOMATION_CLIENT';
  if (!env[`${prefix}_ID`] || !env[`${prefix}_SECRET`]) { console.log(`credential ${prefix}_ID / _SECRET not set`); return 2; }
  try {
    const token = await mint(env[`${prefix}_ID`], env[`${prefix}_SECRET`]);
    const edgeVar = arg('--edge-context-env');
    const s = await collect({ site, cm, token, edgeCtx: edgeVar ? env[edgeVar] : undefined, langs: arg('--langs')?.split(',').map((x) => x.trim()), maxItems: Number(arg('--max-items') || 800) });
    const findings = analyze(s);
    console.log(argv.includes('--json') ? JSON.stringify({ ...s, edge: s.edge ? Object.fromEntries(Object.entries(s.edge).map(([l, e]) => [l, { routes: e.routes.length, dictionary: Object.keys(e.dictionary).length }])) : undefined, findings }, null, 2) : table(s, findings));
    return argv.includes('--strict') && findings.some((x) => x.sev !== 'INFO') ? 1 : 0;
  } catch (e) { console.log(`census failed: ${e.message}`); return 2; }
}

// ---------------------------------------------------------------- self-test
const CLEAN = () => ({
  site: 'S', defaultLanguage: 'en', envLanguages: ['en', 'de-DE'], siteFlags: {}, targetLanguages: ['en', 'de-DE'],
  items: [{ path: '/H', kind: 'page', route: '/', languages: ['en', 'de-DE'] }, { path: '/H/About', kind: 'page', route: '/About', languages: ['en', 'de-DE'] }, { path: '/H/Data/Hero', kind: 'datasource', languages: ['en', 'de-DE'] }],
  dictionary: [{ key: 'Open', languages: ['en', 'de-DE'], phrases: { en: 'Open', 'de-DE': 'Öffnen' } }],
  edge: { en: { routes: ['/', '/About'], dictionary: { Open: 'Open menu' } }, 'de-DE': { routes: ['/', '/about'], dictionary: { Open: 'Menü öffnen' } } },
});
const mod = (fn) => { const s = CLEAN(); fn(s); return s; };
export const FIXTURES = {
  'orphan-language': mod((s) => { s.items[1].languages.push('fr-FR'); s.targetLanguages = ['en', 'de-DE']; }),
  'missing-page-version': mod((s) => { s.items[1].languages = ['en']; s.edge['de-DE'].routes = ['/']; }),
  'dict-missing-version': mod((s) => { s.dictionary.push({ key: 'Close', languages: ['en'], phrases: { en: 'Close' } }); s.edge.en.dictionary.Close = 'Close menu'; }),
  'dict-empty-phrase': mod((s) => { s.dictionary[0].phrases['de-DE'] = ''; }),
  'edge-route-missing': mod((s) => { s.edge['de-DE'].routes = ['/']; }),
  'edge-dict-untranslated': mod((s) => { s.edge['de-DE'].dictionary.Open = 'Open'; }),
  'unused-env-language': mod((s) => { s.envLanguages.push('nl-NL'); }),
  'edge-dict-absent': mod((s) => { s.edge['de-DE'].dictionary = {}; }),
};

export async function selfTest({ quiet = false } = {}) {
  let failed = 0;
  const say = (ok, name) => { if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
  const clean = analyze(CLEAN());
  say(clean.length === 0, `clean fixture has no findings${clean.length ? ` (got ${clean.map((x) => x.rule).join(', ')})` : ''}`);
  for (const [rule, fx] of Object.entries(FIXTURES)) {
    const got = analyze(fx);
    say(got.some((x) => x.rule === rule), `fixture "${rule}" is flagged`);
    say(got.every((x) => x.rule === rule), `fixture "${rule}" flags only its own rule${got.some((x) => x.rule !== rule) ? ` (also ${got.filter((x) => x.rule !== rule).map((x) => x.rule).join(', ')})` : ''}`);
  }
  // wiring: a mutation must be refused BEFORE the transport is called
  let calls = 0; const fake = async () => { calls++; return { status: 200, json: async () => ({ data: {} }) }; };
  let threw = false; try { await gqlPost('https://x/graphql', 'mutation { deleteItem(input:{itemId:"1"}){ successful } }', {}, { fetchImpl: fake }); } catch { threw = true; }
  say(threw && calls === 0, 'a mutation document is refused before any request');
  let ok = true; try { await gqlPost('https://x/graphql', 'query { item(where:{path:"/mutation"}){ path } } # mutation in a comment', {}, { fetchImpl: fake }); } catch { ok = false; }
  say(ok && calls === 1, 'a query that mentions "mutation" in a string or comment is allowed');
  if (quiet) return failed;
  for (const g of Object.keys(GUARDS)) {
    GUARDS[g] = false; const n = await selfTest({ quiet: true }); GUARDS[g] = true;
    const pass = n > 0; console.log(`${pass ? 'PASS' : 'FAIL'}  mutation: guard "${g}" disabled is detected (${n} case(s) fail)`); if (!pass) failed++;
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); (argv.includes('--self-test') ? selfTest() : main(argv)).then((c) => { process.exitCode = c; }); }
