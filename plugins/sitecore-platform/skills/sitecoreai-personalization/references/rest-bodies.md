# Agent API v2 REST equivalents

Source: the Agent API spec `@v2.0` bundle (fetched 2026-10-01). Endpoint tables live in `sitecoreai-agent`; this file carries only the bodies the hero recipe needs. Token and client setup: `sitecoreai-auth`.

- **Base:** `https://edge-platform.sitecorecloud.io/stream/ai-agent-api`
- **Headers:** `Authorization: Bearer <JWT>`, `Accept: application/json`, and **one stable `x-sc-job-id`** for the whole sequence, so one `POST /api/v1/jobs/{jobId}/revert` can undo it (whether revert covers create + setup + content update `[probe-gated: P23]`).
- **Codes:** `201` on creates, `422 HTTPValidationError` on a bad body.
- **Credentials:** an **environment** automation client (`audience=https://api.sitecorecloud.io`, token scope `xmcloud.cm:admin`, 24 h). An org-level client gets 401. A delegated OAuth app also needs `personalize.exp:mng`, `personalize.tmpl:r`, `personalize.pos:mng`, `cmp.sites:read`, `platform.tenants:list`.
- The unversioned bundle URL returns 404; only `@v2.0` resolves.

## Ids

| Id | From | Note |
|---|---|---|
| `siteName` | `GET /api/v1/sites` | |
| `pageId` | `GET /api/v1/sites/{siteName}/pages?language=en` or `GET /api/v1/pages/path-by-url?live_url=<encoded>` | dashed uuid |
| hero **instance uid** | `GET /api/v1/pages/{pageId}/components?language=en` → `components[].id` | `components[].componentId` is the **rendering definition** |
| hero datasource | same call → `components[].dataSourceItem.path` / `.itemId` | |
| template `ref` + param keys | `GET /api/v1/personalization/condition-templates` | see `condition-templates.md` |
| `flowId`, `variantId` | create response (`ref`, `variants` / `transpiledVariants`) or `GET /api/v1/flows/by-page/{pageId}?language=en` | measured through the MCP: the variant endpoints take the **template variant id** (32-hex, from `{"variantId": "…"}` in `transpiledVariants[].tasks[templateRenderTask].input.template` or `traffic.splits[].template`). The dashed `transpiledVariants[].ref` → `400 Requires template Variant Id, not variant ref`. Edge, `_variantId_` and `pageVariantId` use the same 32-hex id |

## 0. Pre-check (read before write)

```http
GET /api/v1/flows/by-page/{pageId}?language=en
```

`subtype: EXPERIENCE` present → a new create **appends** a variant to it. `subtype: EXPERIMENT` present → A/B test on the page; personalization conflicts (direction of enforcement `[probe-gated: P8]`).

## 1. Create the variant + audience

```http
POST /api/v2/personalization/{pageId}/versions
{
  "name": "Home hero personalization",
  "variant_name": "Spring sale hero",
  "audience_name": "UTM campaign spring-sale",
  "language": "en",
  "condition_groups": [
    { "union_type": null,
      "conditions": [ { "condition_template_id": "<utm_value ref>",
                        "condition_params": { "type": "campaign", "compares to": "is equal to",
                                              "UTM value": "spring-sale", "UTM value(s)": "spring-sale" } } ] }
  ]
}
```

→ `201 ExperienceFlowResponseV2`: `ref`, `friendlyId` (`embedded_[scope_]<pageIdNoDashes>_<lang>`), `status`, `subtype: EXPERIENCE`, `traffic{type: audienceTraffic, splits[]{template:'{"variantId":"…"}', variantName, audienceName, conditionGroups}}`, `variants`, `transpiledVariants`, `schedule`, `dashboardLinks`.

- `union_type`: `AND | OR | null`; the first group has none. Whether it joins a group to the previous one or combines conditions inside it `[probe-gated: P23]`.
- Limit: 5 conditions per audience in total, 10 variants per page.
- **v2 only.** The deprecated v1 create (flat `condition_template_id` + `condition_params`) returned `400 "Failed to update flow definition"` for `utm_value` on 2026-09-22; the same params succeeded on v2.

## 2. Give the hero its own content in the variant

```http
POST /api/v1/flows/{flowId}/variants/{variantId}
{ "page_id": "<pageId>", "component_id": "<hero instance uid>",
  "variant_strategy": "COPY", "language": "en", "page_version": null }
```

