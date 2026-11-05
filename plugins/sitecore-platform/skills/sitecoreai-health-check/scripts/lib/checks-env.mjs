// Environment-level checks: O3 O4 O5 E2 E3 D10. Deploy and Monitoring reads with the org client;
// D10 with the Edge administration client (GET allowlist only, enforced by http.mjs).
import { request } from './http.mjs';
import { result, addFinding, unknown, skipped } from './findings.mjs';
import { deploymentAdvisories } from './detect.mjs';
import { DEPLOY, EDGE_ADMIN, errs } from './sitecore.mjs';

const FORBIDDEN_EH = (n) => n === 'SITECORE_EDGE_CONTEXT_ID' || n === 'SITECORE_EDITING_SECRET' || /^NEXT_PUBLIC_/.test(n);

export async function checkO4(ctx) {
  const r = result('O4', 'Org health and CM liveness', { layer: 'OPS', surface: 'D + C' });
  const org = ctx.claims?.['https://auth.sitecorecloud.io/claims/org_id'];
  if (org) {
    const h = await ctx.org.get(`${DEPLOY}/api/organizations/v4/${encodeURIComponent(org)}/health`, { label: 'org-health-v4' });
    if (h.status !== 200) r.notes.push(`org health v4 HTTP ${h.status}`);
    else {
      const bad = [h.json?.status, ...(h.json?.resources || []).map((x) => x.status)].filter((s) => s && s !== 'Healthy');
      if (bad.length) addFinding(r, { severity: 'P1', title: `Org health reports ${h.json.status}`, evidence: JSON.stringify(h.json).slice(0, 400), remediation: 'Check status.sitecore.com; a degraded Search Index makes index-based checks (search inventory) unreliable.' });
      else r.notes.push(`org health ${h.json?.status} (${(h.json?.resources || []).map((x) => x.name).join(', ')})`);
    }
  }
  for (const [p, sev] of [['/healthz/live', 'P0'], ['/healthz/ready', 'P1']]) {
    const x = await request(`${ctx.cmHost}${p}`, { label: 'cm-healthz' });
    if (x.status === 0) return unknown(r, `CM ${p} unreachable (${x.err})`);
    if (x.status !== 200) addFinding(r, { severity: sev, title: `CM ${p} answers HTTP ${x.status}`, evidence: x.text.slice(0, 160), remediation: 'Check the CM environment state in the Deploy portal; restart only after reading the logs (O1).' });
  }
  return r;
}

export async function checkO3(ctx) {
  const r = result('O3', 'Environment and deployment state (advisory)', { layer: 'OPS', surface: 'D' });
  const e = ctx.cmEnvJson;
  if (e.provisioningStatus !== 2) addFinding(r, { severity: 'P2', title: `CM provisioningStatus is ${e.provisioningStatus} (2 = provisioned)`, may_be_intentional: true });
  const list = await ctx.org.get(`${DEPLOY}/api/environments/v2/${ctx.cmEnv}/deployments`, { label: 'env-deployments' });
  const items = (Array.isArray(list.json) ? list.json : list.json?.data ?? list.json?.items ?? []).slice().sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  if (list.status !== 200) return unknown(r, `deployments list HTTP ${list.status}`);
  for (const d of items.slice(0, 3)) {
    const v = await ctx.org.get(`${DEPLOY}/api/deployments/v3/${d.id}`, { label: 'deployment-v3' });
    if (v.status !== 200) continue;
    const adv = deploymentAdvisories(v.json);
    if (v.json.calculatedStatus === 4 && d === items[0]) addFinding(r, { severity: 'P2', title: 'Latest CM deployment is recorded as failed', evidence: `deployment ${d.id}: ${adv.join('; ').slice(0, 300)}`, remediation: 'Deployment records are advisory (they can flip after completion); confirm against the CM itself (O4) and its logs.' });
    else if (adv.length) addFinding(r, { severity: 'P3', title: `Deployment record contradictions (advisory) on ${d.id}`, evidence: adv.join('\n'), may_be_intentional: true });
  }
  r.notes.push(`${items.length} deployments; latest ${items[0]?.createdAt?.slice(0, 10) ?? 'n/a'}${e.repositoryDetails ? ', git-linked' : ', upload mode'}`);
  return r;
}

