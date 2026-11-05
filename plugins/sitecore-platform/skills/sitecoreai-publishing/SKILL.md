---
name: sitecoreai-publishing
description: "SitecoreAI Publishing REST API — create, list, monitor and cancel SitecoreAI publishing jobs, summary statistics. Use for build-time publishes, scheduled republishes, publish dashboards or anything that reacts to publish state."
license: Apache-2.0
compatibility: "Requires a Sitecore Cloud Portal automation client (see sitecoreai-auth) with the xmcloud.cm:admin scope for application/client-credentials tokens, plus the appropriate xmcpub.jobs.* read/write scopes per endpoint, and HTTPS access to https://edge-platform.sitecorecloud.io."
metadata:
  author: Christian Hahn
  version: "0.5.3"
  source_spec: "https://api-docs.sitecore.com/_bundle/sai/publishing-api/index.yaml"
  spec_version: "v1.0"
  spec_sha256: "6edb919a4a470428a4eb542cd4f19c029601ede68e55a98420551e08d1e0db30"
  last_synced: "2026-06-24"
---

# Publishing API

Create and monitor publishing jobs for a SitecoreAI tenant.

---

## Base URL

```
https://edge-platform.sitecorecloud.io
```

All endpoints live under `/authoring/publishing/v1/jobs`.

## Auth & scopes

