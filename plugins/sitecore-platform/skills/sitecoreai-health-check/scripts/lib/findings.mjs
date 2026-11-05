// Check results, findings and the report writer (Markdown + JSON). Pure: no network.
import { createHash } from 'node:crypto';

export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const STATUSES = ['pass', 'findings', 'unknown', 'skipped'];
const rank = (s) => { const i = SEVERITIES.indexOf(s); return i < 0 ? 9 : i; };

/** One check's outcome. UNKNOWN (instrument error) and SKIPPED (no credential / out of scope) are never "pass". */
export function result(check, title, extra = {}) {
  return { check, title, status: 'pass', reason: null, degraded: null, findings: [], notes: [], ...extra };
}
export function addFinding(res, f) {
  if (!SEVERITIES.includes(f.severity)) throw new Error(`bad severity ${f.severity} on ${f.check || res.check}`);
  const finding = { check: res.check, fix_owner: 'ops', may_be_intentional: false, ...f };
  finding.fingerprint = fingerprint(finding);
  res.findings.push(finding);
  if (res.status === 'pass') res.status = 'findings';
  return finding;
}
export const unknown = (res, reason) => Object.assign(res, { status: 'unknown', reason });
export const skipped = (res, reason) => Object.assign(res, { status: 'skipped', reason });

export function fingerprint(f) {
  return createHash('sha1').update([f.check, f.title, f.item || '', f.url || '', f.target || ''].join('|')).digest('hex').slice(0, 10);
}

/** 0 clean; 1 any finding >= P1 or any UNKNOWN check (an instrument error is never clean); 2 harness error. */
export function exitCode(results, harnessError = false) {
  if (harnessError) return 2;
  const bad = results.some((r) => r.status === 'unknown' || r.findings.some((f) => rank(f.severity) <= 1));
  return bad ? 1 : 0;
}

export function pagesLink(ctx, itemId) {
  if (!itemId || !ctx?.site) return null;
  const q = new URLSearchParams({ organization: ctx.organization || '', tenantName: ctx.tenantName || '', sc_site: ctx.site, sc_itemid: bare(itemId), sc_lang: ctx.lang || 'en' });
  return `https://pages.sitecorecloud.io/editor?${q}`;
}
export function contentEditorLink(ctx, itemId) {
  if (!itemId || !ctx?.cmHost) return null;
  return `${ctx.cmHost.replace(/\/$/, '')}/sitecore/shell/Applications/Content%20Editor.aspx?fo=${encodeURIComponent(braced(itemId))}&la=${ctx.lang || 'en'}`;
}
const bare = (id) => String(id).replace(/[{}]/g, '').toLowerCase();
const braced = (id) => { const h = String(id).replace(/[{}-]/g, '').toUpperCase(); return h.length === 32 ? `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}` : String(id); };

export function summarize(results) {
  const s = { P0: 0, P1: 0, P2: 0, P3: 0, unknown: 0, skipped: 0, passed: 0, degraded: 0 };
  for (const r of results) {
    if (r.status === 'unknown') s.unknown++;
    else if (r.status === 'skipped') s.skipped++;
    else if (r.status === 'pass') s.passed++;
    if (r.degraded) s.degraded++;
    for (const f of r.findings) s[f.severity]++;
  }
  return s;
}

/** Build the JSON and Markdown report. `redact` is applied to the whole rendered output. */
export function buildReport({ target = {}, instruments = [], credentials = [], results = [], cost = {}, startedAt, finishedAt, linkCtx = null, version = '0.1.0', redact = (x) => x, harnessError = null }) {
  const findings = results.flatMap((r) => r.findings).sort((a, b) => rank(a.severity) - rank(b.severity) || a.check.localeCompare(b.check));
  for (const f of findings) {
    if (f.itemId && linkCtx) f.links = { pages: pagesLink(linkCtx, f.itemId), contentEditor: contentEditorLink(linkCtx, f.itemId) };
  }
  const summary = summarize(results);
  const code = exitCode(results, !!harnessError);
  const json = { tool: 'sitecoreai-health-check', version, startedAt, finishedAt, exitCode: code, harnessError, target, instruments, credentials, summary,
    reverseDrift: findings.some((f) => f.reverse_drift), results: results.map(({ findings: _f, ...r }) => r), findings, cost };
  return { json: redact(json), md: redact(renderMarkdown(json)), exitCode: code };
}

