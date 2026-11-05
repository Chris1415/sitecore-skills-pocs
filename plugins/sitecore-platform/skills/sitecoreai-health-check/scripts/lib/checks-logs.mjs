// Log checks over the Monitoring API (org client, unattended): O1 (CM), O2 (editing host), plus the env-wide
// T2 confirmation of `Data template ... not found` subjects on Authoring. HEAD before every download; capped.
import { result, addFinding, unknown, skipped } from './findings.mjs';
import { scanLog, SIGNATURES } from './detect.mjs';
import { redact } from './http.mjs';
import { MONITORING } from './sitecore.mjs';
import { ehRegistrations } from './checks-env.mjs';

const HARD_CAP = 25_000_000;
const SEV = Object.fromEntries(SIGNATURES.map(([id, , sev]) => [id, sev]));
const TITLE = {
  'edge-ack-hung': 'Edge publish hung (ack / EdgeApiException / 520)', 'edge-media-blob': 'Edge media blob upload failed', 'edge-batch-failed': 'Edge update batch failed', 'edge-delta-block': 'Edge delta publish blocked',
  'edge-verify-status': 'Edge publishing status unverifiable', 'edge-rendered-entity': 'RenderedEntity generation failed', 'edge-destinations': 'Edge destinations failed', 'template-not-found': 'Items whose data template is gone (breaks publishing)',
  'solr-degraded': 'Search/index degraded (WARN/ERROR)', 'editing-secret': 'Editing secret mismatch', 'secret-leak-debug': 'Debug namespace wrote the editing secret to the log', 'edge-quota': 'Edge API quota exceeded',
  'personalize-timeout': 'Personalize timeout (IE-003)', 'media-hash': 'Media request protection: invalid/missing hash', 'owin-auth-failed': 'OWIN bearer authentication failures',
};

async function newestPerType(ctx, envId, label) {
  const list = await ctx.org.get(`${MONITORING}/api/logs/v1/${envId}`, { label });
  if (list.status !== 200 || !Array.isArray(list.json)) return { err: `log list HTTP ${list.status}` };
  const byType = {};
  for (const f of [...list.json].sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)))) {
    // EH file `type` is mis-derived from the app name: key EH files by their name prefix instead.
    const t = /^RenderingHost\./i.test(f.name) ? 'RenderingHost' : f.type;
    if (!byType[t] && f.size > 0) byType[t] = f;
  }
  return { files: list.json, newest: Object.values(byType) };
}

async function scanFiles(ctx, envId, files, res) {
  const cap = Math.min(ctx.opts.logMaxBytes, HARD_CAP); const merged = {}; let bytes = 0;
  for (const f of files) {
    const h = await ctx.org.head(`${MONITORING}/api/logs/v1/${envId}/${encodeURIComponent(f.name)}`, { label: 'log-head' });
    const size = Number(h.headers['content-length'] ?? f.size);
    const r = await ctx.org.get(`${MONITORING}/api/logs/v2/${envId}/${encodeURIComponent(f.name)}?download=false`, { label: 'log-get', maxBytes: cap });
    if (r.status !== 200) { res.notes.push(`${f.name}: HTTP ${r.status}`); continue; }
    bytes += r.text.length;
    if (size > cap) res.notes.push(`${f.name}: read ${cap} of ${size} bytes (cap)`);
    const s = scanLog(r.text, redact);
    for (const [id, v] of Object.entries(s.hits)) {
      const m = (merged[id] ||= { count: 0, subjects: new Set(), samples: [], files: [] });
      m.count += v.count; v.subjects.forEach((x) => m.subjects.add(x)); m.samples.push(...v.samples.slice(0, 2)); m.files.push(f.name);
    }
  }
  return { merged, bytes };
}