export async function checkO5(ctx) {
  const r = result('O5', 'Log levels and debug namespaces', { layer: 'OPS', surface: 'D' });
  const v = await ctx.org.get(`${DEPLOY}/api/environments/v1/${ctx.cmEnv}/variables`, { label: 'env-variables' });
  if (v.status !== 200) return unknown(r, `variables HTTP ${v.status}`);
  for (const x of Array.isArray(v.json) ? v.json : []) {
    if (/^(PUBLISHING_)?LOG_LEVEL_VALUE$/.test(x.name) && !x.secret && x.value && !/^INFO$/i.test(x.value)) addFinding(r, { severity: 'P2', title: `${x.name}=${x.value} (non-default)`, may_be_intentional: true, remediation: 'Report only. Changing it needs a redeploy; reset to INFO after the investigation.' });
  }
  if (!r.findings.length) r.notes.push('log levels at default');
  return r;
}

export async function ehRegistrations(ctx) {
  if (ctx.store.regs) return ctx.store.regs;
  const h = await ctx.org.get(`${DEPLOY}/api/hosts/v1/environment/${ctx.cmEnv}`, { label: 'eh-registrations' });
  ctx.store.regs = { status: h.status, list: Array.isArray(h.json) ? h.json : [] };
  return ctx.store.regs;
}

export async function checkE2(ctx) {
  const r = result('E2', 'Editing-host registrations and Rendering Host items', { layer: 'EH', surface: 'D + A' });
  const regs = await ehRegistrations(ctx);
  if (regs.status !== 200) return unknown(r, `hosts/v1 by CM id HTTP ${regs.status}`);
  const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return null; } };
  const registered = new Set(regs.list.map((x) => hostOf(x.renderingEngineApplicationUrl)).filter(Boolean));
  for (const reg of regs.list) {
    const host = hostOf(reg.renderingEngineApplicationUrl); if (!host) continue;
    const a = await request(`https://${host}/`, { label: 'eh-alive' });
    // The EH WAF answers 403 anonymously on every path: any HTTP status is "alive"; only a transport failure is dead.
    if (a.status === 0) addFinding(r, { severity: 'P1', title: `Registered editing host is unreachable (${a.err})`, url: `https://${host}/`, evidence: `registration for app "${reg.applicationName}" (EH env ${reg.editingHostEnvironmentId})`, remediation: 'Redeploy the editing host or remove the stale registration with its environment.' });
  }
  const q = '{ item(where:{path:"/sitecore/system/Settings/Services/Rendering Hosts"}){ children(first:200){ nodes{ name path itemId app: field(name:"ServerSideRenderingEngineApplicationUrl"){ value } sse: field(name:"ServerSideRenderingEngineEndpointUrl"){ value } } } } }';
  const items = await ctx.org.agql(ctx.cmHost, q, null, { label: 'rendering-host-items' });
  const nodes = items.json?.data?.item?.children?.nodes;
  if (!nodes) r.notes.push(`Rendering Host items not readable (${errs(items.json)?.[0] ?? `HTTP ${items.status}`})`);
  else for (const n of nodes) {
    const host = hostOf(n.app?.value || n.sse?.value);
    if (!host || registered.has(host) || !/sitecorecloud\.io$/i.test(host)) continue;
    const a = await request(`https://${host}/`, { label: 'rh-item-alive' });
    if (a.status === 0) addFinding(r, { severity: 'P1', title: 'Rendering Host item points at a dead editing host (stale after an EH delete)', item: n.path, itemId: n.itemId, url: `https://${host}/`, evidence: `${a.err}; not in the Deploy registrations`, remediation: 'Nothing on the Deploy side flags this. Repoint the item or delete it, and remove it from serialization if it is serialized.', fix_owner: 'cms' });
  }
  r.notes.push(`${regs.list.length} registrations on this CM${nodes ? `, ${nodes.length} Rendering Host items` : ''}`);
  return r;
}

