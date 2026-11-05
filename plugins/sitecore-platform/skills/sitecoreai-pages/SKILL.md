---
name: sitecoreai-pages
description: "Low-level SitecoreAI Pages REST API — page CRUD, versions, variants, layout and field updates, duplicate, rename, translate, blueprint pages. Use when you need precise control beyond the Agent API's composite actions."
license: Apache-2.0
compatibility: "Requires a Sitecore Cloud Portal automation client (see sitecoreai-auth), HTTPS network access to https://xmapps-api.sitecorecloud.io, and the Accept: application/json header on every call."
metadata:
  author: Christian Hahn
  version: "0.3.2"
  source_spec: "https://api-docs.sitecore.com/_bundle/sai/pages-api/index.yaml"
  spec_version: "v1"
  spec_sha256: "33028f864c0c38261b15dba1d767f08b96bbb77e9ed2b362a79c2b5bf4980c6a"
  last_synced: "2026-06-24"
---

# Pages API

Direct CRUD on pages. Lower-level than the Agent API — prefer Agent API when the task maps to a marketer-level outcome, use Pages API when you need per-field control, version/variant lifecycle, or layout manipulation.

---

## Base URL

```
https://xmapps-api.sitecorecloud.io
```

(Spec `servers[0]` — "Production server". All requests run against the production environment.)

## Auth & scopes

OAuth 2.0 client-credentials → JWT Bearer. See the `sitecoreai-auth` skill.

- **Security scheme:** `Bearer` (HTTP bearer), applied globally (`security: [{ Bearer: [] }]`). Every operation requires the JWT; the spec defines **no per-operation OAuth scope strings**.
- **Token request:** `POST https://auth.sitecorecloud.io/oauth/token` with `grant_type=client_credentials` and **`audience=https://api.sitecorecloud.io`**.
- **Granted scope:** the token response carries **`xmcloud.cm:admin`** — a single admin-level scope, not granular per-endpoint `:r` / `:w` scopes.
- **`Accept: application/json` header is required** on every request (per the spec's auth section). Header format: `Authorization: Bearer {JWT}`.

## Versioning

Current: **v1** (`info.version: v1`). Paths are `/api/v1/...`.

---

## Endpoints

Resource groups: **Pages** · **Versions** · **Live / Variants** · **Aggregation (batch)**.

The full `path` × method table is in `references/endpoints.md`; request bodies and key response fields per operation are in `references/schemas.md`. Both are regenerated from the spec — read them when you need an exact path, method or field name; the sections below carry what the spec does not say.

## Errors

All operations share RFC-7231 **`ProblemDetails`** error bodies (`type`, `title`, `status`, `detail`, `instance`, plus `traceId` + per-field `errors` map in examples):

- **400 Bad Request** — validation failure (e.g. a required property missing).
- **404 Not Found** — page / resource not found (not returned by the create, blueprint, and the two aggregation endpoints).
- **503 Service Unavailable** — `GET /pages/search` only, when the search service is down.

(There is no 406 response declared in the spec — see the curated Pitfalls note for the empirical `Accept`-header behavior.)

---

<!-- CURATED:START — hand-maintained wire-level notes; preserved across regenerations -->

## Version / variant model

- **Versions** are composite-keyed by `(versionNumber, language)`. Deleting a version requires both.
- **Variants** are personalization variations of a page. They are created/managed via the **Agent API** personalization endpoints; the Pages API only *reads* which variants are currently live.
- To audit Edge state: `GET /pages/{pageId}/live` for the page, `GET /pages/{pageId}/live/variants` for its variants.
- **Numbered vs language version.** A *language* version is the first version in a language; a *numbered* version is version N+1 in a language that already has one. Whether `POST /pages/{id}/version` copies the base version is still open (probe-gated), while Authoring `addItemVersion` and MCP `add_language_to_page` were measured to create an **EMPTY** language version (2026-10-02). `translate` covers local datasources (documented). "Keep workflow state" exists in the UI only. Language work: `sitecoreai-localization`.

---

## Patterns

### Safe update

```ts
const token = await getSitecoreToken();
const res = await fetch(`https://xmapps-api.sitecorecloud.io/api/v1/pages/${pageId}`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ fields: { Title: "New title" } }),
});
```

### Duplicate → modify → rename (common "make a variation" flow)

1. `POST /pages/{pageId}/duplicate` → get new `pageId`.
2. `PATCH /pages/{newId}` → set the fields that differ.
3. `POST /pages/{newId}/rename` → give it a proper system name.

### Check live state before publishing

Before telling a marketer "this is live", call `GET /pages/{pageId}/live`. Edge publication can lag authoring.

---

## Pitfalls

- **`Accept: application/json` required.** Missing header → `406 Not Acceptable`.
- **`/pages/search` matches names, not body content.** For content-aware search use Agent API.
- **Version deletion is irreversible.** No soft-delete; no revert equivalent at the Pages API level. (Use Agent API jobs to mutate if revertibility matters.)
- **Layout replacement is total.** `POST /pages/{pageId}/layout` replaces the whole layout, not a merge. Fetch → modify → write back.
- **JWT expires in 24 h.** Cache. See the `sitecoreai-auth` skill.
- **Rate limits undocumented.** Implement backoff.

<!-- CURATED:END -->

## OpenAPI bundle

Full schema: [api-docs.sitecore.com/_bundle/sai/pages-api/index.yaml](https://api-docs.sitecore.com/_bundle/sai/pages-api/index.yaml)

## Sources

- [Pages API reference](https://api-docs.sitecore.com/sai/pages-api)
