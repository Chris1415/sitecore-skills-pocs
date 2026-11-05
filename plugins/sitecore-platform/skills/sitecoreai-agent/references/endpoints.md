# Agent API — endpoints

Supporting reference for the `sitecoreai-agent` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Endpoints

### Sites
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/sites` | List sites (name, display name, URL). |
| GET | `/api/v1/sites/{siteId}` | Site details (ID, name, root path). |
| GET | `/api/v1/sites/{siteName}/pages` | Pages in a site (optional `language` filter). |
| GET | `/api/v1/sites/site-id-from-item/{itemId}` | Reverse-lookup: which site owns this item. |

### Pages
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/pages/create` | Create a page (template + parent + field values + language). |
| POST | `/api/v1/pages/{pageId}/add-language` | Add a language version to a page. |
| POST | `/api/v1/pages/{pageId}/components` | Add a component to a placeholder (optional relative position). |
| GET | `/api/v1/pages/{pageId}/components` | List components on a page (`language`, `version`). |
| POST | `/api/v1/pages/{pageId}/components/{componentId}/datasource` | Set (or clear) a component's datasource. |
| GET | `/api/v1/pages/search` | **Content-aware** search by title/content. Requires `search_query` + `site_name`. |
| GET | `/api/v1/pages/path-by-url` | Resolve page item path from a live URL (`live_url`, URL-encoded). |
| GET | `/api/v1/pages/{pageId}/screenshot` | Page screenshot (base64). **Query: `version` (integer, REQUIRED) + `width` + `height` + `language`. Response field: `screenshot_base64`.** See "Screenshot endpoint quirks" below. |
| GET | `/api/v1/pages/{pageId}/html` | Page HTML (`language` REQUIRED, optional `version`). |
| GET | `/api/v1/pages/{pageId}/preview-url` | Preview URL (`language`, `version`). |
| GET | `/api/v1/pages/template-by-id` | Template details by ID (`templateId` query, fields + settings). |
| GET | `/api/v1/pages/{pageId}` | Page details (ID, name, path; `language`). |
| GET | `/api/v1/pages/{pageId}/placeholders/{placeholderName}/allowed-components` | Components compatible with a placeholder (`*` for all). |

### Content
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/content/create` | Create a content item (template + name + parent + fields). |
| GET | `/api/v1/content/{itemId}` | Get item by ID (`language`). |
| PUT | `/api/v1/content/{itemId}` | Update fields/language on an item (optional new version). |
| DELETE | `/api/v1/content/{itemId}` | Delete an item (removes **all** language versions). |
| GET | `/api/v1/content?item_path=…` | Get item by path (`failOnNotFound`, `language`). |
| GET | `/api/v1/content/{itemId}/insert-options` | Templates allowed as children. |

### Components
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/components/{componentId}/datasources` | Create a datasource for a component. |
| GET | `/api/v1/components/{componentId}/datasources/search` | Search datasources usable with a component (`term`). |
| GET | `/api/v1/components?site_name=…` | List components available to a site. |
| GET | `/api/v1/components/{componentId}` | Component details (ID, name, datasource options). |

### Assets
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/assets/upload` | Upload an asset (`multipart/form-data`: `file` + `upload_request` JSON). |
| GET | `/api/v1/assets/search` | Search assets (`query`, `type`, `language`). |
| GET | `/api/v1/assets/{assetId}` | Asset details. |
| PUT | `/api/v1/assets/{assetId}` | Update asset metadata (name, alt text, fields, language). |

### Environments
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/environments/languages` | List languages available in the environment. |

