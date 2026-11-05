---
name: sitecoreai-edge-admin-webhooks
description: "Experience Edge Admin API: admin client, token, webhook CRUD (OnEnd vs OnUpdate), settings, cache clear, which webhook fits which job. Use when registering, testing or debugging a publish webhook. Not head-app revalidation code."
license: Apache-2.0
compatibility: "SitecoreAI with Experience Edge. Needs an Edge administration client per environment (creatable with an org automation client via the Deploy API) and HTTPS access to edge.sitecorecloud.io and auth.sitecorecloud.io. Node 18+ for scripts/edge-admin.mjs."
metadata:
  author: Christian Hahn
  version: "0.2.6"
---

# Experience Edge Admin API and webhooks

SitecoreAI **does** have a publish webhook. It is not in the Publishing API (which has no callback) and not in the CLI (the `edge` plugin has only `login`, `tenant`, `apikey`). It lives in the **Experience Edge Admin REST API**, which has no UI: REST is the only management path.

An Edge webhook fires **at the very end of an Edge publish, after the Edge cache clear**, so the receiver can read the newly published content. That is why it, and not the CM `publish:end` event, is the right trigger for head-app revalidation.

## 1. Credential: the Edge administration client

| Credential | Edge Admin API |
|---|---|
| **Edge administration client** (one per environment) | **200** |
| Org automation client | **401** `edge.cdn.11: Unauthorized. Failed to find tenant.` (live, 2026-10-02) |
| Environment automation client | Covers the *Edge Platform* admin API, a different API. Not this one |

This 401 is your known-bad control: the org token carries no tenant, so the global host cannot resolve one.

**Create it by API** (live-proven 2026-10-02, no UI step): the **org automation client** (`sitecoreai-auth`) calls the Deploy API.

| Step | Call | Result |
|---|---|---|
| Create | `POST https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/edge` body `{ "name", "description", "projectId", "environmentId" }` | `201 { name, description, clientId, clientSecret }`. **The secret is returned once**: store it in the secret store immediately, never in chat or a manifest |
| List | `GET https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/environment` | Items `{ id, name, description, clientId, createdAt, clientType, projectName, environmentName }`. Edge administration client = **`clientType: 2`** |
| Delete | `DELETE https://xmclouddeploy-api.sitecorecloud.io/api/clients/v1/{id}` | `202`. **`id` is the list's internal id, not `clientId`** (the `clientId` returns 404) |

- **Deleting a client does not revoke tokens already issued** (live, 2026-10-02). After the 202 the list drops it at once and new token requests fail within a minute (`401 access_denied`; one minted at +2 s still worked). A token minted **before** the delete still passed `GET /webhooks` at +1, +5 and +15 min: it lives until its `exp`, up to 24 h, with every scope including `edge.content:clearall`. No revoke endpoint is known. A leaked secret therefore means "delete the client, then treat the environment as exposed for 24 h".
- Creating a credential on a real tenant is a live write: get the user's go-ahead first.

**Token:**

```
POST https://auth.sitecorecloud.io/oauth/token
grant_type=client_credentials&client_id=…&client_secret=…&audience=https://api.sitecorecloud.io
```

- `expires_in` ≈ 86400 s (24 h). Cache it.
- Older tenants may need the legacy audience `https://delivery.sitecore.cloud/<tenant-name>`.
- Tenant and org come from token claims (`…/claims/tenant_id`, `tenant_name`, `org_id`, `sc_org_region`). One global host: **the token decides which environment you hit**, so read the claims before any write.
- Scopes granted: `edge.webhooks:create|read|update|delete`, `edge.settings:read|update`, `edge.caches:clear`, `edge.tokens:*`, `edge.content:publish`, **`edge.content:clearall`**. There is no narrower client type, so every holder of this credential can wipe the environment (§ Hard rules).
- Scope is per environment: webhooks, tokens and cache clears **cannot be limited by site**.
- Env vars: `SITECORE_EDGE_CLIENT_ID` / `SITECORE_EDGE_CLIENT_SECRET`, or per environment `SITECORE_EDGE_<ENV>_CLIENT_ID` (three-segment naming, `sitecoreai-auth`) passed to the script with `--id-env` / `--secret-env`.

