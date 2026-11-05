---
name: sitecoreai-personalization
description: "Sets up SitecoreAI embedded personalization: page variants, audiences from condition templates, copy, swap or hide a component, publish, verify, undo; Marketer MCP first. Use to personalize a page for an audience. Not head-app wiring."
license: Apache-2.0
compatibility: "Requires the Marketer MCP (user OAuth) or an environment-scoped automation client for the Agent API (see sitecoreai-auth), embedded personalization enabled on the tenant, and a publish path (sitecoreai-publishing)."
metadata:
  author: Christian Hahn
  version: "0.3.3"
  validated: "DRAFT 2026-10-01. Read surface LIVE (Marketer MCP tool schemas, 18 condition templates with param keys, flow reads on a plain page). Write chain LIVE 2026-10-01 (P7, on the author's own tenant): create → COPY → edit → AGQL publish → Edge → decision → render → beacon → reset, end to end. LIVE 2026-10-07: SWAP via MCP, page_view condition latency (3/3 seconds). Open: create_perso_version v1 (P23)."
---

# SitecoreAI personalization — backend setup

The ask looks like *"on the home page hero, visitors from audience X see different content"*. This skill turns that into: pick the mechanism, check prerequisites, create the audience and variant, give the hero its own content in that variant, publish, and prove it works at every layer. The head app must already be able to serve variants; that side is **`content-sdk-personalization`**.

## When to use

- Creating, changing, auditing or removing a page personalization on a SitecoreAI tenant.
- Translating a marketer's audience description into condition templates and params.
- **Not** for the proxy, rewrite, rendering, caching or consent wiring in the head app (`content-sdk-personalization`), and **not** for Headless rendering variants (the `FieldNames` display variant; see `sitecoreai-content-composition` § Variants). `set_component_variant` is personalization / A/B only.

## Mental model: four layers, written by different APIs

| Layer | Holds | Written by | Read by |
|---|---|---|---|
| **Flow** (embedded Personalize) | audience (condition groups), splits, status, friendlyId `embedded_[scope_]<pageIdNoDashes>_<lang>` | `create_perso_version_multi` / `POST /api/v2/personalization/{pageId}/versions` | `list_page_flows`, `get_flow_definition` |
| **CM page layout** | per-variant COPY / SWAP / HIDE on a rendering, per page version and language | `set_component_variant` / `POST /api/v1/flows/{flowId}/variants/{variantId}` | `get_flow_variant_by_id`, `get_components_on_page(variantId)` |
| **Edge projection** | `personalization.variantIds`, each rendering's `experiences{}` | **publish** | Edge GraphQL, Pages `GET /pages/{id}/live/variants` |
| **Enablement** | analytics identifier per site language; `PAGES_PERSONALIZE_SCOPE` | Sites API / Channels UI; Deploy env var | Sites API, Deploy API |

All variants travel in the Edge layout JSON; the **head app's proxy** asks the decision service which one to render, server-side, and **fails open** to the default on any error. So "the page renders" proves nothing.

## 1. Choose the mechanism

| | Page variant (default) | Component personalization (decision tables) | A/B/n test |
|---|---|---|---|
| Decides | which page variant a visitor gets; each variant changes one or more components | which variant of one component; rows top-down, first match wins | random split |
| Hero options | COPY, SWAP, HIDE, per-variant layout/styling (UI only) | Duplicate / Hide / Swap | Copy / Swap / Hide |
| Limits | ≤ 10 variants per page, ≤ 5 conditions per audience, **one embedded experience per page** | undocumented | ≤ 6 variants, ≤ 6 concurrent tests per page |
| Versioning | per page version and language | **shared across versions, including live** (a draft edit changes production) | — |
| API / MCP | yes, end to end except publish | **none** | yes; no start/stop verb |
| Status | GA | phased rollout | GA |

**Decision rule**
- One to ten audiences, each with its own hero → **page variant** with COPY. The default.
- Many fine-grained rules on one component, maintained by a marketer → decision tables. **UI-only**: hand off, do not attempt by API.
- "Which hero converts better?" → A/B/n, on a page **without** personalization. The docs say A/B/n is refused on a personalized page, so the two are **mutually exclusive per page** (API enforcement direction `[probe-gated: P8]`).
- Hero must vanish for audience X → page variant with HIDE.
- Hero only for audience X → add the hero, create the variant, then `hide_component_perso_default_page` hides it on the default page.

## 2. Prerequisites — check read-only before any write

