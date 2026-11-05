# Pages API — request & response schemas

Supporting reference for the `sitecoreai-pages` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Request & response schemas

Field names + types below; `*` marks required. Link to the bundle for full nested detail.

### Create / blueprint
- **`CreatePageInput`** (POST `/pages`) — `parentId*` string, `pageName*` string (system name), `templateId*` string, `language*` string, `displayName?` string. → **`PageOperationResult`** (`pageId`, `name`, `displayName`, `path`).
- **`CreatePageFromBlueprintInput`** (POST `/pages/blueprint`) — `parentId*`, `pageName*`, `blueprintId*`, `language*`, `displayName?`. → **`JobResponse`** (`handle` string) — async job.

### Update fields
- **`UpdatePageInput`** (PATCH `/pages/{pageId}`) — `fields*` array of **`PageField`** (`name`, `value` — raw string value), `versionNumber?` int, `language?` string. → **`PageOperationResult`**.
- **`SavePageFieldsInput`** (POST `/pages/{pageId}/fields`) — `fields*` array of **`PageFieldValue`** (`id`, `value`, `originalValue`, `reset` bool), `language*`, `site*`, `pageVersion?` int, `revision?` string. → **`SavePageResult`** (`errors[]` `SavePageError`, `savedPage` `SavedPage`, `validationErrors[]` `PageValidationError`, `warnings[]`, `newCreatedVersion` `PageVersionInfo`).

### Layout
- **`SavePageLayoutInput`** (POST `/pages/{pageId}/layout`) — `layout*` **`PageLayout`** (`kind`: `LayoutKind` = `Final`|`Shared`; `body` string — serialized devices/renderings JSON), `originalLayout?` `PageLayout`, `language*`, `site*`, `pageVersion?` int, `revision?` string. → **`SavePageResult`**.

### Versions
- **`AddPageVersionInput`** (POST `/versions` and `/version`) — `language?`, `site?`, `baseVersion?` int, `versionName?` string. → `integer` (new version number).
- DELETE `/versions/{versionNumber}/{language}` → `integer`.

### Duplicate / rename
- **`DuplicatePageInput`** — `newName*`, `site*`, `language*`, `displayName?`. → **`PageOperationResult`**.
- **`RenamePageInput`** — `newName*`. → **`PageOperationResult`**.

### Delete
- **`DeletePageInput`** (DELETE `/pages/{pageId}`) — `permanently?` bool (skip recycle bin), `forceDelete?` bool (skip references check). → `boolean`.

### Translate
- **`TranslatePageInput`** (POST `/pages/{pageId}/translate`; query `siteId?`) — `sourceLanguage*`, `targetLanguage*`, `translationStrategy*`: **`TranslationStrategy`** = `AddVersion`|`SkipIfExists`. → `string`.

### Read shapes
- **`Page`** — broad item shape: `id`, `name`, `displayName`, `language`, `version`, `templateId`, `parentId`, `path`, `route`, `url`, `finalLayout`/`sharedLayout` (string), `layoutEditingKind`, `hasPresentation`, `hasChildren`, `isLatestPublishableVersion`, `revision`, `versionName`, audit (`createdAt`/`updatedAt`/`createdBy`/`updatedBy`), plus nested `template` `PageTemplate`, `workflow` `PageWorkflow`, `publishing` `Publishing`, `permissions` `Permissions`, `locking` `PageLocking`.
- **`PageState`** (GET `/state`) — `id`, `displayName`, `revision`, `workflow`, `versions[]` `Page`, `finalLayout`/`sharedLayout`, `layoutEditingKind`.
- **`PagesSearchResult`** (GET `/search`) — `totalCount` int, `results[]` `Page`. Query: `searchText`, `rootIds[]`, `filter` (`TypeFilter` = `Pages`|`Folders`|`All`), `language`, `pageSize`, `pageNumber`, `continuationToken`.
- **`PageInsertOption`** (GET `/insertoptions`) — `id` (template ID), `displayName`, `templateType` (`TemplateType` = `ItemTemplate`|`BranchTemplate`). Query requires `insertOptionKind` (`Page`|`Folder`).
- **`LivePage`** (GET `/live`) — `id`, `name`, `displayName`, `path`, `language`, `version`, `personalization` (`Personalization.variantIds[]`), `url` (`Url`: `hostName`/`path`/`scheme`).
- GET `/live/variants` → `string[]` (variant IDs).

### Aggregation
- Both POST aggregation endpoints take a body of **`PageRequest[]`** (`id*`, `language*`).
- POST `/aggregation/pages` → **`PagesAggregationResponse`** (`pages[]` `PageAggregationResponse`: `id`, `language`, `name`, `displayName`, `components[]` `ComponentAggregationResponse` = `id`/`uid`/`name`/`displayName`).
- POST `/aggregation/pages/live/variants` → **`PageVariantsAggregationResponse`** (`pages[]` `PageVariantsResponse`: `pageId`, `language`, `variantIds[]`).
