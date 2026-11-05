// Thin read-only clients over the request layer: Deploy, Monitoring, Authoring GraphQL, Edge, Edge Admin.
import { request, gql, mintToken, addSecret } from './http.mjs';

export const DEPLOY = 'https://xmclouddeploy-api.sitecorecloud.io';
export const MONITORING = 'https://xmcloud-monitoring-api.sitecorecloud.io';
export const EDGE_URL = 'https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1';
export const EDGE_ADMIN = 'https://edge.sitecorecloud.io/api/admin/v1';
export const DEAD_CONTEXT = 'ZZdeadContextId000000000';

export const errs = (j) => (Array.isArray(j?.errors) && j.errors.length ? j.errors.map((e) => e.message) : null);

export function client(env, prefix) {
  let tok = null;
  const bearer = async () => ({ authorization: `Bearer ${tok ||= await mintToken(env, prefix)}` });
  return {
    prefix,
    token: async () => (tok ||= await mintToken(env, prefix)),
    get: async (url, opts = {}) => request(url, { ...opts, headers: { ...(await bearer()), ...(opts.headers || {}) } }),
    head: async (url, opts = {}) => request(url, { ...opts, method: 'HEAD', headers: { ...(await bearer()), ...(opts.headers || {}) } }),
    agql: async (host, query, variables, opts = {}) => gql(`${host.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`, query, variables, { ...opts, headers: await bearer() }),
  };
}

/** Edge delivery/preview query. The context id is the credential: registered as a secret, never printed. */
export function edge(ctx, query, variables, { kind = 'live', label = 'edge' } = {}) {
  if (!ctx) throw new Error('edge: no context id');
  addSecret(ctx);
  return gql(`${EDGE_URL}?sitecoreContextId=${encodeURIComponent(ctx)}`, query, variables, { label, rateKey: kind === 'preview' ? 'edge-preview' : 'edge' });
}

export const LAYOUT_Q = 'query($s:String!,$p:String!,$l:String!){ layout(site:$s, routePath:$p, language:$l){ item{ rendered } } }';

/** Layout probe: { status, itemNull, routeNull, route, errors }. */
export async function layoutProbe(ctx, site, routePath, lang, kind = 'live') {
  const r = await edge(ctx, LAYOUT_Q, { s: site, p: routePath, l: lang }, { kind, label: `layout-${kind}` });
  const item = r.json?.data?.layout?.item; const route = item?.rendered?.sitecore?.route ?? null;
  return { status: r.status, err: r.err, itemNull: !item, routeNull: !route, route, errors: errs(r.json), text: r.text };
}

/** Deploy env v2 read → { ok, env, liveContextId, previewContextId } (ids registered as secrets). */
export async function readEnvironment(org, envId) {
  const r = await org.get(`${DEPLOY}/api/environments/v2/${encodeURIComponent(envId)}`, { label: 'deploy-env-v2' });
  if (r.status !== 200 || !r.json) return { ok: false, status: r.status, err: r.err };
  addSecret(r.json.liveContextId); addSecret(r.json.previewContextId);
  return { ok: true, env: r.json, liveContextId: r.json.liveContextId, previewContextId: r.json.previewContextId };
}
