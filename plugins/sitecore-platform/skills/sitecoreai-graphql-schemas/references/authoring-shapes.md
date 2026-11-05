# 1. Authoring schema — verified shapes

Supporting reference for the `sitecoreai-graphql-schemas` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance; the heading is kept so `SKILL.md` cross-references still resolve here.

## 1. Authoring schema — verified shapes

**316 types total in this tenant.** Distilled subset of the 37 types most relevant to content reads/writes lives at `references/authoring-types.json`. Re-introspect via `references/introspection-query.graphql` if you suspect drift.

### 1.1 Root `Query` (selected — most common)

| Query | Args | Returns | Notes |
|---|---|---|---|
| `item(where: ItemQueryInput)` | `where` is an input object | `Item` (or null) | **The version, language, path/itemId all go INSIDE `where`.** Not as separate args. |
| `itemTemplate(where: ItemTemplateQueryInput)` | `where: { templateId?, path?, contextItemId?, database? }` | `ItemTemplate` | Used for field-type metadata. |
| `itemTemplates(where, after, before, first, last)` | Connection-paginated | `ItemTemplateConnection` | List templates. |
| `mediaItem(where: MediaItemQueryInput!)` | Mandatory `where` | `MediaItem` | Media-item-specific lookup. |
| `search(query: SearchQueryInput!)` | Full-text + facet search | `SearchResults` | Has `latestVersionOnly` and `paging`. |
| `availableRenderings(where: GetRenderingsInput)` | | `[RenderingItem]` | Layout-design renderings list. |
| `renderings(where: GetRenderingsInput)` | | `[RenderingItem]` | All renderings. |
| `pageDesigns(where: DefaultPresentationInput)` | | `[Item]` | Page Builder design tree. |
| `partialDesigns(where: DefaultPresentationInput)` | | `[Item]` | Partial designs. |
| `site(siteName: String!)` | | `Site` | Site config. |
| `sites(includeSystemSites)` | | `[Site!]!` | All sites. |
| `language(name: String!)` | | `Language` | One language. |
| `languages(after, before, databaseName, first, last)` | | `LanguageConnection` | All languages. |
| `currentUser` | | `User!` | The session's user. |
| `databases` | | `DatabaseConnection` | Master/web/etc. |
| `domains` | | `DomainConnection` | Auth domains. |
| `archivedItem(where)` / `archivedItems(archiveName, ...)` | | | Archive access. |
| `publishingStatus(publishingOperationId)` | | `PublishingStatus` | After `publishItem`. |
| `publishingTargets` | | `[Database!]!` | Where to publish. |
| `meta` | | `MetaInfo` | Server meta. |

### 1.2 `ItemQueryInput` (the key one)

```graphql
input ItemQueryInput {
  database: String
  existingVersionOnly: Boolean
  itemId: ID
  language: String
  path: String
  requirePresentation: Boolean
  version: Int          # ← version is here, on the where input
}
```

`Query.item(where: { path, language, version })` is how you fetch a specific item version. Either `path` OR `itemId` is required.

### 1.3 `Item` — every authoring item

```graphql
type Item {
  itemId(format: IdFormat): ID!     # IdFormat enum: N | D | B | P
  name: String!
  displayName: String
  path: String!
  database: String!
  language: Language!
  version: Int!                     # the version this query resolved to
  versionName: String               # optional editor-supplied name
  versions(allLanguages: Boolean!): [Item!]!  # ← all versions of THIS item; one Item per version
  itemUri: String!
  template: ItemTemplate!
  parent: Item
  children(after, before, excludeTemplateIDs, first, hasVersionInLanguages, includeHiddenItems, includeTemplateIDs, last, requirePresentation): ItemConnection
  ancestors: [Item!]!
  hasChildren(...): Boolean!
  hasPresentation: Boolean!
  isFallback: Boolean!
  fields(after, before, excludeStandardFields: Boolean!, first, last, ownFields: Boolean!, withLanguageFallback: Boolean!): ItemFieldConnection
  field(name: String!): ItemField
  insertOptions: [ItemTemplate!]!
  url(options: ItemUrlOptionsInput): String!
  thumbnailUrl(options: MediaUrlOptionsInput): String
  icon(size: IconSize): Url
  access(username: String): ItemAccess
  lock(username: String): ItemLock
  publish: ItemPublish!
  workflow: ItemWorkflow
}
```

