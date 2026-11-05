#!/usr/bin/env node
/**
 * build-list-component.mjs — the four legs of a Sitecore LIST component, verified or built.
 * (SKILL.md § "The decision, first" + § "Build order")
 *
 *   node scripts/build-list-component.mjs verify --host https://<cm-host> \
 *        --rendering "/sitecore/layout/Renderings/Project/<Brand>/<Site>/<Name>"
 *
 *   node scripts/build-list-component.mjs build --host https://<cm-host> \
 *        --rendering "/sitecore/layout/Renderings/Project/<Brand>/<Site>/<Name>" \
 *        --templates-root "/sitecore/templates/Project/<Brand>/<Site>" \
 *        --branches-root  "/sitecore/templates/Branches/Project/<Brand>/<Site>" \
 *        --component "Link List" \
 *        --container-fields "Heading:Single-Line Text" \
 *        --element-fields   "Link:General Link" \
 *        [--element-name "Link"] [--default-element "Link 1"] [--language en] [--apply]
 *
 * Token: --token <bearer> or env SITECORE_CM_TOKEN (a CM automation-client token with Authoring
 * GraphQL scope). The Authoring endpoint is <host>/sitecore/api/authoring/graphql/v1.
 *
 * verify  reads an EXISTING rendering and scores the four legs off the live tenant:
 *           0  _HorizonDatasourceGrouping on the CONTAINER template  (the Items section in Pages)
 *           1  __Masters on the container's __Standard Values       (which template a new row uses)
 *           2  Datasource Template is a BRANCH with a default row    (a new datasource is not empty)
 *           3  delivery is declared on the rendering                 (contents resolver / integrated
 *              GraphQL) — a head-side fetch is also valid, so an undeclared leg 3 is a WARN
 *         Exit 1 on a failed leg 0, 1 or 2.
 *
 * build   plans the element template, the container template (+ __Standard Values + __Masters +
 *         the two grouping base templates), the branch (+ `$name` + one default row) and the
 *         rendering's Datasource Template. DRY-RUN by default — prints every mutation it would
 *         send. `--apply` executes them (create-or-reuse by path), then runs verify on the result.
 *         The RENDERING must already exist: create it by cloning an OOTB one first
 *         (`content-sdk-create-component`); this script does not invent renderings.
 *
 * Controls before any verdict: the seven system items this relies on (Template, Template section,
 * Template field, Standard template, Branch, _HorizonDatasourceGrouping, _PublishingGroupingTemplate)
 * are looked up BY ID and their names asserted. A wrong host, a wrong token or a tenant with a
 * different system tree exits 2 — a harness that cannot see the system tree must not judge a
 * component. Never logs the token. Dependency-free Node ≥ 18.
 *
 * Exit 0 ok · 1 a leg failed (verify) · 2 harness (controls, auth, usage).
 */
const args = process.argv.slice(2);
const verb = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const JSON_OUT = flag('json');
const host = (opt('host') || process.env.SITECORE_CM_HOST || '').replace(/\/+$/, '');
const token = opt('token') || process.env.SITECORE_CM_TOKEN;
const language = opt('language', 'en');
const die = (code, msg) => { if (JSON_OUT) console.log(JSON.stringify({ error: msg }, null, 2)); else console.error(`ERROR: ${msg}`); process.exit(code); };
if (!['verify', 'build'].includes(verb) || !host || !token || !opt('rendering')) {
  console.error('usage: build-list-component.mjs verify|build --host https://<cm-host> [--token <bearer>] --rendering <path> [build options] [--apply] [--json]');
  process.exit(2);
}

// ---------------------------------------------------------------- well-known system items (asserted live)
const G = {
  TEMPLATE: '{AB86861A-6030-46C5-B394-E8F99E8B87DB}',
  TEMPLATE_SECTION: '{E269FBB5-3750-427A-9149-7AA950B49301}',
  TEMPLATE_FIELD: '{455A3E98-A627-4B40-8035-E683A0331AC7}',
  STANDARD_TEMPLATE: '{1930BBEB-7805-471A-A3BE-4858AC7CF696}',
  BRANCH: '{35E75C72-4985-4E09-88C3-0EAC6CD1E64F}',
  HORIZON: '{D0F6BE14-2A2D-4C56-ACB5-80CAA573B8E2}',
  PUBLISHING_GROUPING: '{8BA7DAC6-32ED-4378-BD9E-5DA5B0F9848D}',
};
const CONTROL_NAMES = {
  TEMPLATE: 'Template', TEMPLATE_SECTION: 'Template section', TEMPLATE_FIELD: 'Template field',
  STANDARD_TEMPLATE: 'Standard template', BRANCH: 'Branch',
  HORIZON: '_HorizonDatasourceGrouping', PUBLISHING_GROUPING: '_PublishingGroupingTemplate',
};
/**
 * Braced/dashed/uppercase, from ANY GUID shape a live field can hand back — bare 32 hex
 * ("N"), dashed-unbraced ("D"), or (the real defect this fixes) braced-but-undashed, which
 * is not a valid .NET Guid string at all and makes the Authoring GraphQL endpoint's `ID`
 * scalar coercion fail with an opaque `Unable to convert type from \`String\` to
 * \`Nullable\`1\`` — not a script bug in the query, a malformed value flowing straight back
 * into a later \`where: { itemId }\` unchanged. Found live on this tenant: `verify`'s own
 * leg-1 check reads a template's own `__Standard values` id and re-queries it by id.
 */
