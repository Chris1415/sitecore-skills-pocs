#!/usr/bin/env node
/**
 * audit-component-authorability.mjs — score a Content SDK head app against
 * the authorability bar (an author can find and change every value). Read-only: parses the component map
 * and `src/components/` only, no tenant auth, no network, no mutation.
 *
 *   node scripts/audit-component-authorability.mjs --app <path-to-head-app>
 *   node scripts/audit-component-authorability.mjs --app <path> --json
 *   node scripts/audit-component-authorability.mjs --app <path> --quiet
 *
 * Exit 1 if any registered component is un-authorable and unwaived — so it
 * works as a delivery-loop gate.
 *
 * WHY THIS EXISTS. An un-authorable component is invisible to every other
 * signal: it renders, `next build` succeeds, unit tests mocking `fields` pass
 * identically whether or not the component reads them, code review sees clean
 * code, and the components map screenshots beautifully. One brand shipped 17 of
 * 21 renderings with no inline editing at all — past 704 unit tests, 88 e2e
 * tests, four code reviews and a full test pass. Nothing caught it until a
 * person clicked a heading in Pages. This is that missing signal.
 *
 * WHAT IT CAN AND CANNOT SEE. It proves a component renders NO field
 * components (mechanism 1/2 — the systemic ones), and flags a single field
 * rendered as raw `.value` beside correct ones. It cannot prove the fields it
 * does render are the right ones, nor that inline editing actually works.
 * One real Pages-canvas check per component is still required.
 *
 * AXES:
 *   no-field-components   registered component renders no <Text|RichText|Image|Link>
 *   wrong-import          field components imported from /react
 *   unmount-on-empty      component returns null before rendering anything (warn)
 *   bare-hasvalue-guard   field render guarded without an isEditing escape (warn)
 *   raw-field-value       a field's raw `.value` rendered outside a field component
 *                         (JSX child or non-SDK attribute); waivable per FIELD
 *   literal-microcopy     a hard-coded visitor-facing string (JSX text, a literal
 *                         aria-label / alt / title / placeholder) — the home for these is the
 *                         Sitecore Dictionary (warn; waivable per string)
 *   atom-plain-string     a beta.atoms catalog prop carrying authored copy as
 *                         z.string() instead of a *FieldSchema (warn; src/atoms/ only)
 *
 * Rule numbers (40, 80, 86, 87, 88) name the source framework's rules; the skill's SKILL.md
 * states each one in plain terms. Run from the skill directory: node scripts/<name>.mjs …
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve as resolveFromCwd } from 'node:path';
// A host repo may plug in its own resolver (e.g. a products mount) before importing this file;
// standalone, a path resolves against the working directory.
const resolveLogical = (p) => (globalThis.__componentReviewResolvePath ?? resolveFromCwd)(String(p));

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const AS_JSON = argv.includes('--json');
const QUIET = argv.includes('--quiet');
// Resolve the target through the host resolver plugged in above (cwd when standalone).
const APP = arg('app', null) === null ? null : resolveLogical(arg('app', null));

if (!APP) {
  console.error('Usage: node audit-component-authorability.mjs --app <path-to-head-app> [--json] [--quiet]');
  process.exit(2);
}
if (!existsSync(APP)) { console.error(`No such app directory: ${APP}`); process.exit(2); }

const COMPONENTS_DIR = join(APP, 'src', 'components');
if (!existsSync(COMPONENTS_DIR)) {
  console.error(`Not a Content SDK head app (no src/components/): ${APP}`);
  process.exit(2);
}

const IGNORE_FILE = '.authorability-ignore.json';
const SDK_PKG = '@sitecore-content-sdk/nextjs';
const SDK_PKG_REACT = '@sitecore-content-sdk/react';
const FIELD_COMPONENTS = ['Text', 'RichText', 'Image', 'Link', 'DateField', 'File'];

/**
 * Scaffold-provided infrastructure that has no authored fields BY DESIGN and
 * ships in every App Router app. Exempt built-in, so no app needs the same
 * boilerplate waiver. Anything the team writes is NOT on this list.
 */
const SCAFFOLD_EXEMPT = new Set([
  'PartialDesignDynamicPlaceholder',
  'BYOCWrapper',
  'FEaaSWrapper',
  'Form',
]);

/* ---------------------------------------------------------------- helpers */

/** Every .ts/.tsx file under a directory, recursively, excluding tests. */
function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * The component map is the authority on what is a RENDERING. A file under
 * src/components/ that the map does not register is a support file, and
 * holding it to the authorability bar would be noise.
 *
 * Returns `Map<componentName, string[] modulePaths>`. The map key is the
 * rendering's `componentName` and does NOT have to match the folder — the SDK
 * sanitizes import aliases while preserving the key, so `'Search'` can resolve
 * to `Search/Search.tsx` + `Search/Search.IntentFirst.tsx`, and
 * `'PartialDesignDynamicPlaceholder'` to a kebab-case folder.
 */
function registeredComponents() {
  const found = new Map();
  const candidates = [
    join(APP, '.sitecore', 'component-map.ts'),
    join(APP, '.sitecore', 'component-map.client.ts'),
    join(APP, 'src', 'lib', 'component-map.ts'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');

    // alias -> module specifier, for local imports only
    const aliasPath = new Map();
    for (const m of src.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/g)) {
      if (/^(src\/|\.\.?\/)/.test(m[2])) aliasPath.set(m[1], m[2]);
    }

    // Entry forms the SDK has emitted across versions:
    //   ['Name', { ...Alias }]      (array-tuple Map ctor — current)
    //   Name: Alias,                (object literal)
    //   componentMap.set('Name', X) (imperative)
    const entries = [
      ...src.matchAll(/\[\s*['"]([^'"]+)['"]\s*,([^\]]*)\]/g),
      ...src.matchAll(/^\s*['"]?([A-Za-z][\w .-]*)['"]?\s*:\s*([^,\n]*)/gm),
      ...src.matchAll(/\.set\(\s*['"]([^'"]+)['"]\s*,([^)]*)\)/g),
    ];
    for (const m of entries) {
      const name = m[1].trim();
      if (!name || name === 'default') continue;
      const aliases = [...(m[2] ?? '').matchAll(/\b(\w+)\b/g)].map((a) => a[1]);
      const paths = aliases.map((a) => aliasPath.get(a)).filter(Boolean);
      // No local import behind it → an SDK built-in (BYOCWrapper, Form, …).
      if (paths.length === 0) continue;
      const prev = found.get(name) ?? [];
      found.set(name, [...new Set([...prev, ...paths])]);
    }
  }
  return found;
}

/** Resolve a module specifier (`src/components/X/Y`) to a real file. */
function resolveModule(spec) {
  const rel = spec.replace(/^src\//, '').replace(/^\.\//, '');
  for (const ext of ['.tsx', '.ts']) {
    const p = join(APP, 'src', rel + ext);
    if (existsSync(p)) return p;
  }
  const dir = join(APP, 'src', rel);
  if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  return null;
}

/**
 * Follow LOCAL imports out of a component's entry files.
 *
 * >>> WHY: A COMPONENT'S FIELDS OFTEN AREN'T IN ITS OWN FILE <<< (2026-08-11)
 * A server component must not become a client component just
 * to read edit mode, so the standard shape here is a thin SERVER wrapper that
 * fetches, plus a CLIENT presenter under `src/lib/` that renders the fields.
 * `CityMastheadSwitch` is exactly that: the wrapper holds no JSX fields, while
 * `src/lib/city/CityMastheadSwitchTabs.tsx` renders `<Text>` and `<RichText>`.
 * Scanning only the mapped entry file reported it as un-authorable — a FALSE
 * DEFECT on a component that is fully inline-editable.
 *
 * That failure mode is worse than a miss: a gate with false positives gets
 * ignored, and then the real defects hide in the noise it generated.
 *
 * Bounded deliberately — local specifiers only (`src/…`, `./…`, `../…`), never
 * `node_modules`, depth-capped, and cycle-safe via `seen`. The cap keeps this
 * from silently absorbing half the app into one component's score: a field
 * component five hops away is not "on" the component in any sense an author
 * would recognise.
 */
const IMPORT_DEPTH = 2;

function followLocalImports(entryFiles, depth = IMPORT_DEPTH, seen = new Set()) {
  const out = [];
  for (const file of entryFiles) {
    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
    if (depth <= 0) continue;

    const src = readFileSync(file, 'utf8');
    const next = [];
    for (const m of src.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!/^(src\/|\.\.?\/)/.test(spec)) continue; // local only
      const resolved = spec.startsWith('src/')
        ? resolveModule(spec)
        : resolveModule('src/' + relative(join(APP, 'src'), join(dirname(file), spec)).split(sep).join('/'));
      if (!resolved) continue;
      if (statSync(resolved).isDirectory()) next.push(...sourceFiles(resolved));
      else next.push(resolved);
    }
    out.push(...followLocalImports(next, depth - 1, seen));
  }
  return [...new Set(out)];
}

