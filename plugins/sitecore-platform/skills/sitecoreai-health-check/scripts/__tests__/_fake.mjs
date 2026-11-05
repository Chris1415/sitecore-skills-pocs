// Test double for fetch: serves RAW response bodies (text), so the real request layer still parses them.
import { TOKEN_URL } from '../lib/http.mjs';

export const res = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers } });

/** fetch built from handlers [(url, init, body) => Response | undefined]; records every call. */
export function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const h of handlers) { const r = await h(String(url), init, init.body); if (r) return r; }
    return res('not found', 404);
  };
  fn.calls = calls;
  return fn;
}

export const tokenHandler = (url) => (url === TOKEN_URL ? res({ access_token: 'aaaaaaaaaa.e30.bbbbbbbbbb', expires_in: 86400 }) : undefined);
const braced = (id) => { const h = id.replace(/[{}-]/g, '').toUpperCase(); return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`; };

/** Authoring + Edge handler over a content-graph fixture (see fixtures/graph-*.json). */
export function graphHandler(fx) {
  const byId = new Map(fx.inventory.map((x) => [braced(x.itemId), x]));
  const existing = new Map(Object.entries(fx.existing || {}).map(([k, v]) => [braced(k), v]));
  for (const x of fx.inventory) existing.set(braced(x.itemId), x.path);
  const pathToId = new Map([...existing].map(([id, p]) => [p.toLowerCase(), id]));
  const published = new Set((fx.published || []).map(braced));
  return (url, init, body) => {
    if (!/graphql/.test(url)) return undefined;
    const q = JSON.parse(body).query;
    if (/edge-platform/.test(url)) {
      const data = {}; for (const m of q.matchAll(/e(\d+): item\(path:"([^"]+)"/g)) data[`e${m[1]}`] = published.has(braced(m[2])) ? { id: m[2] } : null;
      return res({ data });
    }
    if (/search\(/.test(q)) return res({ data: { search: { totalCount: fx.inventory.length, results: fx.inventory } } });
    if (/hasPresentation/.test(q)) {
      const data = {};
      for (const m of q.matchAll(/i(\d+): item\(where:\{itemId:"([^"]+)"/g)) {
        const inv = byId.get(braced(m[2])); const it = fx.items[inv.itemId] || { fields: [] };
        const own = it.fields.filter((f) => !/^__(Final )?Renderings$/.test(f.name));
        data[`i${m[1]}`] = { itemId: inv.itemId, path: inv.path, hasPresentation: !!it.hasPresentation,
          fields: { nodes: own.map((f) => ({ name: f.name, value: f.value, templateField: { typeKey: f.typeKey } })) },
          r: { value: it.fields.find((f) => f.name === '__Renderings')?.value ?? '' }, f: { value: it.fields.find((f) => f.name === '__Final Renderings')?.value ?? '' } };
      }
      return res({ data });
    }
    if (/template\{ templateId \}/.test(q)) {
      const data = {};
      for (const m of q.matchAll(/t(\d+): item\(where:\{(?:itemId:"([^"]+)"|path:"([^"]+)")\}\)/g)) {
        const id = m[2] ? braced(m[2]) : pathToId.get(m[3].toLowerCase());
        data[`t${m[1]}`] = id && existing.has(id) ? { itemId: id.replace(/[{}-]/g, '').toLowerCase(), path: existing.get(id), template: { templateId: 'x' } } : null;
      }
      return res({ data });
    }
    return res({ errors: [{ message: `fake: unhandled query ${q.slice(0, 60)}` }] });
  };
}
