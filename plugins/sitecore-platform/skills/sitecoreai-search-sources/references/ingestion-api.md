# Ingestion Service API (push) contract

Source: doc.sitecore.com/sai/en/developers/sitecoreai/search-experiences/ingestion-service-api.html (read 2026-10-02). Nothing on this page has been exercised against a tenant yet: every behaviour is **[docs]** until P6 runs (it creates an instance-wide credential, so it needs its own go-live approval).

## Request

```http
POST {base_url}/v1/index/{config_id}/push
Authorization: ApiKey <key>
Content-Type: application/json

{
  "operations": [
    { "action": "upsert", "id": "doc-1", "locale": "en", "fields": { "title": "Hello", "price": "12.50", "published": "20261002T120000Z" } },
    { "action": "delete", "id": "doc-2" }
  ]
}
```

| Part | Rule |
|---|---|
| `{base_url}` | the "API Endpoint" shown on the source page; no host table is published **[probe-gated: P3/P6]** |
| `{config_id}` | the source id (Settings tab "ID"; the same GUID the head app sends as `config.id`) |
| `action` | `upsert` or `delete` |
| identity | `id` (push and content sources) or `sc_url` (site sources); one per operation |
| `canonical_url`, `locale` | optional per operation; locale format **[probe-gated: P4/P6]** |
| `fields` | object of **string** values only; names case-sensitive and must already exist in the source schema |
| datetimes | `YYYYMMDDTHHMMSSZ` (e.g. `20261002T120000Z`); ISO 8601 is rejected |
| reserved | `sc_*` and `@search.action` (silently ignored or rejected) |
| limits | 1-50 operations **and** ≤ 512 KiB serialized; exceeding either rejects the **whole** request |

## Responses

| Status | Meaning | Action |
|---|---|---|
| 200 | every operation succeeded | — |
| **207** | partial success; body `results: [{ action, index, key, statusCode, succeeded }]` | treat as failure for the failed indexes; retry only those |
| 400 | bad body, empty/oversized list, bad action, missing identity, invalid value, unknown field | fix input; do not retry |
| 401 / 403 | key missing, invalid, expired, revoked, or lacking `search.pushapi:m` | rotate the key |
| 404 | source missing, unpublished, or owned by another instance | check the id and environment |
| 413 | payload > 512 KiB | split |
| 500 / 503 | server error / ingestion disabled | back off and retry |

A bearer token (automation client) fails with `tenant ID not found in JWT claims` **[docs]**. Rate limits and 429 behaviour are undocumented.

## Credential

- Created in the UI (*Search sources > Settings > Create credential*; the doc also mentions a "Profile import" page in settings), shown once.
- **Instance-wide**: one key writes every source in the environment. Org Owner / Admin only in production.
- Store server-side as `SITECORE_SEARCH_PUSH_APIKEY` (all Vercel targets if a route handler pushes; never `NEXT_PUBLIC_*`). Delete probe keys after use.

## Replay algorithm (content or site source that also receives pushes)

A reindex or crawl rebuilds the index from its own source and drops every pushed document. Sources keep no push history.

1. Keep the authoritative pushed set outside Sitecore (a table or a derived list you can regenerate, keyed by `id`).
2. On each publish event (Edge OnUpdate webhook), upsert the changed ids and record them in the set.
3. After **every** reindex (manual, or a scheduled site re-index), replay the whole set in batches of ≤ 50 ops / ≤ 512 KiB.
4. Verify with a known id: `/v1/search` for a token only that document carries must return it.

For a push source that is the only system of record, steps 1-2 are the whole design; there is no reindex to survive.

## Local validation (`scripts/search-push.mjs`)

The script enforces the request rules above before any network call: operation count 1-50, serialized size ≤ 512 KiB, `action` in {upsert, delete}, exactly one identity, `fields` object with string values only, ISO-looking datetimes rejected, `sc_*` / `@search.action` names rejected, HTTPS endpoint, explicit `--source`, key from env only. It sends only with `--yes` and exits 1 when a 207 reports any failed operation.