export async function checkE3(ctx) {
  const r = result('E3', 'Editing-host variable hygiene', { layer: 'EH', surface: 'D' });
  const regs = await ehRegistrations(ctx);
  const ids = ctx.ehEnv ? [ctx.ehEnv] : [...new Set(regs.list.map((x) => x.editingHostEnvironmentId).filter(Boolean))];
  if (!ids.length) return skipped(r, 'no editing-host environment registered on this CM');
  for (const id of ids) {
    const v = await ctx.org.get(`${DEPLOY}/api/environments/v1/${id}/variables`, { label: 'eh-variables' });
    if (v.status !== 200) { r.notes.push(`EH ${id}: variables HTTP ${v.status}`); continue; }
    const bad = (Array.isArray(v.json) ? v.json : []).map((x) => x.name).filter(FORBIDDEN_EH);
    const debug = (Array.isArray(v.json) ? v.json : []).find((x) => x.name === 'DEBUG' && /content-sdk:editing/.test(x.value || ''));
    if (bad.length) addFinding(r, { severity: 'P1', title: `Editing-host env sets platform-injected names: ${bad.join(', ')}`, evidence: `EH env ${id}`, remediation: 'Delete these variables: the platform injects them, and an upsert builds green but never starts a container.' });
    if (debug) addFinding(r, { severity: 'P1', title: 'DEBUG=content-sdk:editing on an editing host writes the editing secret to the logs', evidence: `EH env ${id}`, remediation: 'Remove the namespace and rotate the editing secret.' });
  }
  r.notes.push(`${ids.length} editing-host environment(s) checked${ctx.ehEnv ? '' : ' (all registered on this CM: may include sibling sites)'}`);
  return r;
}

export async function checkD10(ctx) {
  const r = result('D10', 'Edge webhook health', { layer: 'DL', surface: 'EA' });
  if (!ctx.edgeAdmin) return skipped(r, `no Edge administration client (${ctx.prefixes.edgeAdmin}_ID / _SECRET)`);
  const w = await ctx.edgeAdmin.get(`${EDGE_ADMIN}/webhooks`, { label: 'edge-webhooks' });
  if (w.status !== 200) return unknown(r, `GET /webhooks HTTP ${w.status}`);
  const list = Array.isArray(w.json) ? w.json : (w.json?.data ?? w.json?.webhooks ?? []);
  if (!list.length) addFinding(r, { severity: 'P2', title: 'No Edge webhook registered: content freshness relies on redeploy or the revalidate window', may_be_intentional: true, remediation: 'Expected for a plain-template app; an OSR app needs an OnUpdate webhook to /api/revalidate (sitecoreai-edge-admin-webhooks).' });
  const seen = new Map();
  for (const x of list) {
    let host = null; try { host = new URL(x.uri).host; } catch { /* malformed */ }
    const label = `${x.label || x.id} -> ${host || 'invalid uri'}`;
    if (x.disabled) addFinding(r, { severity: 'P1', title: `Webhook disabled: ${label}`, evidence: `last run: ${String(x.lastRuns?.[0]?.message ?? 'n/a').slice(0, 160)}`, remediation: 'Edge auto-disables after 10 failed deliveries. Fix the receiver, prove it with the revalidate controls, then re-enable (old lastRuns stay).' });
    else if (x.lastRuns?.[0] && x.lastRuns[0].success === false) addFinding(r, { severity: 'P1', title: `Webhook last run failed: ${label}`, evidence: String(x.lastRuns[0].message ?? '').slice(0, 200) });
    if (x.executionMode && x.executionMode !== 'OnUpdate') addFinding(r, { severity: 'P2', title: `Webhook mode ${x.executionMode}: ${label}`, remediation: 'OnEnd fires several times per publish, partly before Edge has the content, and carries no rows; use OnUpdate.' });
    if (host && seen.has(x.uri)) addFinding(r, { severity: 'P2', title: `Duplicate webhook for ${host}` }); else seen.set(x.uri, true);
  }
  const s = await ctx.edgeAdmin.get(`${EDGE_ADMIN}/settings`, { label: 'edge-settings' });
  r.notes.push(`${list.length} webhook(s)${s.status === 200 ? `; contentCacheTtl ${s.json?.contentCacheTtl}, autoClear ${s.json?.contentCacheAutoClear}` : ''}`);
  return r;
}
