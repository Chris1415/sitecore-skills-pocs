# Publishing API — endpoints

Supporting reference for the `sitecoreai-publishing` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Endpoints

| Method | Path | operationId | Purpose |
|---|---|---|---|
| GET | `/authoring/publishing/v1/jobs` | `GetJobs` | List jobs for the tenant. Offset **or** checkpoint pagination; filterable + sortable. |
| POST | `/authoring/publishing/v1/jobs` | `Create` | Create a new publishing job. Returns the created job (`201`). |
| GET | `/authoring/publishing/v1/jobs/{id}` | `GetJob` | Retrieve a single publishing job by ID. |
| POST | `/authoring/publishing/v1/jobs/{jobId}/cancel` | `CancelJob` | Cancel a `Queued`/`Running` job (`202` accepted). |
| GET | `/authoring/publishing/v1/jobs/permissions` | `GetUserPermissions` | Current user's publishing permissions (no scope required). |
| GET | `/authoring/publishing/v1/jobs/filters` | `GetJobsFilters` | Distinct filter values (`source`, `system.createdBy`, `system.status`) for the matched jobs. |
| GET | `/authoring/publishing/v1/jobs/summary` | `GetJobsStatistics` | Aggregate counts (queued / running / completed / failed / canceled / canceling). |

**`GET /jobs` query parameters (from spec):** `pageNumber` (1-based, offset mode — presence selects offset pagination), `pageSize` (1–100, default 50), `x-sc-continuation` (**header**, checkpoint mode), `source` (pipe-delimited), `system.createdBy.id`, `system.createdBy.name`, `system.status` (pipe-delimited enum), `system.queuedTime` / `system.startTime` / `system.finishTime` (`=>DATE` / `=<DATE` only), `sortBy` (`field:1`|`field:-1` over `name`, `source`, `system.status`, `system.queuedTime`, `system.startTime`, `system.finishTime`).
