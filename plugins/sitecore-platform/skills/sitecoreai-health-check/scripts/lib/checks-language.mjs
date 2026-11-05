// W3 language versions: environment languages vs item versions (Authoring = master) vs live Edge routes
// and dictionary. analyzeLanguages() is a port of sitecoreai-localization's language-census analyze()
// (same rule names), re-homed here so every request goes through this skill's read-only layer.
import { result, addFinding, unknown, skipped } from './findings.mjs';
import { edge, errs } from './sitecore.mjs';

/** Rule -> doctor severity. orphan-language breaks the next publish (preview serves, live cannot). */
export const W3_RULES = {
  'orphan-language': { severity: 'P1', owner: 'cms', fix: 'Add the language to the environment (it then publishes on the next all-language publish: decide first), or delete those versions. Never delete a language to remove versions.' },
  'missing-page-version': { severity: 'P2', owner: 'cms', fix: 'Add the language version (translate) or accept the 404: the Content SDK has no default-language fallback for a missing version.' },
  'dict-missing-version': { severity: 'P2', owner: 'cms', fix: 'Add the dictionary entry version; Edge returns the KEY as the phrase until then.' },
  'dict-empty-phrase': { severity: 'P2', owner: 'cms', fix: 'Fill the phrase; an empty phrase is served as the key.' },
  'edge-route-missing': { severity: 'P2', owner: 'cms', may_be_intentional: true, fix: 'Publish the page in that language (publish all locales in one place).' },
  'edge-dict-absent': { severity: 'P2', owner: 'cms', fix: 'Republish the Dictionary item with subitems (or the site root) in that language.' },
  'edge-dict-untranslated': { severity: 'P2', owner: 'cms', fix: 'Translate the phrase; on Edge value === key is the only missing-translation signal.' },
  'unused-env-language': { severity: 'P3', owner: 'cms', may_be_intentional: true, fix: 'Informational: the environment defines a language this site has no version in.' },
};

/** `--lang en,de-DE` -> ['en', 'de-DE']; absent / bare flag -> null (W3 then derives env ∪ version languages). */
export function parseLangs(v) {
  if (v == null || v === true) return null;
  const out = [...new Set(String(v).split(',').map((s) => s.trim()).filter(Boolean))];
  return out.length ? out : null;
}

/**
 * Pure. snapshot = { defaultLanguage, envLanguages, targetLanguages, items:[{path, kind:'page'|'datasource', route?, languages}],
 * dictionary:[{key, path, languages, phrases:{lang:value}}], edge?:{ [lang]:{ routes:[], dictionary:{key:value} } } }.
 */
export function analyzeLanguages(s) {
  const out = [];
  const add = (rule, title, items) => out.push({ rule, title, items: items?.slice(0, 50), count: items?.length });
  const env = new Set(s.envLanguages);
  const all = [...s.items, ...s.dictionary];
  const used = new Map();
  for (const it of all) for (const l of it.languages) used.set(l, (used.get(l) || 0) + 1);
  for (const [l, n] of used) if (!env.has(l)) add('orphan-language', `${n} item(s) have "${l}" versions but "${l}" is not an environment language (preview serves them, a publish cannot)`, all.filter((i) => i.languages.includes(l)).map((i) => i.path || i.key));
  for (const l of s.envLanguages) if (!used.has(l)) add('unused-env-language', `Environment language "${l}" has no version in this site`);
  const pages = s.items.filter((i) => i.kind === 'page');
  for (const l of s.targetLanguages) {
    if (l === s.defaultLanguage) continue;
    const miss = pages.filter((p) => p.languages.includes(s.defaultLanguage) && !p.languages.includes(l));
    if (miss.length) add('missing-page-version', `${miss.length}/${pages.length} page(s) have no "${l}" version (/${l}/... 404s for them)`, miss.map((p) => p.route || p.path));
    const dm = s.dictionary.filter((d) => !d.languages.includes(l));
    if (dm.length) add('dict-missing-version', `${dm.length}/${s.dictionary.length} dictionary entr(y/ies) have no "${l}" version (Edge returns the key)`, dm.map((d) => d.key));
    const de = s.dictionary.filter((d) => d.languages.includes(l) && (d.phrases?.[l] ?? '') === '');
    if (de.length) add('dict-empty-phrase', `${de.length} dictionary entr(y/ies) have an empty "${l}" phrase (Edge returns the key)`, de.map((d) => d.key));
  }
  for (const l of s.edge ? s.targetLanguages : []) {
    const e = s.edge[l]; if (!e) continue;
    const routes = new Set(e.routes.map((r) => r.toLowerCase()));
    const unpub = pages.filter((p) => p.languages.includes(l) && p.route && !routes.has(p.route.toLowerCase()));
    if (unpub.length) add('edge-route-missing', `${unpub.length} page(s) have a "${l}" version on master but no "${l}" route on live Edge`, unpub.map((p) => p.route));
    const cmKeys = s.dictionary.filter((d) => d.languages.includes(l)).map((d) => d.key);
    const absent = cmKeys.filter((k) => !(k in e.dictionary));
    if (absent.length) add('edge-dict-absent', `${absent.length}/${cmKeys.length} dictionary key(s) with a "${l}" version are absent from live Edge`, absent);
    const untr = Object.entries(e.dictionary).filter(([k, v]) => v === k).map(([k]) => k);
    if (untr.length) add('edge-dict-untranslated', `${untr.length}/${Object.keys(e.dictionary).length} live Edge phrase(s) in "${l}" equal their key`, untr);
  }
  return out;
}

