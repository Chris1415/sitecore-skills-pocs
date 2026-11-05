#!/usr/bin/env node
// lint-layout.mjs: checks one page's DELIVERED layout (Edge layout JSON) against the layout policy,
// the responsive rules and, with --fit, each component's fit tier. Read-only.
//
// Usage: node lint-layout.mjs --layout <edge-layout.json> [--fit <component-fit.json>] [--json]
//        node lint-layout.mjs --site <site> --route </path> [--lang en] --env-file <app/.env.local> [--fit …] [--json]
//        node lint-layout.mjs --self-test
// --env-file reads SITECORE_EDGE_CONTEXT_ID (never printed); point it at a PREVIEW context to lint unpublished pages.
// Git Bash rewrites a leading-slash --route into a Windows path: run it with MSYS_NO_PATHCONV=1.
// Exit: 0 no FAIL · 1 at least one FAIL · 2 usage.
import { readFileSync, existsSync } from 'node:fs';

const BPS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];
const BP_PX = { xs: 375, sm: 576, md: 768, lg: 992, xl: 1200, xxl: 1400 };
const MIN_COLUMN_PX = 240;
const STRUCTURE = new Set(['Container', 'ColumnSplitter', 'RowSplitter']);
const SPLITTERS = new Set(['ColumnSplitter', 'RowSplitter']);
const isSlotKey = (k) => /-\d+-(\{\*\}|\d+)$/.test(k) && !/^(column|row)-/.test(k);
const isNestedKey = (k) => /^(container|column|row)-/.test(k) || isSlotKey(k);

/** Grid classes → fraction of the parent per breakpoint (inherits upward; null = unknown). */
export function fractions(classValue) {
  const own = {};
  for (const t of String(classValue ?? '').split(/[\s|]+/).filter(Boolean)) {
    const m = /^col(?:-(xs|sm|md|lg|xl|xxl))?(?:-(\d{1,2}|auto))?$/.exec(t);
    if (!m) continue;
    const bp = m[1] ?? 'xs';
    own[bp] = m[2] && m[2] !== 'auto' ? Number(m[2]) / 12 : null;
  }
  const out = {}; let cur = 1;
  for (const bp of BPS) { if (bp in own) cur = own[bp]; out[bp] = cur; }
  return out;
}
const neutral = (cls) => BPS.every((bp) => fractions(cls)[bp] === 1);

/** Pack fractions into lines at one breakpoint; returns items per line. */
export function lines(fracs) {
  const out = []; let sum = 0;
  for (const f of fracs) { if (!out.length || sum + f > 1.0001) { out.push(1); sum = f; } else { out[out.length - 1]++; sum += f; } }
  return out;
}

export const GUARDS = {};
const rule = (id, sev) => { GUARDS[id] = true; return { id, sev }; };
const R = {
  depth: rule('depth-ceiling', 'FAIL'),
  extra: rule('extra-level', 'WARN'),
  rowOne: rule('row-holds-one', 'WARN'),
  rowStyle: rule('unstyled-row-splitter', 'WARN'),
  gridInSlot: rule('grid-in-slot', 'FAIL'),
  containerInColumn: rule('container-in-column', 'WARN'),
  outside: rule('splitter-outside-container', 'WARN'),
  mobile: rule('mobile-not-12', 'WARN'),
  orphan: rule('orphan', 'WARN'),
  narrow: rule('narrow-column', 'WARN'),
  section: rule('section-in-column', 'FAIL'),
  wide: rule('wide-too-narrow', 'FAIL'),
  chrome: rule('chrome-in-page', 'FAIL'),
  unknown: rule('unknown-component', 'WARN'),
};