OAuth 2.0 client-credentials → JWT Bearer (the spec's `Bearer` HTTP security scheme, `bearerFormat: JWT`; sent as `Authorization: Bearer <token>` without the `Bearer` prefix in the token value). See the `sitecoreai-auth` skill.

The spec defines per-operation scope requirements. Each operation accepts **one of** an `a` (all-jobs) scope or a `t` (tenant/own-jobs) scope:

| Endpoint group | Required scope (one of) |
|---|---|
| **Read** — `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/filters`, `GET /jobs/summary` | `xmcpub.jobs.a:r`, `xmcpub.jobs.t:r`, or `xmcpub.jobs.t:rl` |
| **Permissions** — `GET /jobs/permissions` | **No scope** — only a valid token is required |
| **Write** — `POST /jobs` (create) | `xmcpub.jobs.a:w`, `xmcpub.jobs.t:w`, or `xmcpub.jobs.t:wl` |
| **Cancel** — `POST /jobs/{jobId}/cancel` | `xmcpub.jobs.a:w`, `xmcpub.jobs.t:w`, or `xmcpub.jobs.t:wl` |

- The `:rl` / `:wl` suffix is **limited** (read-limited / write-limited): the principal operates only on the jobs **they initiated**, not all tenant jobs.
- Limited-write (`xmcpub.jobs.t:wl`) for create/cancel additionally requires the `Sitecore Client Advanced Publishing` or `Sitecore Client Publishing` role, or the `admin` flag set in SitecoreAI.
- **Application/client-credentials tokens additionally require the `xmcloud.cm:admin` scope** (spec note on `POST /jobs` and `POST /jobs/{jobId}/cancel`). Without it, calls return `403`.

## Versioning

Spec `info.version`: **v1.0**. Path prefix is `/authoring/publishing/v1/`.

---

## Endpoints

Resource groups: .

The full `path` × method table is in `references/endpoints.md`; request bodies and key response fields per operation are in `references/schemas.md`. Both are regenerated from the spec — read them when you need an exact path, method or field name; the sections below carry what the spec does not say.

## Errors

All error bodies use **`ProblemDetails`** (`{ type, title, status, detail, instance }`, RFC 7807-style):

| Status | When |
|---|---|
| `400` | Invalid parameters / job ID / name / items / mode / locales / source / tenant. |
| `401` | Unauthorized request or invalid access token. |
| `403` | Authorization failed (missing scopes/roles, or `xmcloud.cm:admin` missing on an app token), or context tenant cannot be resolved. |
| `404` | Job not found (`GET /jobs/{id}`, `POST /jobs/{jobId}/cancel`). |
| `409` | Cancel rejected — job is not `Queued`/`Running` (`POST /jobs/{jobId}/cancel`). |
| `501` | Cancel not supported for SitecoreAI Content (`POST /jobs/{jobId}/cancel`). |

`POST /jobs` returns **`201`** with the job; `POST /jobs/{jobId}/cancel` returns **`202`** (cancellation accepted, async).

---

<!-- CURATED:START — hand-maintained wire-level notes; preserved across regenerations -->

## Job lifecycle

```
queued → in progress → completed
                    ↘ failed
                    ↘ canceled
```

- **queued**: created, waiting for a worker.
- **in progress**: executing. Cancellable via `POST /jobs/{jobId}/cancel`.
- **completed**: finished successfully. Final state.
- **failed**: terminated with error. Final state. Inspect job details for error payload.
- **canceled**: user-cancelled. Final state.

`GET /jobs/summary` returns a count in each state — drive dashboards off this endpoint, not by listing all jobs.

---

## Create-job request body (the shape `POST /jobs` needs)

⚠️ **`POST /jobs` takes a NESTED body; the FLAT shape that `GET /jobs/{id}` returns will 500.** Verified live + against the official OpenAPI (`api-docs.sitecore.com/_bundle/sai/publishing-api/index.yaml`):

```jsonc
{
  "name": "content publish",   // required, ≤256 chars
  "source": "my-app",          // required, free string (later filterable via ?source=)
  "options": {
    "xmc": {
      "locales": ["en"],                 // required for a site publish
      "site": { "mode": "Smart" }        // Republish (full) | Incremental | Smart (changes only)
    }
  }
}
```

- `options.xmc.site` = **whole-ENVIRONMENT** publish (named `site` for legacy XM reasons but it publishes every site on the env — there is NO site-identifier field). Mutually exclusive with the Tier-1 item form: `{ "options": { "items": [{ "id", "type", "locale?" }], "xmc": { "items": { "mode": "Smart", "publishRelatedItems?": false, "publishChildren?": false } } } }`.
- `mode`: **Smart** = items modified since the last publish (fast, the usual choice) · **Republish** = full re-emit · **Incremental**.
- **`publishChildren` is job-wide, not per item.** There is no exclude: an item with children on takes every descendant, so a site `Home` with children also publishes a build-only subtree under it. To publish a site minus a subtree, list every item explicitly (`publishChildren: false`, `publishRelatedItems: false`); ~1,000 items in one job completed with 0 failed (measured 2026-10-06). Adding a locale to such a job reports language-variant **deletes** in the statistics; they are expected.
- `GET /jobs/{id}` *normalizes* this to a FLAT `options.xmc.{ type:"Site", mode, locales }` — that read-back shape is informational; **never POST it.**

## Patterns

### Kick off a publish and wait

```ts
const token = await getSitecoreToken();
const base = "https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs";

// Create — body per "Create-job request body" above
const create = await fetch(base, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "content publish", source: "my-app",
    options: { xmc: { locales: ["en"], site: { mode: "Smart" } } },
  }),
});
const { id } = await create.json();

// Poll (exponential backoff — do NOT poll every second).
// ⚠️ status lives at job.system.status (US spelling), NOT a top-level job.status.
const TERMINAL = ["Completed", "Failed", "Canceled"];
let delay = 2_000;
while (true) {
  await new Promise(r => setTimeout(r, delay));
  const res = await fetch(`${base}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const job = await res.json();
  if (TERMINAL.includes(job.system?.status)) return job;   // job.statistics has itemsProcessed / itemsFailed
  delay = Math.min(delay * 1.5, 30_000);
}
```

### Publishing dashboard widget

1. `GET /jobs/summary` on a timer (60 s is plenty) → counters.
2. `GET /jobs?status=in_progress` → live list, capped at page size.
3. Use `GET /jobs/filters` once on load to populate filter dropdowns.

### Limited-write cancel

Users with only `:wl` can cancel **only the jobs they initiated**. If cancelling someone else's job is required (e.g. platform-admin tooling), the principal needs `:w`.

---

## Pitfalls

- **Offset pagination caps at 1000 records.** For larger audits use checkpoint pagination (see OpenAPI schema). Do not naively loop beyond offset 1000 — the API will reject it.
- **`:wl` users can cancel only their own jobs.** Surface clear error messaging when the principal lacks scope.
- **`xmcloud.cm:admin` gotcha.** Application tokens (client_credentials) need this extra scope or every call returns `403`. This is the #1 setup mistake.
- **Job creation is async.** `POST /jobs` returns quickly with a job ID; the actual publish runs afterwards. Always poll — do not assume immediate completion.
- **No callback: push instead of poll.** The Publishing API cannot notify you. For "content is live on Edge" register an Edge webhook (`sitecoreai-edge-admin-webhooks`, OnUpdate; it arrives 86–175 s after publish start, live 2026-10-02). Poll only jobs you started yourself.
- **An org automation (deploy-admin) token gets `403` here** (no publishing scope). Use the environment's CM client token, or publish through Authoring GraphQL `publishItem`, which worked with the CM client in the S5 probes (2026-10-02).
- **Statistics are eventually consistent.** `/jobs/summary` may lag individual job-detail reads by a few seconds.
- **Rate limits undocumented.** Back off on `429` / `5xx`.
- **Nested create body is mandatory.** `POST /jobs` needs `options.xmc.site.{mode}` + `options.xmc.locales` (see "Create-job request body"). The flat `GET` shape → 500. The #2 setup mistake after the `xmcloud.cm:admin` scope.
- **`itemsFailed` is env-wide and often chronic — do NOT attribute it to your items.** A Smart publish re-attempts EVERY modified-since item across EVERY site on the env, so a backlog of broken items (bad links, missing required fields) shows up as failures on an unrelated publish. Confirm scope first with `GET /jobs/permissions` (`canCreate: true`); compare `itemsProcessed` vs `itemsFailed` in `job.statistics`; check job history (`GET /jobs` — note: **OLDEST-first**, pageSize max ~100) to see the chronic baseline before blaming your change.
- **A "Completed" job can still have failures.** Terminal status `Completed` only means the job ran; inspect `statistics.itemsFailed`. Individual failure reasons are not in the job payload — surface them from Pages UI.

<!-- CURATED:END -->

## Sources

- [Publishing API reference](https://api-docs.sitecore.com/sai/publishing-api)