export async function checkO1(ctx) {
  const r = result('O1', 'CM log signatures (newest file per type)', { layer: 'OPS', surface: 'M' });
  const n = await newestPerType(ctx, ctx.cmEnv, 'log-list-cm');
  if (n.err) return { o1: unknown(r, n.err), subjects: [] };
  const { merged, bytes } = await scanFiles(ctx, ctx.cmEnv, n.newest, r);
  for (const [id, m] of Object.entries(merged)) {
    if (id === 'template-not-found') continue; // reported as T2 after confirmation on Authoring
    addFinding(r, { severity: SEV[id], title: `${TITLE[id]}: ${m.count} line(s)`, evidence: m.samples.slice(0, 3).join('\n'), remediation: id.startsWith('edge-') ? 'Read the Publishing log around these lines; republish the affected items once the cause is fixed.' : undefined, may_be_intentional: SEV[id] === 'P3' });
  }
  const perType = Object.values(n.files.reduce((m, f) => ((m[f.type] = (m[f.type] || 0) + 1), m), {}));
  r.notes.push(`${n.newest.length} newest files scanned (${Math.round(bytes / 1024)} KB) of ${n.files.length} listed${perType.some((c) => c >= 50) ? '; the list caps at 50 files per type' : ''}`);
  return { o1: r, subjects: [...(merged['template-not-found']?.subjects ?? [])], tnfCount: merged['template-not-found']?.count ?? 0 };
}

/** Confirm log-named items on Authoring. Selecting `template` is what exposes it: itemId alone still resolves. */
export async function confirmTemplateGone(ctx, subjects, lineCount) {
  const r = result('T2', 'Items whose template is gone (environment, from CM logs)', { layer: 'CT', surface: 'M + A' });
  if (!subjects.length) { r.notes.push('no "Data template not found" lines in the newest CM logs'); return r; }
  const confirmed = []; const unconfirmed = [];
  for (let i = 0; i < subjects.length; i += 50) {
    const chunk = subjects.slice(i, i + 50);
    const q = `{ ${chunk.map((p, k) => `p${k}: item(where:{ path:${JSON.stringify(p)} }){ itemId template{ templateId } }`).join(' ')} }`;
    const x = await ctx.org.agql(ctx.cmHost, q, null, { label: 't2-confirm' });
    // Attribute each error to its alias via errors[].path; fall back to the batch text when paths are absent.
    const byAlias = {}; for (const er of x.json?.errors || []) { const al = er.path?.[0] ?? '*'; byAlias[al] = `${byAlias[al] || ''} ${er.message}`; }
    chunk.forEach((p, k) => { const it = x.json?.data?.[`p${k}`]; const e = byAlias[`p${k}`] ?? byAlias['*'] ?? ''; (it === null && /template/i.test(e) ? confirmed : unconfirmed).push(p); });
  }
  if (confirmed.length) addFinding(r, { severity: 'P1', title: `${confirmed.length} item(s) whose data template no longer exists (they fail every publish that includes them)`, items: confirmed, evidence: `${lineCount} "Data template '{...}' not found" log lines; Authoring item(path) returns null with a template error for each`, remediation: 'Restore the template from serialization, or delete these items (Content Editor or by removing them from the serialized module). Check whether a sibling site\'s module owns them first.', fix_owner: 'cms' });
  if (unconfirmed.length) r.notes.push(`${unconfirmed.length} log-named item(s) now readable or gone (already fixed?)`);
  return r;
}

export async function checkO2(ctx) {
  const r = result('O2', 'Editing-host log signatures', { layer: 'OPS/EH', surface: 'M' });
  let eh = ctx.ehEnv;
  if (!eh && ctx.site) {
    const regs = await ehRegistrations(ctx);
    const slug = ctx.site.toLowerCase();
    eh = regs.list.find((x) => String(x.applicationName || '').toLowerCase() === slug)?.editingHostEnvironmentId;
  }
  if (!eh) return skipped(r, 'no editing-host env for this site (pass --eh-env; EH logs live under the EH env id only)');
  const n = await newestPerType(ctx, eh, 'log-list-eh');
  if (n.err) return unknown(r, n.err);
  const rh = n.newest.filter((f) => /^RenderingHost\./i.test(f.name));
  if (!rh.length) { addFinding(r, { severity: 'P2', title: 'Editing host has no RenderingHost log files', evidence: `EH env ${eh}: ${n.files.length} files listed`, remediation: 'Zero RenderingHost logs plus forbidden EH variables (E3) means the container never started.' }); return r; }
  const { merged } = await scanFiles(ctx, eh, rh, r);
  for (const [id, m] of Object.entries(merged)) addFinding(r, { severity: SEV[id], title: `${TITLE[id]}: ${m.count} line(s)`, evidence: m.samples.slice(0, 3).join('\n') });
  r.notes.push(`${rh.length} RenderingHost file(s) scanned (EH stdout carries no timestamps)`);
  return r;
}
