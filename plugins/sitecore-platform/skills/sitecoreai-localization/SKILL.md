---
name: sitecoreai-localization
description: "Languages on a SitecoreAI tenant: add a language, enable it per site, create or AI-translate versions, dictionary, fallback, publish per locale, verify on Edge. Use when a site gains a language. Not head-app next-intl."
license: Apache-2.0
compatibility: "SitecoreAI. Authoring GraphQL works with an org automation client; Sites/Pages/Publishing/Agent REST need an environment-scoped client. Marketer MCP for page/content writes. Measured 2026-10-02 on one test environment. scripts/language-census.mjs: Node 18+, no dependencies, read-only."
metadata:
  author: Christian Hahn
  version: "0.1.2"
---

# SitecoreAI localization (CM + Edge)

A language exists at three layers, versions live per item, Edge serves what was published per language, and the head app 404s whatever Edge does not return. This skill orders the CM work and says how to prove each step. The head app (routing.ts, next-intl, `<html lang>`, links) is `content-sdk-app-router-dictionary-and-i18n`.

Tags: **[measured 2026-10-02]** observed on a real tenant; **[probe-gated: X]** unproven, X names the open check.

## 1. Three layers

| Layer | Holds | Write surface |
|---|---|---|
| **Environment** | `/sitecore/system/Languages/<name>` items: `Iso`, `Regional Iso Code`, **`Fallback Language`**, charset/codepage | AGQL `addLanguage` (org client OK); Sites `POST/PATCH/DELETE /api/v1/languages` (env client) |
| **Site** | `supportedLanguages[]` (subset of env) | Sites `PATCH /sites/{id}`; Channels > Localization |
| **Host (Site Grouping)** | `languageSettings{defaultLanguage, languageEmbedding, itemLanguageFallback, fieldLanguageFallback}`, `analyticsIdentifiers[]` | Sites `PATCH /sites/{id}/hosts/{hostId}`; the Site Grouping item |

Read the effective site values with AGQL `site(siteName){ language properties{ key value } }` (`enableItemLanguageFallback`, `enableFieldLanguageFallback`, `languageEmbedding`, `dictionaryDomain`).

**Existence check:** `languageItem(name:"de-DE")` (null when absent). **Not** `language(name:)`: it returns a culture object for any valid name, existing or not [measured].

## 2. New-language runbook

Each step ends with a read-back on an instrument other than the one that wrote.

1. **Add the environment language.** AGQL:
   ```graphql
   mutation { addLanguage(input:{ languageCode:"de", regionCode:"DE", fallbackCode:"en" }){ successful } }
   ```
   Read back `languages{ nodes{ name } }` and `languageItem(name:"de-DE"){ fields(ownFields:true){ nodes{ name value } } }`: expect `Regional Iso Code=de-DE`, `Fallback Language=en` [measured]. Env-wide: every site's language list shows it. **Removing a language deletes its versions everywhere**; treat the add as permanent. Custom cultures: [probe-gated: G15].
2. **Enable it on the site** (`supportedLanguages`) and set the host language settings. Env client or UI [probe-gated: G8].
3. **Assign an analytics identifier for the language on the host**; a new language has none, so personalization and analytics are off for it (`sitecoreai-personalization` R2).
4. **Create versions** (§ 3) or **AI-translate** (§ 6). Compose layout per language: `__Final Renderings` is versioned, so a new version starts with an empty final layout; shared `__Renderings` stays shared.
5. **Version datasources in place** (`update_content(language, createNewVersion:true)` or `addItemVersion` + `updateItem(language)`); never build a parallel `Data/` tree per language.
6. **Dictionary phrases** (§ 5).
7. **Workflow** per language version (shared fields bypass it).
8. **Publish every language once** (§ 7), including `/Dictionary` with subitems or the site root.
9. **Read back per locale on live** with a known-bad locale as control (§ 8), then run the census.
10. **Keep the head app in step:** `check-locale-drift.mjs` in the i18n skill (`routing.locales` must list the language with identical casing).

## 3. Creating language versions: what each surface does

[measured 2026-10-02]

| Call | Result |
|---|---|
| AGQL `addItemVersion(input:{itemId, language:"de-DE"})` | version 1, **every versioned field empty** (standard-value tokens such as `$name` are not re-expanded), `__Final Renderings` empty. The route exists on preview and renders blank |
| MCP `add_language_to_page {pageId, languageRequest:{language}}` | `{success:true}`, same empty version, no version number returned |
| MCP `update_content {itemId, siteName, language:"de-DE", createNewVersion:true, fields}` on an item without de-DE | creates de-DE v1 with only the written fields |
| MCP `update_content` **without `language`** | writes **en** (schema default) — and with `createNewVersion:true` adds **en v2**, not a language version |
| AGQL `updateItem(input:{itemId, language:"de-DE"})` without a de-DE version | error "does not contain version # in 'de-DE' language"; nothing created |
| AGQL `createItem(language:"de-DE")` | item with **no en version** (Edge en → null) |
| Unknown language (`xx-XX`) on `addItemVersion` / `add_language_to_page` | "Value cannot be null. Parameter name: language" |
| Pages `POST /pages/{id}/version {language, site, baseVersion}` | [probe-gated: G7-REST] (copies or empty?) |

