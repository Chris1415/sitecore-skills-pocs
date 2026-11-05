---
name: sitecoreai-agent
description: "SitecoreAI Agent API: high-level REST actions such as create page with components, create personalization version and generate brief. Use as the default entry point for apps, MCP servers or automations. It powers the Marketer MCP."
license: Apache-2.0
compatibility: "Requires a Sitecore Cloud Portal automation client (see sitecoreai-auth) and HTTPS network access to https://edge-platform.sitecorecloud.io/stream/ai-agent-api."
metadata:
  author: Christian Hahn
  version: "0.4.3"
  source_spec: "https://api-docs.sitecore.com/_bundle/sai/agent-api/@v2.0/index.yaml"
  spec_version: "v2.0"
  spec_sha256: "03c5f872ab0eba36f9b24ceec3f7deef645b2b33fee1d171e1c814853b018112"
  last_synced: "2026-10-01"
---

# Agent API

Business-level actions on Sitecore content, experiments, personalization, and briefs. One call replaces 3–5 low-level Pages/Sites calls. Prefer this over the raw Pages/Sites APIs whenever the task maps to a marketer-level outcome.

---

## Base URL

```
https://edge-platform.sitecorecloud.io/stream/ai-agent-api
```

(Unchanged from v1 — the spec `servers` block still lists this single production server.)

## Auth & scopes

The Agent API uses a single security scheme: **`HTTPBearer`** — HTTP `bearer` with `bearerFormat: JWT`. Every operation in the spec is secured with `HTTPBearer: []`.

**Client-credentials flow (default — service principal).** OAuth 2.0 client-credentials → JWT Bearer. See the `sitecoreai-auth` skill for token acquisition (it is the source of truth for the host/token/scope mechanics):

- Token endpoint: `POST https://auth.sitecorecloud.io/oauth/token`
- `grant_type=client_credentials`, fixed `audience=https://api.sitecorecloud.io`
- Forward the returned `access_token` as `Authorization: Bearer {JWT}` + `Accept: application/json`.
- JWT lifetime is 24 h (`expires_in: 86400`) — cache per `sitecoreai-auth` § 5.

The client-credentials response carries `scope: xmcloud.cm:admin`.

