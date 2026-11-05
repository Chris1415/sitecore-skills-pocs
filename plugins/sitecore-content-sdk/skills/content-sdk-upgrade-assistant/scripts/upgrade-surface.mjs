#!/usr/bin/env node
/**
 * upgrade-surface.mjs — three-way OOTB diff for a Content SDK head-app upgrade.
 *
 * Scaffolds TWO clean reference apps with `create-content-sdk-app` (no install),
 * one at the version the app is on and one at the target, then classifies every
 * file Sitecore changed between them against the app's copy:
 *
 *   upgraded     app == new reference            nothing to do
 *   stale        app == old reference            the upgrade skipped this file   (FAIL)
 *   new-absent   only in new ref, missing in app a new route / config never landed (FAIL)
 *   customized   app matches neither            hunks listed; state a verdict per file
 *   removed      only in old ref, still in app   upstream dropped it; decide       (WARN)
 *   app-dropped  changed upstream, absent in app the app removed an OOTB file      (WARN)
 *
 * It also prints the component-map KEY RULE of the installed and the target
 * `@sitecore-content-sdk/content` — `verbatim` (key = file name) or `pascal-split` (key =
 * toPascalCase(name), which eats `_` and `-`) — read off each package's own templating
 * source, because the rule flipped between content 2.2.x and 2.3.0 and is announced to flip
 * back at the next major (content-sdk-component-naming-traps, trap 6). A differing pair plus
 * any `[-_]` folder under src/components/ is a WARN: that component's key changes on the bump
 * and no other gate sees a generated file change meaning.
 *
 * Why three-way: `app vs new` alone drowns the signal in the app's own
 * customizations; `old vs new` alone says what changed but not whether it landed.
 * The reference IS the upgrade guide — a changelog is prose about it.
 *
 * Dependency-free Node ≥ 18. Needs `npx` on PATH and registry access.
 *
 *   node scripts/upgrade-surface.mjs --app <dir> [--to <ver>] [--from <ver> | --from-git <ref>]
 *        [--template nextjs-app-router|nextjs|nextjs-app-router-cache-components]
 *        [--workdir <dir>] [--fresh] [--include-docs] [--json] [--quiet]
 *
 * Before an upgrade the defaults do the right thing (from = the installed minor, to =
 * latest stable). To VERIFY an upgrade that already landed, the lockfile is the new
 * version, so name the old one: `--from-git HEAD~1` reads it from the lockfile at that ref.
 *
 * Exit 0 clean (customized/removed are advisory) · 1 stale or new-absent · 2 harness.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

const CLI = 'create-content-sdk-app';
const SDK_PKG = '@sitecore-content-sdk/nextjs';
// Agent-instruction payload the CLI ships. Real, but not the upgrade surface an app
// verifies — a consumer curates these separately. `--include-docs` re-admits them.
const DOC_NOISE = /^(\.agents\/|\.cursor\/|\.windsurfrules$|AGENTS\.md$|CLAUDE\.md$|copilot-instructions\.md$|Skills\.md$|README\.md$)/;
const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', '.sitecore']);

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const JSON_OUT = flag('json'), QUIET = flag('quiet');
const say = (...a) => { if (!QUIET && !JSON_OUT) console.log(...a); };
const die = (code, msg) => { if (JSON_OUT) console.log(JSON.stringify({ error: msg }, null, 2)); else console.error(`ERROR: ${msg}`); process.exit(code); };

// ---------------------------------------------------------------- pure helpers (self-checked)
const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n+$/, '');
const semverKey = (v) => v.split('.').map(Number);
const isStable = (v) => /^\d+\.\d+\.\d+$/.test(v);
const cmpVer = (a, b) => { const x = semverKey(a), y = semverKey(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** Classify one surface file. `oldRef`/`newRef`/`app` are normalized contents or null. */
export function classify({ oldRef, newRef, app }) {
  if (oldRef === null && newRef === null) return null;
  if (oldRef === null) return app === null ? 'new-absent' : 'new-ok';
  if (newRef === null) return app === null ? 'removed-ok' : 'removed';
  if (oldRef === newRef) return null; // not on the surface
  if (app === null) return 'app-dropped';
  if (app === newRef) return 'upgraded';
  if (app === oldRef) return 'stale';
  return 'customized';
}

