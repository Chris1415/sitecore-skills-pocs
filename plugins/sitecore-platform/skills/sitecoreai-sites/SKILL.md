---
name: sitecoreai-sites
description: "SitecoreAI Sites REST API — sites, site collections, languages, hosts, editor profiles, sitemap, page hierarchy, background jobs. Use for any CRUD on the site tree, site-level config, multi-language setup or hierarchical page navigation."
license: Apache-2.0
compatibility: "Requires a Sitecore Cloud Portal automation client (see sitecoreai-auth); creating that client requires Org Admin or Owner role. HTTPS access to https://xmapps-api.sitecorecloud.io."
metadata:
  author: Christian Hahn
  version: "0.5.1"
  source_spec: "https://api-docs.sitecore.com/_bundle/sai/sites-api/index.yaml"
  spec_version: "v1"
  spec_sha256: "a26e933d424a41c6004fd5369cb220f4233f532a33a9e386e785bca0a42fda18"
  last_synced: "2026-06-24"
---

# Sites API

Manage the structure of a SitecoreAI tenant: sites, collections, languages, hosts, editor profiles, and the page hierarchy underneath each site. This is the XM Apps Sites API — the core entity model is the **Site Collection** (group of related sites that share resources), the **Site** (a website in the portfolio), the **Language** (tenant/site language management), and the **Job** (background work handle). All requests run against your production environment.

---

## Base URL

```
https://xmapps-api.sitecorecloud.io
```

Single production server (`info.servers[0]`). No sandbox/staging host.

## Auth & scopes

OAuth 2.0 client-credentials → JWT Bearer. See the `sitecoreai-auth` skill for the full flow. The spec declares a single global security scheme — `Bearer` (`type: http`, `scheme: Bearer`) applied to **every** operation; there are **no per-operation scope requirements declared in the spec**.

