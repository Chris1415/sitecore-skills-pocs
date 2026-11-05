---
name: content-sdk-website-build-flow
description: "Building a Content SDK website: CMS and head-app sync, content-model direction, CM before editing-host deploy, page and partial designs via Authoring GraphQL, porting props to SDK fields, preview gating. Use when building or provisioning a site."
license: Apache-2.0
compatibility: "Requires SitecoreAI (Authoring GraphQL + Deploy CLI), a Content SDK App Router head app (per setup-content-sdk) and Sitecore CLI for ser pull. The preview-gate section assumes a host that builds per-PR preview deployments (Vercel or equivalent) and emits a deployment event CI can hook."
metadata:
  author: Christian Hahn
  version: "1.2.3"
---

# Content SDK Website Build — domain craft

Reusable Sitecore/CMS/head-app recipes for Content SDK websites. **Not** a pipeline playbook: stage order, slash-commands, and agent roles belong to the calling project.

Most failures come from desyncing two tracks. Keep them honest at every handoff.

## The two-track model

| | **CMS track** (live tenant) | **Head-app track** (repo) |
|---|---|---|
| Artifacts | Renderings, parameters/datasource templates, Headless Variants, content items, site collection / site nodes, publish events | Components, queries, route handlers, theme, chrome, build output |
| Source of truth | Live tenant (`*.sitecorecloud.io`); authoring solution mirrored via ser pull | Head-app repo (editing host) |
| Sync | Author live (to **preview**); `dotnet sitecore ser pull` into the CM authoring solution — never push | Port / implement against live Edge payloads |

Items are authored live and **pulled** into the CM code base. Publishing to LIVE Edge is a separate, explicit step — during build/author work, rely on **preview**.

## NEW vs EXISTING (content-model direction)

Ask once up front. It drives whether the content model is *derived* or *read*.

| Scenario | Content model | Static reference app (optional) | Provisioning shape |
|---|---|---|---|
| **NEW site** | Derived from design / static props / clickdummy; authored live during implementation | Built before the head app if used; props chosen freely | Full cascade: project → CM env → editing host → collection → site; create CM baseline when the CM is new |
| **EXISTING site** | Already exists — inventory first (templates, datasource field types, renderings, resolvers) | If used, props **bounded by** inventoried field shapes | Create only missing rungs (often editing host + head-app scaffold); reuse existing CM code path |

**Incremental** addition of one rendering to an already-built head app: skip any separate static app; use the per-component cycle directly.

## Build-directly vs separate static app

The separate static app (plain Next.js, **zero** `@sitecore-content-sdk/*`) decouples UI from the tenant. It is **not free**: components are written twice (plain props, then ported to SDK fields).

| Situation | Approach |
|---|---|
| Tenant provisioned + visual design / clickdummy approved | **Build directly in the head app** (default). Clickdummy is the visual oracle; preview each component against the live tenant |
| No tenant yet / offline / design still fluid / want a tenant-independent UI artifact | Produce the separate static app, then port |
| Incremental addition to an already-built head app | Per-component cycle directly (no static app) |

When building directly, the "port loop" collapses to: implement with SDK field components in the head app, clickdummy as visual oracle — same checklist, minus copy-from-static.

### Why prefer a real tenant over mocking

Content SDK reaches Edge from `getPage`, `getDictionary`, `getErrorPage`, `generateStaticParams`, and the `sitecore-tools:build` prelude. Mocking "no tenant" metastasizes into sentinel guards across many files plus a fragile `npm run dev`. A real tenant keeps the head app stock; the port (or direct build) is where Sitecore expertise is applied against real payloads.

> **Mock data is an explicit OPT-IN**, never the default. See Appendix.

## CM ↔ editing-host deploy ordering

1. Deploy the **CM** first (`cloud deployment create … --upload --working-dir <cm>/ --no-watch`). The deployment creates the **Edge resource** for the env contextId early in the run.
2. **Wait ~1–2 minutes** (or poll until past Edge-resource creation) before deploying the editing host.
3. Deploy the **editing host** (`cloud editinghost deploy … --upload --working-dir <head-app>/ --no-watch`).

The EH `next build` SSG-prerenders against Edge **at build time**. Concurrent CM+EH deploy yields `the sitecoreContextId does not contain a edge resource`. Empty *content* is fine; the Edge *resource* must exist first.

**Auth gotcha (XM Apps writes):** mint a CM environment automation client (`POST /api/clients/v1/cm`) after CM deploy. Collection/site creates need that minted token — the org deploy-admin token **401s** on those writes.

**RenderingHost:** after the editing host is up, set the Site Grouping item field `RenderingHost` (plain string) to the `renderingHosts.<key>` name from the head app's `xmcloud.build.json` (must match the editing-host name). Path: `/sitecore/content/<COLLECTION>/<SITE>/Settings/Site Grouping/<SITE>`.

