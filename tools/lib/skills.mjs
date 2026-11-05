// Shared helpers for the repo checks: skill discovery, frontmatter parsing, text-file walking.
// No dependencies, so every check runs on a bare `node` in CI and on a contributor's machine.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n/g, '\n');
export const readJson = (p) => JSON.parse(norm(readFileSync(p, 'utf8')));

/** Every skill under plugins/<plugin>/skills/<name>/, sorted. */
export function listSkills(root) {
  const plugins = join(root, 'plugins');
  const out = [];
  if (!existsSync(plugins)) return out;
  for (const plugin of readdirSync(plugins).sort()) {
    const skills = join(plugins, plugin, 'skills');
    if (!existsSync(skills)) continue;
    for (const e of readdirSync(skills, { withFileTypes: true })) {
      if (e.isDirectory()) out.push({ plugin, name: e.name, dir: join(skills, e.name), rel: `plugins/${plugin}/skills/${e.name}` });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Minimal YAML frontmatter parser: top-level scalars, one level of nesting, simple lists, folded blocks. */
export function parseFrontmatter(text) {
  const lines = norm(text).split('\n');
  if (lines[0].trim() !== '---') return { fm: null, error: 'no frontmatter opener on line 1' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { fm: null, error: 'frontmatter never closed' };
  const fm = {}; const order = []; let cur = null;
  const unq = (v) => v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim();
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const top = line.match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (top) {
      const [, k, v] = top; order.push(k); cur = null;
      if (v === '') { fm[k] = {}; cur = k; }
      else if (/^[>|]-?$/.test(v)) {
        const parts = [];
        while (i + 1 < end && /^[ \t]+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
        fm[k] = parts.join(v.startsWith('|') ? '\n' : ' ').trim();
      } else fm[k] = unq(v);
      continue;
    }
    const nested = line.match(/^[ \t]+([A-Za-z_][\w-]*):[ \t]*(.*)$/);
    if (nested && cur && !Array.isArray(fm[cur])) { fm[cur][nested[1]] = nested[2] === '' ? {} : unq(nested[2]); continue; }
    const item = line.match(/^[ \t]*-[ \t]+(.*)$/);
    if (item && cur) { if (!Array.isArray(fm[cur])) fm[cur] = []; fm[cur].push(unq(item[1])); }
  }
  return { fm, order, body: lines.slice(end + 1).join('\n'), error: null };
}

const WALK_SKIP = new Set(['node_modules', 'out', 'dist', '.git']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|wasm|mp4|mp3|webm|glb|gltf|bin|exe|dll)$/i;

/** Every text file below `dir`, relative to it, sorted. Generated payload and binaries skipped. */
export function walkText(dir) {
  const out = [];
  const rec = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!WALK_SKIP.has(e.name)) rec(join(d, e.name), r); }
      else if (!BINARY_EXT.test(e.name)) out.push(r);
    }
  };
  if (existsSync(dir)) rec(dir, '');
  return out.sort();
}

/** Is skill-relative `rel` ignored by a .gitignore inside the skill (generated payload)? */
export function gitignoredInside(skillDir, rel) {
  const segs = rel.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const gi = join(skillDir, ...segs.slice(0, i), '.gitignore');
    if (!existsSync(gi)) continue;
    const rules = norm(readFileSync(gi, 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/^\//, '').replace(/\/$/, ''));
    const below = segs.slice(i);
    if (rules.some((r) => (r.includes('/') ? below.join('/').startsWith(r) : below.includes(r)))) return true;
  }
  return false;
}