Whole-site copy: the SXA **Add Site Language** script copies all items and values from a source language (UI).

## 4. Fallback

| Need | Use | Requires |
|---|---|---|
| Regional variant (en-AU → en) | item-level fallback | `Fallback Language` on the language item, `Enable Item Fallback` on the item or its `__Standard Values`, **the environment patch**, a first publish of each fallback version |
| Template partly translated | field-level fallback | field-definition flag; not on shared, `__Standard Values` or `__` system fields; never combined with item-level on one item |
| Genuinely different content | no fallback | missing version = 404 in the head app (honest) |
| "Show the default language if missing" in the app | not an SDK feature | fallback above, or custom `getPage` retry code |

- **Edge delivery fallback is governed by the environment patch** `ExperienceEdge.EnableItemLanguageFallback` / `EnableFieldLanguageFallback` (both default false, a `/platform` config patch + CM deploy, infra under the repo's change rules). Measured on an environment without it: the de-DE → en rule plus `__Enable item fallback=1` on the item → Edge preview `layout(language:"de-DE")` **null**, and AGQL `fields(withLanguageFallback:true)` empty. Whether the host `itemLanguageFallback` flag alone changes Edge: [probe-gated: G1].
- Rules are applied **at publish time**: publish each fallback version once; after any fallback toggle, republish everything affected [probe-gated: G3 on this platform; documented].
- `__Enable item fallback` is a shared field. Dictionary entries have it on by default in their `__Standard Values` [measured], which still delivers nothing without the env patch [measured].
- Detection in the head app: `layout.sitecore.context.language` / `route.itemLanguage` [probe-gated: G3].

Details: `references/fallback-config.md`.

## 5. Dictionary

- One domain per site: `<site>/Dictionary`, template **Dictionary Domain** `0a2847e6-9885-450b-b61e-f9e6528480ef`; the site property `dictionaryDomain` points at it. Entries: template `6d1cd897-1936-4a3a-a511-289a94c2a7b1`, **Key = Shared**, **Phrase = Unversioned** (one value per language) [measured].
- Write (AGQL): `createItem(input:{name, templateId:"{6D1CD897-…}", parent:<domain id>, language:"en", fields:[{name:"Key",value:"HeaderOpenMenu"},{name:"Phrase",value:"Open menu"}]})`, then `addItemVersion(language:"de-DE")` + `updateItem(language:"de-DE", fields:[{name:"Phrase", value:…}])`. The Key carries over (shared).
- **Edge returns the KEY as the phrase** when the language version is missing, the phrase is empty, or the language is not even an environment language; `total` counts entries regardless of language [measured]. "value === key" is the only untranslated signal.
- Dots in keys are accepted by Edge but next-intl treats them as nesting: keep keys dot-free.
- **Publishing a single entry does not refresh Edge**; publish the `/Dictionary` item with subitems or the site root [documented; probe-gated: H5]. Measured symptom of skipping it: every site on a test environment had a populated dictionary in master and on preview and **`total: 0` on live**.
- Shared dictionaries: `Fallback Domain` on the consuming domain → the shared domain; publish the shared site first [probe-gated: G4].
- Serialization: `/Dictionary` as `ItemAndDescendants`, push Create-only, so content edits are not overwritten.

## 6. AI translation

| Surface | Shape | Works with |
|---|---|---|
| AGQL `translatePage` / `translateItem` / `translateSite` | `{pageId\|itemId\|siteId, sourceLanguage, targetLanguage, translateIfTargetVersionExists: Boolean!, resetWorkflow: Boolean! = false, brandKitId}` (+ `translateDescendants: Boolean!` on item) → `{ job { handle done status{ jobState processed messages exceptions } } }` | org client [measured] |
| Sites `POST /sites/{id}/translate`, Pages `POST /pages/{id}/translate` | `{sourceLanguage, targetLanguage, translationStrategy: AddVersion\|SkipIfExists}` → bare string | env client; return value [probe-gated: G6-REST] |
| Pages / Channels UI | adds "Keep workflow state" (UI-only) | author |

- One target language per call. Poll AGQL with `job(input:{handle})` until `done` (a one-page job finished within 5 s, `processed:1`) [measured].
- Translated [measured]: Single-line, Rich text (markup kept), NavigationTitle, metadata description. Documented list: Single-line, Multi-line, Rich text, General Link text/title, Image alt; versioned or unversioned only; shared fields never. Audit field sharing first (`itemTemplate` → field items `Shared`/`Unversioned`).
- `translateIfTargetVersionExists:false` on a page that already has the version → job finishes with no units processed, no new version (idempotent skip) [measured].
- Unknown target → `SiteManagement:400: Invalid target language name`. Never invent enum values: REST has exactly `AddVersion` and `SkipIfExists`.
- Workflow state of an API translation: [probe-gated: V3]. Cost: AI credits per call; tell the user before bulk runs.

Input types verbatim: `references/agql-language-mutations.md`. Surface/credential map: `references/api-surface.md`.

## 7. Publishing per language

- AGQL: `publishItem(input:{rootItemId, languages:["en","de-DE"], targetDatabases:["experienceedge"], publishItemMode:SMART, publishSubItems:false, publishRelatedItems:false}){ operationId }`; poll `publishingStatus(publishingOperationId){ isDone isFailed state }` [measured].
- Publishing REST: locales go per item **or** in `options.xmc.locales`, never both (400). `options.xmc.site` publishes the whole environment; use item-rooted jobs (`sitecoreai-publishing`).
- **Unpublish one item without touching parents:** set `__Hide version=1` on each language version and publish the item again in those languages → live `layout` null [measured]. Then delete from master.
- **Orphan versions:** versions can exist in a language the environment does not define (serialization pushes them). Preview serves them; live had none [measured]. Adding the language later makes them publishable by the next all-language publish: decide before that publish.

## 8. Read back on Edge

Live is the strict surface; preview is permissive (it serves master, orphan languages included).

```graphql
query($s:String!,$p:String!,$l:String!){ layout(site:$s, routePath:$p, language:$l){ item{ language{ name } url{ path } rendered } } }
```
- Run with the target language (known-good) and an unlisted one such as `fr-FR` (known-bad: null). Edge's `language` argument is case-insensitive [measured]; the head app's is not.
- `url.path` has **no language segment** on live or preview [measured].
- `siteInfo(site).routes(language:$l)` lists the published routes per language; `item(path, language){ languages{ language{ name } } }` lists the languages with a version on that surface (no supported-language list exists on `SiteInfo`).
- Dictionary: `siteInfo(site).dictionary(language:$l, first:$f, after:$a)` with **`first` as a variable**. Live clamps `first > 1000` with a warning; preview errors on it, and preview rejects a literal `first` ≥ 61 as "Query is too complex" [measured].

**Census:**
```bash
node scripts/language-census.mjs --site <Site> --cm https://<cm-host> --env-file .env --cred-prefix <CLIENT_PREFIX> --edge-context-env <CTX_VAR> [--strict] [--json]
node scripts/language-census.mjs --self-test
```
Read-only (every document passes `assertQuery`; a mutation is refused before any request). Reports env languages, site fallback flags, pages / datasources / dictionary entries per language, Edge routes and dictionary per language; findings `orphan-language`, `missing-page-version`, `dict-missing-version`, `dict-empty-phrase`, `edge-route-missing`, `edge-dict-absent`, `edge-dict-untranslated`, `unused-env-language`.

## 9. Traps

| Trap | Effect |
|---|---|
| MCP `delete_content {language:"de-DE"}` | **deletes the whole item, every language** [measured]; Agent `DELETE /content` documents the same. Delete one language with AGQL `deleteItemVersion` |
| MCP `update_content` without `language` | writes en silently [measured]; always pass it |
| MCP `update_fields_on_item` | has no language parameter |
| MCP `create_page` `fields` | `[{"Title":"…"}]`; `{name,value}` objects fail "Cannot find a field with the name name" [measured] |
| `language(name:)` used as an existence check | always non-null for a valid culture |
| New language, no analytics identifier | personalization/analytics off for it |
| `__Final Renderings` versioned | new language starts with an empty layout |
| Shared fields | leak across languages, bypass workflow, are not translated |
| Edge dictionary untranslated | returns the key, never empty |
| Org automation client on Sites/Pages REST | 401 (host-addressed AGQL works) [measured] |
| Sites `GET /api/v1/languages/supported` without a token | not anonymous: 404 "Authorization header is missing" [measured] |

## Stop conditions

- Stop before `deleteLanguage`: it removes every version in that language across the environment.
- Stop before any publish that covers a whole site or `/sitecore/content` in all languages on a shared CM: check for orphan-language versions first (census).
- Stop before the fallback env patch or a host fallback toggle without an explicit ask: both need a full republish of affected content.
- Before the first MCP write of a session, probe the binding (one throwaway item, read back through AGQL and Edge with known-good/known-bad controls, delete).

## References

- `references/agql-language-mutations.md`: introspected input/payload types.
- `references/fallback-config.md`: env patch, host flags, field flags, doc conflicts.
- `references/api-surface.md`: which operation on which API with which credential.
- REST shapes: `sitecoreai-sites`, `sitecoreai-pages`, `sitecoreai-agent`, `sitecoreai-publishing`; GraphQL shapes: `sitecoreai-graphql-schemas`; MCP composition: `sitecoreai-content-composition`.