```graphql
{ item(where: { path: "/sitecore/content/<COLLECTION>/<SITE>/Settings/Site Grouping/<SITE>", language: "en" }) {
  itemId(format: D)
  field(name: "RenderingHost") { value }
} }

mutation SetRH($id: ID!, $name: String!) {
  updateItem(input: { itemId: $id, language: "en", version: 1, fields: [{ name: "RenderingHost", value: $name }] }) {
    item { field(name: "RenderingHost") { value } }
  }
}
```

## Page / Partial Designs — site chrome skeleton

When SitecoreAI creates a site it provisions empty `Presentation/Page Designs` and `Presentation/Partial Designs`. Populate the minimum chrome skeleton once per site (idempotent).

**Auth:** CM environment client JWT. **Endpoint:** `https://<tenant>.sitecorecloud.io/sitecore/api/authoring/graphql/v1`

### Template IDs (stable across tenants in the same org — still verify if unsure)

- Partial Design: `{FD2059FD-6043-4DFE-8C04-E2437CE87634}`
- Page Design: `{1105B8F8-1E00-426B-BF1F-C840742D827B}`

`createItem` requires **braced** `{GUID}` for `templateId`.

### Step 1 — Idempotency check

```graphql
{
  headerPD: item(where: { path: "/sitecore/content/<COLLECTION>/<SITE>/Presentation/Partial Designs/Header", language: "en" }) { itemId(format: D) name }
  footerPD: item(where: { path: "/sitecore/content/<COLLECTION>/<SITE>/Presentation/Partial Designs/Footer", language: "en" }) { itemId(format: D) name }
  pageDesign: item(where: { path: "/sitecore/content/<COLLECTION>/<SITE>/Presentation/Page Designs/Page", language: "en" }) { itemId(format: D) name }
}
```

Non-null → skip that create. All three present → skip to wiring (or stop if chrome renderings not ready yet).

### Step 2 — Create Partial Designs

```graphql
mutation {
  headerPD: createItem(input: {
    name: "Header"
    templateId: "{FD2059FD-6043-4DFE-8C04-E2437CE87634}"
    parent: "/sitecore/content/<COLLECTION>/<SITE>/Presentation/Partial Designs"
    language: "en"
  }) { item { itemId(format: D) path } }
  footerPD: createItem(input: {
    name: "Footer"
    templateId: "{FD2059FD-6043-4DFE-8C04-E2437CE87634}"
    parent: "/sitecore/content/<COLLECTION>/<SITE>/Presentation/Partial Designs"
    language: "en"
  }) { item { itemId(format: D) path } }
}
```

### Step 3 — Create Page Design and link partials

```graphql
mutation {
  createItem(input: {
    name: "Page"
    templateId: "{1105B8F8-1E00-426B-BF1F-C840742D827B}"
    parent: "/sitecore/content/<COLLECTION>/<SITE>/Presentation/Page Designs"
    language: "en"
  }) { item { itemId(format: D) path } }
}
```

Then set `PartialDesigns` (no space in field name; pipe-separated braced GUIDs):

```graphql
mutation {
  updateItem(input: {
    itemId: "{<PAGE-DESIGN-ID>}"
    language: "en"
    version: 1
    fields: [{ name: "PartialDesigns", value: "{<HEADER-PD-ID>}|{<FOOTER-PD-ID>}" }]
  }) { item { field(name: "PartialDesigns") { value } } }
}
```

**Assert:** `PartialDesigns` is non-empty before treating chrome structure as done.

### Step 4 — Wire Header/Footer renderings into partials

Run **only after** Header and Footer React components are ported and their **rendering items** exist in the CM. Structure (steps 1–3) can complete earlier; placement is a one-shot close-out.

Resolve rendering IDs:

```graphql
{
  header: item(where: { path: "/sitecore/layout/Renderings/Project/<COLLECTION>/Header", language: "en" }) { itemId(format: D) }
  footer: item(where: { path: "/sitecore/layout/Renderings/Project/<COLLECTION>/Footer", language: "en" }) { itemId(format: D) }
}
```

Update `__Renderings` on each Partial Design. **Always pass the XML via GraphQL variables** — inline strings containing `/` cause `EXEC_SYNTAX_ERROR`.

```graphql
mutation UpdateRenderings($itemId: ID!, $xml: String!) {
  updateItem(input: {
    itemId: $itemId
    language: "en"
    version: 1
    fields: [{ name: "__Renderings", value: $xml }]
  }) { item { field(name: "__Renderings") { value } } }
}
```

Header PD variables (fresh GUID for `uid`):

