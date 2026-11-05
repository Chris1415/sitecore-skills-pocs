/**
 * Derive the non-Claude agent manifests from the Claude ones, so .claude-plugin/
 * stays the single source of truth.
 *
 *   node scripts/gen-agent-manifests.mjs          # write
 *   node scripts/gen-agent-manifests.mjs --check  # exit 1 on drift (CI / pre-commit)
 *
 * Only Cursor needs its own files: Copilot CLI, Codex, gh skill, Gemini CLI and
 * skills.sh read .claude-plugin/ or the skills/ tree directly (probed 2026-10-13).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

// Cursor's plugin.json schema (cursor.com/docs/reference/plugins). Anything else
// (displayName, …) is Claude-only and dropped.
const CURSOR_PLUGIN_FIELDS = ["name", "description", "version", "author", "homepage", "repository", "license", "keywords", "logo"];
const CURSOR_ENTRY_FIELDS = [...CURSOR_PLUGIN_FIELDS, "category", "tags"];

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
// Cursor requires relative paths without "./" or "..".
const relSource = (s) => s.replace(/^\.\//, "");

const outputs = new Map();
const market = readJson(".claude-plugin/marketplace.json");

outputs.set(".cursor-plugin/marketplace.json", {
  name: market.name,
  owner: pick(market.owner, ["name", "email"]),
  metadata: { description: market.description, version: market.version },
  plugins: market.plugins.map((p) => ({ ...pick(p, CURSOR_ENTRY_FIELDS), source: relSource(p.source) })),
});

for (const p of market.plugins) {
  const dir = relSource(p.source);
  const manifest = readJson(path.join(dir, ".claude-plugin/plugin.json"));
  // No default: a silently filled-in license once published the UNLICENSED solo plugin as Apache-2.0.
  if (!manifest.license) {
    console.error(`error: ${dir}/.claude-plugin/plugin.json has no license`);
    process.exit(1);
  }
  outputs.set(path.posix.join(dir, ".cursor-plugin/plugin.json"), {
    ...pick(manifest, CURSOR_PLUGIN_FIELDS),
  });
}

let drift = 0;
for (const [rel, data] of outputs) {
  const file = path.join(root, rel);
  const text = JSON.stringify(data, null, 2) + "\n";
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
  if (current === text) continue;
  if (check) {
    console.error(`drift: ${rel}`);
    drift++;
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${rel}`);
  }
}
if (check && drift) {
  console.error(`${drift} manifest(s) out of date — run: node scripts/gen-agent-manifests.mjs`);
  process.exit(1);
}
if (check) console.log(`ok: ${outputs.size} agent manifests in sync`);