### Experiments *(new in v2.0)*
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/experiments/flows` | Create an A/B/n test on a component (variants + goal type + targeted pages). |
| PUT | `/api/v1/experiments/{flowId}` | Update an existing A/B/n test (variants, goal, name, archive). |

### Personalization
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v2/personalization/{pageId}/versions` | **Create a personalization variant** (condition groups + targeting rules). Preferred. |
| GET | `/api/v2/personalization/by-page/{pageId}` | **List variants** for a page. Preferred. |
| PUT | `/api/v1/personalization/{pageId}/versions/{variantId}` | Update a variant (audience name, variant name, targeting rules). |
| GET | `/api/v1/personalization/condition-templates` | List condition templates. |
| GET | `/api/v1/personalization/condition-templates/{template_id}` | Template details + parameter schema. |
| POST | `/api/v1/personalization/{pageId}/versions` | **Deprecated** (removal 2026-08-04) — single-template create. Use the v2 endpoint. |
| GET | `/api/v1/personalization/by-page/{pageId}` | **Deprecated** (removal 2026-08-04) — list variants. Use the v2 endpoint. |
| POST | `/api/v1/personalization/{pageId}/components/{componentId}/hide` | Hide a component on the **default** page variant. Personalization must already exist on the page. *(new 2026-10 sync)* |

### Flow definitions *(new in v2.0 — unifies experiments + personalizations)*
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/flows/by-page/{pageId}` | List flow definitions for a page (A/B/n tests **and** personalizations; `status` filter). Response is a discriminated union on `subtype` (`EXPERIMENT` / `EXPERIENCE`). |
| GET | `/api/v1/flows/{flowId}` | Retrieve one flow definition (same `subtype` union). |
| POST | `/api/v1/flows/{flowId}/variants/reset` | Reset a component: removes an applied COPY / HIDE / SWAP and restores the original. Body names `page_id` + `component_id`; optional `variant_id` (personalization only: omit it to reset the default-variant component). *(new 2026-10 sync)* |
| POST | `/api/v1/flows/{flowId}/variants/{variantId}` | Set up a flow-definition variant (strategy `HIDE`/`SWAP`/`COPY`). |
| GET | `/api/v1/flows/{flowId}/variants/{variantId}` | Variant details (datasource + components). |

### Brand Kits
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/brandkits` | List brand kits in the org. |
| GET | `/api/v1/brandkits/{brandkitId}` | Brand kit with sections + fields. |

### Brand contexts *(new 2026-10 sync)*
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/brand-contexts` | List brand contexts in the org (metadata only, no document content). |
| GET | `/api/v1/brand-contexts/{brandContextId}` | Brand context metadata + its nested folder / file tree index (no content). |
| GET | `/api/v1/brand-contexts/{brandContextId}/items?ids=…` | Batch-fetch 1–50 files / folders by id (comma-separated uuids); files carry Markdown content. A failed item comes back with `fetchStatus: failed` instead of failing the batch. |

### Briefs
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/brief/brief-types` | List brief types (field definitions + metadata). |
| GET | `/api/v1/brief/brief-types/{brief_type_id}` | Brief type by ID. |
| GET | `/api/v1/brief` | **List briefs** (filter `name`/`status`/`creator_id`/`type_id`/`sort_by`). |
| POST | `/api/v1/brief` | Create a brief as draft (type ID + locale + fields). |
| GET | `/api/v1/brief/{brief_id}` | Brief by ID (fields, type ref, metadata). |
| PUT | `/api/v1/brief/{brief_id}` | Partial-update a brief (only supplied fields change). |
| POST | `/api/v1/brief/generate` | Generate brief content (type + brand kit + prompt). Does **not** save. |
| POST | `/api/v1/briefs/generate` | **Deprecated** (removal 2026-09-20) — same shape; use `/api/v1/brief/generate`. |

### Jobs
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/jobs/{jobId}/revert` | Revert all operations linked to a job ID. |
| GET | `/api/v1/jobs/{jobId}` | Job details. |
| GET | `/api/v1/jobs/{jobId}/operations` | Per-operation type + status + timestamps. |

> Note: these are **Agent API jobs** (audit + revert trail for agentic actions). They are distinct from Publishing API jobs.
>
> Job correlation is by the optional **`x-sc-job-id` request header** (present on nearly every operation). Pass a stable ID across a sequence of calls so they share one audit/revert trail.