```json
{
  "itemId": "{<HEADER-PD-ID>}",
  "xml": "<r xmlns:p=\"p\" xmlns:s=\"s\" p:p=\"1\"><d id=\"{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}\" l=\"{96E5F4BA-A2CF-4A4C-A4E7-64DA88226362}\"><r uid=\"{<NEW-GUID>}\" s:id=\"{<HEADER-RENDERING-ID>}\" s:ph=\"headless-header\" s:ds=\"\" s:par=\"\" /></d></r>"
}
```

Footer PD: same shape with `s:ph=\"headless-footer\"` and the footer rendering id.

| Constant | Value |
|---|---|
| Default layout device ID | `{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}` |
| Default layout ID | `{96E5F4BA-A2CF-4A4C-A4E7-64DA88226362}` |
| Header placeholder | `headless-header` |
| Footer placeholder | `headless-footer` |

After this, Pages shows Header + Footer on every page using the Page Design — without per-page chrome authoring.

**Assigning the design to a route by its `Page Design` field? Write the id braced, dashed and uppercase** (`{0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}`, never `{0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d}`). An undashed value is accepted and reads back fine, but the design merge cannot resolve it: `headless-header` and `headless-footer` come back as `[]` on Edge and in edit mode, with no error. An empty shell looks the same whether the merge worked or not, so assert that a chrome rendering actually arrives (measured 2026-09-26). More write-side wire formats are tabled in `content-sdk-create-component` (its GraphQL-sequence reference, § "Write-side wire formats").

### Per-page variation of a chrome block

A chrome block that must **sit in the chrome** but **vary per page** (a footer CTA whose headline changes by section, for example) has one working shape. Measured 2026-09-28 → 29:

- **Keep the rendering on the Partial Design.** Its datasource is the default.
- **Add a page-level `Droplink` override field** on the page template's content section (e.g. `Footer CTA`). Source it to the small set of global variant datasources (`query:$site/*[@@name='Data']/*[@@templatename='<Block>']`).
- **Resolve it server-side in the component.** If the route's field resolves to an item with non-empty `fields`, render those fields instead of the partial's. Otherwise fall back to the partial's datasource. The override's own fields arrive in `route.fields['<Field>'].fields` as real `Field` objects, so they render through the same SDK field components and stay inline-editable. Only children the override needs (rows) take a server-side `client.getData`.

Two shapes that fail:

