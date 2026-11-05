#!/usr/bin/env node
/**
 * check-atoms-lock.mjs — a CI gate for the Content SDK atoms lock that can actually fail.
 *
 * `sitecore-tools project atoms validate` exits 0 on every lock issue unless
 * `atoms.validation.breakOnError` is true, so a CI step that only checks the exit code is green
 * with no lock file at all. This script runs validate, parses the MV-/IV-/IE- codes from the
 * output and fails on ANY code, whatever the config says. It also warns about the changes the lock
 * hash cannot see (Zod check parameters, .meta(), .describe(), withPropMeta) when they land
 * without a `version` bump since the last commit that touched the lock. It also fails on two
 * layout traps validate cannot see: both src/atoms/index.ts and index.tsx present, and atom files
 * under src/components/ that componentMap.exclude does not cover (Content Kit installs both).
 *
 * Usage:
 *   node check-atoms-lock.mjs [--app <dir>] [--json] [--fail-on-hash-blind] [--no-git]
 *   node check-atoms-lock.mjs --self-test
 * Exit: 0 clean · 1 lock or layout issue (or hash-blind change with --fail-on-hash-blind) · 2 usage/tool error.
 * Dependency-free; Node 18+. Needs the app's node_modules (it shells out to npx sitecore-tools).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CODE_RE = /\[((?:MV|IV|IE)-\d{3})\]\s*([^\n]*)/g;

/** Pure: classify a validate run. Exported for the self-test. */
export function parseValidateOutput(text, exitCode) {
  const issues = [];
  for (const m of String(text).matchAll(CODE_RE)) {
    // IE-008 is the "validation failed" header and IE-009 the breakOnError throw: both wrap other codes.
    if (m[1] === 'IE-008' || m[1] === 'IE-009') continue;
    issues.push({ code: m[1], message: m[2].trim() });
  }
  const upToDate = /atoms\.lock\.json is up to date/.test(text);
  const thrown = exitCode !== 0 && issues.length === 0 && !upToDate;
  if (thrown) issues.push({ code: 'TOOL', message: `validate exited ${exitCode} without a recognised code` });
  return { ok: issues.length === 0 && upToDate, upToDate, issues, exitCode };
}