const dashed = (id) => {
  const hex = String(id).replace(/[{}-]/g, '').toUpperCase();
  if (hex.length !== 32 || /[^0-9A-F]/.test(hex)) return `{${hex}}`; // not a plain GUID payload — pass through, don't invent structure
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
};
const sameId = (a, b) => a && b && a.replace(/[{}-]/g, '').toUpperCase() === b.replace(/[{}-]/g, '').toUpperCase();
/** `__Base template` is pipe-delimited live; SCS serializes one GUID per line — accept both. */
const splitIds = (v) => (v || '').split(/[|\n]+/).map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- Authoring GraphQL
async function gql(query, variables) {
  const res = await fetch(`${host}/sitecore/api/authoring/graphql/v1`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) die(2, `Authoring GraphQL returned ${res.status} — the token is wrong for this host (the tenant comes from the token, not the URL)`);
  const j = await res.json().catch(() => null);
  if (!j) die(2, `Authoring GraphQL returned a non-JSON body (HTTP ${res.status}) — wrong host?`);
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data;
}
const ITEM_SEL = `itemId(format: D) name path template { name templateId(format: D) }
  base: field(name: "__Base template") { value }
  sv: field(name: "__Standard values") { value }
  masters: field(name: "__Masters") { value }
  ds: field(name: "Datasource Template") { value }
  cn: field(name: "componentName") { value }
  rcr: field(name: "Rendering Contents Resolver") { value }
  igql: field(name: "ComponentQuery") { value }
  children(first: 50) { nodes { itemId(format: D) name template { name templateId(format: D) } } }`;
async function readItem(where) {
  const w = where.path ? { path: where.path, language } : { itemId: dashed(where.id), language };
  const d = await gql(`query($where: ItemQueryInput!) { item(where: $where) { ${ITEM_SEL} } }`, { where: w });
  return d.item; // null when absent
}
async function createItem({ name, templateId, parent, fields = [] }) {
  const d = await gql(`mutation($input: CreateItemInput!) { createItem(input: $input) { item { itemId(format: D) name path } } }`,
    { input: { name, templateId, parent, language, fields } });
  return d.createItem.item;
}
async function updateItem(itemId, fields) {
  const d = await gql(`mutation($input: UpdateItemInput!) { updateItem(input: $input) { item { itemId(format: D) path } } }`,
    { input: { itemId, language, fields } });
  return d.updateItem.item;
}

// ---------------------------------------------------------------- controls
async function assertControls() {
  const bad = [];
  for (const [k, id] of Object.entries(G)) {
    const it = await readItem({ id }).catch((e) => ({ error: e.message }));
    if (!it || it.error || it.name !== CONTROL_NAMES[k]) bad.push(`${k} ${id} → ${it?.error ?? it?.name ?? 'absent'} (expected "${CONTROL_NAMES[k]}")`);
  }
  if (bad.length) die(2, `system-item controls failed — do not trust any verdict from this host/token:\n  ${bad.join('\n  ')}`);
}