const EXIT_TEXT = { 0: 'clean: no finding at P1 or above, no UNKNOWN check', 1: 'findings at P1 or above, or UNKNOWN checks', 2: 'harness error: the run did not complete' };
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderMarkdown(j) {
  const L = [];
  const t = j.target || {};
  L.push(`# Doctor report: ${t.site || t.cmEnv || 'environment'} (${(j.startedAt || '').slice(0, 10)})`, '');
  L.push(`> Read-only health check (\`sitecoreai-health-check\` v${j.version}). Exit **${j.exitCode}**: ${EXIT_TEXT[j.exitCode]}.`);
  if (j.harnessError) L.push(`>`, `> **Harness error:** ${j.harnessError}`);
  L.push('', '## Target', '', '| Key | Value |', '|---|---|');
  for (const [k, v] of Object.entries(t)) if (v != null && v !== '') L.push(`| ${cell(k)} | ${cell(v)} |`);
  L.push('', '## Summary', '', '| P0 | P1 | P2 | P3 | UNKNOWN | SKIPPED | Passed | Degraded |', '|---|---|---|---|---|---|---|---|');
  const s = j.summary; L.push(`| ${s.P0} | ${s.P1} | ${s.P2} | ${s.P3} | ${s.unknown} | ${s.skipped} | ${s.passed} | ${s.degraded} |`);
  if (j.reverseDrift) L.push('', '> **Do not republish.** At least one item is broken on master but still good on Edge (reverse drift). A publish would push the broken state live. Fix master first, verify on preview, then publish only the fixed items.');
  L.push('', '## Findings', '');
  if (!j.findings.length) L.push('None.');
  for (const sev of SEVERITIES) {
    const fs = j.findings.filter((f) => f.severity === sev);
    if (!fs.length) continue;
    L.push(`### ${sev} (${fs.length})`, '');
    for (const f of fs) {
      L.push(`#### [${f.severity}] ${f.check}: ${f.title}`, '');
      const meta = [f.layer && `layer ${f.layer}`, f.surface && `surface ${f.surface}`, `fix owner ${f.fix_owner}`, f.may_be_intentional && 'may be intentional', `id \`${f.fingerprint}\``].filter(Boolean).join(' · ');
      L.push(`- ${meta}`);
      if (f.item) L.push(`- Item: \`${f.item}\`${f.itemId ? ` (${f.itemId})` : ''}`);
      if (f.url) L.push(`- URL: ${f.url}`);
      if (f.items?.length) { L.push(`- Affected (${f.items.length}):`); for (const x of f.items.slice(0, 50)) L.push(`  - \`${x}\``); if (f.items.length > 50) L.push(`  - … ${f.items.length - 50} more in the JSON report`); }
      if (f.evidence) L.push('- Evidence:', '', '```', String(typeof f.evidence === 'string' ? f.evidence : JSON.stringify(f.evidence, null, 1)).slice(0, 1500), '```', '');
      if (f.remediation) L.push(`- Remediation: ${f.remediation}`);
      if (f.links?.pages) L.push(`- Open: [Pages](${f.links.pages}) · [Content Editor](${f.links.contentEditor})`);
      L.push('');
    }
  }
  const unk = j.results.filter((r) => r.status === 'unknown');
  L.push('## UNKNOWN (instrument errors: never read these as clean)', '');
  if (!unk.length) L.push('None.'); else { L.push('| Check | Title | Reason |', '|---|---|---|'); for (const r of unk) L.push(`| ${r.check} | ${cell(r.title)} | ${cell(r.reason)} |`); }
  const sk = j.results.filter((r) => r.status === 'skipped');
  L.push('', '## SKIPPED', '');
  if (!sk.length) L.push('None.'); else { L.push('| Check | Title | Reason |', '|---|---|---|'); for (const r of sk) L.push(`| ${r.check} | ${cell(r.title)} | ${cell(r.reason)} |`); }
  const deg = j.results.filter((r) => r.degraded);
  if (deg.length) { L.push('', '## Degraded checks', '', '| Check | Why |', '|---|---|'); for (const r of deg) L.push(`| ${r.check} | ${cell(r.degraded)} |`); }
  const ok = j.results.filter((r) => r.status === 'pass');
  L.push('', '## Passed', '');
  if (!ok.length) L.push('None.'); else { L.push('| Check | Title | Note |', '|---|---|---|'); for (const r of ok) L.push(`| ${r.check} | ${cell(r.title)} | ${cell(r.notes?.join('; '))} |`); }
  L.push('', '## Instruments (what truth each one sees)', '');
  for (const i of j.instruments) L.push(`- ${i}`);
  L.push('', '## Credential matrix', '', '| Credential | Source (name only) | Status | Enables |', '|---|---|---|---|');
  for (const c of j.credentials) L.push(`| ${cell(c.name)} | ${cell(c.source)} | ${cell(c.status)} | ${cell(c.enables)} |`);
  const c = j.cost || {};
  L.push('', '## Run cost', '', `- Wall: ${c.wallMs ?? '?'} ms; calls: ${c.calls ?? '?'}; bytes: ${c.bytes ?? '?'}; HTTP 429: ${c.s429 ?? 0}; refused by the read-only guard: ${c.refused ?? 0}`);
  if (c.byHost) { L.push('', '| Host | Calls |', '|---|---|'); for (const [h, n] of Object.entries(c.byHost)) L.push(`| ${cell(h)} | ${n} |`); }
  L.push('');
  return L.join('\n');
}
