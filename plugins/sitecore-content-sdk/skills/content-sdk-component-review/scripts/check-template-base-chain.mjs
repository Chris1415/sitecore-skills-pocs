#!/usr/bin/env node
/**
 * check-template-base-chain.mjs — assert every project template of a brand resolves a
 * non-empty base chain in the LIVE template engine. Read-only.
 *
 *   node scripts/check-template-base-chain.mjs --brand <slug> --cm <cm-dir> --expect-tenant <tenant>
 *   node scripts/check-template-base-chain.mjs ... --endpoint <authoring-graphql-url> --env-file <file> --json
 *
 * Templates are discovered OFFLINE from `<cm>/authoring/items/<brand>*` (a zero-template run
 * exits 2, never "all clean"). Credentials: SITECORE_CLIENT_ID / SITECORE_CLIENT_SECRET (env or
 * --env-file), a client-credentials automation client of the tenant (see `sitecoreai-auth`).
 * Binding: the token's tenant claim MUST equal --expect-tenant, otherwise the script refuses;
 * the endpoint defaults to that tenant's Authoring GraphQL host.
 *
 * WHY LIVE: `__Base template` is pipe-delimited in the template engine. A value joined with
 * newlines resolves to NOTHING, so the item silently loses every inherited field (Pages'
 * Content pane renders empty, the Content Editor shows raw GUIDs) while its own fields still
 * read fine. Serialization writes both forms as the SAME YAML block (measured 2026-08-28: a
 * pipe-delimited template with 18 resolving bases and a newline-delimited one with zero were
 * byte-identical on disk), so no disk check can see it, and a disk parser must stay lenient.
 * The usual cause is a raw Authoring GraphQL write with the wrong separator.
 *
 * Exit: 0 all chains resolve · 1 at least one is broken · 2 usage / auth / binding / no
 * templates / could-not-check (an error is never reported as a broken chain).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLAIM = 'https://auth.sitecorecloud.io/claims/';
const TOKEN_URL = 'https://auth.sitecorecloud.io/oauth/token';

export const authoringEndpointFor = (tenant) => `https://xmc-${tenant}.sitecorecloud.io/sitecore/api/authoring/graphql/v1`;

/** Tenant named by a token; the signature is not verified (we read our own token). */
export function tenantOf(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json)[CLAIM + 'tenant_name'] ?? null;
}

/** Fail closed unless the token names `expected`; the message carries both values. */
export function bindTenant(token, expected) {
  if (!expected) throw new Error('no --expect-tenant supplied: refusing to read an unnamed tenant');
  const got = tenantOf(token);
  if (got == null) throw new Error(`token carries no tenant claim (org-scoped client?); expected "${expected}"`);
  if (got !== expected) throw new Error(`TENANT MISMATCH: token names "${got}", expected "${expected}"`);
  return got;
}

export async function mintToken({ id, secret }, fetchImpl = fetch) {
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, audience: 'https://api.sitecorecloud.io' }),
  });
  const body = await r.json().catch(() => ({}));
  if (!body.access_token) throw new Error(`token mint failed (HTTP ${r.status})`); // never echo the body
  return body.access_token;
}

function walkYml(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkYml(p, acc);
    else if (e.endsWith('.yml')) acc.push(p);
  }
  return acc;
}

/**
 * Template items of a brand: a .yml under a `templatesProject` path carrying a `__Base template`
 * field (sections and fields do not). Module folders may only START with the slug.
 */
export function projectTemplates(itemsDir, brand) {
  const dirs = existsSync(itemsDir) ? readdirSync(itemsDir).filter((d) => d === brand || d.startsWith(brand)) : [];
  const found = [];
  for (const d of dirs) {
    for (const f of walkYml(join(itemsDir, d))) {
      if (!/templatesProject/i.test(f)) continue;
      const raw = readFileSync(f, 'utf8');
      if (!/Hint: "?__Base template"?\s*$/m.test(raw)) continue;   // the hint may be quoted
      const id = raw.match(/^ID: "?([^"\n\r]+)"?\s*$/m);
      const path = raw.match(/^Path: "?([^"\n\r]+)"?\s*$/m);
      if (id) found.push({ id: id[1].trim(), path: path ? path[1].trim() : f, file: f });
    }
  }
  return found;
}

/** One live read. `ItemTemplate` takes `templateId`, not `itemId` (introspected 2026-08-28). */
export async function baseChain(templateId, { endpoint, token, fetchImpl = fetch }) {
  const query = 'query($id:ID!){ itemTemplate(where:{templateId:$id, database:"master"}){ name baseTemplates { nodes { templateId name } } } }';
  const r = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: templateId } }),
  });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const j = await r.json();
  if (j.errors?.length) return { error: j.errors[0].message };
  const t = j.data?.itemTemplate;
  if (!t) return { error: 'template not found in master' };
  return { name: t.name, bases: (t.baseTemplates?.nodes ?? []).map((n) => n.name) };
}

