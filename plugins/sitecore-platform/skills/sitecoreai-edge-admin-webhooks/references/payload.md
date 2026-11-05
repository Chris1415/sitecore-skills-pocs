# Webhook payloads

Live captures from a SitecoreAI tenant (snapshot publishing, SXA site on a shared CM), 2026-10-02. Rows not seen live are marked `doc` or `fixture`. Redacted samples: the S5 probe captures `p4-onupdate-requests.jsonl`, `p4-onend-requests.jsonl`, `p6-fail401-requests.jsonl`.

## Request envelope (live)

`POST`, `content-type: application/json; charset=utf-8`, `user-agent: Sitecore Experience Edge/1.0`, a W3C `traceparent`, `accept-encoding: gzip`. **Your custom `headers` arrive on every delivery**, retries included. Source IP was Azure West Europe (`52.174.108.72` on an EU tenant): do not allowlist by IP without checking yours.

## OnUpdate: `WebHookRequest`

A **datasource-only** publish (`FactList` datasource under `fjord-circuit/Data`, `publishRelatedItems: false`) produced one batch:

```json
{
  "invocation_id": "00000000-0000-4000-8000-000000000001",
  "updates": [
    { "identifier": "11111111111141118111111111111111", "entity_definition": "Item", "operation": "Update", "entity_culture": "en" },
    { "identifier": "22222222222242228222222222222222", "entity_definition": "Item", "operation": "Update", "entity_culture": "en" },
    { "identifier": "22222222222242228222222222222222-layout", "entity_definition": "LayoutData", "operation": "Update", "entity_culture": "en" }
  ],
  "continues": false
}
```

`55E5…` is the datasource; `D8EE…` is the page that uses it. **The dependent page's `Item` and `LayoutData` rows are emitted** (snapshot publishing), so per-item OSR reaches a page whose only change was a datasource. Row order is not stable (a later identical publish listed the `-layout` row first).

The same publish caused a **second, separate invocation** carrying the SXA sitemap file that the CM regenerated after the publish:

```json
{ "invocation_id": "04b61938-…", "updates": [
  { "identifier": "33333333333343338333333333333333", "entity_definition": "Item", "operation": "Update", "entity_culture": "en" },
  { "identifier": "33333333333343338333333333333333-media", "entity_definition": "MediaItem", "operation": "Update", "entity_culture": "" } ],
  "continues": false }
```

(`/sitecore/media library/Project/<collection>/<site>/Sitemaps/<site>/sitemap`, template `File`.) It was not seen on every publish.

| Field | Live observation |
|---|---|
| `invocation_id` | GUID. **A retry gets a NEW id**, so it is not a dedupe key across retries (§ Reliability) |
| `updates[]` | 2–3 rows per small publish; one batch |
| `continues` | `false` on every batch seen (no multi-batch publish was large enough) |

## `EntityUpdate` rows

| Field | Live observation |
|---|---|
| `identifier` | **Dashless UPPERCASE** GUID. Suffix `-layout` on `LayoutData`, `-media` on `MediaItem` (suffix lowercase) |
| `entity_definition` | PascalCase: `Item`, `LayoutData`, `MediaItem` seen live. `ItemTemplate`, `ItemTemplateField`, `SiteInfo`, `DictionaryEntry` doc only. **Absent (no key at all) on `Delete` rows**: derive the type from the `-layout` / `-media` suffix |
| `operation` | `"Update"` and `"Delete"` (PascalCase) live. Compare case-insensitively |
| `entity_culture` | `"en"` on `Item` and `LayoutData`; **`""` (empty string) on `MediaItem`**. `all` for `SiteInfo` is doc only |

Identifier shapes:

| Entity | Identifier | Source |
|---|---|---|
| Item | `11111111111141118111111111111111` | live |
| LayoutData | `22222222222242228222222222222222-layout` | live |
| MediaItem | `33333333333343338333333333333333-media`, `entity_culture: ""` | live |
| SiteInfo | The site name | doc |
| DictionaryEntry | `<site>-<guid>-<key>-<lang>` | SDK fixture only |

## Receiver rules

