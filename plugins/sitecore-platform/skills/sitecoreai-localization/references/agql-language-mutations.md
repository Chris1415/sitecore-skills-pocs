# Authoring GraphQL: language, version, translate and publish types

Introspected live 2026-10-02 (`__type(name:)` on `/sitecore/api/authoring/graphql/v1`, org automation client). `!` = non-null.

## Languages

```graphql
input AddLanguageInput {
  languageCode: String!          # "de"
  regionCode: String             # "DE"  -> item name "de-DE"
  fallbackCode: String           # "en"  -> Fallback Language field
  useSupportedLanguageAsFallback: Boolean
  customCode: String
  name: String
  charset: String  codePage: String  encoding: String  spellChecker: String
  database: String
}
type AddLanguagePayload { successful: Boolean }
input DeleteLanguageInput  { name: String!  database: String }
input DeleteLanguagesInput { names: [String!]!  database: String }
type Language { name: String!  iso: String  displayName: String  englishName: String  nativeName: String  charset: String }
type SupportedLanguage { name: String!  language: String  regionCode: String  customCode: String  charset: String  codePage: String  encoding: String  spellChecker: String }
```

Queries: `languages(first, after, databaseName)`, `language(name!)` (culture lookup, non-null for any valid name), `languageItem(name!, databaseName)` → `Item` or null (existence check), `fallbackLanguage(name!, databaseName)` → `Language` or null, `supportedLanguages(first, after)` (.NET culture catalogue).

Measured: `addLanguage({languageCode:"de", regionCode:"DE", fallbackCode:"en"})` created `/sitecore/system/Languages/de-DE` with `Iso=de`, `Regional Iso Code=de-DE`, `Fallback Language=en`, `Charset=iso-8859-1`, `Code page=65001`, `Encoding=utf-8`, `Dictionary=de-DE.tdf`.

## Versions

```graphql
input AddItemVersionInput    { itemId: ID  path: String  language: String  version: Int  versionName: String  database: String }
input DeleteItemVersionInput { itemId: ID  path: String  language: String  version: Int  database: String }
type AddItemVersionPayload    { item: Item }
type DeleteItemVersionPayload { item: Item }   # item is null after a delete
```

`Item.versions(allLanguages: true){ language{ name } version }` lists every version. Read a language with `item(where:{itemId, language:"de-DE"})`; `version` is 0 when that language has no version. `fields(withLanguageFallback: Boolean!)` is mandatory on the `fields` connection.

## Translation

```graphql
input TranslatePageInput {
  pageId: ID!
  sourceLanguage: String
  targetLanguage: String
  translateIfTargetVersionExists: Boolean!
  resetWorkflow: Boolean! = false
  brandKitId: String
  database: String
}
input TranslateItemInput { itemId: ID!  translateDescendants: Boolean!  # + the TranslatePageInput fields except pageId
}
input TranslateSiteInput { siteId: ID!  # + the TranslatePageInput fields except pageId
}
type TranslatePagePayload { job: Job }   # same for Item / Site
type Job { handle: String!  name: String  displayName: String  done: Boolean!  queueTime: DateTime!  status: JobStatus  options: JobOptions  metadata: [KeyValuePair] }
type JobStatus { jobState: JobState!  processed: Long!  total: Long!  messages: [String]  exceptions: [String]  expiry: DateTime! }
enum JobState { INITIALIZING QUEUED RUNNING ABORTREQUESTED ABORTED FINISHED UNKNOWN }
```

Poll: `job(input:{ handle: $h }){ done status{ jobState processed messages exceptions } }` (`JobQueryInput{handle, jobName}`).

Measured: handle format `"<guid>;<cm-pod-name>"`; a one-page translation finished within 5 s with `processed:1, total:-1` and messages "Job started … / Job ended … (units processed: 1)". A repeat with `translateIfTargetVersionExists:false` ended without "units processed". Unknown target → `SiteManagement:400: Invalid target language name 'xx-XX'`.

There is **no** `translationStrategy` on the AGQL inputs (that is the REST shape).

## Publishing

```graphql
input PublishItemInput {
  rootItemId: ID  rootItemIds: [ID]  rootItemPath: String  rootItemPaths: [String]
  languages: [String!]!
  targetDatabases: [String!]!          # ["experienceedge"]
  publishItemMode: PublishItemMode!    # FULL | SMART
  publishSubItems: Boolean  publishRelatedItems: Boolean
  sourceDatabase: String  displayName: String
}
input PublishLanguageSpecificItemsInput {
  itemsToPublish: [ItemToPublishInput]  # { id: ID, languages: [String!]! }
  publishItemMode: PublishItemMode!  targetDatabases: [String!]!
  publishSubItems: Boolean  publishRelatedItems: Boolean  sourceDatabase: String  displayName: String
}
type PublishItemPayload { operationId: String }
type PublishingStatus { isDone: Boolean  isFailed: Boolean  processed: Long  state: PublishingOperationState  languages: Language  targetDatabase: Database }
```

Measured: one item, `["en","de-DE"]`, SMART, no subitems → FINISHED, `processed: 4`; live route present in both languages on the next read.
