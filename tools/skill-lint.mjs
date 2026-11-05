#!/usr/bin/env node
/**
 * skill-lint — checks every skill and plugin manifest against the Agent Skills spec and this
 * repo's conventions.
 *
 *   node tools/skill-lint.mjs [--root <dir>] [--json] [--no-baseline]
 *
 * Exit 1 on any ERROR not waived in tools/skill-lint/baseline.json, 0 otherwise. A baseline
 * entry that no longer matches is itself an ERROR, so waivers cannot outlive their finding.
 * Rule IDs are stable: SL = skill, MF = manifest, BU = listing budget. See tools/README.md.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSkills, parseFrontmatter, readJson, norm, gitignoredInside, walkText } from './lib/skills.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ROOT = resolve(opt('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..'));

// Agent Skills spec + Claude Code frontmatter keys. Unknown keys warn: a typo'd key silently does nothing.
const KNOWN_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'disable-model-invocation',
  'user-invocable', 'argument-hint', 'model', 'context', 'agent', 'hooks', 'paths', 'version', 'compatibility', 'effort']);
const LICENSES = new Set(['Apache-2.0', 'UNLICENSED']);
// Skill names carry their plugin as prefix; a plugin not listed here uses `<plugin>-`.
// Plugins carry a sitecore- prefix (decision 2026-10-22); skill names keep their product prefix.
const PREFIX = {
  'sitecore-content-sdk-nextjs-app-router': 'content-sdk-app-router-', 'sitecore-content-sdk-nextjs-pages-router': 'content-sdk-pages-router-',
  'sitecore-content-sdk': 'content-sdk-', 'sitecore-platform': 'sitecoreai-', 'sitecore-marketplace': 'marketplace-sdk-',
  'sitecore-blok': 'blok-', 'sitecore-setup': 'setup-', 'sitecore-guide': 'sitecore-skills-',
};
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const XML_RE = /<[^>]+>/;
// Claude Code's default listing budget: 200k context × 4 bytes/token × 1% (measured 2026-09-16).
const LISTING_BUDGET = 8000;
const DESC_TARGET = 250;
// Repo-relative path cap. Agents clone into deep homes (e.g. ~/.codex/.tmp/marketplaces/<name>/);
// past Windows' 260-char limit Codex fails with "Filename too long" (probe 2026-10-21).
const PATH_MAX = 140;

const findings = [];
const add = (severity, rule, path, msg) => findings.push({ severity, rule, path, msg });

// ── manifests ────────────────────────────────────────────────────────────────
const marketPath = join(ROOT, '.claude-plugin', 'marketplace.json');
const pluginLicense = {};
if (!existsSync(join(ROOT, 'LICENSE'))) add('ERROR', 'MF005', 'LICENSE', 'no root LICENSE file');
if (!existsSync(marketPath)) add('ERROR', 'MF001', '.claude-plugin/marketplace.json', 'marketplace manifest missing');
else {
  const market = readJson(marketPath);
  const listed = new Map(market.plugins.map((p) => [p.source.replace(/^\.\//, ''), p]));
  const dirs = existsSync(join(ROOT, 'plugins')) ? readdirSync(join(ROOT, 'plugins'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `plugins/${d.name}`) : [];
  for (const d of dirs) if (!listed.has(d)) add('ERROR', 'MF001', d, 'plugin directory is not listed in marketplace.json');
  for (const [src, entry] of listed) {
    if (!existsSync(join(ROOT, src))) { add('ERROR', 'MF001', src, `marketplace entry "${entry.name}" points at a missing directory`); continue; }
    const mf = join(ROOT, src, '.claude-plugin', 'plugin.json');
    if (!existsSync(mf)) { add('ERROR', 'MF002', src, 'no .claude-plugin/plugin.json'); continue; }
    const pj = readJson(mf);
    if (pj.name !== entry.name) add('ERROR', 'MF002', src, `plugin.json name "${pj.name}" ≠ marketplace entry "${entry.name}"`);
    if (pj.version !== entry.version) add('ERROR', 'MF003', src, `version ${pj.version} in plugin.json ≠ ${entry.version} in marketplace.json`);
    if (!pj.license || !entry.license) add('ERROR', 'MF004', src, 'license must be explicit in plugin.json and the marketplace entry (generators must not default it)');
    else if (pj.license !== entry.license) add('ERROR', 'MF004', src, `license ${pj.license} in plugin.json ≠ ${entry.license} in marketplace.json`);
    else if (!LICENSES.has(pj.license)) add('ERROR', 'MF004', src, `license "${pj.license}" is not one of ${[...LICENSES].join(', ')}`);
    if (pj.license === 'Apache-2.0' && !existsSync(join(ROOT, src, 'LICENSE'))) add('ERROR', 'MF005', src, 'Apache-2.0 plugin without its own LICENSE copy (plugins install standalone)');
    pluginLicense[src.replace(/^plugins\//, '')] = pj.license;
  }
}

// ── skills ───────────────────────────────────────────────────────────────────
const skills = listSkills(ROOT);
const byName = new Map(skills.map((s) => [s.name, s]));
const listing = {};
for (const s of skills) {
  const { plugin, name, dir, rel } = s;
  const hit = readdirSync(dir).find((x) => x.toLowerCase() === 'skill.md');
  if (!hit) { add('ERROR', 'SL001', rel, 'no SKILL.md'); continue; }
  if (hit !== 'SKILL.md') add('ERROR', 'SL001', rel, `file is ${hit}; must be spelled SKILL.md`);
  const { fm, order, body, error } = parseFrontmatter(readFileSync(join(dir, hit), 'utf8'));
  if (!fm) { add('ERROR', 'SL002', rel, error); continue; }

  const n = fm.name;
  if (typeof n !== 'string' || !n) add('ERROR', 'SL003', rel, 'name missing');
  else {
    if (!NAME_RE.test(n) || n.length > 64) add('ERROR', 'SL003', rel, `name "${n}" must be lowercase [a-z0-9-], ≤ 64 chars`);
    if (n !== name) add('ERROR', 'SL004', rel, `name "${n}" ≠ folder "${name}"`);
    const prefix = PREFIX[plugin] ?? `${plugin}-`;
    if (!n.startsWith(prefix)) add('ERROR', 'SL005', rel, `name lacks the plugin prefix "${prefix}"`);
  }

  const d = fm.description;
  if (typeof d !== 'string' || !d) add('ERROR', 'SL006', rel, 'description missing');
  else {
    if (d.length > 1024) add('ERROR', 'SL006', rel, `description is ${d.length} chars; spec max 1024`);
    if (XML_RE.test(d)) add('ERROR', 'SL006', rel, 'description contains an XML-like <tag>');
    if (d.length > DESC_TARGET) add('ERROR', 'SL007', rel, `description is ${d.length} chars; max ${DESC_TARGET} (what · when · not, trigger words first)`);
    listing[plugin] = (listing[plugin] ?? 0) + name.length + 4 + Math.min(d.length, 1536);
  }

  if (!fm.license) add('ERROR', 'SL008', rel, 'license missing');
  else if (!LICENSES.has(fm.license)) add('ERROR', 'SL009', rel, `license "${fm.license}" is not one of ${[...LICENSES].join(', ')}`);
  else if (pluginLicense[plugin] && fm.license !== pluginLicense[plugin]) add('ERROR', 'SL010', rel, `license ${fm.license} ≠ plugin license ${pluginLicense[plugin]}`);

  for (const k of order) if (!KNOWN_KEYS.has(k)) add('WARN', 'SL011', rel, `unknown frontmatter key "${k}"`);
  if (fm.metadata && typeof fm.metadata === 'object') {
    for (const [k, v] of Object.entries(fm.metadata)) if (typeof v !== 'string') add('ERROR', 'SL012', rel, `metadata.${k} is not a string (spec: string → string map)`);
  }

  if (!body.trim()) add('ERROR', 'SL013', rel, 'body is empty');
  for (const f of walkText(dir)) if (`${rel}/${f}`.length > PATH_MAX) add('ERROR', 'SL018', rel, `path ${rel}/${f} is ${rel.length + f.length + 1} chars; max ${PATH_MAX} (Windows clones into deep homes)`);
  const tokens = Math.round(body.length / 4);
  if (tokens > 5000) add('WARN', 'SL014', rel, `body is ~${tokens} tokens; spec recommends < 5000 on activation`);

  // Relative references must resolve: `references/x.md` inside this skill, or
  // "the `other` skill's `references/x.md`" inside a sibling. Code blocks are skipped.
  const prose = body.replace(/```[\s\S]*?```/g, '');
  const refRe = /(?:the `([a-z0-9-]+)` skill'?s? `|`(?:\.\/)?)((?:references|reference|scripts|assets|templates|examples)\/[A-Za-z0-9_./-]+?)`/g;
  const seen = new Set();
  for (const [, sibling, ref] of prose.matchAll(refRe)) {
    const key = `${sibling ?? ''}|${ref}`; if (seen.has(key)) continue; seen.add(key);
    const clean = ref.replace(/\/+$/, '');
    if (sibling) {
      const other = byName.get(sibling);
      if (!other) add('ERROR', 'SL016', rel, `references \`${ref}\` in skill "${sibling}", which does not exist`);
      else if (!existsSync(join(other.dir, clean))) add('ERROR', 'SL016', rel, `references \`${ref}\` in "${sibling}", which does not have it`);
      else if (other.plugin !== plugin) add('WARN', 'SL017', rel, `references a file in "${sibling}" (plugin ${other.plugin}); dangling for a consumer who installs only ${plugin}`);
    } else if (!existsSync(join(dir, clean)) && !gitignoredInside(dir, clean)) {
      add('ERROR', 'SL015', rel, `body references \`${ref}\`, which does not exist in this skill`);
    }
  }
}
if (skills.length === 0) add('ERROR', 'SL000', 'plugins', 'no skills found; an empty tree is never a clean one');
// Names must be unique repo-wide: `npx skills` silently drops a duplicate, `gh skill` refuses it (probe 2026-10-21).
const seenNames = new Map();
for (const s of skills) {
  if (seenNames.has(s.name)) add('ERROR', 'SL019', s.rel, `skill name "${s.name}" is also used in ${seenNames.get(s.name)}; names must be unique across all plugins`);
  else seenNames.set(s.name, s.rel);
}
// A backticked name in a skill's prefix shape must be a real skill: skills route to each other by name,
// and a rename or move (2026-10-22: plugins renamed, four skills moved) otherwise leaves dead pointers.
const prefixes = [...new Set(skills.map((s) => (PREFIX[s.plugin] ?? `${s.plugin}-`).replace(/-$/, '')))];
const SKILL_LIKE = new RegExp(`\`((?:${prefixes.join('|')})-[a-z0-9]+(?:-[a-z0-9]+)*)\``, 'g');
// Names in that shape that are not skills, each with the reason.
const NOT_SKILLS = new Map([
  ['solo-website', 'the SitecoreAI starter repository, named as the thing not to clone'],
  ['content-sdk-nextjs-app-router', 'the package name the nextjs-app-router scaffold writes'],
]);
const pluginNames = new Set(skills.map((s) => s.plugin));
for (const s of skills) {
  const text = readFileSync(join(s.dir, 'SKILL.md'), 'utf8');
  for (const m of new Set([...text.matchAll(SKILL_LIKE)].map((x) => x[1]))) {
    if (!seenNames.has(m) && !pluginNames.has(m) && !NOT_SKILLS.has(m)) add('ERROR', 'SL020', s.rel, `names skill \`${m}\`, which does not exist (renamed or moved?)`);
  }
}

// ── listing budget (information only) ───────────────────────────────────────
const total = Object.values(listing).reduce((a, b) => a + b, 0);
// Information only: nobody installs every plugin at once, so the total is not a gate.
add('INFO', 'BU001', '(all)', `listing ${total} chars for ${skills.length} skills vs Claude Code default ${LISTING_BUDGET}; per plugin: ${Object.entries(listing).map(([p, c]) => `${p} ${c}`).join(', ')}`);

// ── baseline (waivers with a reason; stale entries fail) ────────────────────
const basePath = join(ROOT, 'tools', 'skill-lint', 'baseline.json');
if (!args.includes('--no-baseline') && existsSync(basePath)) {
  const base = readJson(basePath);
  for (const w of base) {
    if (!w.reason) add('ERROR', 'BL001', w.path, `baseline entry for ${w.rule} has no reason`);
    const matched = findings.filter((f) => f.severity === 'ERROR' && f.rule === w.rule && f.path === w.path);
    if (!matched.length) add('ERROR', 'BL002', w.path, `baseline entry for ${w.rule} matches nothing; remove it`);
    for (const f of matched) { f.severity = 'WAIVED'; f.msg += ` (waived: ${w.reason})`; }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const count = (s) => findings.filter((f) => f.severity === s).length;
if (args.includes('--json')) console.log(JSON.stringify({ skills: skills.length, findings }, null, 2));
else {
  const rank = { ERROR: 0, WAIVED: 1, WARN: 2, INFO: 3 };
  for (const f of [...findings].sort((a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path))) {
    console.log(`${f.severity.padEnd(6)} ${f.rule} ${f.path}: ${f.msg}`);
  }
  console.log(`\n${skills.length} skills · ${count('ERROR')} error · ${count('WAIVED')} waived · ${count('WARN')} warn`);
}
process.exit(count('ERROR') ? 1 : 0);