## 2. Endpoints

Base: `https://edge.sitecorecloud.io/api/admin/v1`, header `Authorization: Bearer <JWT>`.

| Op | Route | Success |
|---|---|---|
| List / get webhook | `GET /webhooks`, `GET /webhooks/{id}` | 200 |
| Create | `POST /webhooks` | 201; take the GUID `id` from the body (`Location` names an internal http host) |
| Update | `PUT /webhooks/{id}` (replaces what you send; **an omitted or null `body` is kept**) | 204 |
| Delete | `DELETE /webhooks/{id}` | 204 |
| Settings | `GET` / `PUT` / `PATCH /settings` | 200 / 202 / 200 |
| Clear Edge cache | `DELETE /cache` | 202, whole environment |
| ~~Delete content~~ | `DELETE /content` | **Never.** Wipes all environment data |

Webhook fields (`WebhookEdit`): `label`, `uri` (**HTTPS only**, so localhost needs a tunnel; a Cloudflare quick tunnel works), `method` (`GET`/`POST`), `headers` (object of strings), `body` (OnEnd only), `bodyInclude` (OnUpdate only, a JSON object merged into the top level), `createdBy`, `executionMode` (`OnEnd` default | `OnUpdate`), `disabled`. Read-only: `id` (GUID), `tenantId` (the tenant name), `created` (reset by every PUT), `lastRuns[{ timestamp, success, message }]` (the 10 newest).

`GET` echoes `headers` **including secret values**: redact every read you print or store. Full tables: `references/admin-api.md`.

## 3. OnEnd vs OnUpdate

| | OnEnd (default) | OnUpdate |
|---|---|---|
| Body | Your static `body` string, verbatim | `application/json` `{ invocation_id, updates[], continues }` (+ `bodyInclude`) |
| Batching | One call per publish (debounce documented only for Content Hub) | Batches share `invocation_id`; `continues: true` until the last |
| Use | Deploy hooks, "something was published", sitewide purge | **Per-item OSR**, incremental search sync, per-item mirroring |

OnUpdate row (live): `{ "identifier": "22222222222242228222222222222222-layout", "entity_definition": "LayoutData", "operation": "Update", "entity_culture": "en" }`. Dashless uppercase GUIDs, `-layout` / `-media` suffixes, PascalCase `entity_definition` and `operation`, `entity_culture: ""` on `MediaItem`. Under snapshot publishing a **datasource-only publish emits the dependent page's `Item` + `LayoutData` rows**. Publishes on an SXA site can trigger a second invocation for the regenerated sitemap file. Your custom `headers` arrive on **every** delivery (live), so a per-webhook secret header works. **Unpublish and delete send `operation: "Delete"` rows with NO `entity_definition` key** (live): `{ "identifier": "3556…1637", "operation": "Delete", "entity_culture": "en" }` plus the `-layout` row. Only the removed item's own rows are sent, never the pages that link to it. Full shapes and timing: `references/payload.md`.

**Use OnUpdate for anything that must follow the content.** OnEnd cannot be attributed: one publish produced three OnEnd deliveries (+1.6 s, +9 s, +120 s), two of them before Edge had the content. Use it as "something was published", never as "my publish is live", and never to trigger a purge or rebuild that re-reads Edge.

## 4. Reliability