/**
 * Resolve a component to its source files — by map path when known, else by
 * folder name. `follow: false` returns ONLY the component's own files (see
 * auditComponent's two-scope note).
 */
function filesForComponent(name, modulePaths, { follow = true } = {}) {
  const expand = (fs) => (follow ? followLocalImports([...new Set(fs)]) : [...new Set(fs)]);

  const out = [];
  for (const spec of modulePaths ?? []) {
    const resolved = resolveModule(spec);
    if (!resolved) continue;
    if (statSync(resolved).isDirectory()) out.push(...sourceFiles(resolved));
    else out.push(resolved);
  }
  if (out.length) return expand(out);

  const folder = join(COMPONENTS_DIR, name);
  if (existsSync(folder) && statSync(folder).isDirectory()) return expand(sourceFiles(folder));
  for (const ext of ['.tsx', '.ts']) {
    const flat = join(COMPONENTS_DIR, name + ext);
    if (existsSync(flat)) return expand([flat]);
  }
  return [];
}

function readIgnores() {
  const file = join(APP, IGNORE_FILE);
  if (!existsSync(file)) return { components: {}, fields: {}, microcopy: {}, atoms: {} };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Bad ${IGNORE_FILE}: ${e.message}`); process.exit(2); }
  const take = (section, label) => {
    const out = {};
    for (const [name, entry] of Object.entries(parsed[section] ?? {})) {
      const reason = typeof entry === 'string' ? entry : entry?.reason;
      if (!reason || !String(reason).trim()) {
        console.error(`${IGNORE_FILE}: ${label} "${name}" has no reason. Every waiver needs its own reason.`);
        process.exit(2);
      }
      out[name] = String(reason).trim();
    }
    return out;
  };
  // `fields` keys are `<Component>.<Field>`: an exception is per field, never per component.
  // `microcopy` keys are `<Component>::<literal>` (per string); `atoms` keys are `<Atom>.<prop>`.
  return {
    components: take('components', 'component'),
    fields: take('fields', 'field'),
    microcopy: take('microcopy', 'microcopy string'),
    atoms: take('atoms', 'atom prop'),
  };
}

/* ------------------------------------------------------------------ audit */

/**
 * Strip comments before ANY pattern runs.
 *
 * >>> WHY: THIS AUDIT WAS FLAGGING THE .d.ts CITATION AGENTS MUST WRITE <<< (2026-08-11)
 * Every check below used to scan the raw file, so a `.d.ts` citation in a
 * doc comment — `source: node_modules/@sitecore-content-sdk/react/types/...`,
 * which agents are told to write for every SDK shape — was reported as a
 * `wrong-import` defect. One brand's `HeroMediaBand` was marked
 * un-authorable on the strength of a comment, with no such import anywhere in
 * the file. Two requirements in direct contradiction, resolved by the
 * scanner being wrong.
 *
 * The false NEGATIVE is the more dangerous half and the reason this is applied
 * to every axis rather than just the import check: `usesFieldComponents()`
 * confirms a JSX usage with `<Text[\s/>]`, and a component that imports `Text`
 * for a type and only MENTIONS `<Text ...>` in a comment would have been
 * scored as inline-editable while rendering nothing of the sort — a safety
 * audit passing a component precisely because someone documented the hazard.
 *
 * The `[^:]` guard keeps `https://` inside a string from being read as a
 * line comment (same form as the head app's own cache-posture scan).
 */
function stripComments(src) {
  // Block comments keep their newlines so raw-field-value can report a real line.
  return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** A REAL import of the /react entry point — not a mention of the string. */
const REACT_IMPORT_RE = /(?:import|require)\s*[^;\n]*['"]@sitecore-content-sdk\/react['"]/;

/** Does this source text import AND use at least one SDK field component? */
function usesFieldComponents(src) {
  const imports = new Set();
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"]@sitecore-content-sdk\/(?:nextjs|react)['"]/g)) {
    for (const spec of m[1].split(',')) {
      const local = spec.trim().split(/\s+as\s+/).pop().trim();
      if (local) imports.add(local);
    }
  }
  const fieldImports = [...imports].filter((i) => FIELD_COMPONENTS.includes(i));
  if (fieldImports.length === 0) return false;
  // Imported is not rendered — require a JSX usage so a stray type-only
  // import cannot pass the gate.
  return fieldImports.some((c) => new RegExp(`<${c}[\\s/>]`).test(src));
}

/** What an authoring-mode branch looks like once resolved to real code. */
const AUTHORING_SIGNAL_RE = /\bisEditing\b|\bisPreview\b/;

/**
 * Source of ONE top-level exported symbol, brace-matched.
 *
 * Body-scoped on purpose. Testing the whole module would credit every symbol
 * it exports: `src/lib/roast-curve/render.tsx` exports both `isAuthoringMode`
 * and `CurveRejectedPanel`, and a component importing only the latter must NOT
 * be read as having an authoring branch.
 */
function symbolBody(src, name) {
  const m = src.match(
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\s*[:=]`)
  );
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open < 0) return src.slice(m.index, m.index + 400);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  return src.slice(m.index);
}

/**
 * Does this component branch on authoring/preview mode at all?
 *
 * Corrected 2026-08-15. The check was `/isEditing/.test(own)` — a LITERAL
 * grep of the component's own files. Every project that wraps the mode test in
 * its own helper therefore failed it while being perfectly correct: one brand's
 * canonical guard is `isAuthoringMode(page)` (which returns
 * `page?.mode?.isEditing || page?.mode?.isPreview`), and **18 of 23**
 * `unmount-on-empty` warnings on that app were this false positive —
 * `BrewGuideIndex` was flagged with the correct branch three lines above its
 * `return null`. A gate that is 78% noise is a gate nobody reads, and the real
 * defects hide in the noise it generated.
 *
 * So: literal first (unchanged), then resolve any LOCALLY-imported symbol the
 * component actually CALLS to its definition body and test that. Import
 * resolution reuses the same depth-2 follow the field-component axis uses; the
 * render-contract axes stay scoped to the component's own files for everything
 * else, which is the distinction auditComponent's two-scope note protects.
 */
/** Locally-imported symbols this source actually CALLS (type-only imports excluded). */
function calledLocalImports(own, ownFiles) {
  const imported = new Set();
  for (const f of ownFiles ?? []) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"](?:src\/|\.\.?\/)[^'"]+['"]/g)) {
      for (const spec of m[1].split(',')) {
        const local = spec.trim().split(/\s+as\s+/).pop().trim();
        if (local) imported.add(local);
      }
    }
  }
  return [...imported].filter((id) => new RegExp(`\\b${id}\\s*\\(`).test(own));
}

/** Does `id`'s definition, in any followed file, test authoring/preview mode? */
function resolvesToAuthoringHelper(id, followedFiles) {
  for (const f of followedFiles ?? []) {
    const body = symbolBody(stripComments(readFileSync(f, 'utf8')), id);
    if (body && AUTHORING_SIGNAL_RE.test(body)) return true;
  }
  return false;
}

function hasAuthoringBranch(own, ownFiles, followedFiles) {
  if (AUTHORING_SIGNAL_RE.test(own)) return true;
  return calledLocalImports(own, ownFiles).some((id) => resolvesToAuthoringHelper(id, followedFiles));
}

/**
 * Local names bound to an authoring-mode test — `const authoring =
 * isAuthoringMode(page)`. Components hoist the test into a variable and then
 * guard on THAT, so a pattern looking only for the call (or only for
 * `isEditing`) cannot see the escape at the point where it is used.
 */
function authoringAliases(own, ownFiles, followedFiles) {
  const names = new Set();
  const called = calledLocalImports(own, ownFiles);
  for (const m of own.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const name = m[1];
    // The initialiser ends at the next statement boundary OR the next
    // declaration keyword. Without the keyword stop, a greedy `[^;\n]+` on
    // `export const C = (props) => { const authoring = isAuthoringMode(page)`
    // swallows the inner declaration and binds `C` instead of `authoring` —
    // caught by this file's own self-check while writing it.
    const rest = own.slice(m.index + m[0].length);
    const stop = rest.search(/[;\n]|\b(?:const|let|var)\b/);
    const init = stop === -1 ? rest : rest.slice(0, stop);

    if (AUTHORING_SIGNAL_RE.test(init)) {
      names.add(name);
      continue;
    }
    const call = init.match(/\b([A-Za-z_$][\w$]*)\s*\(/);
    if (call && called.includes(call[1]) && resolvesToAuthoringHelper(call[1], followedFiles)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Is every `hasValue` guard paired with an authoring escape?
 *
 * Corrected 2026-08-15, same root cause as hasAuthoringBranch above. The check
 * was `!/isEditing\s*\|\|\s*hasValue/` — ONE literal spelling of the escape.
 * `StatCounter` and `BrandFigureStrip` both write the logically identical
 * `if (!hasValue && !authoring) return null;` and both were flagged, making the
 * axis 2-for-2 false on this app. Now: find each STATEMENT that guards on
 * hasValue and require an authoring term (literal, or a local alias bound to an
 * authoring helper) in that same statement — so an authoring branch elsewhere in
 * the file still does NOT excuse a guard that hides this field from the author.
 */
function hasValueGuardIsBare(own, ownFiles, followedFiles) {
  const guards = own.split(/[;{}\n]/).filter((s) => /\bhasValue\b\s*&&|&&\s*!?\s*\bhasValue\b/.test(s));
  if (guards.length === 0) return false;
  const aliases = [...authoringAliases(own, ownFiles, followedFiles)];
  const escaped = (stmt) =>
    AUTHORING_SIGNAL_RE.test(stmt) || aliases.some((a) => new RegExp(`\\b${a}\\b`).test(stmt));
  return guards.some((stmt) => !escaped(stmt));
}

/* ------------------------------------------------- raw-field-value axis */

/**
 * Does the component RENDER a field's raw `.value`, bypassing the SDK field
 * component, even though it renders other fields correctly?
 *
 * Added 2026-10-01. `no-field-components` only asks whether ANY field
 * component renders, so the consent banner passed with `<Text field={ReopenLabel}>`
 * swapped for `{fields.ReopenLabel?.value}` and for `{String(…)}`: nine fields
 * editable, the tenth plain text with no chrome (no inline editing, per field).
 *
 * What counts as RENDERING: the value reaches a JSX child expression, or an
 * attribute of a non-SDK element (a content attribute on a DOM tag, any non-
 * structural prop on a custom component). What does NOT: a guard (`v && …`,
 * `v || isEditing ? … : …`, `!v`), a comparison, a value transformed by any
 * function but `String` / `.map` (derived data), `key` / `className` / handlers,
 * or an attribute copy of a field that also renders through a field component. Forms
 * followed: `fields.X.value`, `props.fields.X?.value`, `fields['X'].value`,
 * destructured or aliased field objects, and a local bound to the value.
 * Known limit: a field object passed under another prop name to a presenter
 * that prints `.value` is not traced. Per-field waivers: `.authorability-ignore.json`
 * → `fields` → `"<Component>.<Field>": { reason }`.
 */
const ID = '[A-Za-z_$][\\w$]*';
const DOT = '\\s*(?:\\?\\.|\\.)\\s*';
const FIELD_REF = `\\bfields${DOT}(${ID})|\\bfields\\s*(?:\\?\\.)?\\s*\\[\\s*['"]([^'"]+)['"]\\s*\\]`;
const DOM_CONTENT_ATTRS = new Set([
  'alt', 'title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'href', 'src',
  'srcSet', 'poster', 'content', 'value', 'label', 'cite', 'children', 'dangerouslySetInnerHTML',
]);
const STRUCTURAL_PROPS = /^(?:key|ref|className|class|style|id|on[A-Z]\w*|data-[\w-]+|aria-(?!label$|description$)[\w-]+|role|type|tabIndex|htmlFor|checked|disabled|hidden|width|height|variant|size|tone|theme|as|tag|index|layout|loading|priority|sizes|fill|target|rel)$/;

/** SDK field-component tag names as imported in THIS file (`Image` may be next/image). */
function sdkTagNames(src) {
  const tags = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@sitecore-content-sdk\/(?:nextjs|react)['"]/g)) {
    for (const spec of m[1].split(',')) {
      const [imported, local] = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/).map((s) => s?.trim());
      if (FIELD_COMPONENTS.includes(imported)) tags.add(local || imported);
    }
  }
  return tags;
}

/** Index of the innermost `{` enclosing `pos` (template `${` is transparent), or -1. */
function enclosingBrace(src, pos) {
  let depth = 0;
  for (let k = pos - 1; k >= 0; k--) {
    const c = src[k];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth > 0) { depth--; continue; }
      if (src[k - 1] === '$') continue; // template literal: the value flows into the string
      return k;
    }
  }
  return -1;
}

/** Name of the JSX tag whose opening `<` precedes `pos` at brace depth 0, or null. */
function openTagBefore(src, pos) {
  let depth = 0;
  for (let k = pos - 1; k >= 0; k--) {
    const c = src[k];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) return null; depth--; }
    else if (depth === 0) {
      if (c === ';') return null;
      if (c === '>' && src[k - 1] !== '=') return null;
      if (c === '<') {
        if (/[\w$]/.test(src[k - 1] ?? '')) return null; // TS generic, not JSX
        const m = src.slice(k + 1).match(/^([A-Za-z][\w.]*)/);
        return m ? m[1] : null;
      }
    }
  }
  return null;
}

/** Classify the `{` at `b`: { kind: 'child' } | { kind: 'attr', tag, attr } | null. */
function jsxContainer(src, b) {
  let k = b - 1;
  while (k >= 0 && /\s/.test(src[k])) k--;
  if (src[k] === '=' && src[k - 1] !== '=' && src[k - 1] !== '!') {
    const m = src.slice(0, k).match(/\s([\w:-]+)\s*$/);
    if (!m) return null;
    const tag = openTagBefore(src, k - m[0].length + 1);
    return tag ? { kind: 'attr', tag, attr: m[1] } : null;
  }
  // JSX child: walk back over text (no `<>{}`) to the previous `>` or `}`.
  let j = b - 1;
  while (j >= 0 && !'<>{}'.includes(src[j])) j--;
  const run = src.slice(j + 1, b);
  if (src[j] === '>') {
    if (src[j - 1] === '=') return null; // arrow
    // Find the tag's `<`; an identifier right before it is a TS generic.
    let depth = 0;
    for (let k2 = j - 1; k2 >= 0; k2--) {
      const c = src[k2];
      if (c === '}') depth++;
      else if (c === '{') depth--;
      else if (c === '<' && depth === 0) {
        if (/[\w$]/.test(src[k2 - 1] ?? '')) return null;
        return /^\/?[A-Za-z]|^>/.test(src.slice(k2 + 1)) || src[k2 + 1] === '>' ? { kind: 'child' } : null;
      }
    }
    return null;
  }
  if (src[j] === '}' && !/[;=(),:]/.test(run) && !/^\s*(?:else|try|finally|do)\s*$/.test(run)) return { kind: 'child' };
  return null;
}

/** Calls the raw value flows THROUGH unchanged (coercion / list render) — still raw. */
const PASSTHROUGH_CALLEES = /(?:^|[^\w$.])String\s*$|\.(?:map|flatMap)\s*$/;
const IDENTITY_METHODS = /^(?:trim|trimStart|trimEnd|toString|toUpperCase|toLowerCase|toLocaleUpperCase|toLocaleLowerCase|normalize|join)$/;

/** From `end`, does a ternary `?` or `&&` follow at depth 0 before the operand ends? */
function feedsCondition(src, end) {
  let depth = 0;
  for (let k = end; k < src.length; k++) {
    const c = src[k];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) return false; depth--; }
    else if (depth === 0) {
      if (c === ',' || c === ';' || c === ':') return false;
      // A newline ends the operand unless the next line continues the expression.
      if (c === '\n' && !/^\n\s*(?:\?(?![.?])|\|\||&&|\?\?)/.test(src.slice(k))) return false;
      if (c === '&' && src[k + 1] === '&') return true;
      if (c === '?' && src[k + 1] !== '.' && src[k + 1] !== '?' && src[k - 1] !== '?') return true;
      if (c === '<' && /^<\/?[A-Za-z>]/.test(src.slice(k))) return false; // JSX starts
    }
  }
  return false;
}

/**
 * How the occurrence [i, i+len) is consumed: 'condition' (guard, comparison),
 * 'derived' (transformed by a function, predicates included: computed data,
 * not the field's text; known limit for `compose(a.value, b.value)`), or null (the raw value itself flows on). Walks OUT through
 * enclosing parentheses, so `(v ?? '').trim() !== ''` is a guard even though
 * `v` itself is followed by `??`, and `String(v || 'x')` stays raw.
 */
function consumption(src, i, len, b) {
  let start = i;
  let end = i + len;
  for (;;) {
    const after = src.slice(end);
    const chain = after.match(/^(?:\s*(?:\?\.|\.)\s*[\w$]+|\s*(?:\?\.)?\[[^\]]*\]|\s*(?:\?\.)?\([^()]*\))*/)[0];
    if (/\.\s*length\b/.test(chain)) return 'condition';
    for (const m of chain.matchAll(/(?:\?\.|\.)\s*([\w$]+)\s*(?:\?\.)?\(/g)) if (!IDENTITY_METHODS.test(m[1])) return 'derived';
    const rest = after.slice(chain.length);
    if (/^\s*(?:[=!]==?|[<>]=?|instanceof\b|in\b)/.test(rest)) return 'condition';
    if (feedsCondition(src, end + chain.length)) return 'condition';
    const before = src.slice(Math.max(b + 1, 0), start);
    if (/(?:!|[=!]==?|[<>]=?|\btypeof)\s*$/.test(before) && !/=>\s*$/.test(before)) return 'condition';
    // Step out to the enclosing `(` between the container brace and here.
    let depth = 0;
    let open = -1;
    for (let k = start - 1; k > b; k--) {
      if (src[k] === ')') depth++;
      else if (src[k] === '(') { if (depth > 0) depth--; else { open = k; break; } }
    }
    if (open < 0) return null;
    const callee = src.slice(Math.max(b + 1, open - 40), open).match(/[\w$.?]*\s*$/)[0];
    if (callee.trim() && !PASSTHROUGH_CALLEES.test(callee)) return 'derived';
    let d = 0;
    let close = -1;
    for (let k = open; k < src.length; k++) {
      if (src[k] === '(') d++;
      else if (src[k] === ')' && --d === 0) { close = k; break; }
    }
    if (close < 0) return null;
    start = open - callee.length;
    end = close + 1;
  }
}

/** Text-only attributes: no SDK component can render them, so they count only for a field rendered nowhere else. */
const TEXT_ATTRS = new Set(['alt', 'title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'label', 'content', 'value']);

/** Is the occurrence rendered? Returns null, or 'child' / 'attr' / 'text-attr'. */
function renderedAt(src, i, len, sdkTags) {
  const b = enclosingBrace(src, i);
  if (b < 0) return null;
  const box = jsxContainer(src, b);
  if (!box) return null;
  let kind = 'child';
  if (box.kind === 'attr') {
    if (sdkTags.has(box.tag)) return null;
    const dom = /^[a-z]/.test(box.tag);
    if (dom ? !DOM_CONTENT_ATTRS.has(box.attr) : STRUCTURAL_PROPS.test(box.attr)) return null;
    kind = dom && TEXT_ATTRS.has(box.attr) ? 'text-attr' : 'attr';
  }
  return consumption(src, i, len, b) ? null : kind;
}

/** Field-object and value aliases in one file: Map<localName, { field, kind }>. */
function fieldBindings(src) {
  const objs = new Map(); // local -> field (a field OBJECT)
  const vals = new Map(); // local -> field (the raw VALUE)
  const addDestructure = (body) => {
    for (const part of body.split(',')) {
      const m = part.trim().match(new RegExp(`^(${ID})(?:\\s*:\\s*(${ID}))?(?:\\s*=[^,]*)?$`));
      if (m) objs.set(m[2] || m[1], m[1]);
    }
  };
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s*\\{([^{}]*)\\}\\s*=\\s*(?:[\\w$.?]*\\.)?fields\\b(?!\\s*(?:\\?\\.|\\.|\\[))`, 'g'))) addDestructure(m[1]);
  for (const m of src.matchAll(/\bfields\s*:\s*\{([^{}]*)\}\s*[,}]/g)) if (!/[;?]/.test(m[1])) addDestructure(m[1]);
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${ID})\\s*=\\s*(?:${FIELD_REF})\\s*(?:as\\s+${ID}\\s*)?(?=[;\\n)]|$)`, 'g'))) {
    objs.set(m[1], m[2] || m[3]);
  }
  return { objs, vals };
}

/** Every raw-value occurrence pattern in a file: [{ re, field }]. */
function valueAccessPatterns(src) {
  const { objs, vals } = fieldBindings(src);
  const pats = [{ re: new RegExp(`(?:${FIELD_REF})${DOT}value\\b`, 'g'), field: null }];
  for (const [local, field] of objs) pats.push({ re: new RegExp(`(?<![\\w$.])${local.replace(/\$/g, '\\$')}${DOT}value\\b`, 'g'), field });
  // Value aliases: `const t = <raw value expr>` where the value is not consumed as a guard.
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${ID})\\s*=\\s*([^;\\n]+)`, 'g'))) {
    const init = m[2];
    const initAt = m.index + m[0].length - init.length;
    for (const p of pats.slice()) {
      p.re.lastIndex = 0;
      const hit = p.re.exec(init);
      if (hit && !consumption(src, initAt + hit.index, hit[0].length, initAt - 1)) {
        vals.set(m[1], p.field ?? hit[1] ?? hit[2]);
        break;
      }
    }
  }
  for (const [local, field] of vals) {
    pats.push({ re: new RegExp(`(?<![\\w$.])${local.replace(/\$/g, '\\$')}\\b(?!\\s*(?:\\?\\.|\\.)\\s*value\\b)(?!\\s*:)(?!\\s*=[^=>])`, 'g'), field });
  }
  return pats;
}

