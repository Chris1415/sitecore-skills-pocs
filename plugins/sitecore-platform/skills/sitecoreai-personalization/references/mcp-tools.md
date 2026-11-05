# Marketer MCP personalization tools

Real parameter names, captured from the Marketer MCP tool schemas on 2026-10-01 (read-only session). Each tool wraps one Agent API endpoint (`references/rest-bodies.md`). The MCP is **camelCase**; the REST body is **snake_case**.

## Reads (safe, no confirmation flag)

| Tool | Params | Returns / notes | Wraps |
|---|---|---|---|
| `list_sites` | — | site ids + names | `GET /api/v1/sites` |
| `get_all_pages_by_site` | `siteName`, `language` | page tree with page ids | `GET /api/v1/sites/{siteName}/pages` |
| `get_page_path_by_live_url` | live URL | page path / id | `GET /api/v1/pages/path-by-url` |
| `get_components_on_page` | `pageId, language, variantId?, version?, includeRenderingDetails` | `components[]` with `id` (**instance uid**), `componentId` (**rendering definition**), resolved `dataSourceItem`. Pass `variantId` to read a variant's view | `GET /api/v1/pages/{pageId}/components` |
| `list_page_flows` | `pageId, language, status?` (`DRAFT \| PRODUCTION \| PAUSED \| COMPLETED`) | `[]` on a plain page. **The existence check** | `GET /api/v1/flows/by-page/{pageId}` |
| `get_perso_ver_by_page` | `pageId, language` | variant names, audiences, condition groups. **Errors with `Not Found (404)` when the page has no personalization**: treat that as "none", not as a failure | `GET /api/v2/personalization/by-page/{pageId}` |
| `get_flow_definition` | `flowId` | flow `ref`, `friendlyId`, `status`, `traffic.splits[]`, `variants`, `transpiledVariants` | `GET /api/v1/flows/{flowId}` |
| `get_flow_variant_by_id` | `flowId, variantId, language, version?` | the variant's `components[]` with `variantStrategy`, `datasourcePath` | `GET /api/v1/flows/{flowId}/variants/{variantId}` |
| `get_perso_cond_tmpls` | — | the 18 OOTB templates (`ref` uuid, `friendlyId`, `templateElements`) | `GET /api/v1/personalization/condition-templates` |
| `get_perso_cond_tmpl_by_id` | template id | one template | `GET …/condition-templates/{id}` |
| `get_content_item_by_path` / `_by_id` | path or id, language | item id + fields (to find the COPY datasource) | `GET /api/v1/content` |
| `get_page_preview_url` | `pageId` | editing-host preview URL; also tells you which tenant the MCP is bound to | — |

## Writes (each is a real-tenant mutation; get the user's go-ahead; binding probe first)

Writes carry a confirmation flag (`userConfirmation` or `userConfirmed`, default `false`) and the tool text tells the agent to **show the inputs and get confirmation** before sending `true`.

