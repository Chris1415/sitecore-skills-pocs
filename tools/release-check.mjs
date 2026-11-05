#!/usr/bin/env node
/**
 * release-check — a change to a plugin must raise its version, or installed users never get it.
 * Claude Code caches a plugin per version: `plugin update` skips a plugin whose version did not
 * change, even when its files did (measured 2026-10-21).
 *
 *   node tools/release-check.mjs --base <git ref> [--root <dir>]
 *
 * RB001  files under plugins/<p>/ changed, but plugin.json version did not
 * RB002  files of a skill changed, but its metadata.version did not
 * RB003  a version went down
 * Exit 1 on any finding, 2 when the base ref cannot be resolved.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseFrontmatter } from './lib/skills.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ROOT = resolve(opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const BASE = opt('--base');
const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
if (!BASE) { console.error('release-check: --base <ref> is required'); process.exit(2); }
let base;
try { base = git('merge-base', BASE, 'HEAD').trim(); } catch { console.error(`release-check: cannot resolve base "${BASE}"`); process.exit(2); }

const show = (path) => { try { return git('show', `${base}:${path}`); } catch { return null; } };
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// Committed changes since the base plus uncommitted and untracked ones, so it also works before a commit.
const changed = new Set([...git('diff', '--name-only', base, 'HEAD').split('\n'), ...git('diff', '--name-only', 'HEAD').split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean));

const findings = [];
const add = (rule, path, msg) => findings.push({ rule, path, msg });
const plugins = new Set(), skills = new Set();
for (const f of changed) {
  const m = f.match(/^plugins\/([^/]+)\/(?:skills\/([^/]+)\/)?/);
  if (!m) continue;
  plugins.add(m[1]);
  if (m[2]) skills.add(`${m[1]}/${m[2]}`);
}

for (const p of plugins) {
  const rel = `plugins/${p}/.claude-plugin/plugin.json`;
  const before = show(rel);
  if (!before || !existsSync(join(ROOT, rel))) continue; // new or removed plugin
  const was = JSON.parse(before).version, now = JSON.parse(readFileSync(join(ROOT, rel), 'utf8')).version;
  if (was === now) add('RB001', `plugins/${p}`, `files changed but the plugin version is still ${now}; installed users will not get the change`);
  else if (cmp(now, was) < 0) add('RB003', `plugins/${p}`, `plugin version went down: ${was} → ${now}`);
}
for (const s of skills) {
  const rel = `plugins/${s.replace('/', '/skills/')}/SKILL.md`;
  const before = show(rel);
  if (!before || !existsSync(join(ROOT, rel))) continue; // new or removed skill
  const was = parseFrontmatter(before).fm?.metadata?.version, now = parseFrontmatter(readFileSync(join(ROOT, rel), 'utf8')).fm?.metadata?.version;
  if (!was || !now) continue; // skills without metadata.version are the linter's business
  if (was === now) add('RB002', rel.replace(/\/SKILL\.md$/, ''), `skill files changed but metadata.version is still ${now}`);
  else if (cmp(now, was) < 0) add('RB003', rel.replace(/\/SKILL\.md$/, ''), `skill version went down: ${was} → ${now}`);
}

for (const f of findings) console.log(`ERROR  ${f.rule} ${f.path}: ${f.msg}`);
console.log(`${findings.length ? '\n' : ''}release-check vs ${BASE} (${base.slice(0, 7)}): ${plugins.size} plugin(s), ${skills.size} skill(s) changed · ${findings.length} error`);
process.exit(findings.length ? 1 : 0);
