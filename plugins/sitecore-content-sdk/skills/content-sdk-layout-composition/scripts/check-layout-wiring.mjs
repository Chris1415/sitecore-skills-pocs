#!/usr/bin/env node
// check-layout-wiring.mjs: static gate for layout composition in a Content SDK head app.
// Scans <app>/src for structure / slot components, their placeholder names, style params and grid CSS.
//
// Usage: node check-layout-wiring.mjs --app <head-app dir> [--json]
//        node check-layout-wiring.mjs --self-test
// Exit: 0 no FAIL · 1 at least one FAIL · 2 usage.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const STRUCTURE = ['Container', 'ColumnSplitter', 'RowSplitter'];
const isComponent = (f) => /^src\/components\/(?!content-sdk\/)[^/]+\/[^/]+\.tsx$/.test(f.path);
const usesAppPlaceholder = (src) => /<AppPlaceholder\b/.test(src);
// A rendering file: its base name (before any .Variant) matches the folder, so support files are skipped.
const isRendering = (f) => { const m = /^src\/components\/([^/]+)\/([^./]+)(?:\.[^/]+)?\.tsx$/.exec(f.path); return !!m && m[1].replace(/-/g, '').toLowerCase() === m[2].toLowerCase(); };
const GRID_ASSET = /content-sdk-layout-composition skill, assets\/bootstrap5-grid\.css/;
const BARE_GRID_RULE = /(?:^|[}\n])\s*\.(row|container|container-fluid|col(?:-(?:xs|sm|md|lg|xl|xxl))?-\d{1,2})\s*[{,]/m;

/** The `name=` expression of each <AppPlaceholder>, as written. */
export function placeholderNames(src) {
  const out = []; const re = /<AppPlaceholder\b[\s\S]*?\bname=(\{|"|')/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    if (m[1] !== '{') { const end = src.indexOf(m[1], i); out.push(src.slice(i, end)); continue; }
    let depth = 1; const start = i;
    while (i < src.length && depth) { const ch = src[i]; if (ch === '{') depth++; else if (ch === '}') depth--; i++; }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

export const RULES = [
  { id: 'bare-placeholder', sev: 'FAIL', test: (f) => isComponent(f) && /import\s*\{[^}]*\bPlaceholder\b[^}]*\}\s*from\s*['"]@sitecore-content-sdk\/nextjs['"]/.test(f.src) && /<Placeholder\b/.test(f.src)
      ? ['bare <Placeholder> in a rendering: in App Router it resolves the CLIENT component map, so every child renders "unknown component"; use <AppPlaceholder componentMap={serverMap}>'] : [] },
  { id: 'undefined-styles', sev: 'FAIL', test: (f) => /\$\{\s*(?:props\.)?params\??\.styles\s*\}/.test(f.src) || (/\{[^}]*\bstyles\b[^}]*\}\s*=\s*(?:props\.)?params\b/.test(f.src) && /\$\{\s*styles\s*\}/.test(f.src))
      ? ['params.styles interpolated unguarded: the SDK omits it when GridParameters and Styles are empty, so the class "undefined" ships; use styleClasses(params)'] : [] },
  { id: 'static-dynamic-key', sev: 'FAIL', test: (f) => isComponent(f) && placeholderNames(f.src).some((n) => /\b(?:container|column|row)-/.test(n) && !/DynamicPlaceholderId|\{\*\}|slotName/.test(n)
        // an id held in a variable (`column-${n}-${id}`) counts when the file reads DynamicPlaceholderId
        && !(/\$\{\s*\w+\s*\}\s*`?\s*$/.test(n) && /-\$\{\s*\w+\s*\}-\$\{|^`(?:container)-\$\{/.test(n) && /DynamicPlaceholderId/.test(f.src)))
      ? ['structure placeholder name without DynamicPlaceholderId or {*}: Edge delivers container-{*} / column-N-{*}, so a fixed name finds nothing'] : [] },
  { id: 'slots-from-placeholders', sev: 'WARN', test: (f) => usesAppPlaceholder(f.src) && /Object\.(?:keys|entries)\(\s*(?:props\.)?rendering\??\.placeholders/.test(f.src)
      ? ['slots derived from rendering.placeholders: Edge emits all eight column/row keys whether used or not; read EnabledPlaceholders'] : [] },
  { id: 'ignores-style-params', sev: 'WARN', test: (f) => isRendering(f) && /export\s+(?:const|default|function)/.test(f.src) && !/PartialDesignDynamicPlaceholder/.test(f.path)
      && !/\bstyles\b|GridParameters|\bStyles\b|styleClasses/.test(f.src)
      ? ['never reads params.styles / GridParameters / Styles: the grid size and styles an author picks in Pages have no effect on this component'] : [] },
];
const APP_RULES = [
  { id: 'no-grid-css', sev: 'FAIL', test: (ctx) => ctx.structure.length && !ctx.gridCss
      ? [`${ctx.structure.join(', ')} present but no grid CSS (no .col-md-* rule, no tailwind-bootstrap-grid plugin): columns stack and empty drop zones collapse`] : [] },
  { id: 'partial-structure-set', sev: 'WARN', test: (ctx) => ctx.structure.length && ctx.structure.length < STRUCTURE.length
      ? [`only ${ctx.structure.join(', ')} of ${STRUCTURE.join(', ')}: an author dropping a missing one gets the "missing React implementation" box`] : [] },
  { id: 'app-css-collision', sev: 'WARN', test: (ctx) => ctx.structure.length && ctx.collisions.length
      ? [`app CSS defines its own ${ctx.collisions.join(', ')}: an unlayered app rule beats the layered grid and takes over splitter rows (a 100vw .row did); rename or scope the app rule`] : [] },
  { id: 'no-empty-placeholder-css', sev: 'WARN', test: (ctx) => (ctx.structure.length || ctx.slotComponents) && !ctx.emptyPhCss
      ? ['no CSS for .sc-jss-empty-placeholder: inside a flex row an empty slot shrinks to its "+" button in Pages'] : [] },
];
export const GUARDS = Object.fromEntries([...RULES, ...APP_RULES].map((r) => [r.id, true]));

export function check({ files, css = [] }) {
  const findings = [];
  const comps = files.filter(isComponent);
  const allCss = css.map((c) => c.src).join('\n');
  const ctx = {
    structure: STRUCTURE.filter((n) => comps.some((f) => basename(f.path) === `${n}.tsx`)),
    slotComponents: comps.some((f) => usesAppPlaceholder(f.src) && !STRUCTURE.includes(basename(f.path, '.tsx'))
      && placeholderNames(f.src).some((n) => /DynamicPlaceholderId|\{\*\}|slotName/.test(n))),
    gridCss: /\.col-md-6\b[^{]*\{|tailwind-bootstrap-grid/.test(allCss),
    emptyPhCss: /sc-jss-empty-placeholder/.test(allCss),
    collisions: css.filter((c) => !GRID_ASSET.test(c.src)).flatMap((c) => { const m = BARE_GRID_RULE.exec(c.src); return m ? [`.${m[1]} (${c.path})`] : []; }),
  };
  for (const f of files) for (const r of RULES) if (GUARDS[r.id]) for (const msg of r.test(f)) findings.push({ sev: r.sev, rule: r.id, file: f.path, msg });
  for (const r of APP_RULES) if (GUARDS[r.id]) for (const msg of r.test(ctx)) findings.push({ sev: r.sev, rule: r.id, file: '(app)', msg });
  return findings;
}

function walk(dir, re, acc = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue;
    const p = join(dir, n); const s = statSync(p);
    if (s.isDirectory()) walk(p, re, acc); else if (re.test(n) && !/\.(test|spec)\./.test(n)) acc.push(p);
  }
  return acc;
}

export function loadApp(app) {
  const src = existsSync(join(app, 'src')) ? join(app, 'src') : app;
  const read = (p) => ({ path: relative(app, p).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') });
  return { files: walk(src, /\.(tsx?|jsx?)$/).map(read), css: walk(src, /\.css$/).map(read) };
}

function main(argv) {
  const i = argv.indexOf('--app');
  if (i < 0 || !argv[i + 1]) { console.log('usage: check-layout-wiring.mjs --app <dir> [--json] | --self-test'); return 2; }
  const app = argv[i + 1];
  if (!existsSync(app)) { console.log(`usage: ${app} does not exist`); return 2; }
  const findings = check(loadApp(app));
  if (argv.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    for (const f of findings) console.log(`${f.sev.padEnd(4)}  ${f.rule.padEnd(25)} ${f.file}: ${f.msg}`);
    const nf = findings.filter((f) => f.sev === 'FAIL').length;
    console.log(`${nf} FAIL, ${findings.length - nf} WARN`);
  }
  return findings.some((f) => f.sev === 'FAIL') ? 1 : 0;
}

// ---------------------------------------------------------------- self-test
const COL = `import { AppPlaceholder } from '@sitecore-content-sdk/nextjs';
import componentMap from '.sitecore/component-map';
import { cx, enabledSlots, slotClasses, slotName, styleClasses } from 'lib/layout/layout-params';
export const Default = ({ params, rendering, page }) => (
  <div className={cx('row component column-splitter', styleClasses(params))}>
    {enabledSlots(params).map((n) => (
      <div key={n} className={slotClasses(params, n, 'col-12')}>
        <AppPlaceholder name={slotName('column', params, n)} rendering={rendering} page={page} componentMap={componentMap} />
      </div>
    ))}
  </div>
);`;
const comp = (name, src) => ({ path: `src/components/${name}/${name}.tsx`, src });
const SET = () => STRUCTURE.map((n) => comp(n, COL.replace("'column'", `'${n === 'Container' ? 'container' : n === 'RowSplitter' ? 'row' : 'column'}'`)));
const MARK = '/* content-sdk-layout-composition skill, assets/bootstrap5-grid.css */ ';
const GRID = [{ path: 'src/styles/bootstrap5-grid.css', src: MARK + '.row{display:flex} .col-md-6 { width: 50% } .row > .sc-jss-empty-placeholder { flex: 1 0 100% }' }];
const swap = (from, to) => [...SET().filter((f) => !f.path.includes('/ColumnSplitter/')), comp('ColumnSplitter', COL.replace(from, to))];
export const FIXTURES = {
  'bare-placeholder': { files: swap(/import \{ AppPlaceholder \} from '@sitecore-content-sdk\/nextjs';\n/, "import { Placeholder } from '@sitecore-content-sdk/nextjs';\n").map((f) => f.path.includes('/ColumnSplitter/') ? { ...f, src: f.src.replace('<AppPlaceholder name={slotName(\'column\', params, n)}', '<Placeholder name={`column-${n}-{*}`}') } : f), css: GRID },
  'undefined-styles': { files: swap("cx('row component column-splitter', styleClasses(params))", '`row component column-splitter ${params.styles}`'), css: GRID },
  'static-dynamic-key': { files: swap("slotName('column', params, n)", '`column-${n}`'), css: GRID },
  'slots-from-placeholders': { files: swap('enabledSlots(params).map((n)', 'Object.keys(rendering.placeholders ?? {}).map((n)'), css: GRID },
  'ignores-style-params': { files: [...SET(), comp('Hero', "export default function Hero({ fields }) { return <section className=\"hero\">{fields.Title.value}</section>; }")], css: GRID },
  'no-grid-css': { files: SET(), css: [{ path: 'src/app/globals.css', src: '@import "tailwindcss"; .row > .sc-jss-empty-placeholder { flex: 1 0 100% }' }] },
  'partial-structure-set': { files: SET().filter((f) => !f.path.includes('/RowSplitter/')), css: GRID },
  'no-empty-placeholder-css': { files: SET(), css: [{ path: 'src/styles/bootstrap5-grid.css', src: MARK + '.col-md-6 { width: 50% }' }] },
  'app-css-collision': { files: SET(), css: [...GRID, { path: 'src/app/globals.css', src: '.hero{}\n.row {\n  width: 100vw;\n}' }] },
};

export function selfTest({ quiet = false } = {}) {
  let failed = 0;
  const say = (ok, name) => { if (!quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
  const clean = check({ files: SET(), css: GRID });
  say(clean.length === 0, `clean fixture has no findings${clean.length ? ` (got ${clean.map((x) => x.rule).join(', ')})` : ''}`);
  say(check({ files: [comp('Hero', 'export default function Hero({ params }) { return <section className={styleClasses(params)} />; }')] }).length === 0, 'an app without structure components needs no grid CSS');
  say(check({ files: SET(), css: [{ path: 'src/app/globals.css', src: "@plugin 'tailwind-bootstrap-grid';\n.sc-jss-empty-placeholder{}" }] }).length === 0, 'the upstream tailwind-bootstrap-grid plugin counts as grid CSS');
  say(check({ files: swap("slotName('column', params, n)", '`column-${n}-{*}`'), css: GRID }).length === 0, 'the literal {*} form (upstream) is accepted');
  say(check({ files: SET(), css: [...GRID, { path: 'src/app/globals.css', src: '.rows > .row { width: 100vw }' }] }).length === 0, 'a scoped app rule (.rows > .row) is not a collision');
  say(check({ files: [...SET(), comp('Gallery', 'export default function G({ params }) { return <div className={styleClasses(params)} />; }'), { path: 'src/components/Gallery/LightboxViewer.tsx', src: 'export default function L() { return <div />; }' }], css: GRID }).length === 0, 'a support file in a rendering folder is not flagged for ignoring params');
  say(check({ files: swap("slotName('column', params, n)", '`column-${n}-${id}`').map((f) => ({ ...f, src: `const id = params.DynamicPlaceholderId;\n${f.src}` })), css: GRID }).length === 0, 'an id held in a variable read from DynamicPlaceholderId is accepted');
  say(check({ files: swap("slotName('column', params, n)", '`column-${n}-${id}`'), css: GRID }).some((x) => x.rule === 'static-dynamic-key'), 'a variable id with no DynamicPlaceholderId read is still flagged');
  for (const [rule, fx] of Object.entries(FIXTURES)) {
    const got = check(fx);
    say(got.some((x) => x.rule === rule), `fixture "${rule}" is flagged`);
    say(got.every((x) => x.rule === rule), `fixture "${rule}" flags only its own rule${got.some((x) => x.rule !== rule) ? ` (also ${got.filter((x) => x.rule !== rule).map((x) => x.rule).join(', ')})` : ''}`);
  }
  if (quiet) return failed;
  for (const g of Object.keys(GUARDS)) {
    GUARDS[g] = false; const n = selfTest({ quiet: true }); GUARDS[g] = true;
    const ok = n > 0; console.log(`${ok ? 'PASS' : 'FAIL'}  mutation: rule "${g}" disabled is detected (${n} case(s) fail)`); if (!ok) failed++;
  }
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { const argv = process.argv.slice(2); process.exitCode = argv.includes('--self-test') ? selfTest() : main(argv); }