| # | Check | How | Fails as |
|---|---|---|---|
| R1 | Personalization enabled on the tenant | `get_perso_cond_tmpls` returns 18 templates | error or empty |
| R2 | **Analytics identifier on the site language.** Never assume one: a serialization-pushed site has none (measured 2026-10-15) and **added languages get none**. Create it in the portal; the Sites API only assigns existing ones | Sites API host `analyticsIdentifiers` (`sitecoreai-sites`), then the portal's Site hosts page shows no "missing analytics identifier" warning | that language never personalizes or tracks |
| R3 | **Scope match**: CM env var `PAGES_PERSONALIZE_SCOPE` equals the head app's `personalize.scope` (both empty is a match). Alphanumeric, case-sensitive; **changing it later orphans existing rules** | Deploy API env vars (read); head-app env | wrong friendlyId → `404 No experiences found for friendlyId …` at the wire (measured P7); the SDK turns it into the default, silently |
| R4 | **Head app serves variants**: `PersonalizeProxy` in the chain, production build against **LIVE** Edge | ask, or check via `content-sdk-personalization` | default hero, silently |
| R5 | **Consent narrows reach**: visitors without consent get the default hero by design | head-app consent gate | expected; put it in the acceptance criteria |
| R6 | **Publish path**: neither the MCP nor the Agent API publishes | `sitecoreai-publishing` credentials | variant never reaches Edge |
| R7 | **Binding probe** before the first MCP write of the session: throwaway item, read back through Authoring GraphQL and Edge with known-good and known-bad controls, delete it. `get_page_preview_url` names the bound tenant | — | writes land on the wrong tenant |
| R8 | **Read before write**: `list_page_flows(pageId, language)`. A create on a page that already has an `EXPERIENCE` flow **appends** another variant; an `EXPERIMENT` flow means A/B conflict | `list_page_flows` | duplicate variants |
| R9 | Every write below is a real-tenant mutation: get the user's go-ahead | user | — |

**Existence check:** use `list_page_flows` (`[]` = none). `get_perso_ver_by_page` returns an **error `Not Found (404)`** on a page with no personalization; treat it as "none", never as a failure to retry.

## 3. Recipe: "personalize the home hero for audience X" (Marketer MCP)

MCP first. Exact params: `references/mcp-tools.md`. REST bodies for the same steps: `references/rest-bodies.md`. Every write tool has a confirmation flag (`userConfirmation` / `userConfirmed`): **show the inputs to the user, then send `true`.**

1. **Locate.** `list_sites` → `get_all_pages_by_site(siteName, language)` → the home `pageId`.
2. **Find the hero.** `get_components_on_page(pageId, language)` → note the hero's `id` (**instance uid**), `componentId` (**rendering definition**), and `dataSourceItem.path`.
3. **Pre-check** (R8). `list_page_flows`. Existing `EXPERIENCE` → reuse it (step 4 appends a variant; that is the only way to add one). Existing `EXPERIMENT` → stop and escalate.
4. **Translate the audience.** Map the requested audience to templates in `references/condition-templates.md`. Prefer **request-context** templates (UTM, referrer, device, OS, country, point of sale): they decide on the first request and are testable with a negative control. History templates (page views, new/returning, affinity) need tracked VIEW events, therefore consent and prior visits. **`page_view`** ("viewed page X this visit") joined within seconds for a fresh consented visitor (3/3, 2026-10-07): the choice for behaviour in the session (test method: `references/condition-templates.md` § `page_view`). Params are keyed by the **placeholder label** in the template JS, verbatim: `utm_value` needs `type`, `compares to`, `UTM value` **and** `UTM value(s)` (both required).
5. **Create.** `create_perso_version_multi(pageId, name, variantName, audienceName, conditionGroups, language)`. `conditionTemplateId` is the uuid `ref`. The first group has no `unionType`; later groups need `AND` or `OR`. Do **not** use `create_perso_version` (flat v1 shape; the v1 create 400s on `utm_value`). An `audienceName` with **parentheses** → 400; plain text works.
6. **Get the ids.** The create response (or `list_page_flows` / `get_flow_definition`) carries the flow `ref` and **two** variant ids. Use the **template variant id**: the 32-hex value inside `transpiledVariants[].tasks[0].input.template` / `traffic.splits[].template` (`{"variantId": "7de9…"}`). The dashed `transpiledVariants[].ref` is the "variant ref". Variant tools reject it: `Requires template Variant Id, not variant ref (400)`. The 32-hex id is also what Edge `variantIds`, `_variantId_<v>` and `pageVariantId` use. The create **ignores your `name`** and names the flow `<page name> <lang> - <PAGEID>`; variant and audience names are kept.
7. **Give the hero its own content.** `set_component_variant(flowId, pageId, componentId=<instance uid>, variantId, variantStrategy="COPY", language, pageVersion=0)`. The response's `datasource` is the path of the new copy: a **sibling of the original datasource named `<original>_var1`**. If the original lives in a site-shared Data folder, so does the copy.
8. **Edit the copy.** `get_content_item_by_path(<copy path>)` → `update_content(itemId, siteName, fields, language)` (`siteName` is required). Edit the **copy**, never the original.
9. **Read back.** `get_flow_variant_by_id` → hero `variantStrategy: COPY` and the new `datasourcePath`; `get_components_on_page(pageId, language, variantId)` → the copy's fields; the default page's hero still points at the original.
10. **Publish** (§ 5), then **verify** (§ 8).

