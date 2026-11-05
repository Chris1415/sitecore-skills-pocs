#!/usr/bin/env node
/**
 * scrub — fails when a tracked text file names something private: an absolute workstation path,
 * a tenant id, a customer brand, a private repository, or the vocabulary of a private framework.
 *
 *   node tools/scrub.mjs [--root <dir>] [--values <file>] [--report] [--public-only]
 *
 * Patterns come from two places:
 *   - tools/scrub/rules.json: public patterns, committed;
 *   - SCRUB_PATTERNS (env, a GitHub Actions secret) or --values <file> outside the repo:
 *     private patterns, never committed. Output names only their category, never the match.
 * Without private patterns the gate fails, because a scan that silently skips proves nothing.
 * --public-only runs the public rules alone: for local runs, and in CI only for pull requests
 * from forks, which GitHub gives no secrets (see .github/workflows/validate.yml).
 * --report prints counts per category and plugin and exits 0.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { norm, readJson } from './lib/skills.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ROOT = resolve(opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|wasm|mp4|mp3|webm)$/i;

const toRule = (r, isPrivate) => ({ category: r.category, re: new RegExp(r.pattern, r.flags ?? ''), isPrivate });
// Public rules ship with the tool, not with the scanned tree, so a tree cannot opt out by omitting them.
const rulesFile = join(dirname(fileURLToPath(import.meta.url)), 'scrub', 'rules.json');
const rules = existsSync(rulesFile) ? readJson(rulesFile).rules.map((r) => toRule(r, false)) : [];

let privateSrc = process.env.SCRUB_PATTERNS || null;
if (opt('--values')) privateSrc = readFileSync(opt('--values'), 'utf8');
if (privateSrc) rules.push(...JSON.parse(norm(privateSrc)).map((r) => toRule(r, true)));
else if (!args.includes('--public-only')) {
  console.error('scrub: no private patterns (set SCRUB_PATTERNS or pass --values <file>); refusing to report clean. Use --public-only for a local public-rules run.');
  process.exit(2);
}
if (rules.length === 0) { console.error('scrub: 0 rules loaded; refusing to report clean.'); process.exit(2); }
// Files exempt by design: the scrub rules themselves.
const EXEMPT = new Set(['tools/scrub/rules.json']);

// Tracked files only: what is not committed cannot leak through the repo.
const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter((f) => f && !BINARY_EXT.test(f) && !EXEMPT.has(f));
const hits = [];
for (const f of files) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  const lines = norm(readFileSync(p, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const r of rules) {
      r.re.lastIndex = 0;
      const m = r.re.exec(line);
      if (m) hits.push({ file: f, line: i + 1, category: r.category, shown: r.isPrivate ? '<private>' : m[0] });
    }
  });
}

if (args.includes('--report')) {
  const by = (key) => hits.reduce((a, h) => ((a[key(h)] = (a[key(h)] ?? 0) + 1), a), {});
  const pluginOf = (f) => (f.startsWith('plugins/') ? f.split('/')[1] : '(repo)');
  console.log(JSON.stringify({ files: files.length, rules: rules.length, private_rules: rules.filter((r) => r.isPrivate).length, hits: hits.length,
    files_with_hits: new Set(hits.map((h) => h.file)).size,
    skills_with_hits: new Set(hits.filter((h) => /^plugins\/[^/]+\/skills\/[^/]+\//.test(h.file)).map((h) => h.file.split('/').slice(0, 4).join('/'))).size,
    by_category: by((h) => h.category), by_plugin: by((h) => pluginOf(h.file)) }, null, 2));
  process.exit(0);
}
for (const h of hits) console.log(`SCRUB ${h.category} ${h.file}:${h.line} ${h.shown}`);
console.log(`\n${files.length} files · ${rules.length} rules (${rules.filter((r) => r.isPrivate).length} private) · ${hits.length} hits`);
process.exit(hits.length ? 1 : 0);