const DICT_ENTRY_TEMPLATE = '6d1cd89719364a3aa511289a94c2a7b1';
const CHILDREN_Q = 'query($p:String!,$a:String){ item(where:{path:$p}){ path template{ name } versions(allLanguages:true){ language{ name } } r: field(name:"__Renderings"){ value } children(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ path template{ name } } } } }';
const DICT_Q = 'query($id:ID!,$a:String){ item(where:{itemId:$id}){ children(first:100, after:$a){ pageInfo{ hasNextPage endCursor } nodes{ itemId path template{ templateId } k: field(name:"Key"){ value } versions(allLanguages:true){ language{ name } } } } } }';
// `first` travels as a VARIABLE: Edge preview rejects a literal first >= 61 as "too complex" (S4 probe 2026-10-02).
const EDGE_ROUTES_Q = 'query($s:String!,$l:String!,$f:Int,$a:String){ site{ siteInfo(site:$s){ routes(language:$l, first:$f, after:$a){ pageInfo{ hasNext endCursor } results{ routePath } } } } }';
const EDGE_DICT_Q = 'query($s:String!,$l:String!,$f:Int,$a:String){ site{ siteInfo(site:$s){ dictionary(language:$l, first:$f, after:$a){ pageInfo{ hasNext endCursor } results{ key value } } } } }';