**Critical version semantics:**

- `Item.version` is `Int!` (Authoring uses integers; Edge uses `String` — see § 2).
- `Item.versions(allLanguages: false)` returns one `Item` per version of the same item. Each element has its own `version`, `fields`, etc. — useful for trail / diff use cases.
- `excludeStandardFields: true` and `ownFields: false` and `withLanguageFallback: false` are MANDATORY args on `fields()` — the connection has **no defaults**. Picking these is part of the query.

### 1.4 `ItemField`

```graphql
type ItemField {
  fieldId(format: IdFormat): ID!
  name: String!
  label: String!
  value: String!                       # always String even for non-text fields (image XML, link XML, etc.)
  containsFallbackValue: Boolean!
  containsInheritedValue: Boolean!
  containsStandardValue: Boolean!
  templateField: ItemTemplateField!    # ← the field-type lives here
  validation(modes: [String]): [ItemFieldValidation!]!
  access(userName: String): ItemFieldAccess!
}
```

Field-type discovery: walk `ItemField.templateField.type` (returns a `String!` like `"Single-Line Text"`, `"Rich Text"`, `"Image"`, `"General Link"`, `"Multilist"`, `"Droplink"`, etc.) or `templateField.typeKey` (the lower-case slug like `"text"`, `"rich text"`, `"image"`, `"general link"`).

### 1.5 `ItemTemplateField`

```graphql
type ItemTemplateField {
  templateFieldId(format: IdFormat): ID!
  name: String!
  key: String!
  type: String!         # ← human-readable type name
  typeKey: String!      # ← slug
  source: String        # for Multilist / Droplink — the data source query
  defaultValue: String
  versioning: FieldVersioning!     # VERSIONED | UNVERSIONED | SHARED
  section: ItemTemplateSection!
  sortOrder: Int
  blob: Boolean!
  validation: String
  validationText(language: String!): String
  title(language: String!): String
  description(language: String!): String
  shortDescription(language: String!): String
  toolTip(language: String!): String
  helpLink: String
  icon: String
  style: String
  excludeFromTextSearch: Boolean
  ignoreDictionaryTranslations: Boolean!
  sharedLanguageFallbackEnabled: Boolean!
  dataSource: ItemTemplateFieldSource
}
```

### 1.6 `ItemFieldConnection` and friends

Sitecore Authoring uses **Relay-style cursor connections** for paginated lists.

```graphql
type ItemFieldConnection {
  edges: [ItemFieldEdge!]
  nodes: [ItemField]
  pageInfo: PageInfo!
}

type ItemFieldEdge { cursor: String! node: ItemField }
type PageInfo { hasNextPage: Boolean! hasPreviousPage: Boolean! startCursor: String endCursor: String }
```

Use `nodes` for direct access (skip the edges/cursor unless you need pagination).

### 1.7 Mutation surface (selected)

The Authoring schema's `Mutation` type has 60+ entries. Highlights:

