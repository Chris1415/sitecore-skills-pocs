// Check ids, families and v0.1 implementation status. references/check-catalogue.md carries the full
// rows; __tests__/report.test.mjs fails when the two disagree.
export const FAMILIES = {
  binding: ['X0', 'X1'],
  ops: ['O3', 'O4', 'O5', 'O6', 'O7', 'O8'],
  eh: ['E1', 'E2', 'E3', 'E4'],
  delivery: ['D1', 'D2', 'D3', 'D4', 'D6', 'D8', 'D10', 'D13', 'D14', 'D15', 'D16'],
  census: ['R1', 'D11'],
  graph: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'R2', 'R3', 'R5', 'R6', 'W1', 'W2', 'W3', 'W4', 'W5', 'M1', 'M2', 'N1', 'N2', 'S2', 'S4', 'D12', 'ST1'],
  crawl: ['D5', 'D7', 'D9'],
  logs: ['O1', 'O2'],
};
export const TITLES = {
  X0: 'Tenant binding', X1: 'Credential matrix',
  D1: 'Delivery on the LIVE context id, id alive', D2: 'robots.txt vs delivery visibility', D3: 'Deployment protection vs visibility', D4: 'Revalidate endpoint not open',
  R1: 'Edge route census: no route:null / item:null', L1: 'General Link targets', L6: 'Rendering definitions (s:id) resolve', T5: 'Params template on a datasource rendering',
  D5: 'Live link crawl (hydrated)', D6: 'Media delivered from Edge (200, non-HTML)', D7: 'Per-page markers (MissingComponent, noindex)', D8: 'Sitemap on the public host', D9: 'Console errors after hydration',
  D10: 'Edge webhook health', D11: 'Preview vs live route/component diff', E1: 'Editing config on the delivery surface', E2: 'Editing-host registrations and Rendering Host items', E3: 'Editing-host variable hygiene', E4: 'Sites API editing hosts',
  R2: 'Master page with no live route', R3: 'Live route with no master item', R5: 'Error pages configured', R6: 'Page Design resolves', L2: 'Rich-text dynamic links', L3: 'Reference fields resolve', L4: 'Datasources resolve', L5: 'Published item references unpublished item',
  T1: '__Base template resolves (live)', T2: 'Item whose template is gone', T6: 'Template resolves on LIVE Edge (no UnknownTemplate)', W5: 'Edge vs master drift (reverse drift = do not republish)', O1: 'CM log signatures', O2: 'Editing-host log signatures', O3: 'Environment and deployment state (advisory)', O4: 'Org health and CM liveness', O5: 'Log levels and debug namespaces', O6: 'Publishing job health', O7: 'Vercel runtime errors',
  O8: 'Audit-log change correlation', L7: 'Empty Allowed Controls', L8: 'Hard-pinned Datasource Location', T3: 'Missing __Standard Values', T4: 'Rendering-schema Definition of Done', W1: 'Workflow-stuck items', W3: 'Missing language versions', W4: 'Empty required fields', M1: 'Missing alt text / image targets', M2: 'Oversized media',
  N1: 'Duplicate sibling names', N2: 'Invalid names', S2: 'Site hosts', S4: 'Redirect health', ST1: 'Static head-app audits', W2: 'Long-held locks', D12: 'Unreferenced data items (candidates)', D13: 'Core Web Vitals', D14: '/llms.txt present', D15: 'Leftover debug routes', D16: 'Unknown route returns 404 (no soft 404)',
};
/** Why a catalogue row does not run in v0.1 (null = implemented). */
export const NOT_RUN = {
  T5: 'not implemented in v0.1 (disk side: audit-sitecore-schema.mjs on a checkout)', R5: 'not implemented in v0.1', R6: 'not implemented in v0.1', T1: 'framework script check-template-base-chain.mjs (needs a local cm/ and --brand); run it by hand',
  T3: 'not implemented in v0.1', T4: 'disk-only audit (audit-sitecore-schema.mjs) on a local checkout', W1: 'not implemented in v0.1', W2: 'not implemented in v0.1 (needs per-item __Lock reads)', W4: 'not implemented in v0.1',
  M2: 'not implemented in v0.1', N1: 'not implemented in v0.1', N2: 'not implemented in v0.1', S2: 'not implemented in v0.1', S4: 'not implemented in v0.1', L7: 'not implemented in v0.1', L8: 'not implemented in v0.1 (disk side: schema audit)',
  ST1: 'disk-only audits on a local head-app checkout (map keys, authorability, consent, comments, shape)', D13: 'not implemented in v0.1 (optional Lighthouse)', O7: 'Vercel runtime history needs the REST API or a newer CLI (the installed CLI only streams)', O8: 'not implemented in v0.1',
  O6: 'needs a tenant-scoped automation client (the org client gets 403 on Publishing)', E4: 'needs a tenant-scoped automation client (the org client gets 401 on xmapps)',
};
export const ALL_IDS = Object.values(FAMILIES).flat();

/** --checks a,b or family names -> Set of ids (X0/X1 always included). */
export function selectChecks(spec) {
  if (!spec || spec === true) return new Set(ALL_IDS);
  const out = new Set(['X0', 'X1']);
  for (const t of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    if (FAMILIES[t.toLowerCase()]) FAMILIES[t.toLowerCase()].forEach((x) => out.add(x));
    else if (TITLES[t.toUpperCase()]) out.add(t.toUpperCase());
    else throw new Error(`--checks: unknown check or family "${t}" (families: ${Object.keys(FAMILIES).join(', ')})`);
  }
  return out;
}
