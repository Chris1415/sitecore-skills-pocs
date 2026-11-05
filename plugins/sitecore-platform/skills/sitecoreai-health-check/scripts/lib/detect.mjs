// Pure detectors (no I/O): field-value parsers, the content-graph analysis, log signatures.
// Probe-measured facts behind each rule: references/check-catalogue.md.

export const GUID = /\{?([0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{12})\}?/;
export const norm = (g) => { const h = String(g).replace(/[{}-]/g, '').toUpperCase(); return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`; };

/** Field value → forward edges + value-level issues (General Link, Image, layout XML, RTE, GUID lists). */
export function parseValue(fieldName, typeKey, value) {
  const edges = []; const issues = [];
  if (!value) return { edges, issues };
  const v = String(value);
  if (/^\s*<r[\s>]/.test(v) && /<d\b|s:id|s:ds|s:par/.test(v)) {
    for (const m of v.matchAll(/<r\b([^>]*)\/?>/g)) {
      const at = Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
      if (at['s:id']) edges.push({ kind: 'rendering', raw: at['s:id'], uid: at.uid });
      if (at['s:ds'] != null && at['s:ds'] !== '') edges.push({ kind: 'datasource', raw: at['s:ds'], uid: at.uid, ph: at['s:ph'] });
    }
    return { edges, issues };
  }
  if (/<link\b/i.test(v)) {
    for (const m of v.matchAll(/<link\b([^>]*)\/?>/gi)) {
      const at = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1].toLowerCase(), x[2]]));
      const type = (at.linktype || '').toLowerCase();
      if (type === 'internal') {
        if (!at.id) issues.push({ check: 'L1', key: 'internal-no-id', severity: 'P0', title: 'Internal link without id= (nulls the Edge route)', detail: `url="${at.url ?? ''}"` });
        else edges.push({ kind: 'link', raw: at.id });
      } else if (type === 'media' && at.id) edges.push({ kind: 'media-link', raw: at.id });
      if (/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(m[0])) issues.push({ check: 'L1', key: 'raw-ampersand', severity: 'P2', title: 'Unescaped & inside link XML', detail: m[0].slice(0, 160) });
    }
    return { edges, issues };
  }
  if (/<image\b/i.test(v)) { const m = v.match(/mediaid="([^"]*)"/i); if (m && m[1]) edges.push({ kind: 'image', raw: m[1] }); return { edges, issues }; }
  if (/~\/link\.aspx|-\/media\/|~\/media\//i.test(v)) {
    for (const m of v.matchAll(/~\/link\.aspx\?_id=([0-9A-Fa-f]{32})/g)) edges.push({ kind: 'rte-link', raw: m[1] });
    for (const m of v.matchAll(/[-~]\/media\/([0-9A-Fa-f]{32})\.ashx/g)) edges.push({ kind: 'rte-media', raw: m[1] });
  }
  const trimmed = v.trim();
  if (/^\{?[0-9A-Fa-f-]{32,36}\}?([|\r\n]+\{?[0-9A-Fa-f-]{32,36}\}?)*$/.test(trimmed)) {
    const parts = trimmed.split(/[|\r\n]+/).filter(Boolean);
    if (/[\r\n]/.test(trimmed)) issues.push({ check: 'L3', key: 'newline-joined', severity: 'P2', title: 'Multi-value joined with newlines (resolves nothing)', detail: `${parts.length} ids` });
    for (const p of parts) {
      if (!/^\{[0-9A-Fa-f]{8}-/.test(p)) issues.push({ check: 'L3', key: 'undashed-guid', severity: 'P3', title: 'Reference value is not a braced dashed GUID', detail: p });
      edges.push({ kind: 'reference', raw: p });
    }
  }
  return { edges, issues };
}

/** Resolution key for an edge: by id, by path, or null when it cannot be resolved statically. */
export function edgeTarget(edge) {
  if (edge.kind === 'datasource' && /^local:/i.test(edge.raw)) { const path = `${edge.srcPath}${edge.raw.replace(/^local:/i, '')}`; return { key: `path:${path.toLowerCase()}`, ref: { path } }; }
  if (edge.kind === 'datasource' && /^\/sitecore\//i.test(edge.raw)) return { key: `path:${edge.raw.toLowerCase()}`, ref: { path: edge.raw } };
  if (edge.kind === 'datasource' && /^query:/i.test(edge.raw)) return { query: true };
  const m = String(edge.raw).match(GUID);
  return m ? { key: `id:${norm(m[1])}`, ref: { id: norm(m[1]) } } : { unparseable: true };
}

const KIND_CHECK = {
  link: ['L1', 'link-target-missing', 'General Link points at a missing item'],
  'media-link': ['L1', 'media-link-missing', 'Media link points at a missing item'],
  image: ['M1', 'image-missing', 'Image field points at a missing media item'],
  'rte-link': ['L2', 'rte-target-missing', 'Rich-text dynamic link points at a missing item'],
  'rte-media': ['L2', 'rte-media-missing', 'Rich-text media reference is missing'],
  reference: ['L3', 'reference-missing', 'Reference field (Droplink/Multilist/Treelist) points at a missing item'],
  datasource: ['L4', 'datasource-missing', 'Rendering datasource (s:ds) is missing'],
  rendering: ['L6', 'rendering-missing', 'Rendering definition (s:id) is missing'],
};

/**
 * Content-graph analysis. Inputs are already-fetched facts:
 *   inventory  [{ itemId, path, templateName, templateId }]
 *   items      { [normId]: { path, hasPresentation, fields: [{ name, value, typeKey }] } }
 *   resolved   Map key -> { exists, id, path, brokenTemplate }
 *   edgeState  Map normId -> true|false (published on live Edge), empty when the live leg was skipped
 */
export function analyzeGraph({ inventory = [], items = {}, resolved = new Map(), edgeState = new Map(), liveChecked = false }) {
  const findings = []; const edges = [];
  const F = (f) => findings.push(f);
  for (const x of inventory) if (!x.templateName) F({ check: 'T2', key: 'missing-template', severity: 'P1', title: 'Item whose template no longer exists', item: x.path, itemId: norm(x.itemId), detail: `templateName empty in the index (template ${x.templateId ?? '?'})` });
  for (const [id, it] of Object.entries(items)) {
    for (const n of it.fields || []) {
      if (!n.value) continue;
      const { edges: es, issues } = parseValue(n.name, n.typeKey, n.value);
      for (const e of es) edges.push({ src: id, srcPath: it.path, field: n.name, ...e });
      for (const is of issues) F({ ...is, item: it.path, itemId: id, field: n.name });
    }
  }
  const targets = new Map();
  for (const e of edges) {
    const t = edgeTarget(e);
    if (t.query) { F({ check: 'L4', key: 'query-datasource', severity: 'P3', title: 'query: datasource not resolved statically', item: e.srcPath, itemId: e.src, field: e.field }); continue; }
    if (t.unparseable) { F({ check: 'L3', key: 'unparseable-ref', severity: 'P2', title: 'Unparseable reference value', item: e.srcPath, itemId: e.src, field: e.field, detail: String(e.raw).slice(0, 80) }); continue; }
    if (!targets.has(t.key)) targets.set(t.key, { ref: t.ref, sources: [] });
    targets.get(t.key).sources.push(e);
  }
  for (const [k, t] of targets) {
    const res = resolved.get(k);
    if (!res) continue; // unresolved = not asked; the caller reports UNKNOWN for failed batches
    for (const e of t.sources) {
      if (!res.exists) {
        const [check, key, title] = KIND_CHECK[e.kind] || ['L3', 'target-missing', 'Reference points at a missing item'];
        F(res.brokenTemplate
          ? { check: 'T2', key: 'target-template-missing', severity: 'P1', title: 'Referenced item exists but its template is gone', item: e.srcPath, itemId: e.src, field: e.field, target: t.ref.id || t.ref.path }
          : { check, key, severity: 'P1', title, item: e.srcPath, itemId: e.src, field: e.field, target: t.ref.id || t.ref.path, uid: e.uid });
        continue;
      }
      // Edge only carries the content and media trees: template/layout/system targets are never "published".
      const onEdgeTree = /^\/sitecore\/(content|media library)\//i.test(res.path || '');
      if (liveChecked && onEdgeTree && ['link', 'reference', 'image', 'datasource', 'rte-link'].includes(e.kind) && edgeState.get(e.src) === true && edgeState.get(res.id) === false)
        F({ check: 'L5', key: 'published-to-unpublished', severity: e.kind === 'datasource' ? 'P1' : 'P2', title: 'Published item references an unpublished item', item: e.srcPath, itemId: e.src, field: e.field, target: res.path });
    }
  }
  // Reverse index (counts only). D12 counts descendants of a referenced datasource as referenced:
  // list datasources reach their rows as children, never by id.
  const inbound = new Set();
  for (const [k, t] of targets) { const r = resolved.get(k); if (r?.exists && t.sources.length) inbound.add((r.path || '').toLowerCase()); }
  const referencedPrefixes = [...inbound].filter(Boolean);
  const dataItems = inventory.filter((x) => /\/data\//i.test(x.path) && !/folder/i.test(x.templateName || ''));
  const d12 = dataItems.filter((x) => { const p = x.path.toLowerCase(); return !referencedPrefixes.some((r) => p === r || p.startsWith(`${r}/`)); });
  return { findings, edges, targets, reverseIndex: { targetsWithInbound: inbound.size, dataItems: dataItems.length, d12Candidates: d12.map((x) => x.path) } };
}

// ---- logs (level-aware; the CM line carries the date: '<thread> DD Mon YYYY HH:mm:ss LEVEL  msg') ----
export const CM_LINE = /^(\S+(?: #\d+)?)\s+(\d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR|DEBUG|FATAL)\s+(.*)$/;
/** [id, regex, severity, minLevel ('WARN' means the line must be WARN/ERROR/FATAL), subject extractor] */
export const SIGNATURES = [
  ['edge-ack-hung', /Error processing ack messages|EdgeApiException|status:\s*520/i, 'P0', null],
  ['edge-media-blob', /Failed to upload media blob/i, 'P1', null],
  ['edge-batch-failed', /Sending (layout )?update batch failed/i, 'P1', null],
  ['edge-delta-block', /CheckDeltaPublishBlock/i, 'P1', 'WARN'],
  ['edge-verify-status', /Could not verify publishing status/i, 'P1', null],
  ['edge-rendered-entity', /Failed to generate RenderedEntity/i, 'P1', null],
  ['edge-destinations', /Failed to set destinations/i, 'P1', null],
  ['template-not-found', /Data template '\{?[0-9A-Fa-f-]+\}?' not found for item '([^']+)'/i, 'P1', null],
  ['solr-degraded', /IsSolrAliveAgent|IndexingStateSwitcher|Solr.*(not available|unavailable|is down)/i, 'P1', 'WARN'],
  ['editing-secret', /Missing or invalid editing secret/i, 'P1', null],
  ['secret-leak-debug', /sent ".*" expected ".*"/, 'P1', null],
  ['edge-quota', /API calls quota exceeded/i, 'P1', null],
  ['personalize-timeout', /IE-003/, 'P2', null],
  ['media-hash', /MediaRequestProtection: An invalid\/missing hash/i, 'P3', null],
  ['owin-auth-failed', /OAuthBearerAuthenticationMiddleware - Authentication failed/i, 'P3', null],
];
const SERIOUS = new Set(['WARN', 'ERROR', 'FATAL']);

/** Scan one log file's text. Lines without a CM prefix (EH stdout, stack continuations) have level null. */
export function scanLog(text, redactFn = (s) => s) {
  const levels = {}; const hits = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line) continue;
    const m = line.match(CM_LINE); const level = m ? m[3] : (line.match(/\b(ERROR|WARN|FATAL)\b/)?.[1] ?? null);
    if (level) levels[level] = (levels[level] || 0) + 1;
    for (const [id, re, , minLevel] of SIGNATURES) {
      const s = line.match(re); if (!s) continue;
      if (minLevel === 'WARN' && !SERIOUS.has(level)) continue;
      if (id === 'solr-degraded' && /->\s*'Running'/i.test(line)) continue; // a state change TO Running is recovery
      const h = (hits[id] ||= { count: 0, subjects: new Set(), samples: [], firstAt: null, lastAt: null });
      h.count++; if (s[1]) h.subjects.add(s[1]);
      if (m) { h.firstAt ??= m[2]; h.lastAt = m[2]; }
      if (h.samples.length < 3) h.samples.push(redactFn(line).slice(0, 240));
    }
  }
  return { levels, hits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, { ...v, subjects: [...v.subjects] }])) };
}

/** Deployment v3 record → advisory contradictions (never verdicts: records can flip after completion). */
export function deploymentAdvisories(d) {
  const out = [];
  const at = (k) => (d?.[k] ? Date.parse(d[k]) : null);
  if (at('postActionCompletedAt') && at('deploymentCompletedAt') && at('postActionCompletedAt') < at('deploymentCompletedAt')) out.push('post-action completed before deployment (leg-mutation detector)');
  if (/Failed deployment '[^']+'/.test(d?.deploymentLastFailureMessage || '')) out.push('failure message names only its own deployment id (carries no information)');
  for (const k of Object.keys(d || {})) if (/LastFailureMessage$/.test(k) && d[k] && !/Failed deployment '/.test(d[k])) out.push(`${k}: ${String(d[k]).slice(0, 120)}`);
  return out;
}

/** Media URLs in served HTML (and RSC payload). '\' ends a JSON-escaped URL: exclude it or a healthy asset reads as 400. */
export function harvestMedia(html, limit = 10) {
  const direct = [...new Set([...String(html).matchAll(/https?:\/\/[^"'\s)\\]+?\/(?:-\/)?(?:jssmedia|media)\/[^"'\s)\\]+/g)].map((m) => m[0].replace(/&amp;/g, '&').replace(/\\u0026/g, '&')))];
  const viaNext = [...new Set([...String(html).matchAll(/\/_next\/image\?url=([^&"'\s]+)/g)].map((m) => { try { return decodeURIComponent(m[1]); } catch { return null; } }))].filter((u) => u && /^https?:\/\/.*\/(?:-\/)?(?:jss)?media\//.test(u));
  return [...new Set([...direct, ...viaNext])].slice(0, limit);
}

/** Internal hrefs from HTML (fallback crawler). */
export function extractHrefs(html, base) {
  const out = new Set(); const b = new URL(base);
  for (const m of String(html).matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const raw = (m[2] ?? m[3] ?? '').replace(/&amp;/g, '&');
    if (!raw || /^(mailto:|tel:|javascript:|#)/i.test(raw)) continue;
    out.add(raw);
  }
  return [...out].map((raw) => { try { const u = new URL(raw, b); return { raw, url: u, internal: u.host === b.host }; } catch { return { raw, url: null, internal: false }; } });
}
