# Edge Admin API reference

Status column: **live** = observed against a tenant on 2026-10-02; **doc** = Sitecore documentation only.

## Hosts and auth

| Item | Value | Status |
|---|---|---|
| Admin base | `https://edge.sitecorecloud.io/api/admin/v1` | live |
| Token API base | `https://edge.sitecorecloud.io/api/apikey/v1` | doc |
| Token endpoint | `POST https://auth.sitecorecloud.io/oauth/token`, `grant_type=client_credentials`, `audience=https://api.sitecorecloud.io` (form or JSON) | live |
| Legacy audience | `https://delivery.sitecore.cloud/<tenant-name>` (older tenants) | doc |
| Token lifetime | `expires_in` 86393–86400 s | live |
| Regional host | None documented; one global host, tenant from the token | live (claims) |
| Header | `Authorization: Bearer <JWT>` | live |

Token claims of interest (keys are namespaced URLs; match on the suffix): `tenant_id`, `tenant_name`, `org_id`, `sc_org_region`, `scope`.

Scopes on an Edge administration client token (live): `edge.caches:clear edge.settings:read edge.settings:update edge.webhooks:create edge.webhooks:read edge.webhooks:update edge.webhooks:delete edge.tokens:create edge.tokens:read edge.tokens:update edge.tokens:delete edge.content:publish edge.content:clearall`.

## Credential management (Deploy API, called with an org automation client)

| Op | Call | Result | Status |
|---|---|---|---|
| Create Edge admin client | `POST https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/edge` `{ name, description, projectId, environmentId }` | `201 { name, description, clientId, clientSecret }` (secret once) | live |
| List environment clients | `GET https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/environment` | `200`, items `{ id, name, description, clientId, createdAt, clientType, projectName, environmentName }`; Edge admin = `clientType: 2` | live |
| Delete | `DELETE https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/{id}` (internal `id`) | `202`, gone from the list | live |
| Wrong forms | `DELETE …/clients/v1/{clientId}`, `…/clients/v1/edge/{…}` → 404; `GET …/clients/v1` → 404; `GET …/clients/v1/edge` → 405 | | live |
| Revocation after delete | New mints: one still worked at +2 s, `401 access_denied "Unauthorized"` from +60 s on. **A token minted before the delete kept working** (`GET /webhooks` 200 at +1, +5, +15 min): delete does not revoke issued tokens, they live to `exp` (24 h) | closed | live (P2b, 2026-10-02) |

## Webhooks

| Op | Route | Success | Status |
|---|---|---|---|
| List | `GET /webhooks` | 200, array (`[]` when none) | live |
| Get | `GET /webhooks/{id}` | 200 | live |
| Create | `POST /webhooks` | 201; body echoes `id` (a **GUID**), `tenantId` (= the tenant **name**), `created`, `body: ""`, `bodyInclude: null`, `disabled: null`, `lastRuns: []`. `Location` points at an internal cluster host: use the `id` from the body, never the `Location` URL | live |
| Update | `PUT /webhooks/{id}` | 204. **Not a full replace for `body`:** a `body` the PUT omits or sends as `null` is KEPT. `body: ""` under `OnUpdate` → `400 "You cannot set the 'body' property if the execution mode is 'OnUpdate'."`. To switch OnEnd → OnUpdate, first PUT `OnEnd` with `body: ""`, then PUT `OnUpdate`. Every PUT resets `created` to the PUT time; `lastRuns` survives | live |
| Delete | `DELETE /webhooks/{id}` | 204; `GET /webhooks` no longer lists it | live |

`WebhookEdit` (request body):

| Field | Type | Notes |
|---|---|---|
| `label` | string | Put the owning app / site here |
| `uri` | string | **HTTPS only** ("HTTP is not supported") |
| `method` | `GET` \| `POST` | |
| `headers` | object | String values. Secrets go here (`x-revalidate-secret`, `x-vercel-protection-bypass`). **Echoed back on GET** |
| `body` | string | OnEnd only; sent verbatim. Set `content-type` in `headers` |
| `bodyInclude` | object | OnUpdate only; merged into the top level of the JSON body |
| `createdBy` | string | |
| `executionMode` | `OnEnd` (default) \| `OnUpdate` | Doc: omitting it on PUT resets to `OnEnd` (not re-probed; the tool always sends it) |
| `disabled` | boolean | Reads `null` on a never-disabled webhook. `false` re-enables an auto-disabled one (live); it does not clear `lastRuns` |

Read-only: `id` (GUID on SitecoreAI, live), `tenantId`, `created`, `lastRuns[{ timestamp, success, message }]`. `lastRuns` keeps the **10 newest** entries; a success has `message: ""`, a failure `"Status: Unauthorized, reason: Unauthorized"`, the disabling run `"The webhook has failed the past 10 consecutive invocations and will be disabled."` (all live).

Reliability: 30 s timeout (doc). **Live: a 4xx is a failure, and Edge re-sends a failed delivery without backoff (new `invocation_id`, same rows) until the 10-failure auto-disable. One publish against a receiver answering 401 produced 10 deliveries in 7 s; one against a 400 produced 10 over 137 s (gaps 1–39 s, not growing). Both disabled the webhook.** `lastRuns` messages: `Status: Unauthorized, reason: Unauthorized` / `Status: BadRequest, reason: Bad Request`, then `The webhook has failed the past 10 consecutive invocations and will be disabled.` Cap and rate limit undocumented.

## Settings

| Op | Route | Success |
|---|---|---|
| Get | `GET /settings` | 200 |
| Replace | `PUT /settings` (full object) | 202 |
| Patch | `PATCH /settings`, `application/json-patch+json`, `replace` ops only, lowercase paths | 200 |

Object: `{ contentCacheTtl, contentCacheAutoClear, mediaCacheTtl, mediaCacheAutoClear, tenantCacheAutoClear }`. TTL format `{days}.{hours}:{minutes}:{seconds}`. Documented default `04:00:00`; one live tenant returned `1.00:00:00` for both. Read it, do not assume it.

## Cache and content

| Op | Route | Result | Rule |
|---|---|---|---|
| Clear Edge cache | `DELETE /cache` | 202 | Environment-wide. `--yes` |
| **Delete content** | `DELETE /content` | 202, "instantly wipes all environment data" | **Never called.** No script verb |

## Token API (delivery API keys)

Create, ListAll, GetApiKeyByHash on `/api/apikey/v1`; scopes `audience-delivery`, `content-#everything#`. Out of scope for webhooks; listed so the `edge.tokens:*` scopes are not a surprise.