→ `201 SetupVariantResponse {pageId, componentId, componentRenderingId, flowId, variantId, datasource: "<path of the copy>"}`.

- **SWAP:** `"variant_strategy": "SWAP", "swapped_component": {"componentRenderingId": "<rendering definition id>", "datasourcePath": "/sitecore/content/<collection>/<site>/Home/Data/Hero Spring"}` (both required). SWAP with the **same** rendering id and another datasource is the likely equivalent of the UI's "assign content item": COPY is stored as a set-datasource rule action (below), but SWAP itself is not run `[probe-gated: P8]`.
- **HIDE:** `"variant_strategy": "HIDE"`.
- `page_version: null` = latest (the MCP's `pageVersion` defaults to 0 for the same meaning).

## 3. Edit the copied datasource

```http
GET /api/v1/content?item_path=<datasource path>&language=en      → itemId
PUT /api/v1/content/{itemId}
{ "language": "en", "fields": { "Title": "Spring sale: 20% off" }, "createNewVersion": false }
```

Field names are case-sensitive and must match the datasource template. Field wire formats (link XML, dashed droplink GUIDs, no HTML entities in Text) follow the usual authoring rules.

## 4. Read back

```http
GET /api/v1/flows/{flowId}/variants/{variantId}?language=en                → hero variantStrategy COPY + new datasourcePath
GET /api/v1/pages/{pageId}/components?language=en&variantId=<variant ref>  → the variant's hero shows the new copy
GET /api/v2/personalization/by-page/{pageId}?language=en                    → variant_name, audience_name, condition_groups
```

## 5. Publish

Not in the Agent API. Scoped publish of the page **and** the COPY datasource through `sitecoreai-publishing` (locales in one place) or Authoring GraphQL `publishItem`.

## Update and undo

```http
PUT  /api/v1/personalization/{pageId}/versions/{variantId}
{ "variant_name": "...", "audience_name": "...", "condition_groups": [ ... ] }      // all required; still v1, not deprecated

POST /api/v1/flows/{flowId}/variants/reset
{ "page_id": "<pageId>", "component_id": "<instance uid>", "variant_id": "<optional>", "language": "en", "page_version": null }

POST /api/v1/personalization/{pageId}/components/{componentId}/hide             // hide on the default page; needs an experience
```

No delete, pause, start, schedule or archive endpoint exists for experiences (`archived` exists only on `PUT /api/v1/experiments/{flowId}`).

## Verification calls outside the Agent API

```http
GET https://xmapps-api.sitecorecloud.io/api/v1/pages/{pageId}/live/variants    → ["<v>"] after publish
```

```graphql
# Experience Edge, LIVE context
{ layout(site: "<site>", routePath: "/", language: "en") {
    item { id personalization { variantIds } rendered } } }
```

Decision call (runtime, public context id, no OAuth): `GET /v1/events/v1.2/browser/create.json?client_key=` with header `x-sitecore-contextid: <live context id>` → `ref` (browser id); then `POST https://edge-platform.sitecorecloud.io/v1/personalize?siteId=<site>` with `friendlyId`, `browserId`, `channel: WEB`, `language`, `params.utm.campaign`, `variants: ["<v>"]`, a real browser User-Agent. Match → `{ "variantId": "<v>" }`; no match → `200 {"message":"No matching variant"}`. The head-side skill `content-sdk-personalization` owns the scripted version of this probe.

## `__Final Renderings` after COPY (measured, P7)

Before: `""` (layout in shared `__Renderings`). After `set_component_variant` COPY:

```xml
<r uid="{<instance uid>}"><rls><ruleset>
  <rule uid="{…}" s:name="<template variant id>">
    <conditions><condition uid="…" s:id="{8E7426A4-12ED-4C44-8625-E7191860E726}" s:VariantName="<template variant id>"/></conditions>
    <actions><action uid="…" s:id="{0F3C6BEC-E56B-4875-93D7-2846A75881D2}" s:DataSource="<copy item PATH>"/></actions>
  </rule>
  <rule uid="{00000000-0000-0000-0000-000000000000}" s:name="Default">
    <conditions><condition uid="…" s:id="{4888ABBB-F17D-4485-B14B-842413F88732}"/></conditions>
  </rule>
</ruleset></rls></r>
```

After `reset_component_variant`: only the `Default` rule remains (not `""`). Edge then emits `experiences: {}` on the rendering. Edge PREVIEW reflects the rule immediately; Edge LIVE only after the page is published.
