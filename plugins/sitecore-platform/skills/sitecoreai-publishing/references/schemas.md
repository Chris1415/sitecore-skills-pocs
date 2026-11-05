# Publishing API — request & response schemas

Supporting reference for the `sitecoreai-publishing` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Request & response schemas

### Create-job request body — `CreateJobRequest`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string (≤256) | ✅ | Job name. |
| `source` | string (≤256) | ✅ | Application name (e.g. `Pages`, `Sites`); later filterable via `?source=`. |
| `options` | `PublishOptionsModel` | ✅ | The publish target (see below). |
| `description` | string (≤256), nullable | — | Optional job description. |

`PublishOptionsModel`:
- `items` — array of `ItemModel` (`{ id (≤50), type (≤256, e.g. Page/Site/Item), locale? (≤20, `xx`/`xx-YY` or `*`) }`). Root items to publish from.
- `xmc` — `XmcPublishingModel`:
  - `locales` — string[] (≤256). **Required for a site publish** (`xmc.site` set); optional for an items publish.
  - `site` — `SiteOptionsModel` → `{ mode: "Republish" | "Incremental" | "Smart" }` (required `mode`).
  - `items` — `ItemsOptionsModel` → `{ mode: "Republish" | "Smart" (required), publishRelatedItems?: bool (default false), publishChildren?: bool (default false) }`.

> Note: `xmc.site` and `xmc.items` are mutually exclusive shapes of the same publish. `site.mode` allows `Incremental`; `items.mode` does **not** (only `Republish` | `Smart`). This reinforces the curated "Create-job request body" trap below — the body is **nested**.

### Job-detail / create response — `PublishJobResponse`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Job ID (e.g. `job_41B25`). |
| `name` | string | |
| `description` | string, nullable | |
| `source` | string | |
| `options` | `ResponsePublishOptionsModel` | `{ xmc: oneOf(Items, Site) }` — **normalized read-back shape**, not the create shape. |
| `statistics` | `JobStatistics` | `{ lastReportTime, itemsSent, itemsProcessed, itemsFailed, xmc: { additionalItemsSent, itemsAcknowledged, itemsDeleted, itemsSkipped, itemsSendingComplete } }`. |
| `system` | `SystemData` | `{ organizationId, tenantId (uuid), tenantJobId, status (enum), queuedTime, startTime, finishTime, createdBy: User, canceledBy: User }`. **Status lives here at `system.status`.** |
| `permissions` | `PublishingJobPermissions` | `{ canViewDetails, canCancel }`. |

**Status enum** (`system.status`): `Queued` · `Running` · `Completed` · `Failed` · `Canceled` · `Canceling`.

### Other responses

- **`GET /jobs`** → `oneOf` `OffsetPagingPublishJobsResponse` (`{ totalCount, pageNumber, pageSize, data[] }`) or `CheckpointPagingPublishJobsResponse` (`{ next, data[] }`).
- **`GET /jobs/summary`** → `PublishJobsSummaryResponse` → `{ counts: { queued, running, canceled, failed, completed, canceling } }` (all int32, all required).
- **`GET /jobs/filters`** → `PublishJobFiltersResponse` → `{ statuses[], sources[], createdBy[] }` (each a `{ data: ... }` wrapper).
- **`GET /jobs/permissions`** → `UserPermissions` → `{ canReadAll, canReadOwn, canViewDetailsOfAll, canViewDetailsOfOwn, canCreate }`.