export function lint(route, fit = null) {
  const findings = [];
  const add = (r, where, msg) => { if (GUARDS[r.id]) findings.push({ sev: r.sev, rule: r.id, where, msg }); };
  const isSlotComponent = (c) => Object.keys(c.placeholders ?? {}).some(isSlotKey);

  // ctx: path, top (in a top-level placeholder), inContainer, level (structure levels below the first Container),
  //      cell (placeholder is a column/row/slot), frac (effective fraction of the viewport per bp)
  function walk(phs, ctx) {
    for (const [key, items] of Object.entries(phs ?? {})) {
      const cell = /^(column|row)-/.test(key) || isSlotKey(key);
      if (/^row-/.test(key) && (items.length > 1 || items.some((c) => c.componentName === 'Container')))
        add(R.rowOne, `${ctx.path}/${key}`, `a row holds ${items.length} renderings${items.some((c) => c.componentName === 'Container') ? ' incl. a Container' : ''}: one Column Splitter or components per row; add another row instead`);
      for (const c of items) visit(c, { ...ctx, path: `${ctx.path}/${key}`, top: !isNestedKey(key) && ctx.top, cell, key });
    }
  }

  function visit(c, ctx) {
    const name = c.componentName; const p = c.params ?? {}; const where = `${ctx.path} > ${name}`;
    if (name === 'PartialDesignDynamicPlaceholder') return walk(c.placeholders, { ...ctx, top: true, partial: true });
    const structural = STRUCTURE.has(name) || isSlotComponent(c);
    const tier = fit?.[name];

    if (structural) {
      const level = name === 'Container' && !ctx.inContainer ? 0 : ctx.level + 1;
      if (level === 2) add(R.extra, where, 'one structure level beyond the first: the allowed exception, keep it rare');
      if (level >= 3) add(R.depth, where, `structure level ${level}: deeper than Container > splitter/slot > one exception`);
      if (name === 'Container' && ctx.cell && !/^row-/.test(ctx.key)) add(R.containerInColumn, where, 'a Container inside a column or slot: the outer Container already owns the section');
      if (name !== 'Container' && !ctx.inContainer) add(R.outside, where, 'a splitter or slot component with no Container around it: start each section with one Container');
      const enabled = (p.EnabledPlaceholders ?? '').split(',').map(Number).filter(Boolean);
      if (name === 'RowSplitter' && !enabled.some((n) => p[`Styles${n}`]) && !p.Styles)
        add(R.rowStyle, where, 'a Row Splitter whose rows carry no styles: a placeholder already stacks, use the Row Splitter only for styled bands');
      let childFrac = ctx.frac;
      if (name === 'Container' && p.GridParameters && !neutral(p.GridParameters)) childFrac = Object.fromEntries(BPS.map((bp) => [bp, ctx.frac[bp] * (fractions(p.GridParameters)[bp] ?? 1)]));
      if (name === 'ColumnSplitter') {
        const cols = enabled.length ? enabled : [1, 2];
        const fr = cols.map((n) => fractions(p[`ColumnWidth${n}`] ?? 'col-12'));
        if (fr.some((f) => f.xs !== null && f.xs < 1)) add(R.mobile, where, 'a column is narrower than 12 on Mobile: set 12 first, then override at a larger breakpoint (small uniform peers excepted)');
        const orphans = []; const narrow = {};
        for (const bp of BPS) {
          const fs = fr.map((f) => f[bp] ?? 1); const ls = lines(fs);
          if (ls.length > 1 && ls[ls.length - 1] < ls[0]) orphans.push(`${bp} ${ls.join('+')}`);
          fs.forEach((f, i) => { const px = Math.round(f * ctx.frac[bp] * BP_PX[bp]); if (f < 1 && px < MIN_COLUMN_PX) (narrow[cols[i]] ??= []).push(`${bp} ~${px}px`); });
        }
        if (orphans.length) add(R.orphan, where, `the last line is an orphan at ${orphans.join(', ')}`);
        for (const [n, at] of Object.entries(narrow)) add(R.narrow, where, `column ${n} is below ${MIN_COLUMN_PX}px while side by side at ${at.join(', ')}`);
        cols.forEach((n, i) => walk(Object.fromEntries(Object.entries(c.placeholders ?? {}).filter(([k]) => k.startsWith(`column-${n}-`))),
          { ...ctx, path: where, inContainer: true, level, frac: Object.fromEntries(BPS.map((bp) => [bp, ctx.frac[bp] * (fr[i][bp] ?? 1)])) }));
        return;
      }
      return walk(c.placeholders, { ...ctx, path: where, inContainer: true, level, frac: childFrac });
    }

    // ordinary component
    if (ctx.cell && p.GridParameters && !neutral(p.GridParameters)) add(R.gridInSlot, where, `grid size "${p.GridParameters}" inside a column or slot: the column owns the width, leave the component at 12`);
    const own = fractions(p.GridParameters); const eff = Object.fromEntries(BPS.map((bp) => [bp, ctx.frac[bp] * (own[bp] ?? 1)]));
    if (fit) {
      if (!tier) add(R.unknown, where, 'not in the fit manifest: declare section / wide / flexible');
      if (tier === 'chrome' && !ctx.partial) add(R.chrome, where, 'a chrome component placed on a page: it belongs in a Partial Design');
      if (tier === 'section' && (ctx.cell || BPS.some((bp) => eff[bp] < 0.999))) add(R.section, where, 'a section component in a column, slot or below 12: it only works full width');
      if (tier === 'wide') for (const bp of ['md', 'lg', 'xl', 'xxl']) if (eff[bp] < 0.499) { add(R.wide, where, `~${Math.round(eff[bp] * 12)}/12 at ${bp}: a wide component needs at least 6`); break; }
    }
    walk(c.placeholders, { ...ctx, path: where });
  }

  walk(route?.placeholders, { path: '', top: true, inContainer: false, level: -1, cell: false, frac: Object.fromEntries(BPS.map((bp) => [bp, 1])) });
  return findings;
}