// ---------------------------------------------------------------- verify
async function resolveDatasourceTemplate(value) {
  if (!value) return null;
  const v = value.trim();
  return /^\{?[0-9A-Fa-f-]{32,38}\}?$/.test(v) ? readItem({ id: v }) : readItem({ path: v });
}
async function verify(renderingPath, { quiet = false } = {}) {
  const r = await readItem({ path: renderingPath });
  if (!r) die(2, `rendering not found at ${renderingPath}`);
  const legs = [];
  const dsItem = await resolveDatasourceTemplate(r.ds?.value);
  let container = null, branch = null;
  if (!dsItem) legs.push({ leg: 2, ok: false, note: r.ds?.value ? `Datasource Template "${r.ds.value}" does not resolve` : 'Datasource Template is empty' });
  else if (sameId(dsItem.template.templateId, G.BRANCH)) {
    branch = dsItem;
    const dollar = dsItem.children.nodes.find((c) => c.name === '$name');
    if (!dollar) legs.push({ leg: 2, ok: false, note: `branch ${dsItem.path} has no $name item` });
    else {
      const dollarFull = await readItem({ id: dollar.itemId });
      container = await readItem({ id: dollar.template.templateId });
      const rows = dollarFull.children.nodes.length;
      legs.push({ leg: 2, ok: rows > 0, note: rows > 0 ? `branch ${dsItem.path} ships ${rows} default row(s)` : `branch ${dsItem.path} has a $name item but NO default row — a new datasource is an empty box` });
    }
  } else {
    container = dsItem;
    legs.push({ leg: 2, ok: false, note: `Datasource Template points at the bare template ${dsItem.path} — a new datasource starts empty; point it at a branch` });
  }
  if (container) {
    const bases = splitIds(container.base?.value);
    const horizon = bases.some((b) => sameId(b, G.HORIZON));
    const pubgrp = bases.some((b) => sameId(b, G.PUBLISHING_GROUPING));
    legs.push({ leg: 0, ok: horizon, note: `${container.path} __Base template ${horizon ? 'carries' : 'LACKS'} _HorizonDatasourceGrouping${horizon && !pubgrp ? ' (and lacks _PublishingGroupingTemplate, which normally travels with it)' : ''}` });
    const svId = container.sv?.value;
    const sv = svId ? await readItem({ id: svId }) : null;
    const masters = splitIds(sv?.masters?.value);
    legs.push({ leg: 1, ok: masters.length > 0, note: sv ? (masters.length ? `${sv.path} __Masters = ${masters.join(' | ')}` : `${sv.path} __Masters is EMPTY — no insert options`) : `${container.path} has no __Standard Values item` });
  } else {
    legs.push({ leg: 0, ok: false, note: 'no container template resolved' });
    legs.push({ leg: 1, ok: false, note: 'no container template resolved' });
  }
  const declared = Boolean(r.rcr?.value || r.igql?.value);
  legs.push({ leg: 3, ok: declared, warn: !declared, note: declared ? `delivery declared on the rendering (${r.rcr?.value ? 'Rendering Contents Resolver' : 'ComponentQuery'})` : 'no contents resolver or integrated GraphQL on the rendering — valid only if the head app fetches the children itself; prove it by rendering a page' });
  legs.sort((a, b) => a.leg - b.leg);
  const failed = legs.filter((l) => !l.ok && !l.warn);
  const result = { rendering: r.path, componentName: r.cn?.value ?? null, datasourceTemplate: r.ds?.value ?? null, container: container?.path ?? null, branch: branch?.path ?? null, legs, exit: failed.length ? 1 : 0 };
  if (!quiet && !JSON_OUT) {
    console.log(`\n${r.path}  (componentName ${result.componentName ?? '—'})`);
    for (const l of legs) console.log(`  leg ${l.leg}  ${l.ok ? 'PASS' : l.warn ? 'WARN' : 'FAIL'}  ${l.note}`);
    console.log(`\n${failed.length ? 'FAIL' : 'OK'}  ${failed.length} of the three structural legs failed${declared ? '' : '; leg 3 unverified here'} — then open Pages and add a row by hand: the audit is a floor, not proof.`);
  }
  return result;
}

