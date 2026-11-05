# Query recipes (read-only) and their limits

All shapes measured on a live tenant on 2026-10-02 unless marked otherwise. Field-level shapes: `sitecoreai-graphql-schemas`.

## Authoring GraphQL (master)

`POST https://<cm-host>/sitecore/api/authoring/graphql/v1`, header `Authorization: Bearer <JWT>` (org automation client works). `sc_apikey: bearer …` returns **HTTP 200 with "not authorized" in the body**: always read `errors`.

| Limit | Measured |
|---|---|
| Depth | **13** (`The query exceded the maximum allowed execution depth of 13.`) |
| Complexity | none reached (50 aliases × children × fields = 18.6 MB in 2.5 s) — response size is the bound |
| `search` page size | default 10; 1000+ honoured; `totalCount` exact; 0 duplicates paging at 100 |
| `children` | no `totalCount`; unbounded `children` returns **all** rows (the "10 rows" trap is Edge only) |
| Aliases | 200 per request fine |
| Throttle | none observed (no rate headers, no 429) |
| Index lag | a new item is searchable after ~3.6 s; a deleted one leaves the index after ~6.3 s |

**Inventory (index):**

```graphql
{ search(query:{ index:"sitecore_master_index", latestVersionOnly:true, language:"en",
    searchStatement:{ criteria:[{ field:"_fullpath", criteriaType:STARTSWITH, value:"/sitecore/content/<collection>/<site>" }] },
    paging:{ pageSize:500, pageIndex:0 } }){ totalCount results{ itemId path templateName templateId } } }
```

- Compare `totalCount` with the rows received. A mismatch is UNKNOWN, never clean.
- The returned `path` is **lowercased** (index value). Filter `STARTSWITH` hits to `root` or `root/…`: a sibling `…/Site-Other` also matches.
- `templateName == ""` = the item's template is gone (T2).
- Facet counts count index documents (versions), not items.

**Fields per item (aliased, 25 per call).** All three `fields()` arguments are mandatory:

```graphql
{ i0: item(where:{ itemId:"{GUID}", language:"en" }){ itemId path hasPresentation
    fields(excludeStandardFields:true, ownFields:false, withLanguageFallback:false, first:200){ nodes{ name value templateField{ typeKey } } }
    r: field(name:"__Renderings"){ value } f: field(name:"__Final Renderings"){ value } } }
```

**Resolve targets (aliased, 100 per call).** Select `template` so a gone template shows up:

```graphql
{ t0: item(where:{ itemId:"{GUID}" }){ itemId path template{ templateId } } }
```

- Random GUID → `null`, **no error** (missing).
- Gone template → `null` + error `The '{0000…}' template doesn't exist…` with `path: ["t0","template"]`. Selecting only `itemId` still returns the item.
- Malformed GUID → `null` + `Unable to convert type…`.
- Attribute errors to aliases by `errors[].path[0]`.

**Other roots used:** `sites(includeSystemSites:false){ name rootPath }` (site root), the Rendering Hosts folder `item(where:{path:"/sitecore/system/Settings/Services/Rendering Hosts"}){ children(first:200){ nodes{ … field(name:"ServerSideRenderingEngineApplicationUrl"){value} } } }`, `jobs(first:50)` (running jobs only). No referrers / links / usage query exists: the reverse index is built from forward edges. `renderings` is no longer a Query root.

## Experience Edge (live and preview context)

`POST https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=<id>`. The context id is the credential: never print it.

| Limit | Measured |
|---|---|
| Rate | 80 rps documented; `x-rate-limit-remaining` appears on some responses only. Doctor default 8 rps live, 4 rps preview (shared with production traffic) |
| Routes | `routes(first:100)` and even 1000 pass on **live** for flat selections; the **preview** context answers "Query is too complex" at 100: page preview at 10 |
| Depth | 12 nested `children` levels returned without error; over-depth behaviour unconfirmed — guard with total vs received |
| `children` | default 10 rows: always pass `first` and read `total` |
| Dead context | `404 "No sitecore context"` |
| Missing route | `200` with `item: null`; a broken page is `200` with `route: null` |

