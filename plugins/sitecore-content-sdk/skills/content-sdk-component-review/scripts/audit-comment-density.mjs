#!/usr/bin/env node
/**
 * audit-comment-density.mjs — score a product's source against rule
 * `87-comment-economy.mdc`. Read-only: reads `.ts`/`.tsx` text only, no
 * network, no tenant auth, no mutation.
 *
 *   node scripts/audit-comment-density.mjs --path <dir>
 *   node scripts/audit-comment-density.mjs --path <dir> --json
 *   node scripts/audit-comment-density.mjs --path <dir> --quiet
 *
 * Exit 1 if any file carries an unwaived comment wall — so it works as a
 * delivery-loop gate alongside the schema and authorability audits.
 *
 * WHY THIS EXISTS. Rationale written into a source header is invisible to
 * every other signal: it compiles, it lints, tests pass, review reads it as
 * diligence. Measured 2026-08-12 across 1,505 hand-written source files:
 * 183 files carried a header essay of 25+ lines (8,477 lines total), and the
 * two most recent head apps had MORE comment than code — one at
 * 4,642 comment vs 4,043 code (115%), the other 74%. One component was 227 lines
 * of which ~22 were code. Nothing in the pipeline objected.
 *
 * The root cause was structural, not stylistic: code-review reports are
 * run-scoped and were gitignored, so the only durable home for a hard-won
 * decision was the source file. This audit is one half of the fix — the other
 * half is `docs/build-decisions.md`, which gives that reasoning somewhere to live.
 * Do NOT deploy this gate without the destination, or it deletes knowledge.
 *
 * WHAT IT CAN AND CANNOT SEE. It measures comment VOLUME and placement. It
 * cannot tell a load-bearing comment from a worthless one, and it will never
 * flag the far worse defect of a comment that is subtly WRONG. A short wrong
 * comment passes this audit cleanly. Human review still owns correctness.
 *
 * AXES:
 *   header-essay    comment run >= WALL_DEFECT starting in the first HEAD_LINES
 *   comment-wall    comment run >= WALL_DEFECT anywhere else in the file
 *   long-block      comment run >= WALL_WARN                          (warn)
 *   density         comment:code ratio over DENSITY_WARN              (warn)
 *
 * Rule numbers (40, 80, 86, 87, 88) name the source framework's rules; the skill's SKILL.md
 * states each one in plain terms. Run from the skill directory: node scripts/<name>.mjs …
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resolve as resolveFromCwd } from 'node:path';
// A host repo may plug in its own resolver (e.g. a products mount) before importing this file;
// standalone, a path resolves against the working directory.
const resolveLogical = (p) => (globalThis.__componentReviewResolvePath ?? resolveFromCwd)(String(p));

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const AS_JSON = argv.includes('--json');
const QUIET = argv.includes('--quiet');
// Resolve the target through the host resolver plugged in above (cwd when standalone).
const TARGET = arg('path', null) === null ? null : resolveLogical(arg('path', null));

/** A single comment run at or above this is a defect. */
const WALL_DEFECT = Number(arg('wall', 25));
/** At or above this it is a warning — long, but not yet an essay. */
const WALL_WARN = 12;
/** A run starting within this many lines of the top is a file-header essay. */
const HEAD_LINES = 20;
/** comment:code ratio (percent) that warns, for files with real code in them. */
const DENSITY_WARN = 40;
const DENSITY_MIN_CODE = 30;

const IGNORE_FILE = '.comment-density-ignore.json';

const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.turbo',
  '.vercel', '.yarn', 'obj', 'bin', 'playwright-report', 'test-results',
  'generated', '__generated__', '.sitecore', '.worktrees',
  // Planning surfaces are prose by definition — never source.
  'project-planning', 'design-prototypes',
]);

/* ---------------------------------------------------------------- helpers */

/**
 * Mask string and template-literal bodies so a `/*` or `//` INSIDE a string
 * cannot be mistaken for a comment opener. Line-local and deliberately naive:
 * it only has to survive `const s = '/*'` and `const u = 'https://x'`, which
 * are the two forms that actually occur.
 */