// ---------------------------------------------------------------- build
const parseFields = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [name, type = 'Single-Line Text'] = x.split(':').map((y) => y.trim()); return { name, type }; });
async function ensure(plan, path, make) {
  const existing = await readItem({ path });
  if (existing) { plan.push({ op: 'reuse', path }); return existing; }
  plan.push({ op: 'create', path, ...make });
  return plan.apply ? createItem(make) : { itemId: `<new:${path}>`, path };
}
async function ensureTemplate(plan, root, name, fields, baseTemplates) {
  const t = await ensure(plan, `${root.path}/${name}`, { name, templateId: G.TEMPLATE, parent: root.itemId, fields: [{ name: '__Base template', value: baseTemplates.join('|') }] });
  if (fields.length) {
    const section = await ensure(plan, `${t.path}/Content`, { name: 'Content', templateId: G.TEMPLATE_SECTION, parent: t.itemId });
    for (const f of fields) await ensure(plan, `${section.path}/${f.name}`, { name: f.name, templateId: G.TEMPLATE_FIELD, parent: section.itemId, fields: [{ name: 'Type', value: f.type }] });
  }
  return t;
}
async function build() {
  const renderingPath = opt('rendering');
  const component = opt('component') || renderingPath.split('/').pop();
  const elementName = opt('element-name', `${component} Item`);
  const defaultElement = opt('default-element', `${opt('element-name', 'Item')} 1`);
  const templatesRoot = opt('templates-root') || die(2, '--templates-root is required for build');
  const branchesRoot = opt('branches-root') || die(2, '--branches-root is required for build');
  const rendering = await readItem({ path: renderingPath });
  if (!rendering) die(2, `rendering ${renderingPath} does not exist — clone an OOTB rendering first (content-sdk-create-component); this script builds datasources, not renderings`);
  const tRoot = await readItem({ path: templatesRoot });
  if (!tRoot) die(2, `templates root ${templatesRoot} does not exist`);
  const bRoot = await readItem({ path: branchesRoot });
  if (!bRoot) die(2, `branches root ${branchesRoot} does not exist — create the Branch folder chain under /sitecore/templates/Branches/Project first`);

  const plan = []; plan.apply = flag('apply');
  // 1. element template (a row) — no __Standard Values in the OOTB pattern
  const element = await ensureTemplate(plan, tRoot, elementName, parseFields(opt('element-fields')), [G.STANDARD_TEMPLATE]);
  // 2. container template — the two grouping base templates are what give Pages the Items section (leg 0)
  const container = await ensureTemplate(plan, tRoot, component, parseFields(opt('container-fields')), [G.STANDARD_TEMPLATE, G.PUBLISHING_GROUPING, G.HORIZON]);
  if (plan.apply && !splitIds(container.base?.value ?? '').some((b) => sameId(b, G.HORIZON))) {
    // reused container that lacks leg 0 — the shape measured 2026-08-28; add the bases rather than leave it
    const bases = [...new Set([...splitIds(container.base?.value), G.STANDARD_TEMPLATE, G.PUBLISHING_GROUPING, G.HORIZON].map(dashed))];
    plan.push({ op: 'update', path: container.path, fields: [{ name: '__Base template', value: bases.join('|') }] });
    await updateItem(container.itemId, [{ name: '__Base template', value: bases.join('|') }]);
  }
  // 3. __Standard Values + __Masters (leg 1)
  const sv = await ensure(plan, `${container.path}/__Standard Values`, { name: '__Standard Values', templateId: container.itemId, parent: container.itemId, fields: [{ name: '__Masters', value: element.itemId }] });
  plan.push({ op: 'update', path: container.path, fields: [{ name: '__Standard values', value: sv.itemId }] });
  if (plan.apply) { await updateItem(container.itemId, [{ name: '__Standard values', value: sv.itemId }]); await updateItem(sv.itemId, [{ name: '__Masters', value: element.itemId }]); }
  // 4. branch: $name on the container template, carrying __Masters, plus ONE default row (leg 2)
  const branch = await ensure(plan, `${bRoot.path}/${component}`, { name: component, templateId: G.BRANCH, parent: bRoot.itemId });
  const dollar = await ensure(plan, `${branch.path}/$name`, { name: '$name', templateId: container.itemId, parent: branch.itemId, fields: [{ name: '__Masters', value: element.itemId }] });
  await ensure(plan, `${dollar.path}/${defaultElement}`, { name: defaultElement, templateId: element.itemId, parent: dollar.itemId });
  // 5. rendering → branch (PATH form; content-sdk-create-component § Datasource Template)
  plan.push({ op: 'update', path: rendering.path, fields: [{ name: 'Datasource Template', value: branch.path }] });
  if (plan.apply) await updateItem(rendering.itemId, [{ name: 'Datasource Template', value: branch.path }]);

  if (!JSON_OUT) {
    console.log(`\n${plan.apply ? 'APPLIED' : 'DRY RUN'} — ${plan.length} step(s) for ${component} on ${renderingPath}`);
    for (const [i, s] of plan.entries()) console.log(`  ${String(i + 1).padStart(2)}. ${s.op.padEnd(6)} ${s.path}${s.templateId ? `  (template ${s.templateId})` : ''}${s.fields ? `  ${s.fields.map((f) => `${f.name}=${String(f.value).slice(0, 60)}`).join(', ')}` : ''}`);
    console.log(`\n  leg 3 (delivery) is not automated: set a children Rendering Contents Resolver, an integrated GraphQL query, or fetch in the head app.`);
    console.log(`  Icons: run content-sdk-icon-chooser's probe-icon.mjs --apply on every new template and __Standard Values.`);
    if (!plan.apply) console.log(`  Re-run with --apply to execute, then verify runs automatically.`);
  }
  if (plan.apply) return { plan, verify: await verify(renderingPath) };
  return { plan, dryRun: true };
}

// ---------------------------------------------------------------- main
await assertControls();
const out = verb === 'verify' ? await verify(opt('rendering')) : await build();
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
process.exit(out.exit ?? out.verify?.exit ?? 0);
