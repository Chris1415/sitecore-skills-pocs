# Source setup checklists (UI only)

Every step here happens in the SitecoreAI app (*Content > Search sources*) or Page builder, by a human. An agent prepares the inputs, asks the user to click, and verifies the result with a live query. Paths from the user guide (read 2026-10-02); exact labels **[probe-gated: P2-UI]**.

## Before any source

- [ ] Environment is in the rollout: *Content > Search sources* is visible.
- [ ] Search Configuration Manager app installed **for this environment** (Apps / Marketplace). Note its app id; the starter template's Plugin field Source expects `pub-958f3b66-0fb0-4675-8808-a5dc40949051`.
- [ ] Languages decided (the Searchable allowance multiplies by language count).
- [ ] Field plan: which fields Searchable, which Filterable (= facets, named by display name), which Sortable. No reference fields.

## Content source

1. *Search sources* → **Create source** → **Content**.
2. Name (probe sources: `zz-<track>-probe-<yyyymmdd>`), description.
3. **Template**: exactly one content template; published items of that template are ingested.
4. **Languages**.
5. **Fields** tab: Include / Searchable / Filterable / Sortable per field. Note the allowance meter. An unsupported field type raises a validation error.
6. **Advanced settings**: semantic reranking, fuzzy search (decide now; toggling later is unproven).
7. **Save** → first ingestion runs.
8. **Settings** tab: copy the **ID** (the `searchIndexId`).
9. Rules (optional): Boost / Bury (order matters, higher wins), Pin.
10. After later content changes: publish, then **Reindex content** (pushed documents are wiped).

Verify: `probe-search.mjs --index <ID> --expect-results` against the live context.

## Site source

1. **Create source** → **Site**. Start URL(s) and/or sitemap URL; allow / disallow patterns.
2. Extraction: per field by HTML element, meta tag or CSS selector; **Test Extraction** on a sample URL.
3. Re-index schedule.
4. Confirm the site is reachable by the crawler: allowlist the SitecoreAI crawler IPs (SKILL.md § Site sources), WAF / bot protection off for them, no auth gate, `robots.txt` not `Disallow: /`.
5. Save → crawl. Identity is `sc_url`.

## Push source

1. **Create source** → **Push**; declare the schema (field names are case-sensitive; values will be strings).
2. Copy the source ID and the **API Endpoint** (the push `{base_url}`).
3. *Settings* → **Create credential** → copy the ApiKey once → user stores it as `SITECORE_SEARCH_PUSH_APIKEY` in the server env (agents never edit `.env`).
4. Push with `search-push.mjs --yes`; verify by query.

## Wire the component

1. The page holds the search rendering with a datasource (`Data/Search Experiences/<name>`).
2. Page builder → select the component → **Search Configuration** tab → pick the source → map fields (title, description, type, link, images, tags) → save.
3. Publish the page and its datasource; search runs only on the published site.

## Cleanup (probe sources)

Delete the source, delete the push credential, unpublish/delete probe items and pages, then confirm the source is gone (config list or a query answering `no search index found`).
