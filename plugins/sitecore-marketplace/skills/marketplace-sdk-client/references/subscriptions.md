# Subscription mechanics — path A vs path B

The Marketplace Client SDK exposes **two different mechanisms** for receiving live updates. They are **not interchangeable** — picking the wrong one is a typecheck error.

| Path | Trigger | Used for | Returns |
|------|---------|----------|---------|
| **A. Subscribe-via-query** | `client.query(K, { subscribe: true, onSuccess })` | Keys in `QueryMap` whose row has `subscribable: yes` (e.g. `pages.context`, `host.state`) | `QueryResult` with an `unsubscribe?: () => void` field |
| **B. Subscribe-verb** | `client.subscribe(K, { onData, onError? })` | Keys in `SubscribeMap` (event-only keys, no underlying query) | `() => void` teardown function (call to stop) |

**How to pick:** look up the key.
- If it's in `QueryMap` (SKILL.md § 4) with `subscribable: yes` → **path A** (query option).
- If it's in `SubscribeMap` (table below) → **path B** (subscribe verb).
- A key never lives in both maps. `client.subscribe('pages.context', …)` will not typecheck — `pages.context` is in `QueryMap`, not `SubscribeMap`.

## Path A — subscribe-via-query (for `QueryMap` keys with `subscribable: yes`)

Use this for keys whose data has both an initial-read shape and a live-update stream — `pages.context` is the canonical example. The query call returns the initial value AND wires the subscription in one round trip.

```typescript
const res = await client.query('pages.context', {
  subscribe: true,
  onSuccess: (data) => {
    // fires on initial resolve AND on every subsequent update
    console.info('[mkp][pages.context]: event', data);
  },
  onError: (err) => console.error('[mkp][pages.context]: error', err),
});

// res.data is the initial value. res.unsubscribe is wired ONLY because subscribe: true was passed.
const teardown = res.unsubscribe;

useEffect(() => () => teardown?.(), [teardown]);
```

The `unsubscribe` field is `() => void | undefined` — it's `undefined` if `subscribe: true` was not passed. Always optional-chain when calling.

## Path B — subscribe-verb (for `SubscribeMap` keys — event-only)

Use this for keys that are purely event streams with no companion query — change-event firehoses where there's no "current value" to read.

| Key | Data |
|-----|------|
| `'pages.content.layoutUpdated'` | `{ itemId, language, itemVersion, layout: { type: 'FINAL' \| 'SHARED' } }` |
| `'pages.content.fieldsUpdated'` | `{ itemId, language, itemVersion, fields: Array<{ fieldId, value, originalValue? }> }` |

```typescript
const teardown = client.subscribe('pages.content.fieldsUpdated', {
  onData: (data) => console.info('[mkp][fieldsUpdated]: event', data),
  onError: (err) => console.error('[mkp][fieldsUpdated]: error', err),
});

useEffect(() => () => teardown(), [teardown]);
```

The subscribe-verb teardown is `() => void` — non-optional. Always call it on unmount.

**No server-side filter — filter client-side.** `pages.content.fieldsUpdated` emits for **every** field change on the selected page. A Custom Field editor watching "did my own field change externally?" must filter the event payload itself — the SDK does not expose a `fieldId` filter on the subscribe call:

```typescript
const myFieldId = '…';       // the field this editor owns
const myItemId = pageInfo.id; // from pages.context query

client.subscribe('pages.content.fieldsUpdated', {
  onData: (data) => {
    if (data.itemId !== myItemId) return;
    const hit = data.fields.find((f) => f.fieldId === myFieldId);
    if (!hit) return;
    // hit.value is the new value; hit.originalValue the prior one (optional)
    applyExternalChange(hit.value);
  },
});
```

Skipping the filter means every unrelated field edit on the page triggers the handler — usually harmless, but can cause spurious re-fetches or UI resets. Filter upfront.

## Why both paths exist

`pages.context` semantically *is* a current-state query (selected item, site, language) that *also* has live updates when the user navigates in Pages. `pages.content.fieldsUpdated` is an event firehose that only makes sense as a stream — there is no "current value of fieldsUpdated" to read once. The SDK reflects this distinction in its type maps, so the wrong-shape call is caught at compile time.
