# Lazy item-name resolution — copy-pack

Drop-in primitive for any Sitecore Marketplace app that surfaces items by ID
to a non-technical editor (datasource refs, layout fields, content links,
selected-item indicators, etc.).

Solves: **"the editor sees a GUID where they expected a real item name."**

## What's in the pack

| File | Purpose |
|------|---------|
| `authoring-resolve.ts` | Batched multi-aliased GraphQL query against `xmc.authoring.graphql` (Authoring API). Resolves up to 50 IDs per round-trip. Handles both `result.data.iN` (mutation single-unwrap, the correct shape) and `result.data.data.iN` (defensive fallback in case the SDK build double-wraps). Emits named `console.warn` on `mutate-threw` / `graphql-errors` / `zero-resolved-in-batch` so silent failures are impossible. |
| `item-name-cache.ts` | Module-singleton cache of resolved names. Process-lifetime (survives surface remounts inside one iframe), with `claimUnresolved` / `ingestResolved` / `ingestFailed` / `subscribe` helpers and a `__resetForTests` escape hatch. |
| `use-item-names.ts` | React hook: `useItemNames(client, contextId, ids)` → `ReadonlyMap<string, string>`. Re-renders consumers via `useSyncExternalStore` whenever the cache lands. Filters non-resolvable IDs (only GUIDs / `xpath:...` / `/sitecore/...` go to the network) so `local:/Data/<name>` items skip the round-trip entirely. |
| `derive-display-name.ts` | Pure helper: extracts a marketer-readable name from a raw `dataSource` string when the path contains a name segment, falls back to `Item · {short-id}` (first 8 hex chars) for GUID-only IDs. Used as the synchronous default before the lazy resolver lands. |

## Drop-in steps for a new product

1. Copy the four files into the new product's source tree:
   - `authoring-resolve.ts` → `lib/sdk/`
   - `item-name-cache.ts` → `core/`
   - `use-item-names.ts` → `core/`
   - `derive-display-name.ts` → `lib/sdk/`

2. Rename callers from `useDatasourceNames` → `useItemNames` (or keep the
   datasource-specific name if your domain is exactly that). The cache and
   resolver are domain-agnostic.

3. Wire it at the surface that owns the SDK client:
   ```tsx
   const visibleIds = useMemo(
     () => Array.from(new Set(items.map((i) => i.id).filter(Boolean))),
     [items],
   );
   const resolvedNames = useItemNames(client, contextId, visibleIds);

   const display = (id: string) =>
     resolvedNames.get(id) ?? deriveDisplayName(id);
   ```

4. Test fixture pattern (see Atlas's
   `site/lib/sdk/__tests__/datasource-name.test.ts` and
   `__tests__/datasource-usage-drawer.test.tsx`): mock the cache via
   `__resetForTests()` + `ingestResolved(new Map([[id, 'real name']]))` so
   you can drive deterministic name-resolution states from a test without
   stubbing `client.mutate`.

## Why this is a primitive, not a one-off

Three different Marketplace apps needed it:

- datasource references in a component-usage report
- publish targets in a copy tool
- page-id to page-name display in a screenshot tool

Any Marketplace app that surfaces Sitecore items by ID needs it too.

Same shape, same failure modes, same Authoring API endpoint. Build-once.

## Failure ladder — read this before debugging

If the resolver returns no names in production:

1. **Open DevTools → Console** and look for one of:
   - `[CUA authoring-resolve] mutate-threw` → network/auth error; check the
     scopes registered for the app (it needs `xmc.authoring.read` or
     equivalent).
   - `[CUA authoring-resolve] graphql-errors` → permissions or wrong DB;
     the items exist but the registered identity can't read them, OR the
     query targets `master` and the items only exist on `web`.
   - `[CUA authoring-resolve] zero-resolved-in-batch` → items genuinely
     aren't returned by `item(path:)`. Try the same query in Sitecore's
     GraphQL Playground with the same identity to confirm.
   - `[CUA authoring-resolve] no-data-in-response` → response shape is
     unexpected. The defensive fallback already handles single vs double
     unwrap; if neither shape matched, the SDK build changed contract.
     Inspect `result` directly.

2. If none of the warnings appear, the call isn't firing. Check that
   `client` and `contextId` are non-null and that the IDs you passed pass
   the `isResolvable` filter (only GUIDs and explicit Sitecore paths
   qualify; `local:/...` and other prefixes are filtered out by design).

## Reference implementation

The snippet pack is a verbatim copy of a working app's `lib/sdk` and `core`
folders as of 2026-04-30. Diverging from the pack to fit a new
product's domain is fine — just keep the failure-ladder warnings and the
single-unwrap rule intact.
