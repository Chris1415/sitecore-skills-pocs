#!/usr/bin/env node
// D1 context gate (a go-live gate, also run by the doctor). Ground truth is the Deploy API (the org client
// reads liveContextId/previewContextId); the id is NOT in served HTML, so the app's value is read from env files.
//   1. the LIVE id answers the site's home route on Edge (route != null); a dead id answers 404 "No sitecore context"
//   2. every --app-env-file carries the LIVE id in SITECORE_EDGE_CONTEXT_ID and NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID
// Usage: node check-edge-context.mjs --env <cmEnvId> --site <siteName> [--lang en] [--org <label>]
//          [--app-env-file <pulled .env>]... [--env-file <creds>] [--json]
// Context ids are compared, never printed.
import { parseArgs, loadEnv, credentialPrefixes, isMain, readEnvFile } from './lib/env.mjs';
import { result, addFinding, unknown } from './lib/findings.mjs';
import { client, readEnvironment, layoutProbe, edge, DEAD_CONTEXT, LAYOUT_Q } from './lib/sitecore.mjs';
import { addSecret } from './lib/http.mjs';
import { runGateCli } from './lib/gate.mjs';

const APP_KEYS = ['SITECORE_EDGE_CONTEXT_ID', 'NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID'];

/** Pure: classify one app env file's ids against the Deploy truth. */
export function classifyAppIds(file, values, { live, preview }) {
  const out = [];
  for (const k of APP_KEYS) {
    const v = values[k];
    if (!v) out.push({ severity: 'P1', blocker: true, title: `${k} is empty or absent in ${file} (a Vercel build reading it fails)` });
    else if (v === live) continue;
    else if (v === preview) out.push({ severity: 'P0', blocker: true, title: `${k} in ${file} is the PREVIEW context id: the surface serves unpublished content` });
    else out.push({ severity: 'P1', blocker: true, title: `${k} in ${file} is neither this environment's live nor preview id`, foreign: true, key: k });
  }
  return out;
}

export async function checkEdgeContext({ env, prefixes, cmEnv, site, lang = 'en', appEnvFiles = [], resolved = null }) {
  const r = result('D1', 'Delivery on the LIVE Edge context id, and the id alive', { layer: 'DL', surface: 'D + E' });
  for (const n of prefixes?.notes || []) r.notes.push(n);
  let ids = resolved;
  if (!ids) {
    const org = client(env, prefixes.org);
    try { ids = await readEnvironment(org, cmEnv); } catch (e) { return { results: [unknown(r, `Deploy env read failed: ${e.message}`)] }; }
    if (!ids.ok) return { results: [unknown(r, `Deploy env read HTTP ${ids.status}${ids.err ? ` ${ids.err}` : ''}`)] };
  }
  if (!ids.liveContextId) return { results: [unknown(r, 'Deploy env read carries no liveContextId')] };
  const live = await layoutProbe(ids.liveContextId, site, '/', lang, 'live');
  if (live.status === 0) return { results: [unknown(r, `Edge unreachable (${live.err})`)] };
  if (live.status === 404 && /No sitecore context/i.test(live.text)) addFinding(r, { severity: 'P0', blocker: true, title: 'The environment\'s LIVE context id is dead on Edge (404 No sitecore context)', remediation: 'Re-read the ids from the Deploy API; a recreated environment gets new ids.' });
  else if (live.errors) return { results: [unknown(r, `Edge layout errors: ${live.errors.join(' | ').slice(0, 200)}`)] };
  else if (live.itemNull) addFinding(r, { severity: 'P0', blocker: true, title: `LIVE Edge has no home route for site "${site}" (${lang})`, remediation: 'Publish the site (content root + /sitecore/layout items) or check the site name and language.', fix_owner: 'cms' });
  else if (live.routeNull) addFinding(r, { check: 'R1', severity: 'P0', blocker: true, title: 'LIVE home route answers item but route:null', remediation: 'Look for an internal General Link without id= or a misconfigured params template on the page.', fix_owner: 'cms' });
  const dead = await edge(DEAD_CONTEXT, LAYOUT_Q, { s: site, p: '/', l: lang }, { label: 'edge-dead-control' });
  if (dead.status !== 404) r.notes.push(`dead-context control answered ${dead.status}, expected 404 (instrument cannot discriminate a dead id)`);
  for (const f of appEnvFiles) {
    const values = readEnvFile(f); for (const k of APP_KEYS) addSecret(values[k]);
    const label = f.replace(/^.*[\\/]/, '');
    for (const c of classifyAppIds(label, values, { live: ids.liveContextId, preview: ids.previewContextId })) {
      let title = c.title;
      if (c.foreign) { const p = await layoutProbe(values[c.key], site, '/', lang, 'live'); title += p.status === 404 ? ' (and it is dead on Edge)' : ` (it answers HTTP ${p.status}${p.itemNull ? ', no route for this site' : ''})`; }
      addFinding(r, { severity: c.severity, blocker: c.blocker, title, remediation: 'Set both variables to the LIVE context id from the Deploy API on all three Vercel targets, then redeploy.', fix_owner: 'ops' });
    }
  }
  if (!r.findings.length) r.notes.push(`live id serves the home route${appEnvFiles.length ? `; ${appEnvFiles.length} app env file(s) on the live id` : ''}`);
  return { results: [r], ids };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(); const env = loadEnv(a);
  if (!a.env || !a.site) { console.error('usage: check-edge-context.mjs --env <cmEnvId> --site <siteName> [--org <label>] [--app-env-file <file>]...'); process.exit(2); }
  runGateCli('check-edge-context', () => checkEdgeContext({ env, prefixes: credentialPrefixes(a, env), cmEnv: a.env, site: a.site, lang: a.lang || 'en', appEnvFiles: [].concat(a['app-env-file'] ?? []) }));
}