- **Tolerate foreign ids.** Every webhook on an environment receives every site's publishes, plus side publishes you did not start (the SXA sitemap file).
- **Answer 2xx whenever the request is authentic**, even if no row concerns you. A non-2xx is retried without backoff and every attempt counts toward auto-disable: **one publish against a 401 or a 400 receiver disables the webhook** (both live). This bites the Content SDK route, which answers 400 when a batch resolves to zero tags (a sitemap-only batch does resolve one junk item tag, so it gets 200).
- **Be idempotent, and do not dedupe on `invocation_id`.** A retry carries a new id with identical rows.
- Normalise GUIDs before matching (strip braces and hyphens, lowercase), and strip `-layout` / `-media`.
- Treat `entity_culture: ""` as "all languages / not language-bound".
- **Handle `Delete` rows without `entity_definition`** (below). A parser that requires the key, or switches on it, drops removals silently.

## Unpublish and delete rows (live, P5c 2026-10-02)

A brand-new throwaway page (no datasources, nothing referencing it), one site, `en`:

| Action | Rows (one batch, `continues: false`) | Edge LIVE after the publish job |
|---|---|---|
| Publish | `Item` + `LayoutData`, `operation: "Update"` | `item` and `layout` present at +26 s |
| Unpublish: `__Hide version = 1` on every version in the language, then `publishItem` the page (what Page builder → Unpublish does) | `{"identifier":"44444444444444448444444444444444","operation":"Delete","entity_culture":"en"}` + the same with `-layout` | `item` and `layout` both `null` at +23 s; webhook at +84 s |
| Delete in master, then `publishItem` the **deleted id** | none: the mutation errors `The item "<id>" was not found` | unchanged (still present) |
| Delete in master, then `publishItem` the **parent** with `publishSubItems: true` | `Delete` rows for the item and its `-layout` | both `null` at +30 s; webhook at +96 s |

- An unpublish and a delete produce **identical rows**: the receiver cannot tell them apart and does not need to.
- **Only the removed item's own rows** are sent. Pages that link to it (navigation, lists) get no row, so their cached HTML keeps the dead link until something else refreshes them.
- A delete reaches Edge only through a publish of an **existing ancestor** with subitems. On a shared parent that also publishes every sibling's pending changes, so either publish a throwaway container, or **unpublish first and delete second** (nothing is left on Edge to propagate). Deleting a parent whose child was published alone leaves Edge orphans (Sitecore KB1008482, `/sitecore/admin/EdgeOrphans.aspx`).
- The first publish's batch also carried two `Update` rows for items outside the publish (a page and its datasource on another route, unchanged on Edge). Unattributed; one more reason to tolerate foreign rows.

## Timing (live, 11 publishes)

| Leg | Observed |
|---|---|
| Publish job (`publishItem`, SMART, 1 item) start → `FINISHED` | 23–29 s |
| Start → new value readable on Edge (GraphQL) | 23–60 s |
| Start → OnUpdate webhook delivered | **84–175 s** (151, 101, 175, 87, 119, 164; follow-ups 170, 84, 99, 96, 90; median ≈ 119 s) |
| Webhook → fresh page on Vercel (`'max'` profile: one stale read, then fresh) | 5–10 s |

The webhook trails Edge visibility by one to two and a half minutes. A pipeline that publishes and then asserts the page must wait for `lastRuns`, not for Edge.

## OnEnd

Sends your static `body` verbatim with your `headers` (with a `content-type: application/json` header set, it arrived as `application/json; charset=utf-8`). One publish produced **three** OnEnd deliveries (at +1.6 s, +9 s and +120 s after the publish call); the first two cannot belong to that publish (Edge had not received it yet) and could not be attributed, because an OnEnd body carries nothing to correlate. Treat OnEnd as "something was published on this environment", never as "my publish is live". A Content SDK revalidate route on 2.5.x answers an OnEnd body with `400` (zero tags), which now means **auto-disable after one publish**.

## CM webhook event handler (for contrast)

`{ EventName, WebhookItemId, WebhookItemName, Item: { Id (dashed lowercase), …field dump } }`. No `updates`, different id casing: never send it to an Edge-shaped receiver.