```graphql
query($s:String!,$l:String!,$a:String){ site{ siteInfo(site:$s){ routes(language:$l, first:100, after:$a){
  total pageInfo{ endCursor hasNext } results{ routePath route{ id } } } } } }

query($s:String!,$p:String!,$l:String!){ layout(site:$s, routePath:$p, language:$l){ item{ rendered } } }

{ e0: item(path:"{GUID}", language:"en"){ id } }                       # published? (aliased, 50 per call)
query($i:String!){ item(path:$i, language:"en"){ version u: field(name:"__Updated"){ value } } }   # drift
query($s:String!){ site{ siteInfo(site:$s){ robots } } }
```

- Only Created / Updated / Sortorder are published system fields: `__Revision`, workflow and locks are Authoring-only.
- Dictionary: an invalid language returns `total: 0` with no error, like an empty one.
- Preview is master in Edge shape. It is **never** evidence of publication.

## Deploy API (org automation client, GET only)

Base `https://xmclouddeploy-api.sitecorecloud.io`.

| Read | Notes |
|---|---|
| `/api/environments/v2/{env}` | `host`, `type`, `provisioningStatus` (2 = done), `repositoryDetails`, **`liveContextId` / `previewContextId`**, `platformTenantName`. For an EH env, `host` is the **CM** host |
| `/api/environments/v2/{env}/deployments` | all deployments, oldest first, `pageSize` ignored |
| `/api/deployments/v3/{id}` | per-leg `*Status`, `*CompletedAt`, `*LastFailureMessage`, `calculatedStatus` (2 ok, 4 failed), `commitId` |
| `/api/organizations/v4/{org}/health` | `{ status:"Healthy", resources:[{ name:"Search Index" }] }`; v2 = 500 |
| `/api/hosts/v1/environment/{CM env}` | EH registrations (`editingHostEnvironmentId`, `renderingEngineApplicationUrl`). The EH id returns `200 []` |
| `/api/environments/v1/{env}/variables` | names + values (`secret` flag) |
| `/api/environments/v1/limitation`, `/api/projects/v1/{id}/environments/limitation` | quotas (`/environments/v1/{id}/limitation` does not exist) |
| `GET /api/environments/v1/{env}/restart` | restart **status** (204). POST restarts: the request layer refuses it |

## Monitoring API (org automation client, unattended)

Base `https://xmcloud-monitoring-api.sitecorecloud.io`. Access is org-scoped.

| Read | Notes |
|---|---|
| `GET /api/logs/v1/{env}` | `[{ name, path, lastModified, type, size }]`; no paging; **capped at 50 files per type**; sort by `lastModified` yourself |
| `GET /api/logs/v1/{env}/types` | static list: a random env id also answers 200 |
| `HEAD /api/logs/v1/{env}/{name}` | `content-length` = listed size: size-gate before downloading |
| `GET /api/logs/v2/{env}/{name}?download=false` | raw `text/plain`; read capped (largest seen 20 MB) |
| `GET /api/deployments/v1/{id}` | `{ stage:[{name,state}], logs:[{logTime, logLevel, logMessage, stage}] }`, all `info`: a failed build is not findable by level |
| `GET /api/audit/v1/logsByOrg/{org}` | months of change events, for correlation |

## Edge Admin (Edge administration client, GET allowlist only)

`GET https://edge.sitecorecloud.io/api/admin/v1/webhooks`, `/webhooks/{id}`, `/settings`. Nothing else: the same client holds `edge.content:clearall`, so the request layer refuses every other path and every `/content` route. A GET echoes webhook header secrets: report header names only.

## Delivery surface (plain HTTP, unfollowed)

| Probe | Reading |
|---|---|
| `GET /robots.txt`, `/sitemap.xml` | see D2 / D8 |
| `GET /api/editing/config` (no Origin) | 401 secret set · 500 secret unset · 404 no editing routes |
| `POST /api/revalidate` body `x`, no header | 401 secret set · `400 invalid JSON` open · 404 plain template. Never `{}` |
| `GET /<random>` | must be 404 (soft 404 otherwise) |
| `GET /api/layout-debug` | must not be 200 |
