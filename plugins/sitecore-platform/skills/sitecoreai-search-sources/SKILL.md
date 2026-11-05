---
name: sitecoreai-search-sources
description: "SitecoreAI integrated search backend: content, site and push sources, searchable and filterable fields, reindex and push limits, per-environment configuration. Use when setting up or feeding a search index. Not head-app search UI or CM Solr."
license: Apache-2.0
compatibility: "SitecoreAI Search experiences (phased rollout, per environment). Query plane: edge-platform.sitecorecloud.io. Config read needs a bearer with a search-config scope (org deploy and Edge admin clients get 403). Push needs an instance-wide Ingestion ApiKey. Scripts: Node 18+, no dependencies."
metadata:
  author: Christian Hahn
  version: "0.1.2"
---

# SitecoreAI search sources (integrated search backend)

A **search source** is the index a SitecoreAI search component queries. It is managed under *Content > Search sources* in the SitecoreAI app, per environment. The head-app half (hooks, `SearchService`, the starter component) is `content-sdk-search`.

Status markers: **[confirmed]** = measured 2026-10-02 (read-only); **[docs]** = documented, not yet measured; **[probe-gated: Pn]** = open, the named hands-on probe closes it.

## The three programmatic surfaces (and what is missing)

| Surface | Endpoint | Credential | Status |
|---|---|---|---|
| Query | `POST https://edge-platform.sitecorecloud.io/v1/search`, `/v1/search/suggest` | Edge context id in `x-sitecore-contextid` (public) | **[confirmed]** reachable; every CM context of a test org was recognised (preview and live) |
| Config read | `GET https://edge-platform.sitecorecloud.io/search/v1/config?sitecoreContextId=<id>` | Bearer with a search-config scope | **[confirmed]** no auth → 401 `Config endpoint requires Authorization`; org automation client (Deploy + `xmcloud.cm:admin`) → **403 `insufficient scopes`**; Edge admin client → 403. Works through the Marketplace SDK (`xmc.search.getConfigs`); which non-Marketplace credential carries the scope **[probe-gated: P3]** |
| Push (Ingestion Service API) | `POST {base_url}/v1/index/{source id}/push` | `Authorization: ApiKey <key>` (instance-wide) | **[docs]**; `{base_url}` host **[probe-gated: P3/P6]** |
| Create / edit / reindex a source | — | — | **No documented API.** UI only, until a network capture proves otherwise **[probe-gated: P3]** |

Not this: Authoring GraphQL `search(query:)`, Edge `search(where:)`, `sitecore index rebuild` and the Indexing Manager all target CM Solr / item search. Standalone Sitecore Search (`discover.sitecorecloud.io`, 52-char API key, `rfk.domainId`) is a different product. The Marketer MCP has no search-source tools (`search_site` etc. search pages and assets).

## Rollout preflight (per environment)

1. **Search sources** appear under *Content > Search sources* in the SitecoreAI app for that environment. The docs flag every page "phased rollout"; push sources appear only in the developer docs, so check push separately **[probe-gated: P2-UI]**.
2. The **Search Configuration Manager** Marketplace app is installed for that environment (it adds the *Search Configuration* tab in Page builder). Scriptable install **[probe-gated: P2-UI]**.
3. The search plane recognises the environment's context id: the probe-search script of `content-sdk-search` (fake-context control → 404 `No sitecore context`; your context + fake index → 404 `no search index found`). A recognised context proves the plane, **not** that the Search sources UI is enabled or that any source exists.
4. A source id exists: from the source's **Settings** tab (field "ID"), or `scripts/search-config.mjs` with a credential that carries the scope.

## Choose the source type