/** Raw field-value renders in one (comment-stripped) source: [{ field, line }]. */
function rawFieldValues(src) {
  const sdkTags = sdkTagNames(src);
  const hits = [];
  const seen = new Set();
  for (const { re, field } of valueAccessPatterns(src)) {
    for (const m of src.matchAll(re)) {
      if (seen.has(m.index)) continue;
      const kind = renderedAt(src, m.index, m[0].length, sdkTags);
      if (!kind) continue;
      seen.add(m.index);
      hits.push({ field: field ?? m[1] ?? m[2] ?? '?', kind, line: src.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

/* ---------------------------------------------- literal-microcopy axis */

/**
 * Hard-coded visitor-facing strings: JSX text, `{'literal'}` children, and literal
 * aria-label / alt / title / placeholder values. The Sitecore Dictionary is
 * the home for fixed UI microcopy (2026-10-02); a literal is copy no author can
 * find. WARN only: a literal kept as the dictionary DEFAULT (value === key) is correct
 * and lives inside an expression, which this axis never reads. Not flagged: strings
 * with no 2-letter word, editing-only branches (author hints, not visitor copy),
 * `<style>` / `<script>` / `<code>` / `<pre>` bodies, and an empty `alt`.
 */
const MICROCOPY_ATTRS = /^(?:aria-label|aria-description|aria-roledescription|aria-valuetext|alt|title|placeholder)$/;
const WORDY = /\p{L}{2,}/u;
const RAW_TEXT_TAGS = /^(?:style|script|code|pre)$/;

/** Does the `>` at `gt` close a JSX tag (`<p …>`, `</p>`, `<br />`, `<>`)? Returns the tag name ('' for a fragment) or null. */
function jsxTagClosedAt(src, gt) {
  if (src[gt - 1] === '=' || src[gt - 1] === '-') return null; // arrow / ->
  let depth = 0;
  for (let k = gt - 1; k >= 0; k--) {
    const c = src[k];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) return null; depth--; }
    else if (depth === 0) {
      if (c === ';' || (c === '>' && k !== gt)) return null;
      if (c === '<') {
        if (/[\w$)\]]/.test(src[k - 1] ?? '')) return null; // TS generic or comparison
        if (src[k + 1] === '>') return '';
        const m = src.slice(k + 1, gt).match(/^\/?([A-Za-z][\w.-]*)/);
        return m ? m[1] : null;
      }
    }
  }
  return null;
}

/** Index of the `{` matching the `}` at `close`, or -1. */
function matchingOpen(src, close) {
  let depth = 0;
  for (let k = close; k >= 0; k--) {
    if (src[k] === '}') depth++;
    else if (src[k] === '{' && --depth === 0) return k;
  }
  return -1;
}

/**
 * Expression frames of `s` (JSX-aware): every operator is recorded with the frame it sits in,
 * and the frames still open at the end of `s` are returned innermost-last. A frame is a `(` / `[`
 * / `{` group or a JSX element's children; operators inside JSX text or tags are never recorded.
 * Operators: `&&` `||` `??`, ternary `?`, `:` `,` `;`, assignment `=`, `return`.
 */
function exprFrames(s) {
  const ops = [];
  const stack = []; // { kind: 'js' | 'jsx', at }
  const top = () => stack[stack.length - 1];
  const frameId = () => (stack.length ? top().at : -1);
  const prevSig = (k) => { let j = k - 1; while (j >= 0 && /\s/.test(s[j])) j--; return s[j] ?? ''; };
  /** End index of the JSX tag starting at `k`, honouring braces and strings in attributes. */
  const tagEnd = (k) => {
    let d = 0;
    for (let j = k + 1; j < s.length; j++) {
      const c = s[j];
      if (d === 0 && (c === '"' || c === "'")) { const e = s.indexOf(c, j + 1); if (e < 0) return -1; j = e; continue; }
      if (c === '{') d++;
      else if (c === '}') d--;
      else if (c === '>' && d === 0) return j;
    }
    return -1;
  };
  const jsxTag = (k) => {
    const end = tagEnd(k);
    if (end < 0) return s.length; // tag still open at the end of s: we are inside it
    const closing = s[k + 1] === '/';
    const selfClosing = s[end - 1] === '/';
    if (closing) { if (top()?.kind === 'jsx') stack.pop(); }
    else if (!selfClosing) stack.push({ kind: 'jsx', at: k });
    return end;
  };
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (top()?.kind === 'jsx') { // JSX children: text until a tag or an expression container
      if (c === '{') stack.push({ kind: 'js', at: k });
      else if (c === '<') k = jsxTag(k);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { const e = s.indexOf(c, k + 1); if (e < 0) break; k = e; continue; }
    if (c === '<' && /[A-Za-z>/]/.test(s[k + 1] ?? '') && !/[\w$)\]]/.test(prevSig(k))) { k = jsxTag(k); continue; }
    if ('([{'.includes(c)) { stack.push({ kind: 'js', at: k }); continue; }
    if (')]}'.includes(c)) { if (top()?.kind === 'js') stack.pop(); continue; }
    const two = s.slice(k, k + 2);
    const f = frameId();
    if (two === '&&' || two === '||' || two === '??') { ops.push({ op: two, at: k, end: k + 2, f }); k++; }
    else if (c === '?' && s[k + 1] !== '.') ops.push({ op: '?', at: k, end: k + 1, f });
    else if (c === ':' || c === ',' || c === ';') ops.push({ op: c, at: k, end: k + 1, f });
    else if (c === '=' && !/[=!<>]/.test(s[k - 1] ?? '') && !/[=>]/.test(s[k + 1] ?? '')) ops.push({ op: '=', at: k, end: k + 1, f });
    else if (s.startsWith('return', k) && !/[\w$]/.test(s[k - 1] ?? '') && !/[\w$]/.test(s[k + 6] ?? '')) ops.push({ op: 'return', at: k, end: k + 6, f });
  }
  return { ops, open: [{ kind: 'js', at: -1 }, ...stack] };
}

