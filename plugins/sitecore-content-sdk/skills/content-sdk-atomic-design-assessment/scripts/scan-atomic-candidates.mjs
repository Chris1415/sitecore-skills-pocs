#!/usr/bin/env node
// Read-only inventory of a Content SDK head app's src/components/** → atomic-design candidates.
// Usage: node scan-atomic-candidates.mjs --app <head-app-dir> [--json <out.json>] [--md]
// Limits: regex heuristics, not a TS parse. Comments are stripped line-preserving; strings are not, so a
// signal word inside a string literal can still match. Local imports (lib/*, components/*, @/*, ./x) are
// followed ONE level, so logic hidden two modules deep is invisible. Verdicts are a triage aid for a human
// read, never a migration decision. Exit 0, or exit 2 when --app is not a head app or --json has no path or cannot be written.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
// A value that starts with -- is the next flag, not this flag's value.
const opt = (k) => { const i = args.indexOf(k); const v = i >= 0 ? args[i + 1] : undefined; return v && !v.startsWith('--') ? v : undefined; };
const appDir = opt('--app');
const jsonOut = opt('--json');
const asMd = args.includes('--md');

if (args.includes('--json') && !jsonOut) {
  console.error('scan-atomic-candidates: --json needs a file path');
  process.exit(2);
}
if (!appDir || !fs.existsSync(path.join(appDir, 'src', 'components'))) {
  console.error(`scan-atomic-candidates: --app must point at a head app with src/components (got ${appDir ?? 'nothing'})`);
  process.exit(2);
}
const SRC = path.join(appDir, 'src');
const COMPONENTS = path.join(SRC, 'components');

// ---------- file discovery ----------
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return [p];
});
const rel = (p) => path.relative(COMPONENTS, p).split(path.sep).join('/');
const all = walk(COMPONENTS).filter((p) => /\.(tsx|jsx)$/.test(p));
const isSkipped = (r) => /\.(test|spec|stories)\.(tsx|jsx)$/.test(r) || /(^|\/)(__tests__|__mocks__)\//.test(r);
// A file is a rendering only if the app's own componentMap would register it: honor its exclude globs.
const cliConfig = ['sitecore.cli.config.ts', 'sitecore.cli.config.js'].map((f) => path.join(appDir, f)).find((f) => fs.existsSync(f));
const excludeGlobs = (() => {
  if (!cliConfig) return [];
  const m = fs.readFileSync(cliConfig, 'utf8').replace(/\/\/[^\n]*/g, '').match(/componentMap\s*:\s*\{[\s\S]*?exclude\s*:\s*\[([\s\S]*?)\]/);
  return m ? [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1]) : [];
})();
const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(.*/)?') + '$');
const excludeRes = excludeGlobs.map(globToRe);
const zoneOf = (r) =>
  /^atoms\//.test(r) ? 'atoms' : /^content-sdk\//.test(r) ? 'sdk-plumbing' : /^ui\//.test(r) ? 'primitives'
    : excludeRes.some((re) => re.test(`src/components/${r}`)) ? 'excluded-by-componentMap' : 'component';

// ---------- source helpers ----------
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const findAll = (src, re) => { const out = []; const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); let m; while ((m = g.exec(src))) { out.push({ line: lineOf(src, m.index), text: m[0].trim().slice(0, 60) }); if (m[0] === '') g.lastIndex++; } return out; };

// Resolve local imports one level (lib/*, components/*, src/*, @/*, ./x, ../x) to a file path.
const EXT = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
function resolveLocal(spec, fromFile) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith('src/')) base = path.join(appDir, spec);
  else if (/^(lib|components|utils|hooks|helpers)\//.test(spec)) base = path.join(SRC, spec);
  else return null;
  for (const e of ['', ...EXT]) { const p = base + e; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; }
  return null;
}