export async function checkTemplates(templates, ctx) {
  const results = [];
  for (const t of templates) {
    const r = await baseChain(t.id, ctx);
    results.push({ id: t.id, path: t.path, name: r.name ?? null, bases: r.bases ?? [], error: r.error ?? null, ok: !r.error && r.bases.length > 0 });
  }
  return results;
}

/**
 * Print the verdict and return the exit code. AN ERROR IS NOT A DEFECT: the first version of
 * this check had a wrong query field, every request errored, and it reported a known-good
 * control as "96 of 96 broken". Could-not-check exits 2, a broken chain exits 1.
 */
export function report(results, { brand, tenant, asJson = false, quiet = false } = {}) {
  const errored = results.filter((r) => r.error);
  const broken = results.filter((r) => !r.error && r.bases.length === 0);
  if (asJson) {
    console.log(JSON.stringify({ brand, tenant, checked: results.length, broken: broken.length, errored: errored.length, results }, null, 2));
    return errored.length ? 2 : broken.length ? 1 : 0;
  }
  if (!quiet) {
    for (const r of results) {
      const label = (r.name ?? r.path).padEnd(28);
      if (r.error) console.log(`  x  ${label} ERROR: ${r.error}`);
      else if (!r.bases.length) console.log(`  x  ${label} BASE CHAIN EMPTY — inherited fields are lost`);
      else console.log(`  ok ${label} ${r.bases.length} base template(s)`);
    }
  }
  if (errored.length) {
    console.error(`\nCOULD NOT CHECK ${errored.length} of ${results.length} template(s): not a verdict about the tenant.`);
    console.error(`  first error: ${errored[0].error}\n  Exiting 2 (could-not-check), NOT 1 (broken). Fix the check, then re-run.`);
    return 2;
  }
  if (broken.length) {
    console.error(`\n${broken.length} of ${results.length} template(s) resolve NO base templates.`);
    console.error('  Every inherited field is lost on these, yet the item renders and its own fields read fine.');
    console.error('  Cause is almost always a raw Authoring GraphQL write that joined __Base template with');
    console.error('  newlines instead of PIPES. Rewrite it pipe-delimited (dashed, uppercase, brace-wrapped GUIDs),');
    console.error('  then re-run this check: a field read-back succeeds either way and is not evidence.');
    return 1;
  }
  if (!quiet) console.log(`\nAll ${results.length} template(s) resolve a base chain.`);
  return 0;
}

function readEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0 || line.trimStart().startsWith('#')) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  const asJson = argv.includes('--json');
  const quiet = argv.includes('--quiet');
  const die = (code, ...lines) => { for (const l of lines) console.error(l); process.exit(code); };

  const brand = arg('brand');
  const cmArg = arg('cm');
  const expected = arg('expect-tenant');
  if (!brand || !cmArg || !expected) {
    die(2, 'Usage: check-template-base-chain.mjs --brand <slug> --cm <cm-dir> --expect-tenant <tenant> [--endpoint <url>] [--env-file <file>] [--json] [--quiet]');
  }
  const cmDir = (globalThis.__componentReviewResolvePath ?? resolvePath)(cmArg);
  if (!existsSync(cmDir)) die(2, `[ERROR] No CM code base at ${cmDir}.`);
  const templates = projectTemplates(join(cmDir, 'authoring', 'items'), brand);
  if (!templates.length) {
    die(2, `No project templates found for brand "${brand}" under ${join(cmDir, 'authoring', 'items')}.`,
      'A zero-template run must not exit 0: an empty set would report "all chains resolve" and mean nothing.');
  }

  const envFile = arg('env-file');
  const env = envFile ? { ...process.env, ...readEnvFile(envFile) } : process.env;
  if (!env.SITECORE_CLIENT_ID || !env.SITECORE_CLIENT_SECRET) die(2, 'Missing SITECORE_CLIENT_ID / SITECORE_CLIENT_SECRET (env or --env-file).');

  let token; let tenant;
  try {
    token = await mintToken({ id: env.SITECORE_CLIENT_ID, secret: env.SITECORE_CLIENT_SECRET });
    tenant = bindTenant(token, expected);
  } catch (e) {
    die(2, `Refusing to run: ${e.message}`);
  }
  const endpoint = arg('endpoint') ?? authoringEndpointFor(tenant);
  if (!asJson && !quiet) console.log(`Checking ${templates.length} project template(s) for "${brand}" on tenant ${tenant}…`);
  const results = await checkTemplates(templates, { endpoint, token });
  process.exitCode = report(results, { brand, tenant, asJson, quiet });
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href;
if (IS_MAIN) await main();