| Tool | Params | Notes | Wraps |
|---|---|---|---|
| `create_perso_version_multi` | `pageId, name, variantName, audienceName, conditionGroups[{unionType?: AND\|OR, conditions[{conditionTemplateId, conditionParams{}}]}], language='en', userConfirmation=false` | **Use this one.** `unionType` is omitted on the first group and required on later groups. `conditionTemplateId` is the uuid `ref`. A repeat call **appends** a variant to the page's one embedded flow | `POST /api/v2/personalization/{pageId}/versions` |
| `create_perso_version` | `pageId, name, variantName, audienceName, conditionTemplateId, conditionParams{}, language` | Single condition, flat: the v1 shape. Avoid it; the v1 create returned 400 on the multi-param `utm_value` template. Whether this tool calls v1: not run in P7 `[probe-gated: P23]` | v1 create (likely) |
| `update_perso_version` | `pageId, variantId, variantName, audienceName, conditionGroups, language, userConfirmation` | **Full replace** of the audience: send all fields | `PUT /api/v1/personalization/{pageId}/versions/{variantId}` |
| `set_component_variant` | `flowId, pageId, componentId, variantId, variantStrategy COPY\|SWAP\|HIDE, swappedComponent[{componentRenderingId, datasourcePath}], language, pageVersion=0, userConfirmed=false` | `componentId` = **instance uid**. `swappedComponent.componentRenderingId` = **rendering definition**. `pageVersion` 0 means latest. `variantId` = the **32-hex template variant id** (from `templateRenderTask.input.template`), measured. The dashed `transpiledVariants[].ref` is rejected by the variant read with `Requires template Variant Id, not variant ref (400)`. Response: `{componentRenderingId, variantId, datasource: <copy path, sibling "<original>_var1">}` | `POST /api/v1/flows/{flowId}/variants/{variantId}` |
| `reset_component_variant` | `flowId, pageId, componentId, variantId?, language, pageVersion=0` | No `variantId` resets the component on the **default** page | `POST /api/v1/flows/{flowId}/variants/reset` |
| `hide_component_perso_default_page` | `pageId, componentId, language, pageVersion=0` | Only after an experience exists. Makes a component visible to the audience only | `POST /api/v1/personalization/{pageId}/components/{componentId}/hide` |
| `update_content` | item id, `fields`, `language` | Edit the COPY datasource | `PUT /api/v1/content/{itemId}` |
| `create_component_ab_test` | `siteId, pageId, componentId, name, goalType pageViewGoal\|bouncesGoal\|exitsGoal, targetedPages[], variants[{name,isControl,trafficSplit}], language, userConfirmed` | A/B/n only. Refused on a personalized page (docs). No form goal | `POST /api/v1/experiments/flows` |
| `update_ab_test` | `flowId, name, archived, goalType, targetedPages, variants, userConfirmed` | Full state; no start/stop verb | `PUT /api/v1/experiments/{flowId}` |

## Not in the MCP

- **Publish**: use the Publishing REST API (`sitecoreai-publishing`) or Authoring GraphQL `publishItem`.
- **Delete / pause / schedule / archive an experience**: no tool, no endpoint.
- **Decision tables** (component personalization): no tool.
- **Custom condition templates**: no create tool (list/read only).
- **Per-variant layout or styling** (rendering parameters): no tool.
- **Analytics read**: no tool.

## Measured behaviour (P7, 2026-10-01)

- `create_perso_version_multi`: the response is the full flow. `status: PRODUCTION` immediately, `revision: 2`, `variants: []`, `dashboardLinks: null`. The supplied `name` is **replaced** by `<page name> <lang> - <PAGEID>`.
- `get_perso_ver_by_page`: 200 with `[{page_id, variant_name, audience_name, template, condition_groups}]` once a variant exists (404 when none).
- `get_flow_variant_by_id`: needs the 32-hex template variant id; the dashed ref → 400.
- `get_components_on_page(variantId)`: the hero's `dataSource` comes back as a **path** for the variant, a `{GUID}` for the default.
- `update_content`: `siteName` is required.
- `reset_component_variant`: returns `{pageId, componentId, language}`; no confirmation flag. It does not delete the COPY datasource.
- `create_perso_version_multi` (2026-10-07): an `audienceName` containing parentheses → **400**; the same call with plain text succeeds. `page_view`'s `page name(s)` as an array → 400 `Attempt to decode JSON with unexpected mimetype`; send a string.
- `set_component_variant` **SWAP** (2026-10-07): same rendering definition id + a prebuilt datasource path, on a rendering created through the normal component path, worked on the first attempt; no Agent API fallback needed. Read back with `get_flow_variant_by_id` (`variantStrategy: SWAP`, `datasourcePath`).
- `update_ab_test(archived:true)` on an EXPERIENCE (personalization) flow: **500**, flow unchanged. There is no archive or delete path for personalization.