- **Placing the block per page in `headless-main`** moves it inside `<main>`, above the page's last section, and breaks the visual contract.
- **Adding a new page-level placeholder** (e.g. `headless-footer-page` in the layout's `<footer>`) does not work either. The Layout Service **silently drops a placeholder key that is not registered**: it is missing from `route.placeholders`, and the head app logs only *"Placeholder '…' was not found in the current rendering data"*.

## Content-model spec (from design / static props)

Derive a site content-model document mechanically:

- One prop / design field → one datasource field (SDK type from usage: headline → Single-Line Text, HTML → Rich Text, `<img>` → Image, `<a>` → General Link)
- Pages → placeholders + rendering placements
- Keep each component's prop boundary as **one flat object** mapping 1:1 to a future datasource

Author that model live via Authoring GraphQL (or clone OOTB renderings — see `content-sdk-create-component`) so items are visible on **Preview** Edge; defer LIVE publish.

Dependency order for hand or API authoring:

1. Site collection / site nodes (often created at provision time via XM Apps API)
2. Datasource templates → parameters templates → rendering items (`componentName` exact)
3. Available Renderings → page presentation → datasource content → Headless Variants
4. Publish → separate LIVE step

Avoid generic parameter names (`Levels`, `Depth`, `Style`, `Items`) — they collide with base templates; prefer `Level` or namespaced names.

## Port transform (static or clickdummy → Sitecore component)

Per rendering:

1. Place markup in `src/components/<Component>/<Component>.tsx` (helpers go in `src/lib/<feature>/` or `src/app/api/<feature>/` — see `content-sdk-component-naming-traps`).
2. Replace plain props with SDK field components: `<Text>`, `<RichText>`, `<Image>`, `<Link>` — types from `node_modules/@sitecore-content-sdk/react` `.d.ts`.
3. Derive props from the **live `getPage` / layout-debug payload**, not from static prop names alone.
4. Classify resolver pattern (`content-sdk-resolver-patterns`); decide variant vs sibling (`content-sdk-variants-vs-siblings`).
5. Regenerate component map; lint + `tsc` clean; confirm on **preview**; re-probe payload.

**Risks:** wrong resolver → blank render; `componentName` typo → `<MissingComponent>`; helpers under `src/components/<X>/` → polluted map; treating empty-state field shapes as populated → null deref; port drift from static names.

Client-triggered reads: Route Handler under `src/app/api/…`, never a Server Action (`content-sdk-app-router-route-handler-vs-server-action`).

## Cross-cutting domain rules

1. Tracks sync at handoffs — do not claim head-app work is done against live data without matching CMS state on preview (or LIVE after an explicit publish).
2. Probe before implementing (`layout-debug` / resolver probe).
3. Dark+light+system theme is the default head-app theme stack (`content-sdk-app-router-theme-hydration-pattern`).
4. Never silently fail on an unexpected Edge shape — capture the payload and escalate.
5. CM env is 1:1 with a CM authoring code base — create a new baseline only for a **new** CM; for an existing CM, reuse its code base at the path the user gives.
6. Pull-on-ship for structural items; pull authored content after LIVE publish — never push.

## Gate the PR preview deployment

A head app has a defect class that **no local gate can see**: the component map, the layout data and
the rendering definitions live in three different systems, and only a rendered page proves they
agree. Lint, unit tests and the build all pass while a component resolves to the SDK's
`MissingComponent` placeholder on every page of a live site. Measured 2026-09-01: an SDK bump
regenerated one map key, the nav vanished site-wide, and **814 unit tests, lint, the build and the
SSG route count were all green**.

**The precondition — check it before trusting the gate.** A preview deployment is only an honest
predictor of production if it resolves the **same Edge context production will**. On one measured estate the
Vercel *Preview* target deliberately carries the **LIVE** context id (not the preview one), so it
does. **Verify for your project** — `vercel env pull <scratch> --environment=preview` — because if
Preview points at the *preview* context instead, the deployment serves unpublished content at a
live-looking URL and a green smoke proves nothing about production.

Corollary, worth socialising: with the live context, the preview URL **cannot show unpublished
content**. It is a production-fidelity gate, not a content preview surface.

**Assert structure, never pixels.** On a CMS-backed site the copy and imagery change independently
of the code, so a pixel diff fires on every author edit; the gate then gets ignored, taking real
regressions with it. Assert what holds regardless of what an author writes:

- no `missing React implementation` text on any route ← the reconciliation
- every route returns 200, and the final URL is still on the deployment origin
- `nav` / `main` / `footer` present; nav carries real links, not all `href="/"`
- no console errors (filter third-party beacons, or it will be flaky and then ignored)

**Harness notes.** Use a SEPARATE Playwright config with **no `webServer`** block — this suite runs
against a remote URL, and a `reuseExistingServer` here can adopt a sibling head app on the same port
and pass confidently for the wrong site. Make the base URL required and **throw when it is missing**
rather than defaulting to localhost; a smoke suite that silently retargets is a check that cannot
fail. Trigger on the platform's `deployment_status`-style event, not on PR open — the URL does not
exist until the build finishes.

**Two false-pass shapes this must survive:**

- **Vercel SSO returns a plausible 200** at the end of a redirect to `vercel.com`. Bare deployment
  URLs sit behind deployment protection; only the production alias is public. Assert the final
  origin, not just the status — otherwise a protected deployment reads as a healthy one.
- **A stale static page.** Correct Edge data does not mean a correct site: SSG routes with no
  `revalidate` never refresh, so a page can serve build-time HTML indefinitely
  (`x-vercel-cache: HIT`, `x-nextjs-prerender: 1`) while Edge is already right. Smoke the *new*
  deployment, and do not conclude "published ⇒ visible".

**Prove the gate fails before trusting it.** Plant a real mismatch — build with a component key the
CM does not have, serve it, and confirm the smoke goes red. A gate nobody has watched fail is not a
gate.

## Appendix: mock-data opt-in (NOT the default)

Only when the user explicitly asks to build with **no tenant**. Contain mocks to **one seam**:

1. One `getLayout(path)` (or equivalent) module returning fixtures today / `client.getPage` tomorrow.
2. Fixtures shaped as declared Layout types (cite `.d.ts`).
3. Quarantine Edge-side SDK calls (`getDictionary`, `getErrorPage`, static params) behind one flag in that module.
4. Document that `npm run dev` / `sitecore-tools:build` still hits Edge unless an offline script exists.
5. Still produce the content-model spec — mock defers provisioning/authoring, it does not cancel it.

## Related skills

- `setup-content-sdk` — head-app scaffold + env
- `sitecoreai-cli-cloud-workflow` — CLI login / ser pull
- `content-sdk-create-component` — clone/customize renderings via Authoring GraphQL
- `sitecoreai-edge-graphql-capture` — Edge snapshot
- `content-sdk-resolver-patterns`, `content-sdk-debug-layout-probe`, `content-sdk-component-naming-traps`, `content-sdk-variants-vs-siblings`, `content-sdk-app-router-component-level-navigation`, `content-sdk-app-router-theme-hydration-pattern`, `content-sdk-app-router-route-handler-vs-server-action`, `content-sdk-playground-pattern`
