#!/usr/bin/env node
/**
 * audit-sitecore-schema.mjs — score a serialized Sitecore project against
 * the per-component rendering
 * Definition-of-Done. Read-only: parses `cm/authoring/items/` only, no tenant
 * auth, no mutation, safe to run any time.
 *
 *   node scripts/audit-sitecore-schema.mjs --cm <path-to-cm>
 *   node scripts/audit-sitecore-schema.mjs --cm <path> --brand Acme-Brand
 *   node scripts/audit-sitecore-schema.mjs --cm <path> --json
 *   node scripts/audit-sitecore-schema.mjs --cm <path> --quiet
 *
 * With no `--brand`, every module in the CM is audited. Exit 1 if any brand has
 * defects, loose datasources, or Source violations — so it works as a gate.
 *
 * WHY THIS EXISTS. These defects are invisible to every other signal: the pages
 * render, the head-app build is green, unit tests pass, and Edge serves content
 * — while authors get no rendering parameters, unscoped media pickers, and a
 * content tree nobody can navigate. One brand shipped 103 rendering defects,
 * 17 Source violations and 35 misplaced datasources that way, and another
 * shipped 3 components with no params template at all. Nothing caught either
 * until a person opened the content tree. This is that missing signal.
 *
 * AXES (numbered items of the Definition-of-Done):
 *   1  datasource-template base set (+ list-container grouping bases)
 *   3  rendering `Datasource Template` = item PATH; `Datasource Location` query
 *   5  a params template exists AND is linked
 *   8  folder template exists; local datasources live under `<Page>/Data`
 *   9  one icon per component across every item it owns
 *   +  field `Source` law by type
 *   +  template folder layout — Project/<Brand>/<Site>/ with Folders/ and
 *      Rendering Parameters/ beneath it; only OOTB SXA scaffold at the brand root
 *   +  zero-rendering guard — a brand with no renderings FAILS. An empty row set
 *      cannot produce defects, so this used to print "0/0 clean, defects 0" and
 *      exit 0 on a schema that was never built (one brand, mid-run 2026-08-07).
 *
 * Rule numbers (40, 80, 86, 87, 88) name the source framework's rules; the skill's SKILL.md
 * states each one in plain terms. Run from the skill directory: node scripts/<name>.mjs …
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { resolve as resolveFromCwd } from 'node:path';
// A host repo may plug in its own resolver (e.g. a products mount) before importing this file;
// standalone, a path resolves against the working directory.
const resolveLogical = (p) => (globalThis.__componentReviewResolvePath ?? resolveFromCwd)(String(p));

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const AS_JSON = argv.includes('--json');
const QUIET = argv.includes('--quiet');
// Resolve the target through the host resolver plugged in above (cwd when standalone).
const CM = arg('cm', null) === null ? null : resolveLogical(arg('cm', null));
const ONLY_BRAND = arg('brand', null);

if (!CM) {
  console.error('Usage: node audit-sitecore-schema.mjs --cm <path-to-cm> [--brand X] [--json] [--quiet]');
  process.exit(2);
}
const ITEMS = join(CM, 'authoring', 'items');
if (!existsSync(ITEMS)) { console.error(`Not a CM serialization root: ${ITEMS}`); process.exit(2); }

// ── base-template GUIDs (introspected from OOTB Promo + Link List) ──────────
const BASE = {
  standard: '{1930BBEB-7805-471A-A3BE-4858AC7CF696}',
  perSiteSV: '{44A022DB-56D3-419A-B43B-E27E4D8E9C41}',
  publishingGrouping: '{8BA7DAC6-32ED-4378-BD9E-5DA5B0F9848D}',
  horizonGrouping: '{D0F6BE14-2A2D-4C56-ACB5-80CAA573B8E2}',
};
const TID = {
  template: 'ab86861a-6030-46c5-b394-e8f99e8b87db',
  templateField: '455a3e98-a627-4b40-8035-e683a0331ac7',
  jsonRendering: '04646a89-996f-4ee7-878a-ffdbf1f0ef0d',
  // A LIST component's `Datasource Template` points at a BRANCH, not a template —
  // that is the OOTB SXA shape (Link List) and it is what ships a NEW datasource
  // with one row already in it. Read off a live branch on a reference CM.
  branch: '35e75c72-4985-4e09-88c3-0eac6cd1e64f',
};
/**
 * Selection fields that render a FINITE LIST of options, where a query
 * Source's RESULTS are the options themselves. Tree browsers are deliberately
 * excluded — see the flat-picker check below.
 */
const FLAT_PICKER_TYPES = new Set(['multilist', 'checklist', 'droplist', 'droplink']);