/**
 * Is position `i` inside a branch that renders only in editing / preview mode (author hints)?
 * `names` = the mode flags plus local aliases and authoring helpers (`isAuthoringMode(page)`).
 * Recognised: a non-negated flag as a conjunct of the `&&` chain or ternary condition that leads
 * to `i` in any enclosing expression frame (`{isEditing && …}`, `cond ? a : (isEditing && (…))`,
 * `const note = x && isEditing && (…)`, `{isEditing ? <hint/> : …}` consequent only),
 * `if (flag) { return … }` / `if (flag) return …`, and an earlier top-level `if (!flag) return …;`
 * in an enclosing block. `!isEditing && …` is visitor copy and stays in scope.
 */
function inEditingBranch(src, i, names) {
  const flag = `(?:[\\w$.?]*\\.)?(?:${names.join('|')})\\b(?:\\s*\\([^()]*\\))?`;
  const isFlag = new RegExp(`^\\(*\\s*${flag}\\s*\\)*$`);
  const guardOff = new RegExp(`\\bif\\s*\\(\\s*!\\s*\\(?\\s*${flag}\\s*\\)?\\s*\\)\\s*\\{?\\s*return\\b`);
  const guardOn = new RegExp(`\\bif\\s*\\(\\s*${flag}[^()]*\\)\\s*\\{?\\s*(?:return\\b[^;]*)?$`);
  const head = src.slice(0, i);
  const { ops, open } = exprFrames(head);
  for (let n = open.length - 1; n >= 0; n--) {
    const frame = open[n];
    const end = n + 1 < open.length ? open[n + 1].at : head.length;
    const fo = ops.filter((o) => o.f === frame.at && o.at < end);
    const last = fo[fo.length - 1];
    if (last && (last.op === '&&' || last.op === '?')) {
      let k = fo.length - 1;
      while (k > 0 && fo[k - 1].op === '&&') k--;
      const chain = head.slice(k > 0 ? fo[k - 1].end : frame.at + 1, last.at);
      if (chain.split('&&').some((part) => isFlag.test(part.trim()))) return true;
    }
    if (frame.kind === 'js' && (frame.at < 0 || head[frame.at] === '{')) {
      // the block's own statements (nested groups collapsed): an earlier `if (!flag) return …;`
      let body = head.slice(frame.at + 1, end);
      for (let prev = ''; prev !== body; ) { prev = body; body = body.replace(/\{[^{}]*\}/g, '\u0001'); }
      if (guardOff.test(body)) return true;
      // the current statement is `if (flag) return …` or `if (flag) {` (whose block holds `i`)
      const stmt = body.slice(Math.max(body.lastIndexOf(';'), body.lastIndexOf('\u0001')) + 1);
      if (guardOn.test(stmt.replace(/\s*\(?\s*<[^]*$/, ''))) return true;
    }
  }
  return false;
}

/** Name of the top-level function / const component whose body contains `i`, or null. */
function enclosingSymbol(src, i) {
  let best = null;
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*[:=])/g)) {
    if (m.index > i) break;
    best = m[1] || m[2];
  }
  return best;
}

