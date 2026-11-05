#!/usr/bin/env node
/**
 * assert-map-keys.mjs — does every rendering the CM knows have a key in the generated map?
 * (SKILL.md § Verification — "Reconcile keys against the CM")
 *
 *   node scripts/assert-map-keys.mjs --app <head-app> [--renderings <dir>…] [--json] [--quiet]
 *
 * Reads `.sitecore/component-map.ts` (the generated map — never hand-edited) and, when given
 * one or more serialized renderings folders (Sitecore CLI YAML: `Hint: componentName` /
 * `Value: …`), every rendering's `componentName`. Then:
 *
 *   missing-key     a componentName with no map key            → exit 1 (a guaranteed runtime blank)
 *   sep-in-name     a registered filename carrying `_` or `-`  → WARN  (trap 6 is version-sensitive)
 *   extra-key       a map key no serialized rendering names     → WARN  (infrastructure under
 *                                                                        src/components/, or a rendering
 *                                                                        the given folders do not cover)
 *
 * It also prints the KEY RULE of the installed `@sitecore-content-sdk/content` package, read off
 * its own source rather than a table: `verbatim` (key = file name; content ≥ 2.3.0) or
 * `pascal-split` (key = toPascalCase(name), splits on [-_]; content 2.2.x, announced to return
 * at the next major). Under `pascal-split` a `sep-in-name` finding is promoted to exit 1,
 * because the key cannot match the file name at all.
 *
 * What it cannot see: a rendering whose YAML is not in the folders you pass, and what the CM
 * calls a rendering that is not serialized at all — for that, smoke a real page (SKILL.md ⭐).
 * Dependency-free Node ≥ 18. No network, no tenant auth.
 *
 * Exit 0 clean · 1 a missing key (or a separator name under pascal-split) · 2 harness.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opts = (n) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []));
const JSON_OUT = flag('json'), QUIET = flag('quiet');
const die = (code, msg) => { if (JSON_OUT) console.log(JSON.stringify({ error: msg }, null, 2)); else console.error(`ERROR: ${msg}`); process.exit(code); };

const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------- pure helpers (self-checked)
/** Map keys from the generated component-map.ts: every `['Key', {` tuple. */
export function mapKeys(source) {
  const out = new Map(); // key → import path (or null)
  const src = norm(source);
  const imports = new Map();
  for (const m of src.matchAll(/import \* as (\w+)\s+from\s+'([^']+)'/g)) imports.set(m[1], m[2]);
  for (const m of src.matchAll(/\[\s*'((?:[^'\\]|\\.)+)'\s*,\s*\{\s*(?:\.\.\.(\w+))?/g)) out.set(m[1].replace(/\\'/g, "'"), imports.get(m[2]) ?? null);
  return out;
}

/** `componentName` values from Sitecore CLI item YAML (rendering items). */
export function componentNamesFromYaml(yaml) {
  const y = norm(yaml);
  const out = [];
  for (const m of y.matchAll(/Hint:\s*componentName\s*\n\s*Value:\s*(.+)/g)) {
    const v = m[1].trim().replace(/^"(.*)"$/, '$1');
    if (v && v !== '$name') out.push(v);
  }
  return out;
}

/** Key rule of an installed @sitecore-content-sdk/content, from its own templating source. */
export function keyRuleFromSource(js) {
  const s = norm(js);
  const block = s.match(/componentName:\s*([^,\n]+)/);
  if (!block) return 'unknown';
  return /toPascalCase\s*\(/.test(block[1]) ? 'pascal-split' : 'verbatim';
}

function selfCheck() {
  const map = "import * as Foo from 'src/components/Foo/Foo';\nimport * as BarBaz from 'src/components/Bar_Baz/Bar_Baz';\nexport const componentMap = new Map([\n  ['Foo', { ...Foo }],\n  ['Bar_Baz', { ...BarBaz }],\n  ['With Space', { ...Foo, componentType: 'client' }],\n]);";
  const k = mapKeys(map);
  const yaml = "---\nID: x\nSharedFields:\n- ID: \"a\"\n  Hint: componentName\n  Value: Foo\n- ID: b\n  Hint: componentName\n  Value: \"With Space\"\n- ID: c\n  Hint: componentName\n  Value: $name\n";
  const cases = [
    [k.size, 3], [k.get('Bar_Baz'), 'src/components/Bar_Baz/Bar_Baz'], [k.has('With Space'), true],
    [JSON.stringify(componentNamesFromYaml(yaml)), JSON.stringify(['Foo', 'With Space'])],
    [keyRuleFromSource('x.map((n) => ({ componentName: toPascalCase(n), moduleName: toPascalCase(n) }))'), 'pascal-split'],
    [keyRuleFromSource('// TODO: enabled using toPascalCase()\n({ componentName: name,\n moduleName: toPascalCase(name).replace(/x/, "") })'), 'verbatim'],
    [keyRuleFromSource('nothing here'), 'unknown'],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length) die(2, `self-check failed: ${JSON.stringify(bad)}`);
}

// ---------------------------------------------------------------- fs
function walkYaml(dir) {
  const out = [];
  const rec = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) rec(p); else if (/\.ya?ml$/i.test(e.name)) out.push(p); } };
  if (existsSync(dir) && statSync(dir).isDirectory()) rec(dir);
  return out;
}