function maskStrings(line) {
  return line
    .replace(/\\./g, '__')
    .replace(/'[^']*'/g, "'__'")
    .replace(/"[^"]*"/g, '"__"')
    .replace(/`[^`]*`/g, '`__`');
}

/**
 * Classify every line as 'code' | 'comment' | 'blank'.
 *
 * A line counts as comment only when the comment is what the line is FOR — a
 * trailing `// why` on a real statement is not noise this rule cares about, so
 * it stays 'code'. That keeps the metric aimed at walls, not at annotation.
 */
export function classify(src) {
  const lines = src.split(/\r?\n/);
  const kind = new Array(lines.length).fill('code');
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();

    if (inBlock) {
      kind[i] = 'comment';
      const end = raw.indexOf('*/');
      if (end >= 0) {
        inBlock = false;
        // Code after the closer means the line did real work.
        if (raw.slice(end + 2).trim()) kind[i] = 'code';
      }
      continue;
    }

    if (raw === '') { kind[i] = 'blank'; continue; }
    if (raw.startsWith('//')) { kind[i] = 'comment'; continue; }

    const masked = maskStrings(raw);

    // Whole-line comment openers, including the JSX `{/* … */}` form.
    if (masked.startsWith('{/*') || masked.startsWith('/*')) {
      kind[i] = 'comment';
      if (!masked.includes('*/')) inBlock = true;
      continue;
    }

    // A block opened mid-line after real code: the line is code, but the
    // block continues onto the following lines.
    const open = masked.indexOf('/*');
    if (open > 0) {
      const lineComment = masked.indexOf('//');
      const commentedOut = lineComment >= 0 && lineComment < open;
      if (!commentedOut && !masked.slice(open).includes('*/')) inBlock = true;
    }
  }
  return kind;
}

/** Contiguous comment runs as `{ start, end, length }`, 1-indexed. */
export function commentRuns(kind) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= kind.length; i++) {
    if (kind[i] === 'comment') { if (start < 0) start = i; }
    else if (start >= 0) { out.push({ start: start + 1, end: i, length: i - start }); start = -1; }
  }
  return out;
}

/** Every .ts/.tsx file under a directory, recursively. Tests included — a wall is a wall. */
function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const entry of entries) {
      const p = join(d, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        walk(p);
      } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
        out.push(p);
      }
    }
  };
  walk(dir);
  return out;
}

/** Machine-written files are exempt — nobody chose those comments. */
function isGenerated(src) {
  const head = src.split(/\r?\n/, 8).join('\n');
  return /@generated|AUTO-GENERATED|Auto-generated|DO NOT EDIT|do not edit this file/i.test(head);
}

/**
 * Waivers: `{ "files": { "<repo-relative path>": { "reason": "…" } } }`.
 * Every waiver carries its OWN reason — a blanket reason is how a waiver file
 * becomes a mute button.
 */