// ---------- signals ----------
// hard = the low-code runtime cannot express it; wrap = needs a thin code wrapper around a low-code
// core (lists, JSON-LD, route-context fields); soft = only with a compromise (editing branches, i18n, logic).
const SIGNALS = [
  ['hard', 'data-fetching', /\b(?:fetch\s*\(|gql`)|\b(?:useSWR|useQuery|graphql|getComponentData|ComponentQuery|GraphQLRequestClient|createGraphQLClient|getStaticProps|getServerSideProps|axios)\b/],
  ['hard', 'server-component-async', /export\s+(?:default\s+)?async\s+function|export\s+const\s+\w+\s*=\s*async\b|^\s*const\s+\w+\s*=\s*async\s*\(\s*\{?\s*(fields|rendering|params)/m],
  ['hard', 'server-action', /['"]use server['"]/],
  ['hard', 'client-state', /\b(useState|useReducer|useEffect|useLayoutEffect|useSyncExternalStore|useTransition|useOptimistic)\s*[(<]/],
  ['hard', 'event-handler', /\bon(Click|Change|Submit|Input|KeyDown|KeyUp|MouseEnter|MouseLeave|Focus|Blur|Scroll|Toggle)\s*=\s*\{/],
  ['hard', 'form', /<(form|input|select|textarea)\b|useForm\b|\bFormProvider\b/],
  ['hard', 'placeholder', /<(Placeholder|AppPlaceholder|DynamicPlaceholder)\b/],
  ['hard', 'personalize-analytics', /@sitecore-content-sdk\/(personalize|events|analytics-core)|\b(personalize|trackEvent|pageView|sendEvent)\s*\(/],
  ['hard', 'browser-api', /\b(window|document|localStorage|sessionStorage|navigator|IntersectionObserver|matchMedia)\./],
  ['hard', 'router', /\b(useRouter|usePathname|useSearchParams|useParams)\s*\(/],
  ['wrap', 'list-over-datasource', /\b(fields|children|results|items|rendering\.fields|datasource|targetItems?)\??\.[\w?.]*\.map\s*\(|\.(results|children|items|targetItems)\??\.map\s*\(/],
  ['soft', 'editing-branch', /\b(isEditing|pageEditing|isPreview|mode\.isEditing|page\.mode)\b/],
  ['soft', 'i18n-dictionary', /\b(useTranslations|useI18n|useDictionary|getTranslations|t\(['"])/],
  ['wrap', 'structured-data', /application\/ld\+json|<StructuredData\b|JsonLd|itemScope/],
  ['wrap', 'route-context-fields', /\broute\??\.fields\b/],
  ['soft', 'client-directive', /['"]use client['"]/],
  ['soft', 'hook-other', /\buse(Ref|Memo|Callback|Context|Id|Locale|Sitecore)\s*\(/],
];
const THIRD_PARTY_OK = /^(react|react-dom|next(\/.*)?|@sitecore-content-sdk\/.*|clsx|classnames|tailwind-merge|class-variance-authority|zod|lucide-react|next-intl(\/.*)?|react-i18next)$/;
// Bare specifiers that are app-local aliases, not packages.
const LOCAL_ALIAS = /^(sitecore\.config|\.sitecore\/|temp\/|assets\/|lib\/|components\/|src\/|@\/|utils\/|hooks\/|helpers\/)/;
// SDK plumbing wrappers (CompatibleLink, CdpPageView …) are primitives, not logic to inherit.
const PLUMBING = /[\\/]components[\\/](atoms|ui|content-sdk)[\\/]/;

// Leaf primitives → the atom that would cover them.
const PRIMS = [
  ['Heading', /<Text\b[^>]*\btag=\{?['"]h[1-6]['"]|<h[1-6]\b/g],
  ['Paragraph', /<RichText\b|<ContentSdkRichText\b|<Text\b(?![^>]*\btag=\{?['"]h[1-6])|<p\b/g],
  ['Image', /<(NextImage|ContentSdkImage|Image|img)\b/g],
  ['Button/Link', /<(Link|ContentSdkLink|CompatibleLink|NextLink|a|button)\b/g],
  ['Date', /<DateField\b/g],
  ['List', /<(ul|ol|li)\b/g],
  ['Media(video/iframe)', /<(video|iframe|audio)\b/g],
];
const LAYOUT_RE = /className=\{?[`'"][^`'"]*\b(flex|grid|gap-|stack|row|col-|columns|wrap|container)\b/g;

function analyse(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const reasons = [];
  const addSignals = (code, via) => {
    for (const [kind, name, re] of SIGNALS) for (const hit of findAll(code, re)) reasons.push({ kind, name, line: hit.line, via, text: hit.text });
  };
  addSignals(src, null);

  // imports: third-party widgets + one-level local follow
  const imports = [...src.matchAll(/import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => ({ spec: m[1], line: lineOf(src, m.index), typeOnly: /^import\s+type\b/.test(m[0]) }));
  const followed = [];
  const followedSrc = [];
  for (const imp of imports) {
    if (imp.typeOnly) continue;
    const local = resolveLocal(imp.spec, file);
    if (local) {
      if (PLUMBING.test(local)) continue;
      followed.push(path.relative(SRC, local).split(path.sep).join('/'));
      const before = reasons.length;
      const localSrc = stripComments(fs.readFileSync(local, 'utf8'));
      followedSrc.push(localSrc);
      addSignals(localSrc, path.relative(SRC, local).split(path.sep).join('/'));
      // Derived logic in a helper is at least soft: the Document cannot call it.
      if (reasons.length === before && /^lib\//.test(path.relative(SRC, local).split(path.sep).join('/')) && !/\.props(\.ts)?$|component-props/.test(local))
        reasons.push({ kind: 'soft', name: 'local-helper-logic', line: imp.line, via: null, text: imp.spec });
    } else if (!imp.spec.startsWith('.') && !THIRD_PARTY_OK.test(imp.spec) && !LOCAL_ALIAS.test(imp.spec) && !/\.(css|scss)$/.test(imp.spec)) {
      reasons.push({ kind: 'hard', name: 'third-party-widget', line: imp.line, via: null, text: imp.spec });
    }
  }

  const prims = {};
  // Markup delegated to a local module (lib/ui/*) still counts toward the atom inventory.
  const markup = [src, ...followedSrc].join('\n');
  for (const [atom, re] of PRIMS) { const n = (markup.match(re) || []).length; if (n) prims[atom] = n; }
  const layoutHits = (markup.match(LAYOUT_RE) || []).length;
  if (layoutHits) prims['Stack(container)'] = layoutHits;

  const exportsNamed = [...src.matchAll(/export\s+(?:const|function)\s+([A-Z]\w*)/g)].map((m) => m[1]);
  const variants = exportsNamed.filter((n) => n !== 'Default');
  const fields = new Set([...src.matchAll(/\bfields\??\.(\w+)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/(\w+)\??\s*:\s*(TextField|RichTextField|ImageField|LinkField|DateField|Field<[^>]+>|FileField)/g)) fields.add(m[1]);
  const jsxLines = (src.match(/^\s*<[A-Za-z]/gm) || []).length;

  const kinds = new Set(reasons.map((r) => r.kind));
  const softNames = new Set(reasons.filter((r) => r.kind === 'soft').map((r) => r.name));
  let verdict;
  if (kinds.has('hard')) verdict = 'keep-code';
  else if (kinds.has('wrap') || softNames.size >= 2 || jsxLines > 60) verdict = 'partial';
  else verdict = 'low-code-candidate';
  if (verdict !== 'keep-code' && !/<[A-Za-z]/.test(src) && followed.length) {
    verdict = 'partial';
    reasons.push({ kind: 'soft', name: 'delegates-markup', line: 1, via: null, text: `markup lives in ${followed.join(', ')}` });
  }
  if (jsxLines > 60) reasons.push({ kind: 'soft', name: 'large-jsx', line: 1, via: null, text: `${jsxLines} JSX lines` });
  return { verdict, reasons, prims, variants, fields: [...fields], jsxLines, followed };
}

// ---------- run ----------
const results = [];
const primitivesZone = [];
for (const f of all) {
  const r = rel(f);
  if (isSkipped(r)) continue;
  const zone = zoneOf(r);
  if (zone === 'component') results.push({ file: r, component: path.basename(r).split('.')[0], ...analyse(f) });
  else primitivesZone.push({ file: r, zone });
}

const counts = { 'low-code-candidate': 0, partial: 0, 'keep-code': 0 };
for (const r of results) counts[r.verdict]++;

// Atom inventory: frequency over components that are not keep-code, then greedy cumulative coverage.
const pool = results.filter((r) => r.verdict !== 'keep-code');
const freq = {};
for (const r of pool) for (const a of Object.keys(r.prims)) freq[a] = (freq[a] || 0) + 1;
const ranked = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([a]) => a);
const inventory = [];
const chosen = new Set();
for (const a of ranked) {
  chosen.add(a);
  const covered = pool.filter((r) => Object.keys(r.prims).length && Object.keys(r.prims).every((p) => chosen.has(p))).length;
  inventory.push({ atom: a, usedBy: freq[a], cumulativeCoverage: pool.length ? Math.round((covered / pool.length) * 100) : 0 });
}
const KIT = new Set(['Heading', 'Paragraph', 'Image', 'Button/Link', 'Number', 'Stack(container)']);
const containerRecurs = (freq['Stack(container)'] || 0) >= 2;
const summary = {
  app: path.resolve(appDir), scanned: results.length, counts,
  inventory: inventory.map((i) => ({ ...i, inContentKit: KIT.has(i.atom) })),
  notes: [
    ...(containerRecurs ? [`Container layout recurs in ${freq['Stack(container)']} candidate components: Content Kit's Container is a generic flex wrapper with free CSS values; build a governed Stack first if composers should only pick tokens.`] : []),
    ...(ranked.filter((a) => !KIT.has(a)).map((a) => `Atom "${a}" is not in Content Kit's set (Heading, Paragraph, Image, Button, Number, Container): author it.`)),
  ],
  skippedZones: primitivesZone,
};

// One entry per signal and source: first line, plus how many more hits.
const RANK = { hard: 0, wrap: 1, soft: 2 };
const fmtReasons = (r) => {
  if (!r.reasons.length) return '—';
  const groups = new Map();
  for (const x of r.reasons) {
    const k = `${x.kind}:${x.name}@${x.via ? x.via + ':' : ''}`;
    const g = groups.get(k);
    if (g) g.n++; else groups.set(k, { kind: x.kind, line: x.line, n: 0 });
  }
  return [...groups].sort((a, b) => RANK[a[1].kind] - RANK[b[1].kind])
    .map(([k, g]) => `${k}${g.line}${g.n ? `(+${g.n})` : ''}`).join(', ');
};
const order = { 'low-code-candidate': 0, partial: 1, 'keep-code': 2 };
results.sort((a, b) => order[a.verdict] - order[b.verdict] || a.file.localeCompare(b.file));

if (asMd) {
  const out = [];
  out.push(`# Atomic design assessment — ${path.basename(path.resolve(appDir))}`, '');
  out.push(`Scanned ${results.length} component files: **${counts['low-code-candidate']} low-code-candidate · ${counts.partial} partial · ${counts['keep-code']} keep-code**.`, '');
  out.push('| Component file | Verdict | Primitives | Variants | Fields | Reasons |', '|---|---|---|---|---|---|');
  for (const r of results) out.push(`| ${r.file} | ${r.verdict} | ${Object.entries(r.prims).map(([k, v]) => `${k}×${v}`).join(', ') || '—'} | ${r.variants.join(', ') || '—'} | ${r.fields.join(', ') || '—'} | ${fmtReasons(r)} |`);
  out.push('', '## Atom inventory proposal (over non-keep-code components)', '', '| Atom | Used by | Cumulative coverage | In Content Kit |', '|---|---|---|---|');
  for (const i of summary.inventory) out.push(`| ${i.atom} | ${i.usedBy} | ${i.cumulativeCoverage}% | ${i.inContentKit ? 'yes' : 'no'} |`);
  if (summary.notes.length) out.push('', '## Notes', '', ...summary.notes.map((n) => `- ${n}`));
  if (primitivesZone.length) out.push('', `Skipped zones (existing primitives / SDK plumbing / atoms): ${primitivesZone.map((p) => p.file).join(', ')}`);
  console.log(out.join('\n'));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const W = Math.max(16, ...results.map((r) => r.file.length)) + 2;
  console.log(`${pad('COMPONENT FILE', W)}${pad('VERDICT', 20)}REASONS`);
  for (const r of results) console.log(`${pad(r.file, W)}${pad(r.verdict, 20)}${fmtReasons(r)}`);
  console.log(`\n${results.length} components: ${counts['low-code-candidate']} low-code-candidate, ${counts.partial} partial, ${counts['keep-code']} keep-code`);
  console.log('Atom inventory (rank · atom · used by · cumulative coverage · in Content Kit):');
  summary.inventory.forEach((i, n) => console.log(`  ${n + 1}. ${pad(i.atom, 22)}${pad(i.usedBy, 4)}${pad(i.cumulativeCoverage + '%', 6)}${i.inContentKit ? 'kit' : 'author it'}`));
  for (const n of summary.notes) console.log(`NOTE: ${n}`);
}
if (jsonOut) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify({ summary, components: results }, null, 2));
  } catch (e) {
    console.error(`scan-atomic-candidates: cannot write ${jsonOut}: ${e.message}`);
    process.exit(2);
  }
}
process.exit(0);
