// Arguments, env files and credential prefixes. Ids, brands and hosts come ONLY from args/env.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addSecret } from './http.mjs';

export function readEnvFile(path) {
  const out = {};
  if (!path || !existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

/** `--k v`, `--k=v`, bare `--flag`; repeated keys become arrays. */
export function parseArgs(argv = process.argv.slice(2)) {
  const a = { _: [] };
  const put = (k, v) => { a[k] = a[k] === undefined ? v : [].concat(a[k], v); };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const eq = t.indexOf('=');
    if (eq > 0) { put(t.slice(2, eq), t.slice(eq + 1)); continue; }
    const n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) put(t.slice(2), true); else { put(t.slice(2), n); i++; }
  }
  return a;
}

/** process.env wins over --env-file / DOCTOR_ENV_FILES (';'-separated). Secret-shaped values are registered for redaction. */
export function loadEnv(args = {}) {
  const files = [...[].concat(args['env-file'] ?? []), ...(process.env.DOCTOR_ENV_FILES || '').split(';')].filter(Boolean);
  const merged = {};
  for (const f of files) Object.assign(merged, readEnvFile(f));
  const env = { ...merged, ...process.env };
  for (const [k, v] of Object.entries(env)) if (/SECRET|CONTEXT_ID|CLIENT_ID|TOKEN|PASSWORD|API_KEY|COOKIE/i.test(k)) addSecret(v);
  return env;
}

/**
 * Credential prefixes: explicit flags win, then DOCTOR_* env, then the three-segment convention for --org <label>.
 * A repo that keeps one estate on the unsuffixed pair (SITECORE_DEPLOY_ADMIN_CLIENT_*) has no
 * SITECORE_DEPLOY_<ORG>_ADMIN_CLIENT_* for it: fall back to the unsuffixed pair only when the labelled one is
 * absent, and say so. Safe because every gate reads the named environment with that client: a client of
 * the wrong estate cannot read it, and the gate answers UNKNOWN, never a pass.
 */
export function credentialPrefixes(args, env) {
  const org = args.org ? String(args.org).toUpperCase() : null;
  const has = (p) => Boolean(env[`${p}_ID`] && env[`${p}_SECRET`]);
  const pick = (explicit, labelled, plain) => {
    if (explicit) return { prefix: explicit, fallback: false };
    if (!labelled || has(labelled) || !has(plain)) return { prefix: labelled || plain, fallback: false };
    return { prefix: plain, fallback: true };
  };
  const o = pick(args['org-client-prefix'] || env.DOCTOR_ORG_CLIENT_PREFIX, org && `SITECORE_DEPLOY_${org}_ADMIN_CLIENT`, 'SITECORE_DEPLOY_ADMIN_CLIENT');
  const e = pick(args['edge-client-prefix'] || env.DOCTOR_EDGE_CLIENT_PREFIX, org && `SITECORE_EDGE_${org}_CLIENT`, 'SITECORE_EDGE_CLIENT');
  const notes = [o, e].filter((x) => x.fallback).map((x) => `--org ${args.org}: no labelled credentials, used the unsuffixed ${x.prefix}_* (it names no estate; the environment read is the guard)`);
  return { org: o.prefix, edgeAdmin: e.prefix, notes };
}

/**
 * Git Bash (MSYS) rewrites a leading-slash argument such as /sitecore/content/X or /about into
 * <git-install>/sitecore/content/X, and the query then silently matches nothing. Under MSYS
 * (MSYSTEM set) the install root is known (EXEPATH is <root>/bin), so the rewrite is undone; any
 * other drive-letter path is refused rather than guessed.
 */
export function msysRoot(env = process.env) {
  if (!env.MSYSTEM || !env.EXEPATH) return null;
  return `${String(env.EXEPATH).replace(/\\/g, '/').replace(/\/(usr\/)?bin\/?$/i, '')}/`;
}
export function sitecorePathArg(value, name, env = process.env) {
  if (value == null || value === true) return null;
  const v = String(value);
  if (/^[A-Za-z]:[\\/]/.test(v)) {
    const root = msysRoot(env); const norm = v.replace(/\\/g, '/');
    if (root && norm.toLowerCase().startsWith(root.toLowerCase())) return `/${norm.slice(root.length)}`;
    const e = new Error(`--${name} "${v}" looks like a Windows path: Git Bash rewrote it. Re-run with MSYS_NO_PATHCONV=1 (or pass it without the leading slash).`);
    e.code = 'MSYS_PATH'; throw e;
  }
  return v;
}
export const routePathArg = (v, name, env = process.env) => { const p = sitecorePathArg(v, name, env); return p == null ? null : (p.startsWith('/') ? p : `/${p}`); };

/** True when this module file is the process entry point (Windows-safe: drive-letter case differs). */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return pathToFileURL(resolve(process.argv[1])).href.toLowerCase() === String(importMetaUrl).toLowerCase();
}

export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const today = () => new Date().toISOString().slice(0, 10);