**Audience builder (Performance → Audiences) is a different surface**: batch segments over profile, session and event attributes, not the 18 condition templates. Its filterable attributes (observed 2026-10-06): `references/audience-builder-attributes.md`. It is UI-only and batch-scheduled: for behaviour in the current session prefer the embedded `page_view` condition. Two consequences: event extension data (`ext`) is **not selectable**, so put the segmenting value in a custom event's `type` (or `name`); UTM is a **session** attribute, so a campaign audience needs no custom event.

## 4. Variant content: COPY, SWAP, HIDE

| Strategy | Effect | Use when |
|---|---|---|
| `COPY` | copies the component and its rendering parameters into the variant, **creates and assigns a copy of the datasource**; you then edit the copy | new hero copy for the audience (default) |
| `SWAP` | replaces the rendering with `swappedComponent{componentRenderingId, datasourcePath}` (both required) | a prebuilt hero datasource, or a different hero rendering. Same rendering id + another datasource = the UI's "assign content item": via the MCP it worked first try on a rendering created through the normal component path, no Agent API fallback (measured 2026-10-07) |
| `HIDE` | removes the component in that variant | the hero must vanish for the audience |

**The naming trap.** `get_components_on_page` returns two ids per component. `components[].id` is the **instance uid**: `set_component_variant.componentId`, `reset_component_variant`, `hide_component_perso_default_page` take it. `components[].componentId` is the **rendering definition**: only `swappedComponent.componentRenderingId` takes it. Swapping them fails or targets the wrong thing.

**Editing traps**
- Inline editing in Pages inside a variant **edits the default page** unless the variant already has its own datasource. Same rule by API: COPY (or SWAP) first, then edit the copy.
- The COPY datasource is a normal content item: it needs its own language version, its own workflow state and its own publish. Measured: it lands **next to the original** as `<original>_var1`, inherits the source's `__Created`, and has no workflow of its own. `reset_component_variant` does **not** delete it: it becomes an orphan to remove (and unpublish) yourself.
- CM serialization: COPY writes a personalization **rule** on the rendering into `__Final Renderings`: rule `s:name` = template variant id, condition `{8E7426A4-…}` `s:VariantName=<v>`, action `{0F3C6BEC-…}` `s:DataSource=<copy path>` (a path, not a GUID), plus a `Default` rule. Details: `references/rest-bodies.md`.
- Per-variant layout or styling has no API (UI only).
- Under workflow, the page version carrying the variant and the copy both need the approved state before publish `[probe-gated: P23]`.

## 5. Publish

Visitors see nothing until the **page and the copied datasource** are published to the single Edge target. Use `sitecoreai-publishing` (scoped item publish, locales in one place) or Authoring GraphQL `publishItem` (`rootItemIds:[page, copy]`, `SMART`, `publishSubItems:false`, `publishRelatedItems:false`). The REST API needs `xmcpub.jobs.*`: an org client with only `xmcloud.cm:admin` gets 403 there, while AGQL `publishItem` works with the same token. Measured: job FINISHED in about 37 s, Edge LIVE carried the variant on the next read.

- **The flow is `PRODUCTION` from the moment of create**, and publish does not touch it. What gates visitors is only Edge LIVE `variantIds`, which appear when the page is published.
- **Edge PREVIEW shows the variant right after `set_component_variant`**, with no publish: use it for sign-off, never as proof for LIVE.
- **A page under an unpublished parent has no LIVE route** (`layout: null`). Publish the parent (item only) too, and expect `null`, not `[]`, as the pre-publish control.

## 6. Change and undo

| Need | Tool | Note |
|---|---|---|
| Change the audience | `update_perso_version` | **full replace**: send `variantName`, `audienceName`, `conditionGroups` |
| Undo the hero setup in a variant | `reset_component_variant(flowId, pageId, componentId, variantId)` | omit `variantId` to reset the **default** page's component |
| Undo a whole REST sequence | `POST /api/v1/jobs/{jobId}/revert` with the sequence's `x-sc-job-id` | coverage `[probe-gated: P23]` |
| Delete / pause / schedule / archive the experience | **no verb** in the MCP or the Agent API. `update_ab_test(archived:true)` on an EXPERIENCE flow returns **500** and changes nothing | reset + republish + delete the orphaned copy, then hand the flow removal to the user (Pages UI). Until then `/v1/personalize` **keeps returning the variant**; harmless only because Edge `variantIds` is empty. `reset` leaves a `Default`-only ruleset in `__Final Renderings` (Edge then emits `experiences: {}`) |