/** The CLI release whose template pins the app's installed SDK minor — CLI and SDK
 *  versions are NOT the same number (2.3.0/2.3.1/2.3.2 all pin ^2.3.0; there is no 2.2.1). */
export function pickCliVersion(installed, cliVersions) {
  const stable = cliVersions.filter(isStable).sort(cmpVer);
  const [maj, min] = semverKey(installed);
  const sameMinor = stable.filter((v) => { const [a, b] = semverKey(v); return a === maj && b === min; });
  if (sameMinor.length) return sameMinor.at(-1);
  const below = stable.filter((v) => cmpVer(v, installed) <= 0);
  return below.at(-1) ?? null;
}

/** Component-map key rule from a content package's templating source (trap 6 is version-sensitive). */
export function keyRuleFromSource(js) {
  const m = norm(js).match(/componentName:\s*([^,\n]+)/);
  if (!m) return 'unknown';
  return /toPascalCase\s*\(/.test(m[1]) ? 'pascal-split' : 'verbatim';
}

/** Added/removed lines of a unified diff between two normalized texts, each checked
 *  against the app copy. Advisory: a `+` line absent may be a legitimate rewrite. */
export function hunkReport(oldT, newT, appT) {
  const strip = (l) => l.trim();
  const oldL = new Set(oldT.split('\n').map(strip)), newL = new Set(newT.split('\n').map(strip));
  const appL = new Set(appT.split('\n').map(strip));
  const out = [];
  for (const l of newL) if (l && !oldL.has(l)) out.push({ sign: '+', line: l, inApp: appL.has(l) });
  for (const l of oldL) if (l && !newL.has(l)) out.push({ sign: '-', line: l, inApp: appL.has(l) });
  return out;
}

function selfCheck() {
  const c = classify;
  const cases = [
    [c({ oldRef: 'a', newRef: 'b', app: 'b' }), 'upgraded'],
    [c({ oldRef: 'a', newRef: 'b', app: 'a' }), 'stale'],
    [c({ oldRef: 'a', newRef: 'b', app: 'c' }), 'customized'],
    [c({ oldRef: 'a', newRef: 'a', app: 'z' }), null],
    [c({ oldRef: null, newRef: 'b', app: null }), 'new-absent'],
    [c({ oldRef: null, newRef: 'b', app: 'q' }), 'new-ok'],
    [c({ oldRef: 'a', newRef: null, app: 'a' }), 'removed'],
    [c({ oldRef: 'a', newRef: 'b', app: null }), 'app-dropped'],
    [pickCliVersion('2.2.1', ['2.2.0', '2.3.0', '2.3.2', '2.4.0', '2.4.1-canary.1']), '2.2.0'],
    [pickCliVersion('2.3.0', ['2.2.0', '2.3.0', '2.3.2', '2.4.0']), '2.3.2'],
    [pickCliVersion('2.5.0', ['2.2.0', '2.4.0']), '2.4.0'],
    [pickCliVersion('1.0.0', ['2.2.0']), null],
    [norm('﻿a\r\nb  \r\n\r\n'), 'a\nb'],
    [keyRuleFromSource('({ componentName: toPascalCase(name), moduleName: toPascalCase(name) })'), 'pascal-split'],
    [keyRuleFromSource('// TODO: enabled using toPascalCase()\n({ componentName: name,\n moduleName: toPascalCase(name).replace(/x/, "") })'), 'verbatim'],
    [keyRuleFromSource('no templating here'), 'unknown'],
    [JSON.stringify(hunkReport('x\ny', 'x\nz', 'q\nz')), JSON.stringify([{ sign: '+', line: 'z', inApp: true }, { sign: '-', line: 'y', inApp: false }])],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length) die(2, `self-check failed: ${JSON.stringify(bad)}`);
}

// ---------------------------------------------------------------- fs helpers
function walk(root) {
  const out = [];
  const rec = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) rec(join(dir, e.name)); }
      else out.push(relative(root, join(dir, e.name)).split(sep).join('/'));
    }
  };
  rec(root);
  return out;
}
const readNorm = (p) => (existsSync(p) && statSync(p).isFile() ? norm(readFileSync(p, 'utf8')) : null);

