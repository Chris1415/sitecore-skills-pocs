# Language operations by API and credential

Org client = an organization-level automation client (Deploy API + host-addressed Authoring GraphQL). Env client = an environment-scoped automation client (Sites, Pages, Publishing, Agent). Re-measured 2026-10-02: org client → Sites REST 401.

| Operation | Authoring GraphQL (org client) | REST (env client) | Marketer MCP |
|---|---|---|---|
| List env languages | `languages` | Sites `GET /api/v1/languages`; Agent `GET /environments/languages` | `get_all_languages` |
| Supported culture list | `supportedLanguages` | Sites `GET /api/v1/languages/supported` (needs a token) | — |
| Add / edit / delete env language | `addLanguage`, `deleteLanguage(s)`; edit via `updateItem` on the language item | Sites `POST /languages`, `PATCH /languages/{regionalIsoCode}`, `DELETE` | — |
| Enable on site | — (site item) | Sites `PATCH /sites/{id}` `supportedLanguages[]` | — |
| Host language settings | `updateItem` on the Site Grouping item | Sites `PATCH /sites/{id}/hosts/{hostId}` `languageSettings` | — |
| Page language version | `addItemVersion` | Pages `POST /pages/{id}/version` → int; Agent `POST /pages/{id}/add-language` | `add_language_to_page` |
| Datasource language version | `addItemVersion` + `updateItem(language)` | Agent `PUT /content/{id}` `language`, `createNewVersion` | `update_content(language, createNewVersion)` |
| Delete one language version | `deleteItemVersion` | Pages `DELETE /pages/{id}/versions/{n}/{language}` | **none** (`delete_content` removes the whole item) |
| AI translate | `translatePage/Item/Site` → `Job` | Sites/Pages `POST …/translate` → string | none |
| Dictionary entry | `createItem` / `updateItem(language)` | Agent `POST /content` | `create_content_item` / `update_content(language)` |
| Publish per language | `publishItem(languages)`, `publishLanguageSpecificItems` | Publishing `POST /jobs` (locales in one place) | none |
| Localization statistics | — | Sites `GET /sites/{id}/statistics/localization` (503 when search is down) | — |
| Delivery read-back | — | Edge GraphQL (public context id): `layout`, `routes`, `dictionary`, `item.languages` | — |

Shapes: `sitecoreai-sites`, `sitecoreai-pages`, `sitecoreai-agent`, `sitecoreai-publishing`, `sitecoreai-graphql-schemas`, `agql-language-mutations.md`.
