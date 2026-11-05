# Sites API — request & response schemas

Supporting reference for the `sitecoreai-sites` skill, regenerated from the OpenAPI spec named in `SKILL.md` frontmatter (`metadata.source_spec`). Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the spec's 5,000-token guidance; loaded on demand.

## Request & response schemas

Field names and types are taken verbatim from `components.schemas`. Required fields are marked **(req)**. Site / collection / host **name** fields share one validation pattern: `^(?![\s-])[a-zA-Z0-9_\s-]*(?<!\s)$` (no leading/trailing space, no leading dash, Latin alphanumeric + spaces + dashes + underscore).

### Create a site — `NewSiteInput` (POST `/sites`)
- `siteName` **(req)** string, max 100, name-pattern.
- `templateId` **(req)** string — from `GET /sites/templates`.
- `language` **(req)** string — primary ISO language (e.g. `en`).
- `displayName` string (nullable); `description` string ≤200 (nullable).
- `collectionId` string (GUID/22-char pattern) — supply this **or** `collectionName`. If `collectionName` is given without `collectionId`, a new collection is created. If both are present, `collectionName` is ignored.
- `collectionName` / `collectionDisplayName` / `collectionDescription` string (nullable) — used only when creating a new collection inline.
- `languages` string[] (nullable) — additional supported languages.
- `hostName` string (nullable, default `*`); `posMappings` `AnalyticsIdentifier[]` (nullable).
- **Returns** `JobResponse { handle }` — site provisioning is async.

### Create a collection — `CreateSiteCollectionInput` (POST `/collections`)
- `name` **(req)** string, max 100, name-pattern; `displayName` ≤100 (nullable); `description` ≤200 (nullable). **Returns** `JobResponse { handle }`.

### Create a host — `CreateHostInput` (POST `/sites/{siteId}/hosts`)
- `name` **(req)** string, max 100, name-pattern.
- `hostnames` string[] (nullable); `targetHostname` string (nullable); `homePageId` string (GUID pattern, nullable).
- `renderingHost` string (nullable, **deprecated**) / `editingHost` string (nullable).
- `analyticsIdentifiers` `AnalyticsIdentifier[]` = `[{ name, language }]` on write (nullable); the `Host` read returns it as a `{ "<lang>": "<name>" }` map; assigns existing identifiers only (SKILL.md § Pitfalls); `settings` map<string,string> (nullable); `thumbnail` string (nullable).
- `languageSettings` `SiteLanguageSettings { defaultLanguage, languageEmbedding, itemLanguageFallback, fieldLanguageFallback }`.
- **Returns** `Host` (201).

### Add a language — `AddLanguageModel` (POST `/languages`)
- `languageCode` **(req)** string (ISO, e.g. `en`).
- Optional (all nullable): `regionCode`, `customCode`, `name`, `charset`, `codePage`, `database`, `encoding`, `fallbackLanguage`, `spellChecker`. **Returns** `Language`.

### Update a language — `EditLanguageInput` (PATCH `/languages/{isoCode}`)
- All nullable: `languageCode`, `regionCode`, `fallbackLanguageIso`, `baseIsoCultureCode`, `fallbackRegionDisplayName`. Returns 204.

### Update a site — `UpdateSiteInput` (PATCH `/sites/{siteId}`)
- All optional/nullable: `displayName` ≤100, `description` ≤200, `supportedLanguages` string[], `shared` bool, `errorPages` `{ errorPage, notFoundPage }` (page IDs), `sortOrder` int, `targetHostname` string (**deprecated**), `brandKitId` string, `resetThumbnail` bool, `editorProfiles` string[] (profile IDs). **Returns** `Site`.

### Translate a site — `TranslateSiteInput` (POST `/sites/{siteId}/translate`)
- `sourceLanguage` **(req)**, `targetLanguage` **(req)**, `translationStrategy` **(req)** enum `AddVersion | SkipIfExists`. **Returns** a string (job/stream identifier).

### Copy a site — `CopySiteInput` (POST `/sites/{siteId}/copy`)
- `name` **(req)** string, max 100, name-pattern; `displayName` ≤100 (nullable); `description` ≤200 (nullable); `posMappings` `AnalyticsIdentifier[]` (nullable). **Returns** `JobResponse { handle }`.

