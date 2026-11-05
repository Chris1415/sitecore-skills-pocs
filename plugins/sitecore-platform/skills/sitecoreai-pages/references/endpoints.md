# Pages API — endpoints

Supporting reference for the `sitecoreai-pages` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Endpoints

All operations are tagged `Pages` except the two `Aggregation`-tagged batch endpoints. Most endpoints take an optional `environmentId` query param (defaults to `main`).

### Pages
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/pages` | Create a page (`CreatePage`). |
| GET | `/api/v1/pages/{pageId}` | Retrieve a page incl. stats, template, layout, publishing, workflow (`RetrievePage`). |
| PATCH | `/api/v1/pages/{pageId}` | Update values of existing fields (`UpdateFields`). |
| DELETE | `/api/v1/pages/{pageId}` | Delete a page (`DeletePage`). |
| GET | `/api/v1/pages/{pageId}/state` | Basic state — id, display name, revision; optionally workflow/versions/layout (`RetrievePageState`). |
| GET | `/api/v1/pages/search` | **Name / display-name** search with filters (`Search`). Use Agent API `/pages/search` for content-aware search. |
| GET | `/api/v1/pages/{pageId}/insertoptions` | Templates allowed as children (Page or Folder) (`RetrieveInsertOptions`). |
| POST | `/api/v1/pages/{pageId}/duplicate` | Copy a page (`DuplicatePage`). |
| POST | `/api/v1/pages/{pageId}/rename` | Change the system name (`RenamePage`). |
| POST | `/api/v1/pages/blueprint` | Create a page from a blueprint — async, returns a job handle (`CreateBlueprint`). |
| POST | `/api/v1/pages/{pageId}/layout` | Save (replace) layout — components + placements (`SaveLayout`). |
| POST | `/api/v1/pages/{pageId}/fields` | Save page fields (batch field update with revision/validation) (`SaveFields`). |
| POST | `/api/v1/pages/{pageId}/translate` | Create a translated version via the Stream API (`TranslatePage`). |

### Versions
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/pages/{pageId}/versions` | List versions (`RetrievePageVersions`). |
| POST | `/api/v1/pages/{pageId}/versions` | Add a new version (`AddPageVersions`). |
| POST | `/api/v1/pages/{pageId}/version` | Add a page version — alternative singular route (`AddPageVersion`). |
| DELETE | `/api/v1/pages/{pageId}/versions/{versionNumber}/{language}` | Delete a specific version for a language (`DeletePageVersions`). |

### Live / Variants
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/pages/{pageId}/live` | Check if the page is published to Edge (`GetLivePageState`). |
| GET | `/api/v1/pages/{pageId}/live/variants` | List currently-active personalization variant IDs on Edge (`ListPageVariants`). |

### Aggregation (batch)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/aggregation/pages` | Aggregate data about multiple pages and their components (`AggregatePageData`). |
| POST | `/api/v1/aggregation/pages/live/variants` | Aggregate active personalization variants for multiple pages (`AggregateLivePageVariants`). |