Concrete values (from the spec's `info` authorization section, matching `sitecoreai-auth`):

- **Token endpoint:** `POST https://auth.sitecorecloud.io/oauth/token` with `grant_type=client_credentials`.
- **Audience (literal, fixed):** `audience=https://api.sitecorecloud.io` — not the API base URL, not `.com`, no trailing slash.
- **Scope returned on the token:** `xmcloud.cm:admin` (the admin scope covering XM Apps automation; the spec's sample token response shows `"scope": "xmcloud.cm:admin"`). The spec does not enumerate finer-grained per-endpoint scope strings — automation clients are granted the default XM Apps scopes.
- **Header:** `Authorization: Bearer {JWT}` plus `Accept: application/json` on every request.
- **Token lifetime:** 24 h (`expires_in: 86400`); cache and refresh on `401`.

Creating the automation client requires **Organization Admin or Owner** role in Cloud Portal — the credential form is hidden otherwise.

**Path prefixes:**
- `/api/v1/...` — standard endpoints (sites, collections, languages, hosts, hierarchy, favorites, jobs, statistics, sitemap, translate).
- `/api/ui/v1/...` — editor-profile (page-builder toolbar) endpoints only.

## Versioning

- `info.version`: **v1**.
- Two path prefixes carry the version: `/api/v1/...` (standard) and `/api/ui/v1/...` (editor-profile UI surface).

---

## Endpoints

Resource groups: **Sites** · **Hierarchy (page tree)** · **Hosts** · **Site Collections** · **Languages** · **Favorites** · **Editor Profiles** · **Background Jobs**.

The full `path` × method table is in `references/endpoints.md`; request bodies and key response fields per operation are in `references/schemas.md`. Both are regenerated from the spec — read them when you need an exact path, method or field name; the sections below carry what the spec does not say.

## Errors

Standard RFC-7807 `ProblemDetails` body `{ type, title, status, detail, instance }` plus optional `errors` map (e.g. `{ "sampleProperty": ["...required"] }`).

| Status | Where it appears |
|---|---|
| `400 Bad Request` | Validation failures — present on nearly every operation. |
| `401 Unauthorized` | Editor-profile endpoints (and any expired/invalid token). |
| `403 Forbidden` | Editor-profile endpoints (insufficient role). |
| `404 Not Found` | Any `{id}`/`{handle}` lookup miss. |
| `409 Conflict` | Host create / update (hostname collision). |
| `503 Service Unavailable` | `name/validate`, localization & workflow statistics (search service down). |

Async write operations return `200` with a `JobResponse { handle }` (or `202 Accepted`) rather than the finished resource — poll `GET /jobs/{jobHandle}/status`.

---

<!-- CURATED:START — hand-maintained wire-level notes; preserved across regenerations -->

## Patterns

### Build a site tree view

1. `GET /sites/{siteId}/hierarchy` → root level.
2. Lazy-expand: `GET /sites/{siteId}/hierarchy/{pageId}/children` on node click.
3. Breadcrumbs: `GET /sites/{siteId}/hierarchy/{pageId}/ancestors`.

### Create a new site

1. `GET /sites/templates` → pick a template id.
2. `POST /sites/name/validate` with `{ name }` → validate.
3. `POST /sites` with `{ siteName, templateId, collectionId, language }` (measured 2026-10-28; `templateId` as a braced GUID) → returns a job handle.
4. Poll `GET /jobs/{jobHandle}/status` until `done: true` with `errors: []`.

A new collection (`POST /collections` with `{ name, displayName, description }`) is a job too: poll it before the `POST /sites` that names its id, or the collection is not listed yet. **A site may not carry its collection's name.** `POST /sites` answers `400 "A site with that name already exists"` even though `validate` said valid. Create the site under a temporary name and rename it (below); a collection and a site of the same name then work.

### Rename, swap or delete a site

Measured 2026-10-27/28 on one environment (two renames, a swap, a delete):

1. `POST /sites/{id}/rename` with `{ name }` (not `newName`: that is `400 "The name field is required"`) → job. It renames the site root and its media folder.
2. **It does not rename the Site Grouping item or its `SiteName` field**, which is what the runtime resolves the site by. Set both through Authoring GraphQL (`updateItem` on `SiteName`, `renameItem` on the grouping item) and read them back.
3. Republish each renamed site's `Settings` subtree and read `siteInfoCollection` on the **live** Edge context. After two renames plus one subtree republish, live Edge listed neither name while `layout(site: …)` still resolved and preview was correct. A Content SDK build reading the site list then fails `IV-007 Site "<name>" does not exist`.
4. `DELETE /sites/{id}?force=true` → job; it removes the site's content and media. It does not unpublish: live Edge keeps the site in `siteInfoCollection` until its parent is republished. Items that serialization deployed as resources come back from the deployment, so take them out of git first.

### Set a custom site thumbnail (the dashboard card image)

Measured 2026-09-28:

1. `POST /sites/{siteId}/upload-thumbnail` with `multipart/form-data` field `File` (PNG verified). The call returns `200` with the media item `{ id, name, itemPath, url }`. The item lands at `<site media root>/System/thumbnail_<siteId>`, and a re-upload overwrites that same item.
2. **Max 1 MB.** A larger file returns `400 "Thumbnail size is more than 1MB"` and nothing is written.
3. The image is stored as uploaded, with no resize. The card crops it to **400×221**, so upload at about 1.81:1. 800×442 is 2× and comes to roughly 430 KB as a PNG screenshot.
4. Read back with `GET /sites/{siteId}`. Expect `thumbnail.autogenerated: false` and a url naming `thumbnail_<siteId>`. The media url is on the CM with `db=master`: it answers `302` anonymously and `200` with the bearer token.
5. The custom thumbnail is sticky. A no-op `PATCH /sites/{siteId}` leaves it in place. `resetThumbnail: true` on the PATCH presumably goes back to the auto-generated one, but that path has not been probed.

**Why bother.** The auto-generated thumbnail is a 600×600 capture of the home page that can land **without CSS** on a Content SDK head app: real content rendered as raw monospace text. It stays wrong until something replaces it. A full-viewport screenshot fails the 1 MB limit at 1440 wide with a 1× scale, so render at a 1440 viewport and set `deviceScaleFactor` to about 0.55.

### Add a language tenant-wide

1. `GET /languages/supported` → find the ISO code.
2. `POST /languages` with the code → becomes available for page versions.

**Multi-language (measured 2026-10-02 unless marked).** `SiteLanguageSettings` live on the **hosts** (`PATCH /sites/{id}/hosts/{hostId}`), not the site. `PATCH /languages/{isoCode}` takes the **regional** code (`de-DE`) and sets the fallback rule. `GET /languages/supported` is **not anonymous**: without a token it answers `404 "Authorization header is missing"`; an org automation client gets `401` (use an environment client). Localization statistics answer `503` while search is down. `Site.languages` vs `supportedLanguages` is still open. Full runbook (add, enable, translate, fallback, publish, census): `sitecoreai-localization`.

### Batch live-variant check

For a dashboard listing many pages, do **one** `POST /aggregation/pages/live/variants` with the page IDs instead of N calls to the Pages API `/pages/{id}/live/variants`.

> ⚠️ Sync note (2026-06-24): the `aggregation` endpoints this pattern relies on are **not present in the `v1` Sites API spec** (sha `a26e933…`) — neither `/aggregation/pages` nor `/aggregation/pages/live/variants`. They may have been removed, never shipped under Sites, or live on a different API surface. Verify against a live tenant before depending on this pattern; if you need active variants today, fall back to N calls against the Pages API. Pattern retained pending re-confirmation.

---

## Pitfalls

- **Cascading deletes.** `DELETE /collections/{id}` removes every site in the collection. `DELETE /sites/{id}` also breaks shared-item links that other sites depend on. Always confirm via UI flow before calling from an automation.
- **Site-name rules.** Max 50 chars, Latin alphanumeric + spaces/dashes, no leading/trailing space, no leading dash. Use `/sites/name/validate` rather than inventing your own regex.
- **Deprecated `renderinghosts`.** Already marked deprecated — migrate any integration to `editinghosts` now, not later.
- **Site creation is async.** `POST /sites` returns a job handle, not a ready-to-use site. Poll `/jobs/{jobHandle}/status`.
- **Automation client requires Org Admin/Owner role** — plan for a role-bearing account to register the client, even if the app itself runs as a service.
- **Rate limits undocumented.** Back off on `429` / `5xx`.
- **Analytics identifiers: assign, never create.** The host `PATCH` takes `analyticsIdentifiers: [{ name, language }]` (a list; the GET returns a `{ "<lang>": "<name>" }` map, and sending the map back is a 400). It only assigns an identifier that already exists. An unknown name still returns **204**, lands in the Site Grouping `POS` field and in `GET /sites/analytics-identifiers/{name}`, and the portal then flags the host "missing their analytics identifier": no API read catches it (probed 2026-10-15). Create the identifier in the portal (Site hosts → Analytics and personalization → *Create new*), then assign it. A site created by serialization push has none.

<!-- CURATED:END -->

## OpenAPI bundle

Full schema: [api-docs.sitecore.com/_bundle/sai/sites-api/index.yaml](https://api-docs.sitecore.com/_bundle/sai/sites-api/index.yaml)

## Sources

- [Sites API reference](https://api-docs.sitecore.com/sai/sites-api)
- [Editor Profiles section](https://api-docs.sitecore.com/sai/sites-api/editor-profiles)