| Content lives in… | Source | Caveat |
|---|---|---|
| Sitecore items of ONE template, simple field types | **Content** | published items only; manual reindex; one template per source (the config API's `templateIds[]` hints at more **[probe-gated: P4]**) |
| Rendered pages, metadata, a non-Sitecore site | **Site** (crawler) | crawler must reach the site; sitemap required; scheduled re-index |
| External system of record, or must be fresh in real time | **Push** | you own the full document set; no history kept |
| Sitecore items that must be fresh on publish | Content source + Edge webhook → push upsert, **replayed after every reindex**; or a push source fed only by the webhook | pushes into a content/site source are temporary |

**Field types.** Content: Checkbox, Text, Rich Text, Single-Line, Multi-Line, Number, Date, Datetime, Image. Site: Boolean, String, Number, Tag. Push: the schema you declare. **Reference fields (Multilist, Droplink, Treelist, General Link) cannot be indexed**; the UI rejects them at configuration time **[docs]**. Denormalise into a text field on the item, or use a push source. A third-party report adds `__Created` / `__Updated` and page components as non-indexable **[probe-gated: P4]**.

## Field flags and the language multiplier

Each field has **Include**, **Searchable**, **Filterable** and **Sortable**. Filterable fields become **facets**, and the head app filters them by the facet's **display name** (`content-sdk-search`). The **Searchable allowance grows with the number of languages** on the source; the cap is unpublished. Plan languages before fields: adding a language later multiplies the cost of every searchable field. Whether languages can be added after creation, how fallback versions index, and the locale format **[probe-gated: P4]**.

Rules: Boost / Bury per keyword or all keywords (higher in the list wins), Pin to a slot; boost/bury override semantic relevancy and pins survive reranking. Advanced: semantic reranking and fuzzy search (fuzzy needs at least one Searchable field; with both on, fuzzy runs only after a zero-result query). Toggling either after creation **[probe-gated: P4]**.

## Setup is UI-only (click paths in `references/source-setup-checklists.md`)

Creating a source, editing fields and rules, reindexing, creating push credentials and mapping a page component to a source all happen in the UI. These are **manual steps for the user**, never something an agent claims to have done. Record the source id the user reports and verify it with a live query.

**Wire a page to a source.** The datasource item's `search` field (type Plugin, Source = Search Configuration Manager) holds `{"searchIndex":"<source id>","fieldsMapping":{…}}`. The supported writer is the *Search Configuration* tab in Page builder. Writing the JSON with the Marketer MCP `update_fields_on_item` is possible in principle; probe the MCP binding first (`sitecoreai-content-composition`). The exact JSON the app writes **[probe-gated: P7]**.

**Environment promotion.** The source id lives in **content** (the datasource JSON). If source ids differ per environment, a serialized or content-transferred datasource points at the wrong index after promotion; re-map per environment or keep the datasource out of shared serialization **[probe-gated: P2-UI]** (whether ids or an export exist per env).

**Multisite.** A content source binds a template environment-wide, and the context id is environment-scoped, not site-scoped: two sites sharing the template share the index unless you filter **[probe-gated: P4]**.

## Freshness: reindex discipline

- **Content sources do not update on publish.** Saving a new source runs the first ingestion; after that, new or changed published items appear only after a manual **Reindex content** **[docs]**. Latency, and whether unpublished items linger until the reindex **[probe-gated: P5]**.
- **A reindex rebuilds and swaps** the index, and a crawl or reindex **replaces** it: documents pushed into a content or site source are **wiped** **[docs; probe-gated: P6]**. There is no push history; replay the full set.
- Publish-driven freshness = Edge **OnUpdate** webhook (`sitecoreai-edge-admin-webhooks`) → handler reads the item from Edge → push `upsert` with `id = item id` → **replay everything after each reindex**. Or make a push source the single system of record.
- Search does not run on Preview or in Page Builder; verify with a live query after publish + reindex.

## Ingestion Service API (push) in one screen

Full contract and the replay algorithm: `references/ingestion-api.md`.

- `POST {base_url}/v1/index/{source id}/push`, `Authorization: ApiKey <key>`. A bearer token fails with `tenant ID not found in JWT claims` **[docs; probe-gated: P6]**.
- Keys: *Search sources > Settings > Create credential* (the docs also name a "Profile import" page: which is real **[probe-gated: P6]**), shown once, **instance-wide** (one key writes every source), Org Owner/Admin only in production. Server-only: never a `NEXT_PUBLIC_` variable; store as `SITECORE_SEARCH_PUSH_APIKEY`.
- Body `{ "operations": [ { "action": "upsert"|"delete", "id" | "sc_url", "canonical_url"?, "locale"?, "fields"? } ] }`: **1-50 operations and ≤ 512 KiB** per request, else the whole request is rejected (413 on size).
- **Every value is a string**; datetimes `YYYYMMDDTHHMMSSZ` (ISO 8601 rejected); field names case-sensitive and must exist in the schema; `sc_*` and `@search.action` reserved.
- **200** all succeeded · **207** partial: walk `results[].succeeded` · 400 / 401 / 403 (`search.pushapi:m`) / 404 (source missing, unpublished, other instance) / 413 / 500 / 503 (ingestion disabled). Rate limits undocumented.
- Writes go straight to the **live** index. There is no dry run on the server: `scripts/search-push.mjs` validates locally and sends only with `--yes`.

## Site sources

Crawler NAT IPs (allowlist these, not the standalone-Search IPs): East US 20.172.208.83 · West Europe 108.143.62.79 · Southeast Asia 137.116.136.218 · Central US 172.202.98.116 · Japan East 20.89.57.44 · Australia East 68.218.91.35 · West US 2 20.69.120.121 · UAE North 20.74.155.9 **[docs]**. The crawler reads the sitemap (`content-sdk-app-router-sitemap-robots`). WAF / bot protection blocks it. Whether it honours `robots.txt`, gets through a private-delivery access gate, and its user-agent **[probe-gated: P9]**: a site with `Disallow: /` or an auth gate should be assumed uncrawlable.

## Analytics

*Performance > Search* (CTR, null searches, ignored searches; 30-min sessions; 2 months back) needs both an index and a search component sending `type:'search'` events. The starter's `nullResults: false` defect and the consent gate are in `content-sdk-search`. Dashboard ingestion **[probe-gated: P7]**.

## Scripts

- `scripts/search-config.mjs --context-env <VAR> [--env-file <f>] (--bearer-env <VAR> | --client-prefix <PREFIX>) [--json] [--datasource <source id>]` — read-only. Fake-context control first; lists sources with id, name, type, template ids and per-field flags (search/filter/facet/sort with display names); explains 401/403. `--datasource` prints a datasource JSON stub for that source.
- `scripts/search-push.mjs --endpoint <base_url> --source <source id> --file <ops.json> [--yes] [--key-env SITECORE_SEARCH_PUSH_APIKEY]` — validates locally (count, size, strings, datetime format, reserved names, identity); **sends only with `--yes`**; refuses without an explicit `--source`, refuses a key on argv, refuses non-HTTPS endpoints; exit 1 on any 207 failure.
- Both: `--self-test` runs a fake-fetch suite plus a mutation sweep that disables each guard in turn and fails if nothing notices.

## Hard rules

1. Never claim a source, reindex or credential was created by an agent: they are UI steps; record what the user reports and verify by query.
2. Never put the push ApiKey in client code, argv, logs or captures.
3. After every reindex of a source that also receives pushes, replay the pushes.
4. Treat 404 `No sitecore context` as "wrong or dead context id", and 404 `no search index found` as "context fine, source id wrong or not yet created".

## Related

`content-sdk-search` · `sitecoreai-edge-admin-webhooks` (OnUpdate feed) · `marketplace-sdk-xmc` (`xmc.search.getConfigs`) · `content-sdk-app-router-sitemap-robots` · `sitecoreai-content-composition` (MCP writes) · `sitecoreai-health-check`.
