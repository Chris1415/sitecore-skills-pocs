// Shared client for the site-template scripts: argument parsing, client-credentials auth, Authoring GraphQL, item upserts.
// Secrets come from env vars or --env-file only; they are never printed and refused on argv.
import { readFileSync } from 'node:fs';

export const TOKEN_URL = 'https://auth.sitecorecloud.io/oauth/token';
export const DEPLOY_API = 'https://xmclouddeploy-api.sitecorecloud.io/api';

export function parseArgs(argv, known) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--token', '--secret', '--client-secret', '--bearer'].includes(a)) throw new Error(`${a} on argv is refused; pass secrets through env vars (--client-prefix)`);
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in known)) throw new Error(`unknown argument ${a}`);
    o[key] = known[key] === 'flag' ? true : argv[++i];
  }
  return o;
}

export function loadEnvFile(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/** Client-credentials token for `<prefix>_ID` / `<prefix>_SECRET` (process env wins over --env-file). */
export async function mintToken({ clientPrefix, envFile }, fetchImpl = globalThis.fetch) {
  const vars = { ...(envFile ? loadEnvFile(envFile) : {}), ...process.env };
  const id = vars[`${clientPrefix}_ID`], secret = vars[`${clientPrefix}_SECRET`];
  if (!id || !secret) throw new Error(`${clientPrefix}_ID / ${clientPrefix}_SECRET not set (env or --env-file)`);
  const r = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, audience: 'https://api.sitecorecloud.io', grant_type: 'client_credentials' }) });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`token mint failed: HTTP ${r.status}`);
  return j.access_token;
}

export function makeClient({ cmHost, token, fetchImpl = globalThis.fetch }) {
  // Test seam: an explicit http://127.0.0.1 or http://localhost host keeps its scheme (stub servers); everything else is https.
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(cmHost);
  const endpoint = local ? `${cmHost.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`
    : `https://${cmHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`;
  async function gql(query, variables) {
    const r = await fetchImpl(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw new Error(`Authoring GraphQL HTTP ${r.status}: ${text.slice(0, 200)}`); }
    if (j.errors?.length) { const e = new Error(j.errors.map(x => x.message).join('; ')); e.graphql = j.errors; throw e; }
    return j.data;
  }
  const ITEM = `itemId(format: B) name path template{name templateId(format: B)}`;
  async function item(pathOrId, withFields = false) {
    const isId = /^\{?[0-9a-f-]{36}\}?$/i.test(pathOrId);
    const sel = withFields ? `${ITEM} fields(ownFields:false, first:400){nodes{name value}}` : ITEM;
    const q = isId ? `query($i:ID!){item(where:{itemId:$i}){${sel}}}` : `query($w:String!){item(where:{path:$w}){${sel}}}`;
    const d = await gql(q, isId ? { i: pathOrId } : { w: pathOrId })
      .catch(e => { if (/does not exist|not found/i.test(e.message)) return { item: null }; throw e; });
    return d.item;
  }
  async function children(path) {
    const out = [];
    for (let after = null; ;) {
      const d = await gql(`query($p:String!,$a:String){item(where:{path:$p}){children(first:200,after:$a){nodes{${ITEM}} pageInfo{hasNextPage endCursor}}}}`, { p: path, a: after });
      out.push(...(d.item?.children.nodes ?? []));
      const page = d.item?.children.pageInfo;
      if (!page?.hasNextPage) return out;
      after = page.endCursor;
    }
  }
  /** Create-or-update one item; returns its {B}-formatted id (upper case). */
  async function upsert(parentPath, name, templateId, fields = [], language = 'en') {
    const existing = await item(`${parentPath}/${name}`);
    if (existing) {
      if (fields.length) await gql(`mutation($i:UpdateItemInput!){updateItem(input:$i){item{itemId}}}`, { i: { itemId: existing.itemId, language, fields } });
      return { id: existing.itemId.toUpperCase(), created: false };
    }
    const parent = await item(parentPath);
    if (!parent) throw new Error(`missing parent ${parentPath}`);
    const d = await gql(`mutation($i:CreateItemInput!){createItem(input:$i){item{itemId(format: B)}}}`,
      { i: { name, templateId, parent: parent.itemId, language, fields } });
    return { id: d.createItem.item.itemId.toUpperCase(), created: true };
  }
  /** Create every missing folder along `path` with the given folder template. */
  async function ensurePath(path, folderTemplateId) {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      const next = `${cur}/${p}`;
      if (!(await item(next))) await upsert(cur, p, folderTemplateId);
      cur = next;
    }
  }
  async function remove(pathOrId) {
    const it = await item(pathOrId);
    if (!it) return false;
    await gql(`mutation($i:DeleteItemInput!){deleteItem(input:$i){successful}}`, { i: { itemId: it.itemId, permanently: true } });
    return true;
  }
  return { gql, item, children, upsert, ensurePath, remove, endpoint };
}

export const fieldMap = (it) => Object.fromEntries((it?.fields?.nodes || []).map(n => [n.name, n.value]));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
