#!/usr/bin/env node
/**
 * catalog — generates catalog.json: every plugin and skill with description, license and path.
 * Docs pages and listings can read it.
 *
 *   node tools/catalog.mjs [--root <dir>]          # write catalog.json
 *   node tools/catalog.mjs [--root <dir>] --check  # exit 1 when catalog.json is out of date
 *
 * When the guide skill exists, it also writes that skill's skill list (GUIDE_REF) from the same
 * data, so the "start here" skill can never describe a catalog other than the shipped one.
 *
 * Deterministic (no timestamps), so --check is a plain text compare.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSkills, parseFrontmatter, readJson, norm } from './lib/skills.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ROOT = resolve(opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

const market = readJson(join(ROOT, '.claude-plugin', 'marketplace.json'));
const skills = listSkills(ROOT);
const catalog = {
  schema: 1,
  marketplace: market.name,
  version: market.version,
  plugins: market.plugins.map((p) => ({
    name: p.name,
    displayName: p.displayName ?? p.name,
    version: p.version,
    license: p.license,
    skills: skills.filter((s) => `plugins/${s.plugin}` === p.source.replace(/^\.\//, '')).map((s) => {
      const { fm } = parseFrontmatter(readFileSync(join(s.dir, 'SKILL.md'), 'utf8'));
      return { name: fm?.name ?? s.name, description: fm?.description ?? '', license: fm?.license ?? '', version: fm?.metadata?.version ?? '', path: s.rel };
    }),
  })),
};
const text = JSON.stringify(catalog, null, 2) + '\n';
const out = join(ROOT, 'catalog.json');

const GUIDE_DIR = join(ROOT, 'plugins', 'sitecore-guide', 'skills', 'sitecore-skills-guide');
const GUIDE_REF = join(GUIDE_DIR, 'references', 'catalog.md');
const cell = (t) => String(t ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const code = (t) => '`' + t + '`';
function guideText() {
  const lines = ['# Sitecore skills catalog', '',
    `Generated from ${code('catalog.json')} by ${code('tools/catalog.mjs')}; do not edit. Marketplace ${code(catalog.marketplace)}: ${catalog.plugins.length} plugins, ${skills.length} skills. Versions are left out on purpose, so a version bump elsewhere does not change this skill.`, ''];
  for (const p of market.plugins) {
    const c = catalog.plugins.find((x) => x.name === p.name);
    lines.push(`## ${c.displayName} (${code(p.name)})`, '', cell(p.description), '',
      `Install in Claude Code: ${code(`/plugin install ${p.name}@${catalog.marketplace}`)}`, '',
      '| Skill | What it covers and when to use it |', '|---|---|',
      ...c.skills.map((s) => `| ${code(s.name)} | ${cell(s.description)} |`), '');
  }
  return lines.join('\n');
}
const guide = existsSync(join(GUIDE_DIR, 'SKILL.md')) ? guideText() : null;

if (args.includes('--check')) {
  const current = existsSync(out) ? norm(readFileSync(out, 'utf8')) : null;
  if (current !== text) { console.error('catalog.json is out of date; run: node tools/catalog.mjs'); process.exit(1); }
  if (guide !== null && (existsSync(GUIDE_REF) ? norm(readFileSync(GUIDE_REF, 'utf8')) : null) !== guide) {
    console.error('guide skill catalog (references/catalog.md) is out of date; run: node tools/catalog.mjs'); process.exit(1);
  }
  console.log(`ok: catalog.json${guide !== null ? ' and guide catalog' : ''} in sync (${catalog.plugins.length} plugins, ${skills.length} skills)`);
} else {
  writeFileSync(out, text);
  if (guide !== null) { mkdirSync(dirname(GUIDE_REF), { recursive: true }); writeFileSync(GUIDE_REF, guide); }
  console.log(`wrote catalog.json${guide !== null ? ' and guide catalog' : ''} (${catalog.plugins.length} plugins, ${skills.length} skills)`);
}