async function fetchRoute({ site, route, lang, envFile }) {
  const env = readFileSync(envFile, 'utf8');
  const ctxId = (env.match(/^SITECORE_EDGE_CONTEXT_ID=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  if (!ctxId) throw new Error(`no SITECORE_EDGE_CONTEXT_ID in ${envFile}`);
  const r = await fetch(`https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=${ctxId}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query($s:String!,$r:String!,$l:String!){layout(site:$s,routePath:$r,language:$l){item{rendered}}}', variables: { s: site, r: route, l: lang } }) });
  return (await r.json()).data?.layout?.item?.rendered?.sitecore?.route;
}
const routeOf = (j) => j?.data?.layout?.item?.rendered?.sitecore?.route ?? j?.sitecore?.route ?? j?.route ?? j;

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const fit = arg('--fit') ? JSON.parse(readFileSync(arg('--fit'), 'utf8')) : null;
  let route;
  if (arg('--layout')) { if (!existsSync(arg('--layout'))) { console.log(`usage: ${arg('--layout')} does not exist`); return 2; } route = routeOf(JSON.parse(readFileSync(arg('--layout'), 'utf8'))); }
  else if (arg('--site') && arg('--route') && arg('--env-file')) route = await fetchRoute({ site: arg('--site'), route: arg('--route'), lang: arg('--lang') ?? 'en', envFile: arg('--env-file') });
  else { console.log('usage: lint-layout.mjs --layout <file> | --site <s> --route <r> --env-file <f> [--lang en] [--fit <json>] [--json] | --self-test'); return 2; }
  if (!route?.placeholders) { console.log('usage: no route placeholders in the layout'); return 2; }
  const f = lint(route, fit?.components ?? fit);
  if (argv.includes('--json')) console.log(JSON.stringify(f, null, 2));
  else { for (const x of f) console.log(`${x.sev.padEnd(4)}  ${x.rule.padEnd(26)} ${x.where}: ${x.msg}`); const n = f.filter((x) => x.sev === 'FAIL').length; console.log(`${n} FAIL, ${f.length - n} WARN`); }
  return f.some((x) => x.sev === 'FAIL') ? 1 : 0;
}

// ---------------------------------------------------------------- self-test
const C = (params, placeholders = {}) => ({ componentName: 'Container', params: { GridParameters: 'col-12', DynamicPlaceholderId: '1', ...params }, placeholders: { 'container-{*}': [], ...placeholders } });
const CS = (widths, kids = {}, extra = {}) => ({ componentName: 'ColumnSplitter', params: { EnabledPlaceholders: widths.map((_, i) => i + 1).join(','), ...Object.fromEntries(widths.map((w, i) => [`ColumnWidth${i + 1}`, w])), ...extra },
  placeholders: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`column-${i + 1}-{*}`, kids[i + 1] ?? []])) });
const RS = (rows, extra = {}) => ({ componentName: 'RowSplitter', params: { EnabledPlaceholders: rows.map((_, i) => i + 1).join(','), ...extra }, placeholders: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`row-${i + 1}-{*}`, rows[i] ?? []])) });
const X = (name, params = {}) => ({ componentName: name, params });
const page = (...main) => ({ placeholders: { 'headless-main': main } });
const FIT = { Hero: 'section', Quote: 'wide', Stat: 'flexible', Header: 'chrome' };
const C_ = (inner) => { const c = C(); c.placeholders['container-{*}'] = [inner]; return c; };
const CLEAN = page(C({}, { 'container-{*}': [X('Hero')] }), C_(CS(['col-12 col-md-6', 'col-12 col-md-6'], { 1: [X('Quote')], 2: [X('Stat')] })), C({}, { 'container-{*}': [X('Stat', { GridParameters: 'col-12 col-lg-4' }), X('Stat', { GridParameters: 'col-12 col-lg-4' }), X('Stat', { GridParameters: 'col-12 col-lg-4' })] }));
export const FIXTURES = {
  'depth-ceiling': page(C_(RS([[CS(['col-12', 'col-12'], { 1: [CS(['col-12 col-lg-6', 'col-12 col-lg-6'])] })]], { Styles1: 'band' }))),
  'extra-level': page(C_(RS([[CS(['col-12 col-md-6', 'col-12 col-md-6'])]], { Styles1: 'band' }))),
  'row-holds-one': page(C_(RS([[X('Stat'), X('Stat')]], { Styles1: 'band' }))),
  'unstyled-row-splitter': page(C_(RS([[X('Stat')]]))),
  'grid-in-slot': page(C_(CS(['col-12 col-md-6', 'col-12 col-md-6'], { 1: [X('Stat', { GridParameters: 'col-12 col-md-6' })] }))),
  'container-in-column': page(C_(CS(['col-12 col-md-6', 'col-12 col-md-6'], { 1: [C({}, { 'container-{*}': [X('Stat')] })] }))),
  'splitter-outside-container': page(CS(['col-12 col-md-6', 'col-12 col-md-6'])),
  'mobile-not-12': page(C_(CS(['col-6', 'col-6']))),
  'orphan': page(C_(CS(['col-12 col-md-6', 'col-12 col-md-6', 'col-12 col-md-6']))),
  'narrow-column': page(C_(CS(['col-12 col-md-3', 'col-12 col-md-9']))),
  'section-in-column': page(C_(CS(['col-12 col-md-6', 'col-12 col-md-6'], { 1: [X('Hero')] }))),
  'wide-too-narrow': page(C({}, { 'container-{*}': [X('Quote', { GridParameters: 'col-12 col-lg-4' })] })),
  'chrome-in-page': page(C({}, { 'container-{*}': [X('Header')] })),
  'unknown-component': page(C({}, { 'container-{*}': [X('Mystery')] })),
};

// A fixture may legitimately trip a rule that its own case implies.
const ALSO = { 'depth-ceiling': ['extra-level'], 'container-in-column': ['extra-level'], 'mobile-not-12': ['narrow-column'] };

function selfTest({ quiet = false } = {}) {
  let failed = 0;
  const say = (ok, n) => { if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) failed++; };
  const clean = lint(CLEAN, FIT);
  say(clean.length === 0, `clean page has no findings${clean.length ? ` (got ${clean.map((x) => x.rule).join(', ')})` : ''}`);
  const pd = (inner) => ({ placeholders: { 'headless-header': [{ componentName: 'PartialDesignDynamicPlaceholder', params: { sig: 'sxa-header' }, placeholders: { 'sxa-header': [inner] } }] } });
  say(lint(pd(X('Header')), FIT).length === 0, 'chrome inside a Partial Design placeholder is allowed');
  say(lint(pd(X('Mystery')), FIT).some((x) => x.rule === 'unknown-component'), 'a Partial Design placeholder is walked');
  say(JSON.stringify(fractions('col-12 col-md-6 col-lg-3')) === JSON.stringify({ xs: 1, sm: 1, md: 0.5, lg: 0.25, xl: 0.25, xxl: 0.25 }), 'fractions inherit upward');
  say(JSON.stringify(fractions('col-sm-12|col-md-2')) === JSON.stringify({ xs: 1, sm: 1, md: 2 / 12, lg: 2 / 12, xl: 2 / 12, xxl: 2 / 12 }), 'pipe-joined Bootstrap 3 value parses');
  say(JSON.stringify(lines([0.5, 0.5, 0.5])) === '[2,1]', 'three halves pack 2+1');
  say(lint(page(C_(CS(['col-12 col-md-6 col-lg-3', 'col-12 col-md-6 col-lg-3', 'col-12 col-md-6 col-lg-3', 'col-12 col-md-6 col-lg-3']))), FIT).length === 0, 'the agreed 3/3/3/3 (12 / 6 / 3) passes');
  for (const [r, pg] of Object.entries(FIXTURES)) {
    const got = lint(pg, FIT);
    say(got.some((x) => x.rule === r), `fixture "${r}" is flagged`);
    const others = got.filter((x) => x.rule !== r && !(ALSO[r] ?? []).includes(x.rule)).map((x) => x.rule);
    say(others.length === 0, `fixture "${r}" flags only its own rule${others.length ? ` (also ${others.join(', ')})` : ''}`);
  }
  if (quiet) return failed;
  for (const g of Object.keys(GUARDS)) { GUARDS[g] = false; const n = selfTest({ quiet: true }); GUARDS[g] = true; const ok = n > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: rule "${g}" disabled is detected (${n} case(s) fail)`); if (!ok) failed++; }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); if (argv.includes('--self-test')) process.exitCode = selfTest(); else main(argv).then((c) => { process.exitCode = c; }); }