### Rename — `RenameSiteInput` / `RenameSiteCollectionInput`
- Site: `name` **(req)** max **50**, name-pattern. Collection: `systemName` **(req)** max 100, name-pattern. Both **return** `JobResponse { handle }`.

### Sitemap — `UpdateSitemapConfigurationInput` (PATCH `/sites/{siteId}/configuration/sitemap`)
- `id` **(req)** string (GUID pattern); `enabled` bool, `maxNumberOfPages` string, plus nested `alternateLinksOptions { enabled, includeXDefault }`, `urlOptions { includeChangeFreq, includeLastMod, includePriority }`, `cacheOptions { refreshThreshold }`. **Returns** `SitemapConfiguration`.

### Validate name — `ValidateSiteNameInput` / `ValidateCollectionNameInput`
- `name` string (nullable). **Returns** `NameValidationResult { isValid: bool, message: string }`.

### Detach analytics — `DetachFromSitesInput`
- `sitesIdentifiers` **(req)** string[]. **Returns** boolean (or 202 Accepted).

### Sort — `SortSitesInput` / `SortCollectionsInput`
- `{ sites: map<id,int32> }` / `{ collections: map<id,int32> }`. Lower value = higher in UI. Returns 204.

### Favorites inputs
- `AddFavoriteSiteInput { favoriteSiteId (req) }`; `AddFavoriteSiteTemplateInput { favoriteSiteTemplateId (req) }`.

### Editor profile — `CreateEditorProfileInput` / `UpdateEditorProfileInput`
- Create: `name` **(req)**, `value` **(req)** (toolbar JSON config string). Update: `name`, `profile` (both nullable). Response model `EditorProfileModel { id, name, profile }`.

### Primary response shapes
- **`Site`** — `id, name, description, displayName, thumbnail{url,rootPath,autogenerated}, collectionId, created, createdBy, sortOrder, brandKitId, permissions, languages[], hosts[], supportedLanguages[], errorPages, errorPagesConfiguration, settings (map), properties (read-only map; e.g. `IsSxaSite`)`.
- **`SiteCollection`** — `id, name, description, displayName, sortOrder, createdBy, created, permissions, settings (map; e.g. `itemPath`)`.
- **`Host`** — `id, name, hostnames[], targetHostname, homePageId, renderingHost (deprecated), editingHost, permissions, settings (map), properties (read-only map; `siteDefinitionID`, `startItem`), analyticsIdentifiers, languageSettings, created, createdBy`.
- **`Language`** — `id, iso, regionalIsoCode, fallbackLanguageIso, name, displayName, nativeName, englishName, baseIsoCultureCode, fallbackRegionDisplayName, permissions`. **`SupportedLanguage`** — `name, englishName, displayName, charSet, codePage, encoding, languageCode, regionCode`.
- **`PageResponse`** — `id, name, displayName, language, version, templateId, parentId, path, route, hasVersions, hasChildren, hasPresentation, isLatestPublishableVersion, insertOptions[] (PageInsertOption{ id, displayName, templateType: ItemTemplate|BranchTemplate }), children[], permissions, locking{ canUnlock, isLocked, lockedBy, lockedByCurrentUser }`. **`PageHierarchy`** wraps `page` + `children[]` + `ancestors[]` + `siblings[]`.
- **`Job`** — `name, queueTime, endTime, handle, site, siteCollection, status (enum Queued|Running|Completed|Failed), jobType, statistics{ itemsProcessed, pagesProcessed }, done (deprecated)`. **`JobResponse`** — `{ handle }`.
- **`SiteTemplate`** — `id, name, enabled, description, contents[], createdBy, updatedOn, thumbnail, image, metadata (map)`.
- **`LocalizationStatistics`** — `locales[] (LocaleStatistics{ data{ displayName, englishName, locale }, pageCount }), totalPageCount`. **`WorkflowsStatistics`** — `workflows[] (WorkflowStatistics{ name, states[] (WorkflowStateStatistics{ name, pageCount }) })`.
- **`UploadMediaOutput`** — `id, name, itemPath, url`.
- **`Permissions`** — `canAdmin, canWrite, canCreate, canDelete, canRename, canRead, canPublish, canDuplicate, canWriteLanguage` (all bool). Present on Site / SiteCollection / Host / Language / PageResponse / SitemapConfiguration.

Full nested detail: the OpenAPI bundle — `api-docs.sitecore.com/_bundle/sai/sites-api/index.yaml`.