**Authorization-code flow (optional — user-delegated).** The Agent API also supports the OAuth 2.0 authorization-code flow for acting *as a user*. This requires an OAuth app registration submitted to Sitecore Support, requesting these **exact scope strings** (from the spec's Authorization section):

| Scope | Covers |
|---|---|
| `xmcloud.cm:admin` | Content management (pages, content, components, assets, jobs) |
| `personalize.exp:mng` | Manage personalization experiences / experiments |
| `personalize.tmpl:r` | Read personalization condition templates |
| `personalize.pos:mng` | Manage personalization point-of-sale / placement |
| `ai.org.bri:r` | Read briefs (org scope) |
| `ai.org.bri:w` | Write briefs (org scope) |
| `co.briefs:r` | Read briefs (collaboration) |
| `co.briefs:w` | Write briefs (collaboration) |
| `ai.org.brd:r` | Read brand kits (org scope) |
| `cmp.sites:read` | Read sites *(added to the list by 2026-10)* |
| `platform.tenants:list` | List tenants *(added to the list by 2026-10)* |

For most Marketplace apps and backend automations the client-credentials flow is correct and simpler; reach for authorization-code only when a per-user audit trail / per-user permissions are required.

## Versioning

`info.version` is **v2.0**. Most paths are prefixed `/api/v1/...`; personalization now exposes a parallel `/api/v2/...` lane for the two endpoints that changed shape (create variant, list variants by page). The `/api/v1` personalization create + list-by-page are **deprecated** (announced removal **2026-08-04**) — use the `/api/v2` equivalents. The `/api/v1/briefs/generate` endpoint is also deprecated (announced removal **2026-09-20**) in favour of `/api/v1/brief/generate`. All three are past their date and **still in the 2026-10-01 spec** (`deprecated: true`); do not build on them.

---

## Endpoints

Resource groups: **Sites** · **Pages** · **Content** · **Components** · **Assets** · **Environments** · **Experiments** · **Personalization** · **Flow definitions** · **Brand Kits** · **Brand contexts** · **Briefs** · **Jobs**.

The full `path` × method table is in `references/endpoints.md`; request bodies and key response fields per operation are in `references/schemas.md`. Both are regenerated from the spec — read them when you need an exact path, method or field name; the sections below carry what the spec does not say.

## Errors

The spec declares one explicit error response per operation plus the bearer-auth default:

| Status | Meaning |
|---|---|
| `422` | **Unprocessable entity** — `HTTPValidationError` (`{ detail: ValidationError[] }`, each `{ loc, msg, type }`). The catch-all for malformed bodies / bad params (e.g. a non-integer `version`). |
| `401` | Unauthorized — implied by `HTTPBearer`; expired/invalid JWT. Re-auth per `sitecoreai-auth` § 6. |
| `201` | Returned on successful creates (pages, content, components, datasources, experiments, personalization variants, briefs, flow-variant setup, job revert). |

> The spec does **not** enumerate `429` or `5xx` shapes — rate limits are undocumented (see Pitfalls).

---

<!-- CURATED:START — hand-maintained wire-level notes; preserved across regenerations -->

## Patterns

### Create a page with content in one sequence

1. `POST /pages/create` → get `pageId`.
2. `GET /pages/{pageId}/placeholders/{ph}/allowed-components` → find usable component IDs.
3. `POST /pages/{pageId}/components` for each placement.
4. `POST /components/{componentId}/datasources` → attach content.
5. `POST /pages/{pageId}/components/{componentId}/datasource` → bind.

For bulk scenarios the higher-level "create_page_with_components" pattern combines these — check the OpenAPI spec for composite endpoints.

**Language traps (measured 2026-10-02).** `DELETE /content/{id}` removes **every** language version, and so does MCP `delete_content {language}`: the whole item went. Never use it to drop one language. `add-language` returns no version number. v2 has no translate operation (use Authoring `translatePage` or the Pages API; `sitecoreai-localization`).

### Reverting an agentic action

The job id is **client-supplied**, not returned in the body: send a stable `x-sc-job-id` request header on every call of a sequence (the spec declares it on nearly every operation). To undo the whole sequence:

```http
POST /api/v1/jobs/{jobId}/revert
```

This is the safety net for autonomous agents — always surface the `jobId` to the user and keep it for the audit trail.

### Agent-driven personalization

Full recipe (audiences, COPY / SWAP / HIDE, publish, verify, undo): **`sitecoreai-personalization`**. The Agent-API-level facts:

1. `GET /personalization/condition-templates` → pick a template (param keys = the placeholder labels in the template).
2. `POST /api/v2/personalization/{pageId}/versions` with `condition_groups` → new flow + variant. **Use v2 only:** the deprecated v1 create (single `condition_template_id` + flat `condition_params`) returned `400 "Failed to update flow definition"` for the multi-param `utm_value` template on 2026-09-22, where the identical params succeeded on v2. The flow is `PRODUCTION` at create and its supplied `name` is replaced by `<page> <lang> - <PAGEID>`.
3. `POST /flows/{flowId}/variants/{variantId}` (COPY / SWAP / HIDE) and `POST /flows/{flowId}/variants/reset` (undo one component).
4. `POST /personalization/{pageId}/components/{componentId}/hide` hides a component on the **default** variant; it needs an existing personalization on the page.

**Two variant ids — the variant endpoints want the 32-hex one.** A flow carries `transpiledVariants[].ref` (dashed uuid, the "variant ref") and the **template variant id** (32-hex, no dashes, in `templateRenderTask.input.template` / `traffic.splits[].template`). The spec text says to pass the `ref`; live, `GET /flows/{flowId}/variants/{variantId}` with the dashed ref returns `400 "Requires template Variant Id, not variant ref"`, and the setup write succeeded with the 32-hex id (2026-10-01).

**"None" is a 404.** `GET /api/v2/personalization/by-page/{pageId}` on a page with no personalization returns **404 Not Found**, not `[]`. Treat it as "none"; `GET /flows/by-page/{pageId}` returns `[]` and is the better existence check.

**No delete, pause or archive for experiences.** There is no endpoint to remove an EXPERIENCE flow; `PUT /experiments/{flowId}` with `archived: true` on one returned **500** and changed nothing. `reset` leaves a `Default`-only ruleset in `__Final Renderings`, and the flow keeps answering decisions. Removal is a Pages UI task — tell the user.

---

### Screenshot endpoint quirks

Confirmed empirically + via the OpenAPI bundle (a Marketplace app build, 2026-04-22). The public reference is silent on all three; document them here until upstream fixes land.

**Query parameters:**

| Param | Type | Required? | Default | Notes |
|---|---|---|---|---|
| `version` | integer | **yes** | — | Must be an integer. `"latest"` returns `400 "Input should be a valid integer"`; omission returns `400 "Field required"`. Pass `1` when you don't want to surface a version selector. |
| `width` | integer | no | `1200` | Rendered viewport width (also controls output image width). |
| `height` | integer | no | — | **EXACT output-image height** — not a viewport hint, not a minimum. Taller page content is cropped; shorter content gets solid-color padding at the bottom. Consumers who want "whole page" must pick a generous value (`4000`–`8000` px) and trim whitespace client-side. |
| `language` | string | no | `en` | Language code for the rendered page. |

**No `fullPage` query parameter exists.** The `fullPage: true` field in the response body (below) is informational only — it describes rendering mode, not a togglable input. Do not document it or pass it as a query param.

**Response body shape:**

```json
{
  "type": "png",
  "fullPage": true,
  "encoding": "base64",
  "timestamp": "2026-04-22T13:47:00.233131",
  "screenshot_base64": "<base64 string>"
}
```

The image payload is under `screenshot_base64` — **not** `image`, **not** `data`. The string is **bare base64** (no `data:image/png;base64,` prefix); add the prefix client-side if you need a data URL.

---

## Pitfalls

- **JWT expires in 24 h.** Cache per the `sitecoreai-auth` skill, § 5.
- **All requests are production.** No sandbox audience.
- **`x-sc-job-id` is mandatory for audit.** A call made without it cannot be reverted as part of a job.
- **Composite endpoints return partial success.** A `POST /pages/create` that succeeds in page creation but fails on a follow-up component add will still return a `201` on the page. Always check the `operations` array in the response or via `GET /jobs/{jobId}/operations`.
- **Site context is required** for most page-level reads (`GET /pages/search`, `GET /components`). Passing `siteId` vs. `siteName` differs per endpoint — always check the path.
- **Rate limits undocumented.** Implement exponential backoff on `429` + `5xx`.

<!-- CURATED:END -->

## OpenAPI bundle

Full schema: [api-docs.sitecore.com/_bundle/sai/agent-api/@v2.0/index.yaml](https://api-docs.sitecore.com/_bundle/sai/agent-api/@v2.0/index.yaml). The Agent API bundle is **version-pinned**: the unversioned `_bundle/sai/agent-api/index.yaml` returns 404.

## Sources

- [Agent API reference](https://api-docs.sitecore.com/sai/agent-api)
- [Marketer MCP and Agent API overview](https://doc.sitecore.com/sai/en/users/sitecoreai/marketer-mcp-and-agent-api-overview.html)
- [Introducing the Sitecore Agent API](https://sitecoreclimber.wordpress.com/2025/11/07/introducing-the-sitecore-agent-api-empowering-ai-driven-digital-experiences/)