| Mutation | Input | Returns | Purpose |
|---|---|---|---|
| `createItem(input: CreateItemInput!)` | `{ name, language, templateId, parent, fields, ...}` | `CreateItemPayload` | New item under a parent. |
| `updateItem(input: UpdateItemInput!)` | `{ path/itemId, language, version, fields: [FieldValueInput] }` | `UpdateItemPayload` | Edit field values. |
| `addItemVersion(input: AddItemVersionInput!)` | `{ path/itemId, language, version (source), versionName }` | `AddItemVersionPayload` | Add a version. A **new language** version is created **EMPTY** (every versioned field blank, `__Final Renderings` empty; measured 2026-10-02), not a copy. |
| `deleteItemVersion(input)` | | `DeleteItemVersionPayload` | Remove specific version. |
| `archiveVersion(input)` / `restoreArchivedVersion(input)` | | | Archive lifecycle. |
| `copyItem(input)` / `moveItem(input)` / `renameItem(input)` / `deleteItem(input)` | | | Tree manipulation. |
| `publishItem(input: PublishItemInput!)` | `{ rootItemId/Ids, languages: [String!]!, sourceDatabase, targetDatabases: [String!]!, publishItemMode!, publishSubItems?, publishRelatedItems? }` | `PublishItemPayload` | Publish to Edge. Has `displayName` for the publishing job. |
| `publishSite(input)` / `publishWithOptions(input)` / `publishLanguageSpecificItems(input)` | | | Higher-level publishing. |
| `cancelPublishing(publishingOperationId)` | | `CancelPublishingPayload` | Cancel job. |
| `createSite(input)` / `removeSite(input)` / `cloneSite(input)` / `renameSite(input)` | | | Site management. |
| `addLanguage(input)` / `deleteLanguage(input)` | | | Language management. |
| `createUser(input)` / `updateUser(input)` / `deleteUser(input)` / `enableUser` / `disableUser` / `unlockUser` / `changeUserPassword` | | | User mgmt. |
| `createRole(input)` / `deleteRole(input)` / `addAccountsToRole(input)` / `deleteAccountsFromRole(input)` / `addRoleToRoles(input)` / `deleteRoleFromRoles(input)` | | | Role mgmt. |
| `createItemTemplate(input)` / `updateItemTemplate(input)` / `deleteItemTemplate(input)` | | | Template authoring. |
| `executeWorkflowCommand(input)` / `startWorkflow(input)` | | | Workflow. |
| `translateItem(input)` / `translatePage(input)` / `translateSite(input)` | | | i18n. |
| `uploadMedia(input: UploadMediaInput!)` | | `UploadMediaPayload` | Upload media — **2-step**: returns a `presignedUploadUrl`, then POST the binary. See `references/worked-examples.md` § 6b. |
| `populateManagedSchema(input)` / `rebuildIndexes(input)` / `rebuildLinkDatabase(input)` / `cleanUpDatabases(input)` | | | Maintenance. |

**Pattern:** every input is named `<Verb><Noun>Input` (e.g. `UpdateItemInput`); every payload is `<Verb><Noun>Payload`. Inputs always go in `input:`; the SDK call is `client.mutate('xmc.authoring.graphql', { body: { query, variables } })` — the GraphQL goes in `body.query`.

### 1.8 Language, translate, job and language-publish inputs (introspected 2026-10-02)

```graphql
input AddLanguageInput { languageCode: String!  regionCode: String  fallbackCode: String  customCode: String
  useSupportedLanguageAsFallback: Boolean  name: String  charset: String  codePage: String  encoding: String  spellChecker: String  database: String }
input DeleteLanguageInput  { name: String!  database: String }
input DeleteLanguagesInput { names: [String!]!  database: String }
input TranslatePageInput { pageId: ID!  sourceLanguage: String  targetLanguage: String
  translateIfTargetVersionExists: Boolean!  resetWorkflow: Boolean! = false  brandKitId: String  database: String }
input TranslateItemInput { itemId: ID!  translateDescendants: Boolean!  # + the TranslatePageInput fields except pageId
}
input TranslateSiteInput { siteId: ID!  # + the TranslatePageInput fields except pageId
}
type TranslatePagePayload { job: Job }            # same for Item / Site
type Job { handle: String!  name: String  done: Boolean!  status: JobStatus }
type JobStatus { jobState: JobState!  processed: Long!  total: Long!  messages: [String]  exceptions: [String] }
enum JobState { INITIALIZING QUEUED RUNNING ABORTREQUESTED ABORTED FINISHED UNKNOWN }
input PublishLanguageSpecificItemsInput { itemsToPublish: [ItemToPublishInput]   # { id: ID, languages: [String!]! }
  publishItemMode: PublishItemMode!  targetDatabases: [String!]!  publishSubItems: Boolean  publishRelatedItems: Boolean }
type PublishingStatus { isDone: Boolean  isFailed: Boolean  processed: Long  state: PublishingOperationState }
```

- Poll a translation with `job(input:{ handle })`; the handle is `"<guid>;<cm-pod>"`. There is **no** `translationStrategy` here (that is the REST shape).
- **`language(name:)` is a culture lookup:** non-null for any valid culture, including one the environment does not define. Use `languageItem(name:)` (null when absent) as the existence check.
- Full measured notes: `sitecoreai-localization/references/agql-language-mutations.md`.
