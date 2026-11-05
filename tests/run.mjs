#!/usr/bin/env node
/**
 * Self-tests for the repo checks: each check must PASS a good fixture and FAIL each broken one
 * with the expected rule. A check that cannot fail proves nothing. Fixtures are built in a temp
 * dir at run time, so no deliberately bad content (fake keys, private names) is ever committed.
 *
 *   node tests/run.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'skills-checks-'));
let failed = 0; let passed = 0;
const run = (script, args, cwd = REPO, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, SCRUB_PATTERNS: '', ...env } });
const expect = (label, r, code, needle) => {
  const out = `${r.stdout}${r.stderr}`;
  const ok = r.status === code && (!needle || out.includes(needle));
  if (ok) passed++; else { failed++; console.log(`FAIL ${label}: exit ${r.status} (want ${code})${needle ? `, want "${needle}"` : ''}\n${out.split('\n').slice(0, 6).join('\n')}`); }
};

// ── fixture repo builder ─────────────────────────────────────────────────────
const SKILL = (o = {}) => {
  const fm = { name: 'alpha-hello', description: 'Says hello. Use when greeting.', license: 'Apache-2.0', ...o.fm };
  const lines = Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => (typeof v === 'object' ? `${k}:\n${Object.entries(v).map(([a, b]) => (typeof b === 'object' ? `  ${a}:\n${Object.entries(b).map(([c, d]) => `    ${c}: ${d}`).join('\n')}` : `  ${a}: "${b}"`)).join('\n')}` : `${k}: "${v}"`));
  return `---\n${lines.join('\n')}\n---\n${o.body ?? '# Hello\n\nSay hello.\n'}`;
};
function fixture(name, mutate = {}) {
  const root = join(TMP, name);
  const plugin = { name: 'alpha', source: './plugins/alpha', version: '0.1.0', license: 'Apache-2.0', ...mutate.entry };
  const pj = { name: 'alpha', version: '0.1.0', license: 'Apache-2.0', ...mutate.pluginJson };
  for (const [k, v] of Object.entries(pj)) if (v === undefined) delete pj[k];
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'fixture', version: '0.1.0', plugins: [plugin] }));
  mkdirSync(join(root, 'plugins', 'alpha', '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, 'plugins', 'alpha', '.claude-plugin', 'plugin.json'), JSON.stringify(pj));
  if (!mutate.noRootLicense) writeFileSync(join(root, 'LICENSE'), 'Apache License 2.0\n');
  if (!mutate.noPluginLicense) writeFileSync(join(root, 'plugins', 'alpha', 'LICENSE'), 'Apache License 2.0\n');
  if (!mutate.noSkills) {
    const folder = mutate.folder ?? 'alpha-hello';
    mkdirSync(join(root, 'plugins', 'alpha', 'skills', folder), { recursive: true });
    writeFileSync(join(root, 'plugins', 'alpha', 'skills', folder, 'SKILL.md'), SKILL(mutate.skill));
  }
  if (mutate.extraDir) mkdirSync(join(root, 'plugins', mutate.extraDir, 'skills'), { recursive: true });
  if (mutate.baseline) { mkdirSync(join(root, 'tools', 'skill-lint'), { recursive: true }); writeFileSync(join(root, 'tools', 'skill-lint', 'baseline.json'), JSON.stringify(mutate.baseline)); }
  return root;
}

// ── skill-lint ───────────────────────────────────────────────────────────────
const LINT = join(REPO, 'tools', 'skill-lint.mjs');
const lint = (root) => run(LINT, ['--root', root]);
expect('lint: good fixture passes', lint(fixture('good')), 0);
const lintCases = [
  ['SL000', { noSkills: true }],
  ['SL003', { skill: { fm: { name: 'Alpha_Hello' } }, folder: 'Alpha_Hello' }],
  ['SL004', { skill: { fm: { name: 'alpha-other' } } }],
  ['SL005', { skill: { fm: { name: 'beta-hello' } }, folder: 'beta-hello' }],
  ['SL006', { skill: { fm: { description: 'a'.repeat(1025) } } }],
  ['SL007', { skill: { fm: { description: 'a'.repeat(251) } } }],
  ['SL008', { skill: { fm: { license: undefined } } }],
  ['SL009', { skill: { fm: { license: 'MIT' } } }],
  ['SL010', { skill: { fm: { license: 'UNLICENSED' } } }],
  ['SL012', { skill: { fm: { metadata: { upstream: { repo: 'x/y' } } } } }],
  ['SL013', { skill: { body: '\n' } }],
  ['SL015', { skill: { body: '# H\n\nSee `references/missing.md`.\n' } }],
  ['SL016', { skill: { body: '# H\n\nSee the `alpha-nope` skill\'s `references/x.md`.\n' } }],
  ['SL020', { skill: { body: '# H\n\nThen hand over to `alpha-nope`.\n' } }],
  ['MF001', { extraDir: 'orphan' }],
  ['MF003', { pluginJson: { version: '0.2.0' } }],
  ['MF004', { pluginJson: { license: undefined } }],
  ['MF005', { noPluginLicense: true }],
  ['MF005', { noRootLicense: true }],
  ['BL002', { baseline: [{ rule: 'SL004', path: 'plugins/alpha/skills/alpha-hello', reason: 'stale on purpose' }] }],
  ['BL001', { skill: { fm: { name: 'alpha-other' } }, baseline: [{ rule: 'SL004', path: 'plugins/alpha/skills/alpha-hello' }] }],
];
lintCases.forEach(([rule, m], i) => expect(`lint: ${rule} fixture fails`, lint(fixture(`lint-${i}-${rule}`, m)), 1, rule));
const longPath = fixture('lint-SL018');
const deep = join(longPath, 'plugins', 'alpha', 'skills', 'alpha-hello', 'references', 'a'.repeat(40));
mkdirSync(deep, { recursive: true }); writeFileSync(join(deep, `${'b'.repeat(70)}.md`), 'x\n');
expect('lint: SL018 fixture fails', lint(longPath), 1, 'SL018');
const dupName = fixture('lint-SL019');
mkdirSync(join(dupName, 'plugins', 'beta', 'skills', 'alpha-hello'), { recursive: true });
writeFileSync(join(dupName, 'plugins', 'beta', 'skills', 'alpha-hello', 'SKILL.md'), SKILL());
expect('lint: SL019 duplicate name across plugins fails', lint(dupName), 1, 'SL019');
expect('lint: SL020 a real skill name passes', lint(fixture('lint-SL020-ok', { skill: { body: '# H\n\nSee `alpha-hello`.\n' } })), 0);
expect('lint: waiver with reason turns the error green', lint(fixture('waived', { skill: { fm: { name: 'alpha-other' } }, baseline: [{ rule: 'SL004', path: 'plugins/alpha/skills/alpha-hello', reason: 'test' }] })), 0, 'WAIVED');

// ── scrub ────────────────────────────────────────────────────────────────────
const SCRUB = join(REPO, 'tools', 'scrub.mjs');
const CANARY = ['zz', 'canary', 'tenant'].join('-'); // assembled so this file never matches its own pattern
const values = JSON.stringify([{ category: 'tenant-id', pattern: CANARY, flags: 'i' }]);
const gitRepo = (name, files) => {
  const root = fixture(name);
  for (const [f, body] of Object.entries(files)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), body); }
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: root, stdio: 'ignore' });
  git('init', '-q'); git('add', '-A');
  return root;
};
const clean = gitRepo('scrub-clean', { 'README.md': 'nothing private here\n' });
const leaky = gitRepo('scrub-leaky', { 'plugins/alpha/skills/alpha-hello/references/x.md': `tenant ${CANARY.toUpperCase()} here\n` });
const pathy = gitRepo('scrub-path', { 'docs.md': 'see ' + ['C:', 'Users', 'someone', 'notes'].join('\\') + '\n' });
expect('scrub: clean repo passes', run(SCRUB, ['--root', clean], REPO, { SCRUB_PATTERNS: values }), 0);
const leak = run(SCRUB, ['--root', leaky], REPO, { SCRUB_PATTERNS: values });
expect('scrub: private hit fails', leak, 1, 'SCRUB tenant-id');
if (`${leak.stdout}${leak.stderr}`.toLowerCase().includes(CANARY)) { failed++; console.log('FAIL scrub: output leaked the private match'); } else passed++;
expect('scrub: public path rule fails', run(SCRUB, ['--root', pathy, '--public-only']), 1, 'abs-path-windows');
// Each public vocabulary rule fails on a planted hit (assembled, so this file stays clean).
for (const [category, planted] of [
  ['private-framework-name', ['hahn', 'solo'].join('-')],
  ['private-framework-rule', ['rule', '86'].join(' ')],
  ['private-framework-gate', ['go', 'live'].join('_')],
  ['private-framework-id', ['PRD', '000'].join('-')],
  ['real-org-id', ['org', 'AbCdEfGhIjKlMnOp'].join('_')],
  ['old-product-name', ['XM', 'Cloud'].join(' ')],
  ['private-framework-command', 'run ' + ['', 'create-prd'].join('/') + ' now'],
  ['private-memory-note', ['reference', 'sitecore', 'note'].join('_')],
]) {
  const r = gitRepo(`scrub-${category}`, { 'plugins/alpha/skills/alpha-hello/references/x.md': `see ${planted}\n` });
  expect(`scrub: public rule ${category} fails on a planted hit`, run(SCRUB, ['--root', r, '--public-only']), 1, category);
}
expect('scrub: no private patterns refuses to report clean', run(SCRUB, ['--root', clean]), 2);

// ── catalog ──────────────────────────────────────────────────────────────────
const CATALOG = join(REPO, 'tools', 'catalog.mjs');
const cat = fixture('catalog');
expect('catalog: write', run(CATALOG, ['--root', cat]), 0);
expect('catalog: in sync', run(CATALOG, ['--root', cat, '--check']), 0);
writeFileSync(join(cat, 'plugins', 'alpha', 'skills', 'alpha-hello', 'SKILL.md'), SKILL({ fm: { description: 'Changed.' } }));
expect('catalog: drift fails', run(CATALOG, ['--root', cat, '--check']), 1);

// ── gen-agent-manifests (copy of the real repo's manifests) ─────────────────
const gen = join(TMP, 'gen');
cpSync(join(REPO, 'scripts', 'gen-agent-manifests.mjs'), join(gen, 'scripts', 'gen-agent-manifests.mjs'));
for (const d of ['.claude-plugin', '.cursor-plugin']) cpSync(join(REPO, d), join(gen, d), { recursive: true });
for (const p of readdirSync(join(REPO, 'plugins'))) for (const d of ['.claude-plugin', '.cursor-plugin']) cpSync(join(REPO, 'plugins', p, d), join(gen, 'plugins', p, d), { recursive: true });
const GEN = join(gen, 'scripts', 'gen-agent-manifests.mjs');
expect('manifests: real copy in sync', run(GEN, ['--check'], gen), 0);
const cursorBlok = join(gen, 'plugins', 'sitecore-blok', '.cursor-plugin', 'plugin.json');
writeFileSync(cursorBlok, readFileSync(cursorBlok, 'utf8').replace('"sitecore-blok"', '"sitecore-blok-edited"'));
expect('manifests: hand-edited output fails', run(GEN, ['--check'], gen), 1, 'drift');
const claudeBlok = join(gen, 'plugins', 'sitecore-blok', '.claude-plugin', 'plugin.json');
const pj = JSON.parse(readFileSync(claudeBlok, 'utf8')); delete pj.license; writeFileSync(claudeBlok, JSON.stringify(pj));
expect('manifests: missing license fails (no default)', run(GEN, ['--check'], gen), 1, 'has no license');

// ── release-check (a fixture git repo: commit, change, check) ────────────────
const REL = join(REPO, 'tools', 'release-check.mjs');
const rel = fixture('release', { skill: { fm: { metadata: { version: '0.1.0' } } } });
const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: rel, stdio: 'ignore' });
g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-q', '-m', 'base'); g('tag', 'base');
const relCheck = () => run(REL, ['--root', rel, '--base', 'base']);
expect('release: unchanged passes', relCheck(), 0);
const relSkill = join(rel, 'plugins', 'alpha', 'skills', 'alpha-hello', 'SKILL.md');
const relPlugin = join(rel, 'plugins', 'alpha', '.claude-plugin', 'plugin.json');
writeFileSync(relSkill, readFileSync(relSkill, 'utf8') + '\nA new trap.\n');
expect('release: change without plugin bump fails', relCheck(), 1, 'RB001');
expect('release: change without skill bump fails', relCheck(), 1, 'RB002');
writeFileSync(relPlugin, JSON.stringify({ ...JSON.parse(readFileSync(relPlugin, 'utf8')), version: '0.1.1' }));
writeFileSync(relSkill, readFileSync(relSkill, 'utf8').replace('version: "0.1.0"', 'version: "0.1.1"'));
expect('release: bumped plugin and skill pass', relCheck(), 0);
const relU = fixture('release-untracked');
const gu = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: relU, stdio: 'ignore' });
gu('init', '-q', '-b', 'main'); gu('add', '-A'); gu('commit', '-q', '-m', 'base'); gu('tag', 'base');
mkdirSync(join(relU, 'plugins', 'alpha', 'skills', 'alpha-new'), { recursive: true });
writeFileSync(join(relU, 'plugins', 'alpha', 'skills', 'alpha-new', 'SKILL.md'), SKILL({ fm: { name: 'alpha-new' } }));
expect('release: new untracked skill without plugin bump fails', run(REL, ['--root', relU, '--base', 'base']), 1, 'RB001');
writeFileSync(relPlugin, JSON.stringify({ ...JSON.parse(readFileSync(relPlugin, 'utf8')), version: '0.0.9' }));
expect('release: lower version fails', relCheck(), 1, 'RB003');
expect('release: unknown base exits 2', run(REL, ['--root', rel, '--base', 'no-such-ref']), 2);

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed ? 1 : 0);