function readWaivers(root) {
  const file = join(root, IGNORE_FILE);
  if (!existsSync(file)) return {};
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Bad ${IGNORE_FILE}: ${e.message}`); process.exit(2); }
  const files = parsed.files ?? {};
  const out = {};
  for (const [path, entry] of Object.entries(files)) {
    const reason = typeof entry === 'string' ? entry : entry?.reason;
    if (!reason || !String(reason).trim()) {
      console.error(`${IGNORE_FILE}: "${path}" has no reason. Every waiver needs its own reason.`);
      process.exit(2);
    }
    out[path.split(sep).join('/')] = String(reason);
  }
  return out;
}

/** Findings for one file. */
export function auditSource(src) {
  const kind = classify(src);
  const runs = commentRuns(kind);
  const code = kind.filter((k) => k === 'code').length;
  const comment = kind.filter((k) => k === 'comment').length;
  const findings = [];

  for (const run of runs) {
    if (run.length >= WALL_DEFECT) {
      const header = run.start <= HEAD_LINES;
      findings.push({
        level: 'defect',
        axis: header ? 'header-essay' : 'comment-wall',
        detail: `${run.length}-line comment block at line ${run.start}`,
        line: run.start,
      });
    } else if (run.length >= WALL_WARN) {
      findings.push({
        level: 'warn',
        axis: 'long-block',
        detail: `${run.length}-line comment block at line ${run.start}`,
        line: run.start,
      });
    }
  }

  const ratio = code ? Math.round((comment / code) * 100) : 0;
  if (code >= DENSITY_MIN_CODE && ratio > DENSITY_WARN) {
    findings.push({
      level: 'warn',
      axis: 'density',
      detail: `${comment} comment lines to ${code} code lines (${ratio}%)`,
      line: 1,
    });
  }

  return { code, comment, ratio, findings };
}

/* ------------------------------------------------------------ self-check */

/**
 * Mutation-proof self-check: every axis gets a positive AND a negative sample,
 * so a scanner that has silently stopped detecting anything cannot report a
 * clean run. The string cases are the ones that actually broke earlier
 * scanners — a `/*` inside a quoted string, and a `//` inside a URL.
 *
 * Runs unconditionally rather than behind a flag: a self-check nobody invokes
 * is the same as no self-check.
 */
function selfCheck() {
  const failures = [];
  const check = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const block = (n) => ['/**', ...Array.from({ length: n - 2 }, (_, i) => ` * line ${i}`), ' */'].join('\n');
  const slashes = (n) => Array.from({ length: n }, (_, i) => `// line ${i}`).join('\n');

  // header-essay: fires at the top, and the same block deeper is a plain wall.
  const headerSrc = `${block(30)}\nexport const a = 1;`;
  const deepSrc = `${Array.from({ length: 40 }, (_, i) => `const x${i} = ${i};`).join('\n')}\n${block(30)}\nexport const a = 1;`;
  check('header-essay fires on a 30-line top block',
    auditSource(headerSrc).findings.some((f) => f.axis === 'header-essay'), true);
  check('deep block is a comment-wall, not a header-essay',
    auditSource(deepSrc).findings.some((f) => f.axis === 'comment-wall'), true);
  check('deep block does NOT report header-essay',
    auditSource(deepSrc).findings.some((f) => f.axis === 'header-essay'), false);

  // Threshold has two sides — a short header must stay clean.
  check('10-line header is not a defect',
    auditSource(`${block(10)}\nexport const a = 1;`).findings.some((f) => f.level === 'defect'), false);
  check('10-line header does not even warn',
    auditSource(`${block(10)}\nexport const a = 1;`).findings.length, 0);

  // Line-comment runs count the same as block comments.
  check('30 consecutive // lines are a wall',
    auditSource(`${slashes(30)}\nexport const a = 1;`).findings.some((f) => f.level === 'defect'), true);

  // Strings must not open comments.
  check('a /* inside a string is not a comment',
    classify(`const s = '/*';\nconst t = 2;\nconst u = 3;`).every((k) => k === 'code'), true);
  check('a // inside a URL is not a comment',
    classify(`const u = 'https://example.com';`)[0], 'code');
  check('a real block comment IS a comment',
    classify('/* x */').every((k) => k === 'comment'), true);

  // Code after a block closer is code, not comment.
  check('code after */ counts as code',
    classify('/*\n x\n*/ const a = 1;')[2], 'code');

  // Trailing annotation on a statement stays code — this rule targets walls.
  check('trailing // on a statement stays code',
    classify('const a = 1; // why')[0], 'code');

  // Density axis, both directions.
  const dense = `${Array.from({ length: 40 }, (_, i) => `// c${i}`).join('\n').replace(/\n/g, '\n')}`;
  const denseSrc = Array.from({ length: 40 }, (_, i) => `// c${i}\nconst x${i} = ${i};`).join('\n');
  const sparseSrc = Array.from({ length: 40 }, (_, i) => `const x${i} = ${i};`).join('\n');
  check('density warns when comments outweigh code',
    auditSource(denseSrc).findings.some((f) => f.axis === 'density'), true);
  check('density silent on uncommented code',
    auditSource(sparseSrc).findings.some((f) => f.axis === 'density'), false);
  void dense;

  // Generated-file detection, both directions.
  check('generated marker detected', isGenerated('/* @generated */\nconst a = 1;'), true);
  check('ordinary file not treated as generated', isGenerated('const a = 1;'), false);

  if (failures.length > 0) {
    console.error('AUDIT SELF-CHECK FAILED — the scanner cannot be trusted:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(2);
  }
}
selfCheck();

/* ------------------------------------------------------------------- run */

if (!TARGET) {
  console.error('Usage: node audit-comment-density.mjs --path <dir> [--json] [--quiet] [--wall N]');
  process.exit(2);
}
if (!existsSync(TARGET)) { console.error(`No such directory: ${TARGET}`); process.exit(2); }

const waivers = readWaivers(TARGET);
const results = [];

for (const file of sourceFiles(TARGET)) {
  const src = readFileSync(file, 'utf8');
  if (isGenerated(src)) continue;
  const rel = relative(TARGET, file).split(sep).join('/');
  const { code, comment, ratio, findings } = auditSource(src);
  if (findings.length === 0) continue;
  results.push({ file: rel, code, comment, ratio, findings, waived: waivers[rel] ?? null });
}

results.sort((a, b) => b.comment - a.comment);

const defects = results.filter((r) => r.findings.some((f) => f.level === 'defect') && !r.waived);
const warns = results.filter((r) => !r.findings.some((f) => f.level === 'defect') && !r.waived);
const waivedUsed = results.filter((r) => r.waived);
const staleWaivers = Object.keys(waivers).filter((p) => !results.some((r) => r.file === p));

const summary = {
  path: TARGET,
  wallThreshold: WALL_DEFECT,
  filesWithFindings: results.length,
  defects: defects.length,
  warnings: warns.length,
  waived: waivedUsed.length,
  staleWaivers: staleWaivers.length,
  wallLines: defects.reduce((a, r) => a + r.findings.filter((f) => f.level === 'defect')
    .reduce((s, f) => s + Number(f.detail.match(/^(\d+)/)?.[1] ?? 0), 0), 0),
};

if (AS_JSON) {
  console.log(JSON.stringify({ summary, results, staleWaivers }, null, 2));
  process.exit(defects.length ? 1 : 0);
}

if (!QUIET || defects.length) {
  console.log(`\nComment economy — ${TARGET}`);
  console.log(`  ${summary.defects} defect(s) · ${summary.warnings} warning(s) · ${summary.waived} waived · wall threshold ${WALL_DEFECT} lines\n`);

  for (const r of results) {
    const worst = r.findings.some((f) => f.level === 'defect') ? (r.waived ? 'WAIVED' : 'DEFECT') : 'warn  ';
    console.log(`  [${worst}] ${r.file}  (${r.comment} cmt / ${r.code} code = ${r.ratio}%)`);
    for (const f of r.findings) console.log(`      ${f.axis}: ${f.detail}`);
    if (r.waived) console.log(`      waiver: ${r.waived}`);
  }

  for (const p of staleWaivers) {
    console.log(`  [stale ] ${p} — waived in ${IGNORE_FILE} but now clean. Remove the waiver.`);
  }

  if (defects.length) {
    console.log(`\n  ${summary.defects} file(s) carry a comment wall (${summary.wallLines} lines).`);
    console.log('  A comment says WHY in a line or two and links out. Narrative history,');
    console.log('  review findings, task IDs, phase numbers and measurement logs belong in');
    console.log(`  docs/build-decisions.md. Deliberate exceptions go in ${IGNORE_FILE} under \`files\`,`);
    console.log('  each with its own reason.');
    console.log('\n  This audit measures VOLUME, not correctness — a short WRONG comment passes it');
    console.log('  cleanly. Do not read a green run as "the comments are good".\n');
  } else {
    console.log('\n  No comment walls.\n');
  }
}

process.exit(defects.length ? 1 : 0);
