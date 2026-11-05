#!/usr/bin/env node
/**
 * probe-icon.mjs — does this icon path actually resolve on THIS tenant? (SKILL.md § 0)
 *
 *   node scripts/probe-icon.mjs --host https://<cm-host> office/16x16/star.png [more paths…]
 *   node scripts/probe-icon.mjs --host … --apply <itemId> office/16x16/star.png   # probe, then set __Icon
 *
 * Token: --token <bearer> or env SITECORE_CM_TOKEN (a CM automation-client client-credentials
 * token, or the Sitecore CLI accessToken from .sitecore/user.json — the latter expires in ~24h).
 *
 * Both controls are asserted before any verdict (§ 0a): a known-bad path must 404 and a
 * known-good must 200 image/*. A sweep where everything fails is a claim about your credentials,
 * not the tenant, so exit 2 (harness broken) is returned before a single icon is judged.
 *
 * Exit 0 = every requested path resolves (and was applied, if --apply). Exit 1 = at least one is
 * dead. Exit 2 = a control misbehaved — fix the token / host, do not trust any result.
 * No dependencies; Node 18+.
 */
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const host = (opt('--host') || process.env.SITECORE_CM_HOST || '').replace(/\/+$/, '');
const token = opt('--token') || process.env.SITECORE_CM_TOKEN;
const apply = opt('--apply');
const paths = args.filter((a, i) => !a.startsWith('--') && !['--host', '--token', '--apply'].includes(args[i - 1]));
if (!host || !token || !paths.length) {
  console.error('usage: probe-icon.mjs --host https://<cm-host> [--token <bearer>] [--apply <itemId>] <folder/size/name.png> …');
  process.exit(2);
}
const auth = { Authorization: `Bearer ${token}` };

async function resolves(icon) {
  const res = await fetch(`${host}/~/icon/${icon}`, { headers: auth, redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  return { ok: res.status === 200 && type.startsWith('image/'), status: res.status, type, bytes: Number(res.headers.get('content-length') || 0) };
}

// § 0a — both controls, every run. The known-good half is the one that is usually missing.
const bad = await resolves('office/16x16/__control_definitely_not_real__.png');
const good = await resolves('office/16x16/window.png');
// The contract is a strict 404, not merely "not an image": with a bad credential this CM still serves
// REAL icons anonymously but answers a dead path with a 200 login page — so the good control passes,
// the bad control is the only thing that can see the degraded harness, and a lenient check let it
// through (measured 2026-09-16 with a garbage token: bad→200 text/html, good→200 image/png).
if (bad.status !== 404) { console.error(`✖ known-BAD control answered ${bad.status} ${bad.type} instead of 404 — the request is being redirected (expired / malformed / missing token); no verdict from this run can be trusted.`); process.exit(2); }
if (!good.ok) { console.error(`✖ known-GOOD control did not resolve (${good.status} ${good.type}${good.bytes ? `, ${good.bytes} bytes` : ''}) — expired/unscoped token or wrong host; every path would look dead.`); process.exit(2); }
console.log(`controls ok — bad→${bad.status}, good→${good.status} ${good.type}`);

let dead = 0;
const results = [];
for (const p of paths) {
  const r = await resolves(p);
  results.push({ p, ...r });
  console.log(`${r.ok ? '  ok  ' : '  DEAD'} ${p}  (${r.status} ${r.type})`);
  if (!r.ok) dead++;
}
if (dead) { console.error(`\n${dead} of ${paths.length} do not resolve on ${host} — pick another from references/icon-catalog.md and probe again.`); process.exit(1); }

if (apply) {
  if (paths.length !== 1) { console.error('--apply takes exactly one icon path'); process.exit(2); }
  // SKILL.md § 5c (references/graphql-recipes.md). __Icon is a shared field; language is ignored but must be valid.
  const query = `mutation SetIcon($itemId: ID!, $iconPath: String!) { updateItem(input: { itemId: $itemId, language: "en", fields: [{ name: "__Icon", value: $iconPath }] }) { item { itemId(format: D) name field(name: "__Icon") { value } } } }`;
  const res = await fetch(`${host}/sitecore/api/authoring/graphql/v1`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { itemId: apply, iconPath: paths[0] } }) });
  const json = await res.json().catch(() => ({}));
  const item = json?.data?.updateItem?.item;
  if (!res.ok || json.errors || !item) { console.error(`✖ updateItem failed (${res.status}): ${JSON.stringify(json.errors || json).slice(0, 400)}`); process.exit(1); }
  const written = item.field?.value;
  if (written !== paths[0]) { console.error(`✖ read-back mismatch: wrote ${paths[0]}, item reads ${written}`); process.exit(1); }
  console.log(`applied __Icon = ${written} on ${item.name} (${item.itemId})`);
}