const BLIND_RE = /\.(min|max|length|regex|email|url|uuid|int|positive|nonnegative|meta|describe|startsWith|endsWith|gt|gte|lt|lte|multipleOf)\(|withPropMeta\(/;

/** Pure: find hash-blind edits in a unified diff of src/atoms. Exported for the self-test. */
export function classifyHashBlind(diffText) {
  const changed = [];
  let versionTouched = false;
  for (const line of String(diffText).split(/\r?\n/)) {
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    if (/\bversion\s*:/.test(line)) versionTouched = true;
    if (BLIND_RE.test(line)) changed.push(line.slice(0, 160));
  }
  return { hashBlindLines: changed, versionTouched, warn: changed.length > 0 && !versionTouched };
}

const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$');

/**
 * Pure: layout traps the CLI cannot see. Exported for the self-test.
 * `entries` = files present among src/atoms/index.{ts,tsx}; `componentFiles` = [{path, text}] under
 * src/components/ (posix, repo-relative); `configText` = sitecore.cli.config.* source.
 * Two entries: the CLI/tsc read index.ts, the bundler index.tsx (lock green, render null).
 * An atom under src/components/ that no exclude glob covers is registered as a rendering.
 */
export function checkLayout({ entries = [], componentFiles = [], configText = '' }) {
  const issues = [];
  if (entries.length > 1) issues.push({ code: 'LAYOUT-ENTRY', message: `${entries.join(' + ')}: the CLI reads index.ts, the bundler index.tsx; keep exactly one` });
  const globs = [...String(configText).matchAll(/['"`]([^'"`\n]*src\/components[^'"`\n]*)['"`]/g)].map((m) => globRe(m[1]));
  const atomish = (f) => /(^|\/)atoms\//.test(f.path.replace(/^src\/components\//, '')) || /from\s+['"]@sitecore-content-sdk\/(nextjs|react)\/atoms['"]/.test(f.text || '');
  const stray = componentFiles.filter((f) => atomish(f) && !globs.some((re) => re.test(f.path)));
  if (stray.length) issues.push({ code: 'LAYOUT-MAP', message: `${stray.length} atom file(s) under src/components/ not in componentMap.exclude (e.g. ${stray[0].path}); add 'src/components/atoms/**'` });
  return issues;
}

function scanLayout(app) {
  const entries = ['index.ts', 'index.tsx'].filter((f) => fs.existsSync(path.join(app, 'src/atoms', f))).map((f) => 'src/atoms/' + f);
  const componentFiles = [];
  const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(t|j)sx?$/.test(e.name)) componentFiles.push({ path: path.relative(app, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') }); } };
  walk(path.join(app, 'src/components'));
  const cfg = ['sitecore.cli.config.ts', 'sitecore.cli.config.js', 'sitecore.cli.config.mjs'].map((f) => path.join(app, f)).find((f) => fs.existsSync(f));
  return checkLayout({ entries, componentFiles, configText: cfg ? fs.readFileSync(cfg, 'utf8') : '' });
}

function args(argv) {
  const a = { app: process.cwd(), json: false, failOnBlind: false, git: true, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--app') a.app = path.resolve(argv[++i]);
    else if (k === '--json') a.json = true;
    else if (k === '--fail-on-hash-blind') a.failOnBlind = true;
    else if (k === '--no-git') a.git = false;
    else if (k === '--self-test') a.selfTest = true;
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); process.exit(0); }
    else { console.error('unknown argument ' + k); process.exit(2); }
  }
  return a;
}

function run(a) {
  if (!fs.existsSync(path.join(a.app, 'package.json'))) { console.error(`no package.json in ${a.app}`); return 2; }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const r = spawnSync(npx, ['--no-install', 'sitecore-tools', 'project', 'atoms', 'validate'], { cwd: a.app, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error) { console.error('could not run sitecore-tools: ' + r.error.message); return 2; }
  const verdict = parseValidateOutput((r.stdout || '') + '\n' + (r.stderr || ''), r.status ?? 1);
  let blind = { hashBlindLines: [], versionTouched: false, warn: false, skipped: !a.git };
  if (a.git) {
    const g = (...x) => spawnSync('git', x, { cwd: a.app, encoding: 'utf8' });
    const base = g('log', '-1', '--format=%H', '--', '.sitecore/atoms.lock.json').stdout.trim();
    if (base) blind = { ...classifyHashBlind(g('diff', base, '--', 'src/atoms').stdout), base: base.slice(0, 10) };
    else blind.skipped = 'lock never committed';
  }
  const layout = scanLayout(a.app);
  const fail = !verdict.ok || layout.length > 0 || (a.failOnBlind && blind.warn);
  const out = { ok: !fail, lock: verdict, layout, hashBlind: blind };
  if (a.json) console.log(JSON.stringify(out, null, 2));
  else {
    for (const i of [...layout, ...verdict.issues]) console.log(`FAIL ${i.code} ${i.message}`);
    if (verdict.ok) console.log('lock: up to date');
    if (blind.warn) console.log(`WARN hash-blind change without a version bump since ${blind.base}:\n  ${blind.hashBlindLines.join('\n  ')}\n  -> bump the atom's version and run atoms update`);
    console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
  }
  return fail ? 1 : 0;
}

function selfTest() {
  let failed = 0;
  const t = (name, cond) => { if (!cond) { failed++; console.log('FAIL ' + name); } else console.log('ok   ' + name); };
  // Real outputs captured from the beta CLI (2.3.0-beta.atoms.20260930142740), 2026-10-02.
  const missing = '[IE-008] Lock file validation failed:\n  - [MV-012] Lock file not found. Run `sitecore-tools project atoms update` to generate it.';
  const clean = '[atoms validate] atoms.lock.json is up to date.';
  const changed = '[IE-008] Lock file validation failed:\n  - [IV-010] Atom "Button" schema has changed.';
  const thrown = 'Error: [MV-010] Atoms module not found at src/atoms/index.{ts,tsx}.';
  const strict = changed + '\nError: [IE-009] Atom validation failed. See issues above.';
  t('missing lock with exit 0 is a FAIL (the warn-only trap)', !parseValidateOutput(missing, 0).ok);
  t('missing lock reports MV-012', parseValidateOutput(missing, 0).issues[0]?.code === 'MV-012');
  t('clean output passes', parseValidateOutput(clean, 0).ok);
  t('schema change with exit 0 fails', !parseValidateOutput(changed, 0).ok);
  t('thrown MV-010 fails', !parseValidateOutput(thrown, 1).ok);
  t('IE-009 wrapper is not double-counted', parseValidateOutput(strict, 1).issues.length === 1);
  t('empty output with exit 0 is not a pass', !parseValidateOutput('', 0).ok);
  t('unknown crash is a FAIL', !parseValidateOutput('Segfault', 1).ok);
  const blindDiff = '--- a/src/atoms/index.tsx\n+++ b/src/atoms/index.tsx\n-        tagline: z.string().min(3).optional(),\n+        tagline: z.string().max(5).optional(),';
  const bumped = blindDiff + "\n-      version: '1.0.0',\n+      version: '1.1.0',";
  const typeOnly = "-        level: z.enum(['h1','h2']),\n+        level: z.enum(['h1','h2','h3']),";
  t('min->max without version bump warns', classifyHashBlind(blindDiff).warn);
  t('min->max with version bump does not warn', !classifyHashBlind(bumped).warn);
  t('.meta() change warns', classifyHashBlind("+  text: textFieldSchema().meta({control:'Image'}),").warn);
  t('a hashed change (enum) does not warn', !classifyHashBlind(typeOnly).warn);
  t('diff header lines are ignored', !classifyHashBlind('+++ b/x.min(3)\n--- a/x.min(3)').warn);
  // Layout traps measured on the Content Kit install, 2026-10-02.
  const kitAtom = { path: 'src/components/atoms/heading/heading.schema.ts', text: "import { withPropMeta } from '@sitecore-content-sdk/nextjs/atoms';" };
  const kitButton = { path: 'src/components/atoms/button/button.tsx', text: "'use client';" };
  const codeComp = { path: 'src/components/Promo.tsx', text: "import { Text } from '@sitecore-content-sdk/nextjs';" };
  const excluded = "componentMap: { exclude: ['src/components/atoms/**', 'src/components/ui/**'] }";
  t('two catalog entry files fail', checkLayout({ entries: ['src/atoms/index.ts', 'src/atoms/index.tsx'] }).some((i) => i.code === 'LAYOUT-ENTRY'));
  t('one catalog entry file passes', checkLayout({ entries: ['src/atoms/index.tsx'] }).length === 0);
  t('atoms under src/components/ without exclude fail', checkLayout({ componentFiles: [kitAtom, codeComp] }).some((i) => i.code === 'LAYOUT-MAP'));
  t('an atoms/ folder file with no atoms import still fails', checkLayout({ componentFiles: [kitButton] }).some((i) => i.code === 'LAYOUT-MAP'));
  t('atoms under src/components/ covered by exclude pass', checkLayout({ componentFiles: [kitAtom, kitButton, codeComp], configText: excluded }).length === 0);
  t('an exclude for another folder does not cover atoms', checkLayout({ componentFiles: [kitAtom], configText: "exclude: ['src/components/ui/**']" }).length === 1);
  t('a plain code component is not flagged', checkLayout({ componentFiles: [codeComp] }).length === 0);
  console.log(failed ? `SELF-TEST FAILED (${failed})` : 'SELF-TEST PASSED');
  return failed ? 1 : 0;
}

const a = args(process.argv.slice(2));
process.exit(a.selfTest ? selfTest() : run(a));