/** Authoring flag names for a component: mode flags, local aliases, and helpers whose body tests the mode. */
function authoringNames(combined, files) {
  const names = new Set(['isEditing', 'isPreview', 'isDesignLibrary', ...authoringAliases(combined, files, files)]);
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    // small lower-case helpers that RETURN a mode test: `function isAuthoringMode(page) { return …isEditing… }`
    for (const m of src.matchAll(/\bfunction\s+([a-z_$][\w$]*)\s*\([^)]*\)[^{]*\{/g)) {
      const body = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
      if (/^[^{}]*\breturn\b[^;{}]*\b(?:isEditing|isPreview)\b/.test(body)) names.add(m[1]);
    }
    for (const m of src.matchAll(/\bconst\s+([a-z_$][\w$]*)\s*=\s*\([^)]*\)\s*(?::[^=]*)?=>\s*([^;\n]*)/g)) {
      if (/\b(?:isEditing|isPreview)\b/.test(m[2])) names.add(m[1]);
    }
  }
  return [...names];
}

/** Literal microcopy in one (comment-stripped) source: [{ text, where, line }]. `editingOnly(sym)`: a sub-component rendered only in editing. */
function literalMicrocopy(src, names = ['isEditing', 'isPreview'], editingOnly = () => false) {
  const hits = [];
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const ENT = { apos: "'", rsquo: "'", lsquo: "'", '#39': "'", quot: '"', ldquo: '"', rdquo: '"', amp: '&', middot: '·', mdash: '—', ndash: '–', hellip: '…' };
  const clean = (t) => t.replace(/&([#\w]+);/g, (_, e) => ENT[e] ?? ' ').replace(/\s+/g, ' ').trim();
  const push = (text, where, i) => {
    const t = clean(text);
    if (!WORDY.test(t) || /=>|===|&&|\|\||[;`]|\b(?:function|return|const|let|import|export|interface)\b|\bif\s*\(|^\)|\($/.test(t)) return; // code, not copy
    if (inEditingBranch(src, i, names)) return;
    const sym = enclosingSymbol(src, i);
    if (sym && editingOnly(sym)) return;
    hits.push({ text: t, where, line: lineOf(i) });
  };
  // JSX text after a tag: `<p>Read more</p>`, `<p>Hello {name}</p>`, after `<br />`
  for (const m of src.matchAll(/>([^<>{}]+)(?=[<{])/g)) {
    const tag = jsxTagClosedAt(src, m.index);
    if (tag === null || RAW_TEXT_TAGS.test(tag)) continue;
    const next = src[m.index + m[0].length];
    if (next === '<' && !/^<(?:\/|[A-Za-z>])/.test(src.slice(m.index + m[0].length))) continue;
    push(m[1], 'text', m.index + 1);
  }
  // JSX text after a child expression: `{count} items</span>`
  for (const m of src.matchAll(/\}([^<>{}]+)(?=<\/?[A-Za-z>])/g)) {
    const open = matchingOpen(src, m.index);
    if (open < 0 || jsxContainer(src, open)?.kind !== 'child') continue;
    push(m[1], 'text', m.index + 1);
  }
  // `{'Read more'}` as a JSX child
  for (const m of src.matchAll(/\{\s*(['"])([^'"\n]+)\1\s*\}/g)) {
    if (jsxContainer(src, m.index)?.kind !== 'child') continue;
    push(m[2], 'text', m.index);
  }
  // literal attribute values on JSX elements
  for (const m of src.matchAll(/\s([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(['"`])([^'"`$]*)\4\s*\})/g)) {
    if (!MICROCOPY_ATTRS.test(m[1])) continue;
    if (!openTagBefore(src, m.index + 1)) continue;
    push(m[2] ?? m[3] ?? m[5] ?? '', m[1], m.index + 1);
  }
  return hits;
}

/* -------------------------------------------------- atoms axis (beta) */

/**
 * beta.atoms catalogs (`src/atoms/`, outside src/components/ and the component map, so
 * every other axis is blind to them). A prop that carries AUTHORED COPY must use a
 * `*FieldSchema` so a Document can bind it to a datasource field (`$state: /fields/X`);
 * `z.string()` makes it a design-time literal no author can find. Content
 * props are recognised by name; styling / structural props (className, level, variant)
 * are not content. WARN: Pages inline editing inside atoms is unverified on the beta.
 */
const ATOM_CONTENT_PROP = /^(?:text|title|heading|subheading|subtitle|headline|tagline|eyebrow|kicker|label|body|copy|description|caption|content|summary|quote|alt|cta\w*|button\w*text|link\w*text)$/i;

function atomPlainStringProps(src) {
  const hits = [];
  if (!/defineAtomsCatalog\s*\(/.test(src)) return hits;
  // `Name: { props: z.object({ … })` — brace-matched object body per atom
  for (const m of src.matchAll(/\b([A-Z][\w$]*)\s*:\s*\{\s*props\s*:\s*z\.object\(\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1;
    for (let k = open; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) { close = k; break; }
    }
    if (close < 0) continue;
    const body = src.slice(open + 1, close);
    for (const p of body.matchAll(/(?:^|[,{\n])\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*z\s*\.\s*string\s*\(/g)) {
      if (!ATOM_CONTENT_PROP.test(p[1])) continue;
      hits.push({ atom: m[1], prop: p[1], line: src.slice(0, open + 1 + p.index).split('\n').length });
    }
  }
  return hits;
}

/**
 * TWO SCOPES, DELIBERATELY — they answer different questions.
 *
 *  - `deep` (entry files + local imports): "can ANY part of this component
 *    render an editable field?" A server wrapper's fields live in its client
 *    presenter, so this must follow imports or it reports false defects.
 *  - `own` (the component's own files): "does THIS component's render
 *    contract mishandle the empty state?" `return null` in an imported helper
 *    is not the component unmounting, and scoring it as such was inflating
 *    the warning count the moment import-following was added (19 → 22 with no
 *    code change). A warning you cannot act on trains people to ignore the
 *    ones you can.
 */
function auditComponent(name, files, ownFiles, fieldWaivers = {}, usedFieldWaivers = new Set(), microWaivers = {}, usedMicroWaivers = new Set()) {
  const findings = [];
  if (files.length === 0) {
    return [{ axis: 'unresolved', level: 'warn', detail: 'registered in the component map but no source file found under src/components/' }];
  }

  // Comments stripped FIRST — see stripComments(). Scanning raw source made
  // this audit both over- and under-report, in opposite directions.
  const read = (fs) => stripComments(fs.map((f) => readFileSync(f, 'utf8')).join('\n'));
  const combined = read(files);
  const own = read(ownFiles?.length ? ownFiles : files);

  if (!usesFieldComponents(combined)) {
    findings.push({
      axis: 'no-field-components',
      level: 'defect',
      detail: 'renders no <Text>/<RichText>/<Image>/<Link> — nothing on this component is inline-editable',
    });
  }
  // Per FILE so the finding names a line; deep scope, since a presenter renders too.
  const raw = new Map(); // field -> [file:line]
  // An attribute copy (aria-label, alt, a presenter's label prop) is fine when the same field also
  // renders through a field component here: the author can find and edit it. A visible child is not.
  const editableElsewhere = (field) => new RegExp(String.raw`\bfield=\{[^}]*\b${field}\b`).test(combined);
  for (const f of files) {
    for (const h of rawFieldValues(stripComments(readFileSync(f, 'utf8')))) {
      if (h.kind !== 'child' && editableElsewhere(h.field)) continue;
      const key = `${name}.${h.field}`;
      if (fieldWaivers[key]) { usedFieldWaivers.add(key); continue; }
      raw.set(h.field, [...(raw.get(h.field) ?? []), `${relative(APP, f).split(sep).join('/')}:${h.line}`]);
    }
  }
  for (const [field, where] of raw) {
    findings.push({
      axis: 'raw-field-value',
      level: 'defect',
      field,
      detail: `renders ${field}'s raw .value outside an SDK field component (${where.join(', ')}) — no editing chrome on that field; use <Text>/<RichText>/<Image>/<Link>/<DateField>, or waive "${name}.${field}" with a reason`,
    });
  }
  if (REACT_IMPORT_RE.test(combined)) {
    findings.push({
      axis: 'wrong-import',
      level: 'defect',
      detail: `imports from ${SDK_PKG_REACT} — use ${SDK_PKG} (/react breaks next build)`,
    });
  }
  // Resolved once — both render-contract axes ask the same question, and the
  // answer costs a file read per local import.
  const authoringBranch = hasAuthoringBranch(own, ownFiles?.length ? ownFiles : files, files);

  if (/\breturn\s+null\b/.test(own) && !authoringBranch) {
    findings.push({
      axis: 'unmount-on-empty',
      level: 'warn',
      detail: 'returns null with no authoring-mode branch — an unauthored component may have no click target in the canvas',
    });
  }
  // The ESCAPE must sit on the guard STATEMENT itself, never merely somewhere in
  // the file — a component can branch on authoring elsewhere and still hide THIS
  // field from the author. See hasValueGuardIsBare.
  if (hasValueGuardIsBare(own, ownFiles?.length ? ownFiles : files, files)) {
    findings.push({
      axis: 'bare-hasvalue-guard',
      level: 'warn',
      detail: 'guards a field on hasValue with no isEditing escape — an empty field is hidden from the author',
    });
  }
  // literal-microcopy: deep scope (a presenter's strings are this component's copy), per string.
  const names = authoringNames(combined, files);
  const srcs = files.map((f) => stripComments(readFileSync(f, 'utf8')));
  const memo = new Map();
  const ownSet = new Set(ownFiles?.length ? ownFiles : files);
  // Skip a sub-component's strings when every JSX use of it here sits in an editing branch (an
  // author hint), or — for one defined in a FOLLOWED file — when this component never renders it.
  const editingOnly = (sym, followed) => {
    if (!/^[A-Z]/.test(sym) || sym === name) return false;
    if (!memo.has(sym)) {
      const uses = srcs.flatMap((s) => [...s.matchAll(new RegExp(`<${sym}\\b`, 'g'))].map((m) => [s, m.index]));
      memo.set(sym, { none: uses.length === 0, editing: uses.length > 0 && uses.every(([s, at]) => inEditingBranch(s, at, names)) });
    }
    const u = memo.get(sym);
    return u.editing || (followed && u.none);
  };
  const micro = new Map(); // text -> [file:line]
  for (const [n, f] of files.entries()) {
    for (const h of literalMicrocopy(srcs[n], names, (sym) => editingOnly(sym, !ownSet.has(f)))) {
      const key = `${name}::${h.text}`;
      if (microWaivers[key]) { usedMicroWaivers.add(key); continue; }
      micro.set(h.text, [...(micro.get(h.text) ?? []), `${relative(APP, f).split(sep).join('/')}:${h.line}`]);
    }
  }
  if (micro.size) {
    findings.push({
      axis: 'literal-microcopy',
      level: 'warn',
      strings: [...micro].map(([text, where]) => ({ text, where })),
      detail: `${micro.size} hard-coded visitor-facing string(s): ${[...micro.keys()].slice(0, 4).map((t) => JSON.stringify(t.length > 40 ? `${t.slice(0, 37)}...` : t)).join(', ')}${micro.size > 4 ? ', ...' : ''} — move to the Sitecore Dictionary (keep the literal as the value===key default) or a field, or waive "${name}::<text>"`,
    });
  }
  return findings;
}

/**
 * SELF-CHECK — a scanner that silently stops matching reports a perfect score.
 *
 * Every axis is asserted against a positive AND a negative sample, in memory,
 * before a single real file is read. The comment cases are the ones that
 * actually regressed: the `/react` axis must fire on an import and stay silent
 * on the `.d.ts` citation agents must write, and `usesFieldComponents` must NOT
 * be satisfied by a component whose only `<Text>` is inside a comment.
 *
 * Runs unconditionally rather than behind a flag: a self-check nobody invokes
 * is the same as no self-check.
 */
function selfCheck() {
  const failures = [];
  const check = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  const realImport = `import { Text } from '@sitecore-content-sdk/react';\nexport const C = () => <Text field={f} />;`;
  const citedInComment = `/* source: node_modules/@sitecore-content-sdk/react/types/components/Text.d.ts */\nimport { Text } from '@sitecore-content-sdk/nextjs';\nexport const C = () => <Text field={f} />;`;
  check('wrong-import fires on a real /react import', REACT_IMPORT_RE.test(stripComments(realImport)), true);
  check('wrong-import ignores a /react .d.ts citation', REACT_IMPORT_RE.test(stripComments(citedInComment)), false);

  const commentOnlyUsage = `import type { Text } from '@sitecore-content-sdk/nextjs';\n// renders <Text /> eventually\nexport const C = () => <div>{v}</div>;`;
  check('field components detected when really rendered', usesFieldComponents(stripComments(citedInComment)), true);
  check('field components NOT detected from a comment', usesFieldComponents(stripComments(commentOnlyUsage)), false);
  check('field components absent when none used', usesFieldComponents(stripComments('export const C = () => <div>{v}</div>;')), false);

  // raw-field-value (2026-10-01): the consent-banner mutation must fire, its guard form must not.
  const rawSample = (jsx) => `import { Text } from '@sitecore-content-sdk/nextjs';\nexport const C = ({ fields }) => <p><Text field={fields.A} />${jsx}</p>;`;
  check('raw-field-value fires on {fields.X?.value}', rawFieldValues(stripComments(rawSample('{fields.B?.value}'))).length, 1);
  check('raw-field-value ignores a guard', rawFieldValues(stripComments(rawSample('{fields.B?.value && <Text field={fields.B} />}'))).length, 0);
  check('comment stripper keeps line count', stripComments('/* a\nb */x').split('\n').length, 2);

  check('comment stripper removes a block comment', stripComments('/* x */a').trim(), 'a');
  check('comment stripper preserves a URL', stripComments("const u = 'https://x.io';").includes('https://x.io'), true);

  // --- authoring-branch resolution (the 2026-08-15 false-positive fix) ------
  // Written to disk under the OS temp dir: hasAuthoringBranch resolves symbols
  // by reading files, and a sample that never touches the filesystem would
  // exercise none of that. Cleaned up before the audit proper runs.
  const tmp = mkdtempSync(join(tmpdir(), 'authorability-selfcheck-'));
  try {
    const helper = join(tmp, 'helper.ts');
    writeFileSync(
      helper,
      'export function isAuthoringMode(page) { return Boolean(page?.mode?.isEditing || page?.mode?.isPreview); }\n' +
        'export function unrelatedHelper(x) { return x + 1; }\n'
    );
    const viaHelper = join(tmp, 'ViaHelper.tsx');
    writeFileSync(
      viaHelper,
      "import { isAuthoringMode } from './helper';\n" +
        'export const C = ({ page }) => { if (!isAuthoringMode(page)) return null; return <div/>; };\n'
    );
    const viaUnrelated = join(tmp, 'ViaUnrelated.tsx');
    writeFileSync(
      viaUnrelated,
      "import { unrelatedHelper } from './helper';\n" +
        'export const C = () => { if (!unrelatedHelper(1)) return null; return <div/>; };\n'
    );
    const typeOnly = join(tmp, 'TypeOnly.tsx');
    writeFileSync(
      typeOnly,
      "import type { isAuthoringMode } from './helper';\nexport const C = () => { return null; };\n"
    );
    // isPreview ALONE. Without this sample the isPreview half of
    // AUTHORING_SIGNAL_RE is untested by construction — every real helper in
    // the apps audited today happens to mention isEditing too, so deleting
    // `|isPreview` from the pattern changed nothing and the mutant survived.
    const previewHelper = join(tmp, 'preview-helper.ts');
    writeFileSync(previewHelper, 'export function isPreviewMode(page) { return Boolean(page?.mode?.isPreview); }\n');
    const viaPreview = join(tmp, 'ViaPreview.tsx');
    writeFileSync(
      viaPreview,
      "import { isPreviewMode } from './preview-helper';\n" +
        'export const C = ({ page }) => { if (!isPreviewMode(page)) return null; return <div/>; };\n'
    );

    const read1 = (f) => stripComments(readFileSync(f, 'utf8'));
    check(
      'authoring branch resolves a local helper it CALLS',
      hasAuthoringBranch(read1(viaHelper), [viaHelper], [viaHelper, helper]),
      true
    );
    check(
      'authoring branch NOT credited from an unrelated symbol in the same module',
      hasAuthoringBranch(read1(viaUnrelated), [viaUnrelated], [viaUnrelated, helper]),
      false
    );
    check(
      'authoring branch NOT credited from a type-only import that is never called',
      hasAuthoringBranch(read1(typeOnly), [typeOnly], [typeOnly, helper]),
      false
    );
    check(
      'authoring branch resolves a preview-ONLY helper (isPreview half of the signal)',
      hasAuthoringBranch(read1(viaPreview), [viaPreview], [viaPreview, previewHelper]),
      true
    );
    check(
      'authoring branch still detected from the literal isEditing',
      hasAuthoringBranch('if (page.mode.isEditing) return <div/>; return null;', [], []),
      true
    );
    check(
      'authoring branch absent when the component simply returns null',
      hasAuthoringBranch('export const C = () => null;', [], []),
      false
    );
    check(
      'symbolBody is brace-matched, not whole-module',
      /isEditing/.test(symbolBody(readFileSync(helper, 'utf8'), 'unrelatedHelper') ?? ''),
      false
    );

    // --- bare-hasvalue-guard, alias-aware ------------------------------------
    const aliasGuard = join(tmp, 'AliasGuard.tsx');
    writeFileSync(
      aliasGuard,
      "import { isAuthoringMode } from './helper';\n" +
        'export const C = ({ page, f }) => { const authoring = isAuthoringMode(page);\n' +
        '  const hasValue = f?.value !== ""; if (!hasValue && !authoring) return null; return <div/>; };\n'
    );
    const bareGuard = join(tmp, 'BareGuard.tsx');
    writeFileSync(
      bareGuard,
      'export const C = ({ f }) => { const hasValue = f?.value !== "";\n' +
        '  return hasValue && <span>{f.value}</span>; };\n'
    );
    // An authoring branch ELSEWHERE must not excuse a bare guard — this is the
    // distinction that keeps the axis meaningful rather than merely quiet.
    const branchElsewhere = join(tmp, 'BranchElsewhere.tsx');
    writeFileSync(
      branchElsewhere,
      "import { isAuthoringMode } from './helper';\n" +
        'export const C = ({ page, f, items }) => { const authoring = isAuthoringMode(page);\n' +
        '  if (!items.length && authoring) return <p>hint</p>;\n' +
        '  const hasValue = f?.value !== "";\n' +
        '  return hasValue && <span>{f.value}</span>; };\n'
    );

    check(
      'hasValue guard escaped by a local alias of the authoring helper',
      hasValueGuardIsBare(read1(aliasGuard), [aliasGuard], [aliasGuard, helper]),
      false
    );
    check(
      'hasValue guard with NO escape is still reported',
      hasValueGuardIsBare(read1(bareGuard), [bareGuard], [bareGuard]),
      true
    );
    check(
      'an authoring branch elsewhere does NOT excuse a bare hasValue guard',
      hasValueGuardIsBare(read1(branchElsewhere), [branchElsewhere], [branchElsewhere, helper]),
      true
    );
    check(
      'no hasValue guard at all reports nothing',
      hasValueGuardIsBare('export const C = () => <div/>;', [], []),
      false
    );
    // EXACT set, not merely `.has('authoring')`. Over-binding is the quiet
    // failure: a greedy initialiser match also binds the enclosing `const C`,
    // after which ANY statement mentioning `C` reads as escaped and the axis
    // goes silent. Asserting membership alone let that mutant survive.
    check(
      'authoringAliases binds EXACTLY the name assigned from the helper call',
      [...authoringAliases(read1(aliasGuard), [aliasGuard], [aliasGuard, helper])].sort().join(','),
      'authoring'
    );
    check(
      'authoringAliases does NOT bind a name assigned from an unrelated call',
      authoringAliases(read1(viaUnrelated), [viaUnrelated], [viaUnrelated, helper]).size,
      0
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('AUDIT SELF-CHECK FAILED — the scanner cannot be trusted:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(2);
  }
}
selfCheck();

/* ------------------------------------------------------------------- run */

const registered = registeredComponents();
const ignores = readIgnores();
const waived = ignores.components;
const usedFieldWaivers = new Set();
const usedMicroWaivers = new Set();
const usedAtomWaivers = new Set();

// No map (or an unparsed one) → fall back to top-level folders, and say so.
let names = [...registered.keys()];
const mapFound = names.length > 0;
if (!mapFound) {
  names = readdirSync(COMPONENTS_DIR).filter((e) => statSync(join(COMPONENTS_DIR, e)).isDirectory());
}
names.sort((a, b) => a.localeCompare(b));

const results = [];
for (const name of names) {
  if (SCAFFOLD_EXEMPT.has(name)) continue;
  const files = filesForComponent(name, registered.get(name));
  const ownFiles = filesForComponent(name, registered.get(name), { follow: false });
  const findings = auditComponent(name, files, ownFiles, ignores.fields, usedFieldWaivers, ignores.microcopy, usedMicroWaivers);
  results.push({
    component: name,
    files: files.map((f) => relative(APP, f).split(sep).join('/')),
    findings,
    waived: waived[name] ?? null,
  });
}

// beta.atoms catalogs live in src/atoms/, outside the component map.
const atoms = [];
const ATOMS_DIR = join(APP, 'src', 'atoms');
if (existsSync(ATOMS_DIR)) {
  for (const f of sourceFiles(ATOMS_DIR)) {
    for (const h of atomPlainStringProps(stripComments(readFileSync(f, 'utf8')))) {
      const key = `${h.atom}.${h.prop}`;
      if (ignores.atoms[key]) { usedAtomWaivers.add(key); continue; }
      atoms.push({ axis: 'atom-plain-string', level: 'warn', atom: h.atom, prop: h.prop, where: `${relative(APP, f).split(sep).join('/')}:${h.line}`,
        detail: `atom ${h.atom}.${h.prop} carries authored copy as z.string() — use a *FieldSchema (textFieldSchema / richTextFieldSchema / linkFieldSchema …) so a Document can bind it to a field, or waive "${key}"` });
    }
  }
}

// literal-microcopy is reported on its own line: it never fails the gate and never changes the
// clean / warning / waiver counts the other axes have reported since 2026-08.
const core = (r) => r.findings.filter((f) => f.axis !== 'literal-microcopy');
const defects = results.filter((r) => core(r).some((f) => f.level === 'defect') && !r.waived);
const warns = results.filter((r) => core(r).some((f) => f.level === 'warn') && !r.waived);
const clean = results.filter((r) => core(r).length === 0);
const waivedUsed = results.filter((r) => r.waived && core(r).length > 0);
const waivedStale = results.filter((r) => r.waived && core(r).length === 0);
const staleFieldWaivers = Object.keys(ignores.fields).filter((k) => !usedFieldWaivers.has(k));
const staleMicroWaivers = Object.keys(ignores.microcopy).filter((k) => !usedMicroWaivers.has(k));
const staleAtomWaivers = Object.keys(ignores.atoms).filter((k) => !usedAtomWaivers.has(k));
const microcopyStrings = results.reduce((n, r) => n + (r.findings.find((f) => f.axis === 'literal-microcopy')?.strings.length ?? 0), 0);

const summary = {
  app: APP,
  componentMapFound: mapFound,
  total: results.length,
  clean: clean.length,
  defects: defects.length,
  warnings: warns.length,
  waived: waivedUsed.length,
  staleWaivers: waivedStale.length,
  fieldWaiversUsed: usedFieldWaivers.size,
  staleFieldWaivers: staleFieldWaivers.length,
  microcopyComponents: results.filter((r) => r.findings.some((f) => f.axis === 'literal-microcopy')).length,
  microcopyStrings,
  staleMicrocopyWaivers: staleMicroWaivers.length,
  atomWarnings: atoms.length,
  staleAtomWaivers: staleAtomWaivers.length,
  editablePercent: results.length ? Math.round(((results.length - defects.length - waivedUsed.length) / results.length) * 100) : 100,
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, results, atoms }, null, 2));
  process.exit(defects.length ? 1 : 0);
}

if (!QUIET || defects.length) {
  console.log(`\nComponent authorability — ${APP}`);
  if (!mapFound) {
    console.log('  ! No component map found — audited every folder under src/components/ instead.');
    console.log('    Support folders will show up as components. Generate the map for an accurate run.');
  }
  console.log(`  ${summary.total} registered · ${summary.clean} clean · ${summary.defects} defect(s) · ${summary.warnings} warning(s) · ${summary.waived} waived`);
  console.log(`  literal microcopy (warn): ${summary.microcopyStrings} string(s) in ${summary.microcopyComponents} component(s)${existsSync(ATOMS_DIR) ? ` · atoms (warn): ${summary.atomWarnings}` : ''}\n`);

  for (const r of results) {
    if (r.findings.length === 0) continue;
    const worst = r.findings.some((f) => f.level === 'defect') ? (r.waived ? 'WAIVED' : 'DEFECT') : 'warn  ';
    console.log(`  [${worst}] ${r.component}`);
    for (const f of r.findings) console.log(`      ${f.axis}: ${f.detail}`);
    if (r.waived) console.log(`      waiver: ${r.waived}`);
  }
  for (const a of atoms) console.log(`  [warn  ] ${a.atom} (src/atoms)\n      ${a.axis}: ${a.detail} (${a.where})`);
  for (const k of [...staleMicroWaivers, ...staleAtomWaivers]) {
    console.log(`  [stale ] ${k} — waiver in ${IGNORE_FILE} matches nothing. Remove the waiver.`);
  }

  for (const r of waivedStale) {
    console.log(`  [stale ] ${r.component} — waived in ${IGNORE_FILE} but now clean. Remove the waiver.`);
  }
  for (const k of staleFieldWaivers) {
    console.log(`  [stale ] ${k} — field waiver in ${IGNORE_FILE} matches no raw render. Remove the waiver.`);
  }

  if (defects.length) {
    console.log(`\n  ${defects.length} component(s) are un-authorable. Every authored value arrives on \`fields\``);
    console.log(`  and renders through an SDK field component. Deliberate exceptions go in ${IGNORE_FILE}`);
    console.log('  under `components`, each with its own reason.');
    console.log('\n  This audit is a FLOOR, not proof — it cannot see whether the fields a component');
    console.log('  DOES render are the right ones. One real Pages-canvas check per component is still required.\n');
  } else {
    console.log('\n  No un-authorable components. Still verify inline editing in the Pages canvas.\n');
  }
}

process.exit(defects.length ? 1 : 0);