- **A non-2xx is a failure, and Edge retries it without backoff** (live): each retry has a **new `invocation_id`** and the same rows. The `lastRuns` message is the response's status text: `Status: Unauthorized, reason: Unauthorized`, `Status: BadRequest, reason: Bad Request`.
- **10 consecutive failures → auto-disable, and the retries alone get there: ONE publish disables the webhook, for a 401 and for a 400 alike** (live). The 401 run sent 10 deliveries in 7 s; the 400 run sent 10 over 137 s at irregular gaps (1–39 s, not growing). Then `disabled: true` and the last `lastRuns` message `The webhook has failed the past 10 consecutive invocations and will be disabled.` (it takes one of the 10 slots, so the first failure falls off). So "10 failures" means one bad publish, not ten, and the retry window is seconds to about 2 minutes, too short to fix a receiver in.
- Re-enable with `webhooks enable <id> --yes` (a PUT carrying `disabled: false`); `lastRuns` is not cleared. Fix the receiver first or the next publish disables it again.
- **30 s** without a response counts as a failure (doc; not probed).
- `lastRuns` is the **only delivery log** and keeps 10 entries. A success has an empty `message`; its `timestamp` is about 1 s before the receiver sees the request.
- Delivery is at-least-once while you answer non-2xx and at-most-once when your receiver is down past the retries: keep a TTL backstop on the receiver.
- No test or ping endpoint exists. A synthetic POST to the receiver proves the receiver; only a real publish proves Edge.
- **Latency (live):** publish start → webhook 86–175 s (median ≈ 135 s), about 1–2.5 min after the content is already readable on Edge (23–60 s). Wait for `lastRuns`, not for Edge, and **budget about 3 minutes** before calling a delivery missed.
- Webhook cap per environment and Admin API rate limits are undocumented.

## 5. Recipe: the OSR webhook for a Content SDK head app

```sh
export SITECORE_EDGE_CLIENT_ID=… SITECORE_EDGE_CLIENT_SECRET=…
node scripts/edge-admin.mjs webhooks list                     # duplicate check, prints tenant
node scripts/edge-admin.mjs webhooks create \
  --label "<site> OSR" --uri https://<production-domain>/api/revalidate \
  --mode OnUpdate --method POST \
  --header x-revalidate-secret=env:SITECORE_REVALIDATE_SECRET \
  --header x-vercel-protection-bypass=env:VERCEL_AUTOMATION_BYPASS_SECRET \
  --created-by "<who>"                                          # dry run: prints the plan
# re-run with --yes to create
```

- **`uri` = the production domain**, never a per-deployment URL (it dies on the next deploy) and never preview (preview gets no Edge webhook).
- **Vercel Deployment Protection (live):** under the default Standard protection (`ssoProtection.deploymentType: all_except_custom_domains`) the production `*.vercel.app` alias answered **200 without a bypass**, while the per-deployment URL answered `302` → `vercel.com/sso-api` (and `401 {"error":{"message":"Protected deployment"}}` to a POST). An `x-vercel-protection-bypass` header in the webhook's `headers` **does pass Edge's delivery through** a protected URL (`lastRuns` OK, page refreshed). Create the secret with `PATCH /v1/projects/{id}/protection-bypass` (`{"generate":{}}`) or Settings → Deployment Protection → Protection Bypass for Automation.
- Header values via `env:NAME` keep secrets off the command line and out of shell history.
- The receiver contract (secret, responses, tags) is `content-sdk-app-router-cache-components-and-osr`.
- **Order: controls pass → then the webhook exists.** Run `revalidate-controls.mjs` against the deployed route (secret set on the target, bypass if protected) **before** `create --yes`: one publish against a receiver answering 401 or 400 sends 10 retries within seconds to about 2 minutes and disables the webhook (both live). Creating it with `disabled: true` and enabling after the controls would be the safer shape, but whether `POST` honours `disabled` is unverified `[probe-gated]` (a fresh create read back `disabled: null`); until a probe shows it, create only after the controls pass.
- Verify after a real publish: `webhooks get <id>` → newest `lastRuns` success true, `disabled` false, then the **content marker** on the page (not `200`, not `x-vercel-cache`).

**Shared CM / multi-site:** one Edge environment serves every site on it, and every webhook receives every site's publishes. One webhook per head app per environment; receivers must tolerate foreign ids (the SDK route does). Put the owning app in `label` and check for an existing webhook with the same `uri` before creating.

## 6. Safe updates and the debugging ladder