After any undo, republish the page.

## 7. Per-language behaviour

- The flow is **per language**: friendlyId ends `_<lang>` (lowercased, first hyphen → `_`). A German hero needs its own create with `language: "de"`, its own datasource language version, and an analytics identifier on the `de` site language (R2).
- One create per language = one flow per language; region locales; the locale-prefix path trap `[probe-gated: P11]`.
- Duplicated environments that share page ids share their variants; `PAGES_PERSONALIZE_SCOPE` exists to separate them.

## 8. Verification ladder — each layer independent

| # | Layer | Check | Pass | Control |
|---|---|---|---|---|
| 1 | Flow | `list_page_flows` | one `EXPERIENCE`; audience as written | no duplicate variants (append trap) |
| 2 | Variant setup | `get_flow_variant_by_id` | hero `variantStrategy: COPY`, new `datasourcePath` | default hero still on the original datasource |
| 3 | Edge | Pages `GET /pages/{pageId}/live/variants`; Edge `layout{ item{ personalization{ variantIds } } }` | `<v>` present; hero has `experiences["<v>"]` | before publish: `[]`, or `layout: null` if the route was never published. After reset + republish: `[]` and `experiences: {}` |
| 4 | Decision | `POST /v1/personalize` with the audience's input | `{variantId: "<v>"}` | same call without it → `200 {"message":"No matching variant"}` (measured). Unknown or wrongly scoped friendlyId → `404 No experiences found for friendlyId …` |
| 5 | Render | production build on LIVE Edge, real browser UA, consent set, e.g. `?utm_campaign=…` | HTML shows the copy | without the input → original hero; a headless UA counts as a bot |
| 6 | Beacon | browser network `POST …/v1/events/v1.2/events` | 2xx, `ext.pageVariantId` ends `_<v>` | default visit ends `_default` |
| 7 | Analytics | Page builder Personalize analytics / `dashboardLinks` | variant views appear | human read only (no API). `dashboardLinks` was `null` at create and after publish (P7): send the user to Pages → page → Personalize |

Layers 4–6 are head-side; the scripted probes live in `content-sdk-personalization`. Calls and bodies: `references/rest-bodies.md` § Verification.

## 9. Fallback: Pages UI click path

Page builder → Editor → select the page and language → **Personalize** tab → **Create variant** → name → **Create your audience** → add up to 5 conditions (AND/OR, groups) → **Save** → select the variant → click the hero → **assign content item** (or create one; never inline-edit first), or replace / hide the component → edit; a teal border marks a personalized component → **Preview** → publish page and datasource. Decision tables are only reachable this way.

## 10. Gaps — escalate, do not work around

- **No analytics read API.** An agent can set up a personalization but cannot report its performance or pick a winner (only `dashboardLinks` and the Data lake export).
- **Decision tables have no API or MCP tool**, and the head-app contract is undocumented `[probe-gated: P9]`.
- **Missing lifecycle verbs**: no delete, pause, start, schedule or archive for experiences; no publish in the MCP or Agent API; no per-variant rendering-parameter API; no custom-condition create.
- **Decision as data** (an arbitrary JSON payload per audience, web or interactive experiences) is a **standalone Sitecore Personalize** capability, not embedded personalization.
- **v1 deprecation is inconsistent**: the v1 create/list are marked removed (August 2026) yet still answered in September 2026 and 400 on multi-param templates. Write only through v2 create; `PUT …/versions/{variantId}` and `/api/v1/flows/*` stay current.
- **Geo audiences** fall back to `cf-ipCountry` / `cf-region-code` headers, which describe the proxy's server unless the head app forwards visitor geo `[probe-gated: P12]`.

## Related skills

- **`content-sdk-personalization`** — head side: proxy decision, variant grammar, rendering, caching, decision and beacon probes.
- **`sitecoreai-agent`** — full Agent API endpoint tables (the API behind the Marketer MCP).
- **`sitecoreai-pages`** — `/live/variants`, page components and layout.
- **`sitecoreai-publishing`** — the publish step.
- **`sitecoreai-sites`** — analytics identifiers on site hosts.
- **`sitecoreai-auth`** — environment automation client and scopes.
- **`sitecoreai-content-composition`** — page composition; Headless variants are not personalization.

## References

- `references/condition-templates.md` — the 18 OOTB templates: uuid `ref`, param keys with types and enums, output sentence, request vs history.
- `references/mcp-tools.md` — Marketer MCP read and write tools with real parameter names.
- `references/rest-bodies.md` — Agent API v2 bodies for every recipe step, undo and verification calls.
- `references/audience-builder-attributes.md` — audience builder filter attributes (profile, session, five event kinds) and what cannot be filtered on.