/** Collect the snapshot through the read-only layer. Throws on an instrument error (the caller marks UNKNOWN). */
export async function collectLanguages(ctx, langs = null) {
  const ag = async (q, v, label) => {
    const r = await ctx.org.agql(ctx.cmHost, q, v, { label });
    const e = errs(r.json);
    if (r.status !== 200 || (e && !r.json?.data)) throw new Error(`${label}: HTTP ${r.status} ${(e || [r.err]).join(' | ').slice(0, 160)}`);
    return r.json.data;
  };
  const envLanguages = (await ag('query{ languages(first:100){ nodes{ name } } }', null, 'w3-languages')).languages.nodes.map((n) => n.name);
  const si = (await ag('query($s:String!){ site(siteName:$s){ rootPath startPath language dictionaryDomain } }', { s: ctx.site }, 'w3-site')).site;
  if (!si) throw new Error(`site "${ctx.site}" not found on Authoring`);
  const start = `${si.rootPath}${si.startPath || ''}`;
  const max = ctx.opts.maxLangItems ?? 800;
  const items = []; const queue = [{ path: start, inData: false }]; let visited = 0;
  while (queue.length && visited < max) {
    const { path, inData } = queue.shift(); let after = null, node; visited++;
    do {
      const d = (await ag(CHILDREN_Q, { p: path, a: after }, 'w3-tree')).item; if (!d) break; node ||= d;
      for (const c of d.children.nodes) queue.push({ path: c.path, inData: inData || /data/i.test(d.template?.name || '') || /data/i.test(c.template?.name || '') });
      after = d.children.pageInfo.hasNextPage ? d.children.pageInfo.endCursor : null;
    } while (after);
    if (!node) continue;
    const isFolder = /folder|data/i.test(node.template?.name || '');
    const kind = node.r?.value ? 'page' : (!isFolder && (inData || /\/Data\//i.test(node.path)) ? 'datasource' : null);
    if (kind) items.push({ path: node.path, kind, route: kind === 'page' ? (node.path.slice(start.length) || '/') : undefined, languages: [...new Set(node.versions.map((v) => v.language.name))] });
  }
  const truncated = queue.length > 0;
  const dictionary = [];
  if (si.dictionaryDomain) {
    const dq = [si.dictionaryDomain]; let guard = 0;
    while (dq.length && guard++ < 200) {
      const id = dq.shift(); let after = null;
      do {
        const d = (await ag(DICT_Q, { id, a: after }, 'w3-dictionary')).item; if (!d) break;
        for (const c of d.children.nodes) {
          if (String(c.template.templateId).replace(/[{}-]/g, '').toLowerCase() === DICT_ENTRY_TEMPLATE) dictionary.push({ id: c.itemId, path: c.path, key: c.k?.value ?? '', languages: [...new Set(c.versions.map((v) => v.language.name))], phrases: {} });
          else dq.push(c.itemId);
        }
        after = d.children.pageInfo.hasNextPage ? d.children.pageInfo.endCursor : null;
      } while (after);
    }
  }
  const versionLangs = new Set([...items, ...dictionary].flatMap((i) => i.languages));
  const targetLanguages = langs || [...new Set([...envLanguages, ...versionLangs])];
  for (const d of dictionary) for (const l of d.languages) if (targetLanguages.includes(l)) {
    const r = (await ag('query($id:ID!,$l:String!){ item(where:{itemId:$id, language:$l}){ p: field(name:"Phrase"){ value } } }', { id: d.id, l }, 'w3-phrase')).item;
    d.phrases[l] = r?.p?.value ?? '';
  }
  let edgeSnap = null;
  if (ctx.ids?.live) {
    edgeSnap = {};
    const page = async (q, l, pick) => {
      const acc = []; let after = null, n = 0;
      do {
        const r = await edge(ctx.ids.live, q, { s: ctx.site, l, f: 100, a: after }, { label: 'w3-edge' });
        const e = errs(r.json);
        if (r.status !== 200 || e) throw new Error(`live Edge ${l}: HTTP ${r.status} ${(e || [r.err]).join(' | ').slice(0, 160)}`);
        const conn = pick(r.json?.data?.site?.siteInfo); if (!conn) break;
        acc.push(...conn.results); after = conn.pageInfo?.hasNext ? conn.pageInfo.endCursor : null;
      } while (after && ++n < 200);
      return acc;
    };
    for (const l of targetLanguages) {
      const routes = (await page(EDGE_ROUTES_Q, l, (s) => s?.routes)).map((x) => x.routePath);
      const dict = Object.fromEntries((await page(EDGE_DICT_Q, l, (s) => s?.dictionary)).map((x) => [x.key, x.value]));
      edgeSnap[l] = { routes, dictionary: dict };
    }
  }
  return { defaultLanguage: si.language || 'en', envLanguages, targetLanguages, items, dictionary: dictionary.map(({ id, ...d }) => d), edge: edgeSnap, truncated, visited };
}

export async function checkW3(ctx) {
  const r = result('W3', 'Missing language versions', { layer: 'CT', surface: 'A + E' });
  if (ctx.page) return skipped(r, 'site scope only (the language census walks the whole site)');
  let s;
  try { s = await collectLanguages(ctx, ctx.langs); } catch (e) { return unknown(r, e.message); }
  for (const f of analyzeLanguages(s)) {
    const rule = W3_RULES[f.rule];
    addFinding(r, { severity: rule.severity, title: f.title, items: f.items, rule: f.rule, may_be_intentional: !!rule.may_be_intentional, remediation: rule.fix, fix_owner: rule.owner });
  }
  if (s.truncated) r.degraded = `language census stopped at ${s.visited} items (--max-language-items): counts are lower bounds`;
  if (!s.edge) r.notes.push('no live context id: the Edge legs (edge-route-missing, edge-dict-*) did not run');
  r.notes.push(`languages ${s.targetLanguages.join(', ')} (env: ${s.envLanguages.join(', ')}; default ${s.defaultLanguage}); ${s.items.filter((i) => i.kind === 'page').length} pages, ${s.items.filter((i) => i.kind === 'datasource').length} datasources, ${s.dictionary.length} dictionary entries`);
  return r;
}

/** Fold an extra language's census results into the primary ones: findings prefixed `[lang]`, UNKNOWN wins. */
export function mergeLanguageResults(primary, extra, lang) {
  for (const x of extra) {
    const p = primary.find((y) => y.check === x.check);
    if (!p) continue;
    if (x.status === 'unknown') unknown(p, `${p.status === 'unknown' && p.reason ? `${p.reason}; ` : ''}[${lang}] ${x.reason}`);
    for (const { fingerprint, ...f } of x.findings) addFinding(p, { ...f, title: `[${lang}] ${f.title}` });
    for (const n of x.notes) p.notes.push(`[${lang}] ${n}`);
  }
  return primary;
}