const SOURCE_BY_TYPE = { image: 'query:$siteMedia', 'rich text': 'query:$xaRichTextProfile', 'general link': 'query:$linkableHomes' };
// The OOTB SXA site scaffold — the ONLY templates that belong at Project/<Brand>/.
// Everything else the build creates goes under <Site>/.
const OOTB_BRAND_ROOT = new Set(['headless site', 'headless tenant', 'jss settings', 'page',
  'page designs', 'page design folder', 'partial designs', 'partial design folder']);
const LAYOUT_SUBS = new Set(['Folders', 'Rendering Parameters']);

function parseItem(file) {
  const raw = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
  const lines = raw.split('\n');
  const top = (k) => { const m = raw.match(new RegExp(`^${k}: "?([^"\\n]+)"?\\s*$`, 'm')); return m ? m[1].trim() : null; };
  const item = { file, fields: {}, id: top('ID'), path: top('Path'), template: top('Template') };
  for (let i = 0; i < lines.length; i++) {
    // A Hint may be quoted (`Hint: "__Icon"`); kept, the quotes became part of the field NAME and every field read as missing.
    const h = lines[i].match(/^\s*Hint:\s*"?(.+?)"?\s*$/);
    if (!h) continue;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const v = lines[j].match(/^(\s*)Value:\s*(.*)$/);
      if (!v) { if (/^\s*-\s*ID:/.test(lines[j])) break; continue; }
      let val = v[2].trim();
      if (val === '|' || val === '|-') {
        const indent = v[1].length + 2, buf = [];
        for (let k = j + 1; k < lines.length; k++) {
          if (lines[k].trim() === '' || lines[k].search(/\S/) >= indent) buf.push(lines[k].trim()); else break;
        }
        val = buf.join('\n').trim();
      }
      val = val.replace(/^"(.*)"$/, '$1');
      if (!(h[1] in item.fields)) item.fields[h[1]] = val;
      break;
    }
  }
  return item;
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else if (e.endsWith('.yml')) out.push(p);
  }
  return out;
}
// ⚠️ THE `\n` IN THIS SPLIT IS REQUIRED. DO NOT "TIGHTEN" IT TO `|`-ONLY.
//
// Live Sitecore stores `__Base template` PIPE-delimited and its template engine is strictly
// `|`-delimited — a newline-joined value resolves to NOTHING. So tightening this regex looks
// like an obvious hardening. It is not: **SCS serialization is LOSSY for this field.** It writes
// the value as a YAML block scalar, one GUID per line, and re-joins on push — so a CORRECT
// pipe-delimited live value and a BROKEN newline-delimited one produce BYTE-IDENTICAL YAML.
// Measured 2026-08-28 on this CM: `<brand-a>/Hero Media Band` (18 base templates resolve live) and
// `<brand-b>/OpeningBanner` (ZERO resolved live) were indistinguishable on disk.
//
// Tightening this to `|` would therefore flag every correctly-serialized brand on the CM as
// broken — ten false positives, zero true ones. This audit reads DISK and is structurally
// incapable of seeing the defect; that is a property of the input, not a bug here.
//
// The check that CAN see it is `scripts/check-template-base-chain.mjs`, which asks the
// live template engine whether `baseTemplates` actually resolves. Run that one.
const bases = (it) => (it?.fields['__Base template'] || '').split(/[|\n]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ── discover modules from their manifests (exact, not guessed) ─────────────
// Manifests sit EITHER directly in authoring/items/ (flat, `items.path` = the
// brand folder) OR one level down in their own folder with `items.path: "."` —
// the layout the SitecoreAI items-as-resources builder requires, because it
// rejects modules that share an include name along the same path. A flat
// readdir finds zero manifests in the nested layout and every audit axis then
// passes on an empty set, so discovery is depth-tolerant. `items.path` is
// resolved against the MANIFEST's own directory (which is what makes "." mean
// "beside me"); resolving it against ITEMS would point every brand at the
// shared root and cross-contaminate all of them.
function findManifests(dir, depth = 1, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e.endsWith('.module.json')) out.push(p);
    else if (depth > 0 && statSync(p).isDirectory()) findManifests(p, depth - 1, out);
  }
  return out;
}
const modules = [];
for (const file of findManifests(ITEMS)) {
  let m;
  try { m = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  const ns = m.namespace || '';
  if (!ns.startsWith('Project.')) continue;          // skip non-project modules
  const brand = ns.slice('Project.'.length);
  const dir = join(dirname(file), m.items?.path || '');
  if (!existsSync(dir)) continue;
  // Take the site's content root from the manifest too, rather than guessing it
  // from the brand: a brand's namespace is `Project.Acme` while its site
  // lives at /sitecore/content/acme/acme-site, so the old
  // `brand.replace(/-Brand$/, '')` guess pointed the item-8 placement check at a
  // path that does not exist — it found nothing and reported clean.
  const siteInc = (m.items?.includes || []).find((i) => i.name === 'site');
  modules.push({ brand, dir, sitePath: siteInc?.path || null });
}

function auditBrand({ brand, dir, sitePath }) {
  const all = walk(dir).map(parseItem).filter((i) => i.path);
  // Sitecore paths are CASE-INSENSITIVE and the serialized casing does not have
  // to match the module namespace — `Project.Acme` serializes items under
  // /sitecore/templates/Project/acme. A case-sensitive prefix match made all
  // 248 of that brand's template items invisible, so every template-based axis
  // (base sets, Source law, folder/params existence, icons, layout) passed on an
  // empty set. Match lowercased everywhere a path is compared.
  const byPath = new Map(all.map((i) => [i.path.toLowerCase(), i]));
  const byId = new Map(all.filter((i) => i.id).map((i) => [i.id.toUpperCase().replace(/[{}]/g, ''), i]));
  const tplRoot = `/sitecore/templates/Project/${brand}`;
  const tplRootLC = tplRoot.toLowerCase();
  const under = (p, root) => p.toLowerCase().startsWith(`${root}/`);

  const renderings = all.filter((i) => i.template === TID.jsonRendering && /\/layout\/renderings\/project\//i.test(i.path));
  const projTemplates = all.filter((i) => i.template === TID.template && under(i.path, tplRootLC));
  // Existence checks stay name-based so a misplaced template still counts as
  // PRESENT — otherwise a flat brand would report every component missing its
  // folder/params template on top of the layout finding, which buries the real
  // fix (move it) under a wrong one (create it).
  const folderTemplates = projTemplates.filter((t) => /\/Folders\//.test(t.path) || /\sFolder$/.test(basename(t.path)));
  const paramTemplates = projTemplates.filter((t) => /\/Rendering Parameters\//.test(t.path) || /\sParameters$/.test(basename(t.path)));

  // ── template folder layout ──────────────────────
  // Everything the build creates lives under Project/<Brand>/<Site>/ — datasource
  // and element templates at that root, folder templates in <Site>/Folders/,
  // params in <Site>/Rendering Parameters/. Only the OOTB SXA site scaffold
  // belongs at the brand root. Until 2026-08-12 this axis did not exist and three
  // of five brands drifted flat while scoring clean.
  const layoutIssues = [];
  for (const t of projTemplates) {
    const rel = t.path.slice(tplRoot.length + 1);
    if (!rel) continue;
    const segs = rel.split('/');
    const name = segs[segs.length - 1];
    const kind = /\sFolder$/.test(name) ? 'Folders' : /\sParameters$/.test(name) ? 'Rendering Parameters' : null;
    const wantTail = kind ? `${kind}/${name}` : name;
    // A template directly at the brand root, unless it is OOTB SXA scaffold.
    if (segs.length === 1) {
      if (OOTB_BRAND_ROOT.has(name.toLowerCase())) continue;
      layoutIssues.push({ path: rel, want: `<Site>/${wantTail}` });
      continue;
    }
    // `Folders/` or `Rendering Parameters/` sitting AT the brand root — the
    // subfolder is right, the <Site> level above it is missing (one brand).
    if (LAYOUT_SUBS.has(segs[0])) { layoutIssues.push({ path: rel, want: `<Site>/${wantTail}` }); continue; }
    const tail = segs.slice(1).join('/');
    if (tail !== wantTail) layoutIssues.push({ path: rel, want: `${segs[0]}/${wantTail}` });
  }

  const rows = [];
  for (const r of renderings) {
    const name = basename(r.path), f = r.fields, defects = [];
    const dt = f['Datasource Template'] || '';
    let dsTpl = null;
    if (dt.startsWith('/sitecore/')) dsTpl = byPath.get(dt.toLowerCase());
    else if (dt) {
      const n = dt.replace(/[{}-]/g, '').toUpperCase();
      dsTpl = byId.get(n.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')) || byId.get(n);
      defects.push(`DatasourceTemplate=${dt.includes('-') ? '' : 'DASHLESS '}GUID (rule80#3 wants item PATH)`);
    }
    if (dt) {
      const dl = f['Datasource Location'] || '';
      if (!dl) defects.push('DatasourceLocation MISSING');
      else if (!dl.startsWith('query:')) defects.push(`DatasourceLocation='${dl}' (rule80#3 wants query:$site/...)`);
    }
    const pt = f['Parameters Template'] || '';
    if (!pt) defects.push('ParametersTemplate NOT LINKED (rule80#5)');
    else if (!/^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/.test(pt))
      defects.push(`ParametersTemplate not DASHED (${pt}) — will not resolve in Edge`);
    if (!f.__Icon) defects.push('__Icon MISSING on rendering (rule80#9)');

    // ── BRANCH-AWARE (2026-08-28) ────────────────────────────────────────────
    // A LIST component points `Datasource Template` at a BRANCH, so the item this
    // resolves to is a Branch — which has no base templates, no __Standard Values
    // and no __Icon by nature. Auditing it AS a template reported three defects on
    // a correctly-built list component, which means this gate actively penalised
    // the right answer and would have pushed a build back to the bare template.
    // Follow the branch to its `$name` child and audit THAT item's template.
    const G = (g) => (g || '').toUpperCase().replace(/[{}-]/g, '');
    let viaBranch = false;
    if (dsTpl && G(dsTpl.template) === G(TID.branch)) {
      viaBranch = true;
      const nameItem = byPath.get(`${dsTpl.path}/$name`.toLowerCase());
      if (!nameItem) {
        defects.push('branch has no $name child — a new datasource would be created from nothing (rule80#3)');
        dsTpl = null;
      } else {
        // Resolve the template the $name item is BUILT ON — that is the real
        // datasource template the author ends up editing.
        dsTpl = byId.get(G(nameItem.template).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'))
             || byId.get(G(nameItem.template)) || null;
        if (!dsTpl) defects.push('branch $name template UNRESOLVED in serialization');
      }
    }

    if (dsTpl) {
      const b = bases(dsTpl);
      if (!b.includes(BASE.standard)) defects.push('dsTemplate missing Standard template');
      if (!b.includes(BASE.perSiteSV)) defects.push('dsTemplate missing _PerSiteStandardValues (rule80#1)');
      if (!dsTpl.fields.__Icon) defects.push('__Icon MISSING on dsTemplate (rule80#9)');

      // ── LIST containers need _HorizonDatasourceGrouping (2026-08-28) ───────
      // BASE.horizonGrouping and BASE.publishingGrouping were DECLARED here and
      // never read — the GUID for the base template that surfaces the Pages
      // "Items" section sat in this file, unused, while four of six brands
      // shipped with no list-editable component at all (four brands: 0/64,
      // 0/32, 0/44, 0/7; two others 11/34 and 6/37 do it).
      //
      // A container is a LIST container when it hands rows to the author — the
      // observable signal in serialization is a multilist-family field with a
      // relative `query:./*` Source (children), or __Masters on its SV.
      // Without Horizon the insert options exist only in the Content Editor
      // tree, which is not where authors work.
      const dsFields = all.filter((i) => i.template === TID.templateField && i.path.toLowerCase().startsWith(dsTpl.path.toLowerCase() + '/'));
      const childList = dsFields.some((f) => /multilist|treelist|checklist/i.test(f.fields.Type || '')
        && /^query:\.\//i.test(f.fields.Source || ''));
      const sv = byPath.get(`${dsTpl.path}/__Standard Values`.toLowerCase());
      const hasMasters = !!(sv?.fields?.__Masters || '').trim();
      if (childList || hasMasters) {
        if (!b.includes(BASE.horizonGrouping))
          defects.push('LIST container missing _HorizonDatasourceGrouping — no "Items" section in Pages, so an author cannot add a row (rule80#1)');
        if (!b.includes(BASE.publishingGrouping))
          defects.push('LIST container missing _PublishingGroupingTemplate (pairs with _HorizonDatasourceGrouping)');
      }
    } else if (dt && !viaBranch) defects.push('dsTemplate UNRESOLVED in serialization');

    const dsName = dsTpl ? basename(dsTpl.path) : null;
    const match = (p, suf) => {
      const b = squash(basename(p).replace(new RegExp(`\\s*${suf}$`, 'i'), ''));
      return b === squash(name) || (dsName && b === squash(dsName));
    };
    if (dt && !folderTemplates.some((t) => match(t.path, 'Folder'))) defects.push('Folder template MISSING (rule80#8)');
    if (!paramTemplates.some((t) => match(t.path, 'Parameters'))) defects.push('Parameters template ITEM MISSING (rule80#5)');
    rows.push({ name, defects });
  }

  // ── Source law. The relative-query rule is for LIST fields on a DATASOURCE
  // template referencing its own children — NOT for rendering-parameter
  // Droplinks, which correctly point at a shared option folder.
  const sourceIssues = [];
  for (const fld of all.filter((i) => i.template === TID.templateField && under(i.path, tplRootLC))) {
    const type = (fld.fields.Type || '').toLowerCase(), src = fld.fields.Source || '';
    const want = SOURCE_BY_TYPE[type];
    if (want && src !== want) sourceIssues.push({ path: fld.path, type, source: src || '(empty)', want });
    const onParams = /\/Rendering Parameters\//.test(fld.path) || /\sParameters\//.test(fld.path);
    if (/multilist|treelist|checklist/.test(type) && !onParams) {
      if (!src) sourceIssues.push({ path: fld.path, type, source: '(empty)', want: "query:./*[@@templatename='<Child>']" });
      else if (src.startsWith('/sitecore/')) sourceIssues.push({ path: fld.path, type, source: src, want: 'relative query:./* (rule80#1)' });
    }

    // ── FLAT pickers must SELECT ITEMS, not resolve to their container.
    //
    // Added 2026-08-11 after three fields of one brand shipped with a site-relative
    // query that looked exactly right and offered ONE useless entry:
    //   query:$site/*[@@name='Data']/*[@@name='Developments']
    // That resolves to the Developments FOLDER. For a flat picker the query's
    // RESULTS are the options, so the author is offered the folder itself. It
    // is neither empty nor an absolute path, so both checks above pass it.
    //
    // TREE browsers (treelist / droptree / multiroot treelist) are exempt on
    // purpose: they ROOT a browsable tree at the Source item and the author
    // walks down, so ending at one item is correct for them. Every working
    // Multilist in this tenant ends in a wildcard step; every working Treelist
    // roots at a folder. A blanket rule rejects the correct form for half.
    if (FLAT_PICKER_TYPES.has(type) && !onParams && src.startsWith('query:') && src.includes('/')) {
      const lastStep = src.trim().split('/').pop();
      const selectsMany = lastStep === '*' || /@@templatename\s*=/.test(lastStep);
      if (!selectsMany) {
        sourceIssues.push({
          path: fld.path,
          type,
          source: src,
          want: `a query selecting ITEMS — end it "/*" or "/*[@@templatename='X']" (currently resolves to "${lastStep}")`,
        });
      }
    }
  }

  // ── local datasource placement
  const siteRoot = sitePath || `/sitecore/content/${brand}/${brand.replace(/-Brand$/, '')}`;
  const home = `${siteRoot}/Home`;
  const homeLC = home.toLowerCase();
  const pageTpl = byPath.get(`${tplRoot}/Page`.toLowerCase());
  const nrm = (g) => (g || '').toUpperCase().replace(/[{}-]/g, '');

  // A page is anything whose template IS `Page` OR DERIVES from it.
  //
  // Matching only the exact `Page` id counted every item on a DERIVED page
  // template as a stray item under its parent. Measured on one brand
  // (2026-08-13): its six coffee pages are real, routed pages on a `Coffee`
  // template whose `__Base template` is `Page`, and all six were reported as
  // loose datasources — a false positive that would have been "fixed" by six
  // product waivers papering over a tool bug. The closure below is
  // TRANSITIVE, so a template two or more hops from `Page` counts too.
  const pageTids = new Set();
  if (pageTpl) {
    pageTids.add(nrm(pageTpl.id));
    const templates = all.filter((i) => nrm(i.template) === nrm(TID.template));
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of templates) {
        const tid = nrm(t.id);
        if (!tid || pageTids.has(tid)) continue;
        if (bases(t).some((b) => pageTids.has(nrm(b)))) { pageTids.add(tid); grew = true; }
      }
    }
  }

  const looseDatasources = [];
  if (pageTids.size) {
    const pages = new Set(all.filter((i) => i.path.toLowerCase().startsWith(homeLC) && pageTids.has(nrm(i.template))).map((i) => i.path.toLowerCase()));
    pages.add(home);
    for (const i of all) {
      if (!under(i.path, homeLC) || i.path.includes('__Standard Values')) continue;
      const parent = i.path.replace(/\/[^/]+$/, '').toLowerCase();
      if (!pages.has(parent) || pages.has(i.path.toLowerCase()) || basename(i.path) === 'Data') continue;
      looseDatasources.push(i.path.replace(home, '/Home'));
    }
  }

  // ── single-use datasource sitting in the GLOBAL Data folder
  //
  // THE LAW IS "LOCAL WHEN POSSIBLE, GLOBAL WHEN NEEDED", AND THE AXIS ABOVE DOES NOT ENFORCE IT.
  // `looseDatasources` catches content scattered loose *under a page* — items whose parent IS the
  // page instead of the page's `Data` folder. A datasource parked in the site-global `<Site>/Data/`
  // is a SIBLING of the page, so it never enters that scan set at all. Two different laws; only the
  // first had a gate. Measured on one brand 2026-08-28: every datasource global, `Home/Data`
  // did not exist, and this audit exited 0.
  //
  // A datasource referenced by exactly ONE page is single-use by definition, so "global" is a claim
  // that is simply false for it. Referenced by two or more → genuinely shared, correctly global,
  // not reported. That count is the whole discriminator, which is why this reads the layout rather
  // than guessing from paths.
  const dsById = new Map(all.filter((i) => i.id).map((i) => [nrm(i.id), i]));
  const refs = new Map();          // datasource id → Set(referencing item path)
  for (const i of all) {
    const layout = `${i.fields['__Final Renderings'] || ''}\n${i.fields['__Renderings'] || ''}`;
    if (!layout.trim()) continue;
    for (const m of layout.matchAll(/\bs:ds="([^"]+)"/g)) {
      const id = nrm(m[1]);
      if (!id) continue;
      if (!refs.has(id)) refs.set(id, new Set());
      refs.get(id).add(i.path);
    }
  }
  const globalDataLC = `${siteRoot}/Data/`.toLowerCase();
  const singleUseGlobal = [];
  for (const [dsId, holders] of refs) {
    if (holders.size !== 1) continue;                        // shared → global is correct
    const ds = dsById.get(dsId);
    if (!ds) continue;                                       // unresolvable is a different defect
    if (!ds.path.toLowerCase().startsWith(globalDataLC)) continue;   // already local
    // The OOTB SXA containers (Images / Promos / Link Lists / Texts / Tags / Navigation Filters)
    // legitimately live in the global Data folder and are not per-page content.
    if (/^(images|promos|link lists|texts|tags|navigation filters)$/i.test(basename(ds.path))) continue;
    const holder = [...holders][0];
    singleUseGlobal.push({ path: ds.path.replace(siteRoot, ''), usedBy: holder.replace(siteRoot, '') });
  }

  return {
    brand,
    renderings: renderings.length,
    clean: rows.filter((r) => !r.defects.length).length,
    totalDefects: rows.reduce((n, r) => n + r.defects.length, 0),
    sourceIssues,
    looseDatasources,
    singleUseGlobal,
    layoutIssues,
    // An empty row set cannot produce defects, so without this the gate prints
    // "0/0 clean, defects 0" and exits 0 on a schema that was never built.
    emptySchema: renderings.length === 0,
    acceptedLoose: [],        // filled by the ignore-file pass below
    staleLooseWaivers: [],
    rows,
    icons: {
      renderings: [renderings.length, renderings.filter((r) => r.fields.__Icon).length],
      templates: [projTemplates.length, projTemplates.filter((t) => t.fields.__Icon).length],
    },
  };
}

const targets = ONLY_BRAND ? modules.filter((m) => m.brand.toLowerCase() === ONLY_BRAND.toLowerCase()) : modules;
if (!targets.length) { console.error(`No module for brand "${ONLY_BRAND}" in ${ITEMS}`); process.exit(2); }

// ── accepted exceptions ────────────────────────────────────────────────────
// A gate that is permanently red gets ignored, so deliberate carve-outs are
// declared in `cm/.schema-audit-ignore.json` WITH A REASON:
//
//   { "Acme-Brand": {
//       "reason": "live chrome, verified rendering",
//       "components": { "Header": ["DatasourceTemplate", "DatasourceLocation"] },
//       "looseDatasources": [
//         { "path": "/Home/Destinations/*", "reason": "routable content, deliberately not under /Data" }
//       ] } }
//
// `components` entries are defect-message PREFIXes covered by the brand-level
// `reason`. `looseDatasources` entries carry their OWN mandatory `reason` — a
// placement decision is per-item, so one brand-wide sentence cannot justify it,
// and an entry without a reason is a hard error (exit 2), not a silent pass.
// `path` is the path AS THE AUDIT REPORTS IT (rooted at `/Home`), and accepts a
// trailing `/*` (direct children) or `/**` (any descendant).
//
// Anything not declared still fails — silence means "someone decided this",
// never "nobody looked". Unused waivers are reported so they can be retired.
const IGNORE_FILE = join(CM, '.schema-audit-ignore.json');
let ignore = {};
if (existsSync(IGNORE_FILE)) {
  try { ignore = JSON.parse(readFileSync(IGNORE_FILE, 'utf8')); }
  catch (e) { console.error(`Bad ${IGNORE_FILE}: ${e.message}`); process.exit(2); }
}

// Validate the looseDatasources waivers up front — a malformed waiver must fail
// loudly here, never degrade into "this path is silently exempt".
for (const [brand, cfg] of Object.entries(ignore)) {
  if (brand.startsWith('_') || !cfg || typeof cfg !== 'object') continue;   // _readme et al
  // `looseDatasources` and `layout` share one contract: [{ path, reason }].
  for (const [key, what, egPath] of [
    ['looseDatasources', 'datasource placement', '/Home/Destinations/*'],
    ['layout', 'template placement', 'Acme SEO'],
  ]) {
    const waivers = cfg[key];
    if (waivers === undefined) continue;
    if (!Array.isArray(waivers)) {
      console.error(`Bad ${IGNORE_FILE}: "${brand}".${key} must be an array of { path, reason }.`);
      process.exit(2);
    }
    for (const [i, w] of waivers.entries()) {
      const where = `"${brand}".${key}[${i}]`;
      if (!w || typeof w !== 'object' || typeof w.path !== 'string' || !w.path.trim()) {
        console.error(`Bad ${IGNORE_FILE}: ${where} needs a non-empty "path" (as the audit reports it, e.g. "${egPath}").`);
        process.exit(2);
      }
      if (typeof w.reason !== 'string' || w.reason.trim().length < 10) {
        console.error(`Bad ${IGNORE_FILE}: ${where} ("${w.path}") needs a "reason" — a waived ${what} must say WHY it is deliberate.`);
        process.exit(2);
      }
    }
  }
  // `emptySchema` waives the zero-rendering guard: { "reason": "…" }.
  if (cfg.emptySchema !== undefined) {
    const r = cfg.emptySchema?.reason;
    if (typeof r !== 'string' || r.trim().length < 10) {
      console.error(`Bad ${IGNORE_FILE}: "${brand}".emptySchema needs a { "reason": "…" } saying WHY this module legitimately has no renderings.`);
      process.exit(2);
    }
  }
}

// A waiver path matches itself, or — with a `/*` (direct children) / `/**` (any
// descendant) suffix — the subtree beneath it. Case-insensitive, like Sitecore.
function waiverMatches(pattern, path) {
  const pat = pattern.trim().toLowerCase().replace(/\/+$/, '');
  const p = path.toLowerCase();
  if (pat.endsWith('/**')) return p.startsWith(`${pat.slice(0, -3)}/`);
  if (pat.endsWith('/*')) {
    const base = pat.slice(0, -2);
    return p.startsWith(`${base}/`) && !p.slice(base.length + 1).includes('/');
  }
  return p === pat;
}

const results = targets.map(auditBrand).map((r) => {
  const rules = ignore[r.brand]?.components || {};
  let accepted = 0;
  for (const row of r.rows) {
    const pats = rules[row.name];
    if (!pats?.length) continue;
    const kept = row.defects.filter((d) => !pats.some((p) => d.startsWith(p)));
    accepted += row.defects.length - kept.length;
    row.accepted = row.defects.length - kept.length;
    row.defects = kept;
  }

  // Loose-datasource waivers — same contract, per-entry reason.
  const waivers = ignore[r.brand]?.looseDatasources || [];
  const used = new Set();
  const keptLoose = [];
  for (const p of r.looseDatasources) {
    const w = waivers.find((x) => waiverMatches(x.path, p));
    if (w) { used.add(w.path); r.acceptedLoose.push({ path: p, reason: w.reason }); }
    else keptLoose.push(p);
  }
  r.looseDatasources = keptLoose;
  r.staleLooseWaivers = waivers.filter((w) => !used.has(w.path)).map((w) => w.path);

  // Layout waivers — identical contract to looseDatasources.
  const layoutWaivers = ignore[r.brand]?.layout || [];
  const layoutUsed = new Set();
  const keptLayout = [];
  r.acceptedLayout = [];
  for (const li of r.layoutIssues) {
    const w = layoutWaivers.find((x) => waiverMatches(x.path, li.path));
    if (w) { layoutUsed.add(w.path); r.acceptedLayout.push({ ...li, reason: w.reason }); }
    else keptLayout.push(li);
  }
  r.layoutIssues = keptLayout;
  r.staleLayoutWaivers = layoutWaivers.filter((w) => !layoutUsed.has(w.path)).map((w) => w.path);

  // Zero-rendering guard, waivable for a module that legitimately has none.
  r.acceptedEmpty = r.emptySchema ? ignore[r.brand]?.emptySchema?.reason || null : null;
  if (r.acceptedEmpty) r.emptySchema = false;

  r.accepted = accepted;
  r.acceptedReason = ignore[r.brand]?.reason || null;
  r.clean = r.rows.filter((x) => !x.defects.length).length;
  r.totalDefects = r.rows.reduce((n, x) => n + x.defects.length, 0);
  return r;
});
const isBad = (r) => Boolean(r.totalDefects || r.sourceIssues.length || r.looseDatasources.length ||
  r.layoutIssues.length || r.emptySchema);
const bad = results.filter(isBad);

if (AS_JSON) {
  console.log(JSON.stringify({ status: bad.length ? 'defects' : 'ok', results }, null, 2));
  process.exit(bad.length ? 1 : 0);
}

for (const r of results) {
  if (QUIET && !isBad(r)) continue;
  const out = isBad(r) ? console.error : console.log;
  out(`\n=== ${r.brand} — schema audit ===`);
  out(`  renderings ${r.clean}/${r.renderings} clean   defects ${r.totalDefects}   sourceIssues ${r.sourceIssues.length}   looseDatasources ${r.looseDatasources.length}   layout ${r.layoutIssues.length}` +
      (r.accepted ? `   (+${r.accepted} accepted: ${r.acceptedReason || 'no reason given'})` : '') +
      (r.acceptedLoose.length ? `   (+${r.acceptedLoose.length} loose accepted)` : ''));
  out(`  icons: renderings ${r.icons.renderings[1]}/${r.icons.renderings[0]}  templates ${r.icons.templates[1]}/${r.icons.templates[0]}`);
  for (const row of r.rows.filter((x) => x.defects.length).sort((a, b) => b.defects.length - a.defects.length)) {
    out(`  ${String(row.defects.length).padStart(2)}x ${row.name}`);
    for (const d of row.defects) out(`        - ${d}`);
  }
  if (r.looseDatasources.length) {
    out(`  local datasources NOT under a page "Data" folder:`);
    for (const p of r.looseDatasources) out(`        ✖ ${p}`);
    out(`        → deliberate? declare it in cm/.schema-audit-ignore.json under`);
    out(`          "${r.brand}".looseDatasources as { "path": "…", "reason": "…" }.`);
  }
  // ADVISORY, NOT YET BLOCKING — deliberately. Every brand on this CM predates the local-first
  // rule, so wiring this to the exit code before measuring would fail ten builds at once and teach
  // everyone to waive it. Measure, grandfather what exists, then make it blocking for new work.
  if (r.singleUseGlobal?.length) {
    out(`  ⚠ single-use datasources in the GLOBAL Data folder (advisory):`);
    for (const g of r.singleUseGlobal) out(`        ~ ${g.path}   used by ${g.usedBy} only`);
    out(`        → "local when possible, global when needed". Each is referenced by exactly ONE`);
    out(`          page, so global claims a reuse that is not happening. Move to <Page>/Data/.`);
  }
  if (r.acceptedLoose.length) {
    out(`  accepted datasource placements (waived):`);
    for (const a of r.acceptedLoose) out(`        ~ ${a.path}  — ${a.reason}`);
  }
  if (r.staleLooseWaivers.length) {
    out(`  STALE looseDatasources waivers (nothing matched — retire them):`);
    for (const p of r.staleLooseWaivers) out(`        · ${p}`);
  }
  if (r.emptySchema) {
    out(`  ✖ NO renderings serialized under /sitecore/layout/Renderings/Project/${r.brand}`);
    out(`        the schema was never built, or the "ser pull" did not land.`);
    out(`        → legitimately empty? declare "${r.brand}".emptySchema = { "reason": "…" }.`);
  }
  if (r.layoutIssues.length) {
    out(`  templates outside the canonical folder layout:`);
    for (const li of r.layoutIssues) out(`        ✖ ${li.path}   → want ${li.want}`);
    out(`        → deliberate? declare it in cm/.schema-audit-ignore.json under`);
    out(`          "${r.brand}".layout as { "path": "…", "reason": "…" }.`);
  }
  if (r.acceptedLayout.length) {
    out(`  accepted template placements (waived):`);
    for (const a of r.acceptedLayout) out(`        ~ ${a.path}  — ${a.reason}`);
  }
  if (r.staleLayoutWaivers.length) {
    out(`  STALE layout waivers (nothing matched — retire them):`);
    for (const p of r.staleLayoutWaivers) out(`        · ${p}`);
  }
  if (r.sourceIssues.length) {
    out(`  Source-law issues:`);
    for (const s of r.sourceIssues) out(`        ✖ ${s.path.replace(`/sitecore/templates/Project/${r.brand}/`, '')}  is=${s.source}  want=${s.want}`);
  }
}

if (bad.length) {
  console.error(`\n✖ ${bad.length} brand(s) with schema defects: ${bad.map((b) => b.brand).join(', ')}`);
  process.exit(1);
}
if (!QUIET) console.log(`\n✓ all ${results.length} brand(s) clean.`);