function npmJson(args) {
  const r = spawnSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) die(2, `npm ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout);
}

function scaffold(version, template, dest, fresh) {
  if (existsSync(join(dest, 'package.json')) && !fresh) { say(`  reuse  ${CLI}@${version} → ${dest}`); return; }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  say(`  scaffold ${CLI}@${version} ${template} → ${dest}`);
  const r = spawnSync('npx', ['--yes', `${CLI}@${version}`, template, '--destination', dest, '--yes', '--noInstall', '--silent'],
    { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0 || !existsSync(join(dest, 'package.json')))
    die(2, `scaffold of ${CLI}@${version} failed (never hand-write the reference)\n${r.stderr || r.stdout}`);
}

function installedSdk(app, gitRef) {
  if (gitRef) {
    const r = spawnSync('git', ['-C', app, 'show', `${gitRef}:package-lock.json`], { encoding: 'utf8' });
    if (r.status !== 0) die(2, `git show ${gitRef}:package-lock.json failed in ${app}: ${r.stderr}`);
    const v = JSON.parse(r.stdout.replace(/^﻿/, '')).packages?.[`node_modules/${SDK_PKG}`]?.version;
    if (!v) die(2, `${SDK_PKG} not in package-lock.json at ${gitRef}`);
    return { version: v, source: `package-lock.json @ ${gitRef}` };
  }
  const lock = join(app, 'package-lock.json');
  if (existsSync(lock)) {
    const j = JSON.parse(readFileSync(lock, 'utf8').replace(/^﻿/, ''));
    const v = j.packages?.[`node_modules/${SDK_PKG}`]?.version;
    if (v) return { version: v, source: 'package-lock.json' };
  }
  const nm = join(app, 'node_modules', SDK_PKG, 'package.json');
  if (existsSync(nm)) return { version: JSON.parse(readFileSync(nm, 'utf8')).version, source: 'node_modules' };
  const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8').replace(/^﻿/, ''));
  const range = pkg.dependencies?.[SDK_PKG];
  if (!range) die(2, `${SDK_PKG} is not a dependency of ${app}`);
  return { version: range.replace(/^[\^~]/, ''), source: 'package.json range (no lock)' };
}

// ---------------------------------------------------------------- component-map key rule
const CONTENT_PKG = '@sitecore-content-sdk/content';
const templatingSource = (pkgDir) => ['esm', 'cjs'].map((k) => join(pkgDir, 'dist', k, 'tools', 'templating', 'components.js')).find(existsSync);
function installedKeyRule(app) {
  const dir = join(app, 'node_modules', CONTENT_PKG);
  const src = templatingSource(dir);
  if (!src) return { version: null, rule: 'not-installed' };
  const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  return { version, rule: keyRuleFromSource(readFileSync(src, 'utf8')) };
}
/** Resolve the content version the target template pulls in (nextjs range → content range → newest
 *  stable), `npm pack` it into the workdir and read its templating source. Never fatal. */
function targetKeyRule(nextjsRange, workdir) {
  try {
    const nextjsVer = [].concat(npmJson(['view', `${SDK_PKG}@${nextjsRange}`, 'version', '--json'])).filter(isStable).sort(cmpVer).at(-1);
    const contentRange = npmJson(['view', `${SDK_PKG}@${nextjsVer}`, `dependencies.${CONTENT_PKG}`, '--json']);
    const version = [].concat(npmJson(['view', `${CONTENT_PKG}@${contentRange}`, 'version', '--json'])).filter(isStable).sort(cmpVer).at(-1);
    const dest = join(workdir, `content@${version}`);
    if (!templatingSource(join(dest, 'package'))) {
      mkdirSync(dest, { recursive: true });
      const pack = spawnSync('npm', ['pack', `${CONTENT_PKG}@${version}`, '--pack-destination', dest, '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' });
      const tgz = readdirSync(dest).find((f) => f.endsWith('.tgz'));
      if (pack.status !== 0 || !tgz) return { version, rule: 'unknown', note: `npm pack failed: ${pack.stderr || pack.stdout}` };
      // Relative archive name + cwd: an absolute Windows path carries a colon, which GNU tar reads as a remote host.
      const tar = spawnSync('tar', ['-xzf', tgz], { cwd: dest, encoding: 'utf8' });
      if (tar.status !== 0) return { version, rule: 'unknown', note: `tar failed: ${tar.stderr}` };
    }
    const src = templatingSource(join(dest, 'package'));
    return src ? { version, rule: keyRuleFromSource(readFileSync(src, 'utf8')) } : { version, rule: 'unknown', note: 'templating source not in the package' };
  } catch (e) { return { version: null, rule: 'unknown', note: e.message }; }
}

function detectTemplate(app) {
  if (existsSync(join(app, 'src', 'pages'))) return 'nextjs';
  if (existsSync(join(app, 'src', 'lib', 'cache'))) return 'nextjs-app-router-cache-components';
  if (existsSync(join(app, 'src', 'app'))) return 'nextjs-app-router';
  die(2, `cannot detect router in ${app} (no src/app or src/pages) — pass --template`);
}

// ---------------------------------------------------------------- main
selfCheck();
const appDir = opt('app') ? resolve(opt('app')) : die(2, '--app <head-app dir> is required');
if (!existsSync(join(appDir, 'package.json'))) die(2, `${appDir} has no package.json`);

const template = opt('template', detectTemplate(appDir));
const cliVersions = npmJson(['view', CLI, 'versions', '--json']);
const installed = installedSdk(appDir, opt('from-git'));
const fromExplicit = Boolean(opt('from'));
const from = opt('from', pickCliVersion(installed.version, cliVersions));
if (!from) die(2, `no stable ${CLI} release at or below installed ${SDK_PKG}@${installed.version}`);
const to = opt('to', cliVersions.filter(isStable).sort(cmpVer).at(-1));
if (!cliVersions.includes(from)) die(2, `${CLI}@${from} does not exist`);
if (!cliVersions.includes(to)) die(2, `${CLI}@${to} does not exist`);

const workdir = resolve(opt('workdir', join(tmpdir(), 'csdk-upgrade-surface')));
const refOld = join(workdir, `${template}@${from}`), refNew = join(workdir, `${template}@${to}`);
say(`app        ${appDir}`);
say(`installed  ${SDK_PKG}@${installed.version} (${installed.source})  →  reference ${CLI}@${from}`);
say(`target     ${CLI}@${to}   template ${template}`);
scaffold(from, template, refOld, flag('fresh'));
scaffold(to, template, refNew, flag('fresh'));

// The old reference must really pin the installed minor, or the "stale" verdicts are noise.
const refPin = (d) => JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).dependencies?.[SDK_PKG] ?? '?';
const oldPin = refPin(refOld), newPin = refPin(refNew);
const pinMinor = (r) => r.replace(/^[\^~]/, '').split('.').slice(0, 2).join('.');
const warnings = [];
if (!fromExplicit && pinMinor(oldPin) !== installed.version.split('.').slice(0, 2).join('.'))
  warnings.push(`old reference ${CLI}@${from} pins ${SDK_PKG} ${oldPin}, app was on ${installed.version} — pass --from explicitly`);
if (from === to) warnings.push(`from == to (${to}): the app is already on the target — use --from-git <ref> to verify a landed upgrade`);

const files = [...new Set([...walk(refOld), ...walk(refNew)])].sort();
const findings = [];
for (const f of files) {
  if (!flag('include-docs') && DOC_NOISE.test(f)) continue;
  const oldT = readNorm(join(refOld, f)), newT = readNorm(join(refNew, f)), appT = readNorm(join(appDir, f));
  const kind = classify({ oldRef: oldT, newRef: newT, app: appT });
  if (!kind) continue;
  const entry = { file: f, kind };
  if (kind === 'customized') entry.hunks = hunkReport(oldT, newT, appT);
  findings.push(entry);
}

// package.json is always customized; the useful question is per-package range agreement.
const appPkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8').replace(/^﻿/, ''));
const newPkg = JSON.parse(readFileSync(join(refNew, 'package.json'), 'utf8'));
const deps = [];
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, range] of Object.entries(newPkg[section] ?? {})) {
    if (!name.startsWith('@sitecore')) continue;
    const have = appPkg.dependencies?.[name] ?? appPkg.devDependencies?.[name] ?? null;
    deps.push({ name, template: range, app: have, match: have === range });
  }
}

// Component-map key rule, installed vs target — a generated file changing meaning on the bump.
const mapKeyRule = { installed: installedKeyRule(appDir), target: targetKeyRule(newPin, workdir) };
const compDir = join(appDir, 'src', 'components');
const sepDirs = existsSync(compDir) ? readdirSync(compDir).filter((d) => /[-_]/.test(d) && !/^(content-sdk|partial-design-dynamic-placeholder|__tests__)$/.test(d)) : [];
if (mapKeyRule.installed.rule !== mapKeyRule.target.rule && mapKeyRule.target.rule !== 'unknown' && sepDirs.length)
  warnings.push(`component-map key rule changes on this bump (${mapKeyRule.installed.rule} → ${mapKeyRule.target.rule}); these src/components/ folders carry _ or - and their keys will change: ${sepDirs.join(', ')} — reconcile against the renderings' componentName (content-sdk-component-naming-traps trap 6)`);

const counts = Object.fromEntries(['upgraded', 'stale', 'new-ok', 'new-absent', 'customized', 'removed', 'app-dropped'].map((k) => [k, findings.filter((x) => x.kind === k).length]));
const fail = counts.stale + counts['new-absent'] > 0;
const result = { app: appDir, template, installed, from, to, refPins: { old: oldPin, new: newPin }, workdir, counts, findings, sitecoreDeps: deps, mapKeyRule, warnings, exit: fail ? 1 : 0 };

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exit(result.exit); }