// ---------------------------------------------------------------- main
selfCheck();
const app = opts('app')[0] ? resolve(opts('app')[0]) : die(2, '--app <head-app dir> is required');
const mapFile = ['component-map.ts', 'component-map.client.ts'].map((f) => join(app, '.sitecore', f)).filter(existsSync);
if (!mapFile.length) die(2, `${app}/.sitecore/component-map.ts not found — run the app's generate-map step first`);
const keys = new Map();
for (const f of mapFile) for (const [k, p] of mapKeys(readFileSync(f, 'utf8'))) if (!keys.has(k)) keys.set(k, p);
if (!keys.size) die(2, `no keys parsed from ${mapFile.join(', ')} — the map format may have changed; do not trust an empty result`);

const contentSrc = ['esm', 'cjs'].map((k) => join(app, 'node_modules', '@sitecore-content-sdk', 'content', 'dist', k, 'tools', 'templating', 'components.js')).find(existsSync);
const contentPkg = join(app, 'node_modules', '@sitecore-content-sdk', 'content', 'package.json');
const rule = contentSrc ? keyRuleFromSource(readFileSync(contentSrc, 'utf8')) : 'not-installed';
const contentVersion = existsSync(contentPkg) ? JSON.parse(norm(readFileSync(contentPkg, 'utf8'))).version : null;

const yamlFiles = opts('renderings').flatMap(walkYaml);
const componentNames = new Set(yamlFiles.flatMap((f) => componentNamesFromYaml(readFileSync(f, 'utf8'))));

const findings = [];
for (const name of componentNames) if (!keys.has(name)) findings.push({ severity: 'ERROR', code: 'missing-key', name, msg: `rendering componentName "${name}" has no key in the generated map — MissingComponent at runtime` });
for (const [k, p] of keys) {
  const file = p ? basename(p) : k;
  if (/[-_]/.test(file) && !/^partial-design-dynamic-placeholder$/i.test(file)) {
    const sev = rule === 'pascal-split' ? 'ERROR' : 'WARN';
    findings.push({ severity: sev, code: 'sep-in-name', name: k, msg: `registered file "${file}" carries _ or - — the key rule is version-sensitive (installed: ${rule}); ${sev === 'ERROR' ? 'under pascal-split no such file can match its componentName' : 'it will break again when the split returns at the next major'}` });
  }
  if (componentNames.size && !componentNames.has(k) && !/^(BYOCWrapper|FEaaSWrapper|Form|PartialDesignDynamicPlaceholder|BYOCServerWrapper|FEaaSServerWrapper)$/i.test(k)) findings.push({ severity: 'WARN', code: 'extra-key', name: k, msg: `map key "${k}" names no serialized rendering in the folders given — infrastructure under src/components/, or an uncovered rendering` });
}
const errors = findings.filter((f) => f.severity === 'ERROR');
const result = { app, mapFiles: mapFile, keys: keys.size, renderingsScanned: yamlFiles.length, componentNames: componentNames.size, keyRule: rule, contentVersion, findings, exit: errors.length ? 1 : 0 };

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exit(result.exit); }
if (!QUIET || errors.length) {
  console.log(`map keys ${keys.size} (${mapFile.map((f) => basename(f)).join(', ')}) · renderings ${componentNames.size} from ${yamlFiles.length} YAML file(s) · key rule ${rule}${contentVersion ? ` (content ${contentVersion})` : ''}`);
  if (!yamlFiles.length) console.log('  (no --renderings given: only the key-rule and separator axes ran — pass the serialized renderings folder(s) to reconcile)');
  for (const f of findings) console.log(`  ${f.severity.padEnd(5)} ${f.code.padEnd(12)} ${f.msg}`);
  console.log(`\n${errors.length ? 'FAIL' : 'OK'}  ${errors.length} error(s), ${findings.length - errors.length} warning(s)`);
}
process.exit(result.exit);