- **Update = GET → merge → PUT → GET and diff.** Send every field: the doc's re-enable example omits `executionMode`, which (doc) resets to `OnEnd`, so the receiver gets no rows, answers 400, and the webhook disables itself on the next publish. `edge-admin.mjs update|enable|disable` does the merge.
- **A stored `body` survives a PUT that omits it or sends `null`, and `body: ""` is rejected under OnUpdate** (live). Switching OnEnd → OnUpdate therefore needs two PUTs: `OnEnd` + `body: ""`, then `OnUpdate`. The script plans both and fails the post-PUT check if a stale body remains.
- **Delete** prints a redacted snapshot first so the webhook can be recreated.
- **Rotate the receiver secret** without downtime: accept old and new on the receiver, `update --header x-revalidate-secret=env:NEW`, then drop the old.

"The webhook doesn't fire": (1) the token's `tenant_name` is the environment you think → (2) the webhook exists, `executionMode` is right, `disabled` is false → (3) the publish reached Edge (query Edge, not the CM) → (4) `lastRuns` has an entry for that time → (5) its `message` (timeout, status) → (6) the receiver: a `302` to an SSO page is a false success, check the bypass header → (7) the receiver's tags match the cache (the OSR skill).

## 7. Settings and cache

- `edge-admin.mjs settings get`: `contentCacheTtl`, `mediaCacheTtl` (format `d.hh:mm:ss`; documented default `04:00:00`, observed `1.00:00:00` on one tenant: always read it), `*AutoClear`, `tenantCacheAutoClear`.
- `cache clear` (`DELETE /cache`, `--yes`): environment-wide Edge cache clear, every site on it. Not needed after a normal publish (Edge clears on its own).

## Which webhook for which job

| Job | Use |
|---|---|
| Revalidate a head app after publish | **Edge, OnUpdate** → `/api/revalidate` |
| Keep a SitecoreAI search index fresh | **Edge, OnUpdate** → push upsert; replay after every reindex, which wipes pushed documents (`sitecoreai-search-sources`) |
| Sitewide purge / trigger a rebuild | The pipeline, after a read-back shows the content on Edge. An OnEnd webhook fires early and repeatedly (§ 3); use it only where a premature trigger is harmless |
| Sync external search | Edge, OnUpdate, filter `LayoutData` rows |
| Notify on workflow approval / block on an external check | Workflow Submit Action / Validation Action (CM) |
| Alert on a failed publish | CM event handler `publish:fail` |
| Know when *your* Publishing API job finished | Poll the job (`sitecoreai-publishing`); the Edge webhook says when it is live |

Full table with the CM webhook families and their traps: `references/decision-table.md`. **Never point a CM webhook at `/api/revalidate`**: its payload has no `updates`, and `publish:end` fires before Edge is live.

## Hard rules

- **Never call `DELETE /content`** (scope `edge.content:clearall`). It instantly wipes all published data of the environment. The bundled script has no command for it and refuses the route even if asked. Not with a flag, not for a test.
- **Every write needs explicit intent:** read the token's tenant claims first; the script is read-only unless `--yes` is passed.
- **Never print or store a secret:** client secret, JWT, webhook header values. Record only ids (`clientId`, webhook `id`).
- **Never use an automation client** against the Edge Admin API. Mint an Edge administration client.
- **Never update with a partial PUT.**
- Webhook creation on a real tenant is a live write: get the user's go-ahead first.

## References

- `scripts/edge-admin.mjs`: `token`, `webhooks list|get|create|update|enable|disable|delete`, `settings get`, `cache clear`, `--self-test`. Live-tested 2026-10-02 (create, get, list, two-step mode switch, enable, delete).
- `references/admin-api.md` · `references/payload.md` · `references/decision-table.md`
- `sitecoreai-auth` (org automation client, token caching) · `sitecoreai-publishing` (jobs, polling) · `content-sdk-app-router-cache-components-and-osr` (the receiver)
- Sitecore docs (doc.sitecore.com, SitecoreAI developer docs → Experience Edge): *Admin REST API*, *Webhook objects*, *The webhook execution modes*, *The publishing process*, *Create a JSON Web Token for Experience Edge APIs*.