const order = ['stale', 'new-absent', 'customized', 'removed', 'app-dropped', 'new-ok', 'upgraded'];
const tag = { stale: 'STALE      ', 'new-absent': 'NEW ABSENT ', customized: 'CUSTOMIZED ', removed: 'REMOVED    ', 'app-dropped': 'APP-DROPPED', 'new-ok': 'new ok     ', upgraded: 'upgraded   ' };
if (!QUIET || fail) {
  console.log(`\nupgrade surface ${from} → ${to}: ${findings.length} file(s)`);
  for (const k of order) for (const x of findings.filter((y) => y.kind === k)) {
    console.log(`  ${tag[k]} ${x.file}`);
    if (k === 'customized') for (const h of x.hunks) console.log(`               ${h.inApp === (h.sign === '+') ? '  ' : '?!'} ${h.sign} ${h.line}`);
  }
  console.log('\n@sitecore* ranges vs the target template:');
  for (const d of deps) console.log(`  ${d.match ? '  ' : '!!'} ${d.name.padEnd(42)} template ${String(d.template).padEnd(9)} app ${d.app ?? '(absent)'}`);
  console.log(`\ncomponent-map key rule:  installed ${CONTENT_PKG}@${mapKeyRule.installed.version ?? '?'} → ${mapKeyRule.installed.rule}   target @${mapKeyRule.target.version ?? '?'} → ${mapKeyRule.target.rule}${mapKeyRule.target.note ? ` (${mapKeyRule.target.note})` : ''}`);
  for (const w of warnings) console.log(`\nWARN ${w}`);
  console.log(`\n${fail ? 'FAIL' : 'OK'}  stale=${counts.stale} new-absent=${counts['new-absent']} customized=${counts.customized} (state a verdict per customized file) removed=${counts.removed} app-dropped=${counts['app-dropped']}`);
  console.log(`references kept at ${workdir} (--fresh to rescaffold)`);
}
process.exit(result.exit);
