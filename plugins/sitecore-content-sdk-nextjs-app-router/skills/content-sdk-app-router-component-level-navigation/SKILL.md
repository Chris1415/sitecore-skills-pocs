---
name: content-sdk-app-router-component-level-navigation
description: "Navigation via component-level GraphQL in a Content SDK App Router app: server fetches top levels, client lazy-loads deeper ones via a route handler. Use for main, footer or sidebar nav, or when the SXA nav resolver returns empty."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/nextjs ≥ 2.x (for SitecoreClient.getData), Next.js 13+ App Router, React 18+. Edge complexity ceiling verified empirically; per-branch fetches stay safely within limits at any depth."
metadata:
  author: Christian Hahn
  version: "0.2.2"
---

# Content SDK — Component-Level Navigation Pattern

A navigation that you actually control: queries you can read, types you can refactor, layout you can predict. Avoids the SXA Navigation Content Resolver (opaque, parameter-driven, fragile) and Integrated GraphQL on the rendering (query lives in Sitecore, hard to version). Instead the React component owns its data fetching via the SDK's GraphQL client.

## When to use

- Building navigation (main nav, footer nav, breadcrumb-adjacent, sidebar, sub-section nav) for a Sitecore head app.
- Existing SXA `Navigation Content Resolver` is misbehaving, returning empty arrays, or its parameters (LevelFrom/LevelTo/Filter) are hard to reason about.
- You want navigation that:
  - Stays in source control (queries + types + UI all in the React app)
  - Can be unit-tested without a tenant
  - Has type-safe responses
  - Scales to any depth without hitting Edge complexity limits
- You're OK without inline-editing the nav (authors edit the underlying page items' `NavigationTitle` / `NavigationFilter`, not the nav rendering itself).

## The pattern (one-page overview)

```
Server-side initial render:
  ┌─────────────────────────────────────────────┐
  │ NavigationCustom.tsx (Server Component)    │
  │   client.getData<NavLevel1Response>(        │
  │     NAV_LEVEL_1_QUERY, { root, language })  │
  │   ↓ returns root + L1 children +            │
  │     hasChildren flag per child              │
  └─────────────────────────────────────────────┘
                       ↓
  ┌─────────────────────────────────────────────┐
  │ NavBranch.tsx (Client Component) per item   │
  │   Renders link + chevron (if hasChildren)   │
  │   On hover/focus → ensureLoaded() →         │
  │     fetch('/api/nav-children?parent=...')   │
  │   Caches result in component state          │
  │   Renders dropdown with recursive NavBranch │
  └─────────────────────────────────────────────┘
                       ↓
  ┌─────────────────────────────────────────────┐
  │ /api/nav-children/route.ts (Route Handler)  │
  │   GET ?parent=...&language=...&maxItems=20  │
  │   client.getData<NavBranchResponse>(        │
  │     NAV_BRANCH_QUERY, { parent, language }) │
  │   Returns JSON array of child items         │
  │   NO router.refresh() side-effect           │
  └─────────────────────────────────────────────┘
```

Recursion: each `NavBranch` can itself render child `NavBranch` components inside its dropdown. Each child can lazy-load ITS children via the same route handler. The pattern scales to L3, L4, … without code changes — the only knob is the rendering parameter that caps depth.

## Sitecore-side setup (per project)

1. **Rendering item** at `/sitecore/layout/Renderings/Project/<project>/NavigationCustom`:
   - `componentName` = `NavigationCustom`
   - `Datasource Location` = `query:$site|query:$sharedSites`
   - `Parameters Template` = the new Parameters Template (next step)
   - `OtherProperties` = `IsRenderingsWithDynamicPlaceholders=true`
   - Datasource Template empty or pointing to a generic page template

2. **Parameters Template** at `/sitecore/templates/Project/<project>/Rendering Parameters/NavigationCustom Parameters` with shared fields:

   | Field | Type | Notes |
   |---|---|---|
   | `Level` | Droplist `1\|2` | Default `1`. **Do NOT name this `Levels`** — that name collides with base-template inheritance on some Sitecore versions and the field becomes invisible in Pages. `Level` (singular) is safe. |
   | `MaxItems` | Single-Line Text | Default `20` — per-level pagination cap; keeps Edge complexity bounded. |
   | `Class` | Single-Line Text | Optional CSS hook for layout variants. |

3. **Add to Available Renderings** under `/sitecore/content/<tenant>/<site>/Presentation/Available Renderings/Navigation`.

4. **Place on a page** in Pages Editor:
   - Set Datasource = the item whose children should be the L1 nav (typically `/Home`).
   - Set `Level = 2` for dropdowns; `Level = 1` for flat clickable nav.
   - Publish + wait ~30s for Edge cache.

5. (Optional) **Headless Variants** if you want author-selectable visual treatments — skip for v1.

## Head-app file layout

**Critical:** only the Sitecore-registered `.tsx` lives under `src/components/<Component>/`. All support files (types, queries, sub-components, route handlers) live elsewhere or `sitecore-tools generate-map` will register them as separate Sitecore renderings or variants. See `content-sdk-component-naming-traps`.

```
src/
  components/
    NavigationCustom/
      NavigationCustom.tsx              # ONLY this file — Server Component, registered by gen-map
  lib/
    navigation/
      types.ts                           # NavItem, NavLevel1Response, NavBranchResponse, navLabel(), isNavVisible()
      queries.ts                         # NAV_LEVEL_1_QUERY, NAV_BRANCH_QUERY (string literals)
      nav-branch.tsx                     # 'use client' — recursive NavBranch with hover/focus/click + lazy fetch
  app/
    api/
      nav-children/
        route.ts                         # GET handler — uses SitecoreClient.getData, returns JSON
```

## The L1 query (server-side)

```graphql
query NavLevel1($root: String!, $language: String!, $maxItems: Int = 20) {
  item(path: $root, language: $language) {
    id
    path
    displayName
    navTitle: field(name: "NavigationTitle") { value }
    url { path }
    navFilter: field(name: "NavigationFilter") { value }
    children(first: $maxItems, hasLayout: true) {
      results {
        id
        path
        displayName
        navTitle: field(name: "NavigationTitle") { value }
        url { path }
        navFilter: field(name: "NavigationFilter") { value }
        hasChildren(hasLayout: true)
      }
    }
  }
}
```

- **`hasLayout: true`** — excludes data items, datasources, settings nodes. Only pages.
- **`hasChildren(hasLayout: true)`** — boolean flag per L1 item. Lets the client decide whether to render an expandable chevron WITHOUT a round-trip. Crucial for UX.
- **`url { path }`** is the public-facing URL (the visitor href). NOT the Sitecore tree path (`path`) — that's for downstream fetches only.
- **Empirically safe** at `first: 20` with all these field-lookups against a real SitecoreAI tenant. See `sitecoreai-edge-graphql-capture` for limits.

## The L2 route handler (NOT a server action)

```ts
// src/app/api/nav-children/route.ts
import { NextResponse } from 'next/server';
import client from 'src/lib/sitecore-client';
import { NAV_BRANCH_QUERY } from 'src/lib/navigation/queries';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parent = searchParams.get('parent');
  const language = searchParams.get('language') ?? 'en';
  if (!parent) {
    return NextResponse.json({ error: 'parent required' }, { status: 400 });
  }
  const result = await client.getData(NAV_BRANCH_QUERY, { parent, language, maxItems: 20 });
  return NextResponse.json(result.item?.children.results ?? []);
}
```

```graphql
query NavBranch($parent: String!, $language: String!, $maxItems: Int = 20) {
  item(path: $parent, language: $language) {
    children(first: $maxItems, hasLayout: true) {
      results {
        id
        path
        displayName
        navTitle: field(name: "NavigationTitle") { value }
        url { path }
        navFilter: field(name: "NavigationFilter") { value }
        hasChildren(hasLayout: true)
      }
    }
  }
}
```

**WHY a route handler, not a Server Action:**
- Server Actions auto-trigger `router.refresh()` after completion (designed for mutations — re-fetch the RSC tree to reflect server state changes).
- A nav fetch is a **read**. The refresh wipes all client state — dropdown closes, page re-renders to initial state, user sees an endless "loading then nothing" cycle.
- Route handlers are pure JSON responses with zero React-tree side-effect.

This is a Next.js architectural rule, not a Sitecore quirk: **reads → route handler, mutations → server action.**

## NavBranch (client component — hover + lazy load)

Key behavior, distilled:

```tsx
'use client';
export function NavBranch({ item, language, maxItems, remainingLevels }) {
  const [children, setChildren] = useState<NavItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const fetchedRef = useRef(false);                            // de-dupe fetch
  const closeTimerRef = useRef(null);                          // hover intent-delay

  const expandable = item.hasChildren && remainingLevels > 0;

  const ensureLoaded = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    try {
      const url = `/api/nav-children?parent=${encodeURIComponent(item.path)}&language=${language}&maxItems=${maxItems}`;
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) { fetchedRef.current = false; setChildren([]); return; }
      const data = await r.json();
      setChildren(data.filter(isNavVisible));
    } finally { setLoading(false); }
  }, [item.path, language, maxItems]);

  const handleOpen = useCallback(() => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setOpen(true);
    void ensureLoaded();
  }, [ensureLoaded]);

  // 150ms intent-delay — don't close on brief mouseleave (user travelling toward dropdown)
  const handleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => { setOpen(false); closeTimerRef.current = null; }, 150);
  }, []);

  return (
    <li
      className="relative"
      onMouseEnter={expandable ? handleOpen : undefined}
      onMouseLeave={expandable ? handleClose : undefined}
      onFocus={expandable ? handleOpen : undefined}
      onBlur={(e) => {
        if (expandable && !e.currentTarget.contains(e.relatedTarget as Node | null)) handleClose();
      }}
    >
      <div className="flex items-center">
        <Link href={item.url.path || '#'}>{navLabel(item)}</Link>
        {expandable && <button onClick={() => open ? handleClose() : handleOpen()} aria-expanded={open}>▼</button>}
      </div>
      {expandable && open && (
        <ul
          role="menu"
          // top-full FLUSH with parent's bottom — NO mt-*. Any visible gap here
          // causes mouseleave on <li> during cursor traversal, triggering flicker.
          className="absolute left-0 top-full z-50 min-w-48 ..."
        >
          {loading ? <li>Loading…</li> :
            children?.length ? children.map(c => <NavBranch key={c.id} item={c} language={language} maxItems={maxItems} remainingLevels={remainingLevels - 1} />)
            : <li>No items</li>}
        </ul>
      )}
    </li>
  );
}
```

## Critical design choices (with rationale)

1. **`hasChildren` flag in L1 query**: lets the client render the expandable chevron before any L2 fetch. Without it, you'd have to either fetch all L2 upfront (defeats lazy load) or render every L1 with a chevron (UI lies about expandability). `Item.hasChildren(hasLayout: Boolean)` is a cheap boolean.

2. **Route Handler for the L2 read** (the bug we hit and fixed): Server Actions trigger `router.refresh()` → wipes client state → endless loading flicker. Route Handler returns JSON with zero React side-effect. Universal rule: client-triggered reads → route handler.

3. **Hover intent-delay (150ms)**: brief `mouseleave`s (e.g., crossing a tiny gap) don't immediately close. Re-entering within 150ms cancels the close. Standard popover pattern.

4. **No-gap dropdown positioning (`top-full`, no `mt-*`)**: the dropdown must be flush with the parent `<li>`'s bottom. Any visible CSS gap creates a zone where mouse is OUTSIDE `<li>`'s bbox AND outside the dropdown's DOM — triggers `mouseleave` on the `<li>` → close → flicker. Internal padding (`p-1`) provides visual breathing room.

5. **Recursive NavBranch** (each branch fetches its own children): no flat tree code, no per-level branching. Same component works for L1, L2, L3, … The only stop condition is `remainingLevels === 0`.

6. **NavigationFilter respect** (`isNavVisible`): items with a non-empty `NavigationFilter` field value are hidden. Matches SXA's "any filter set = hidden from default nav" convention. Conservative default; can be made configurable later.

7. **NavigationTitle override** (`navLabel`): per-item author override of the link label. Falls back to `displayName` when not set. Standard Sitecore convention.

8. **Datasource = root, NOT a rendering parameter**: one mechanism, no overlap. Author picks root via Pages' Content tab. Tested earlier with a `Root` rendering parameter — added confusion ("which wins?"), removed.

9. **Helper files live OUTSIDE `src/components/`**: types, queries, route handler, NavBranch client component all under `src/lib/navigation/` (or `src/app/api/` for the route handler). Inside `src/components/NavigationCustom/`, only the Sitecore-registered `.tsx`. Otherwise gen-map registers helpers as Sitecore renderings or variants. See `content-sdk-component-naming-traps`.

## Edge complexity

Empirically tested against SitecoreAI Edge on 2026-05-27:

- L1 query (`first: 20` + full `field()` lookups + `hasChildren`) → ✅ works
- L2 nested in L1 (`first: 5` + minimal fields, no field()) → ✅ works
- L2 nested in L1 (`first: 5` + any `field()` lookups) → ❌ "Query is too complex"

So a SINGLE L0+L1+L2 query is impractical with full fidelity. Per-branch lazy fetch sidesteps this entirely — each branch's children query has the same shape as the L1 query and stays within limits.

See `sitecoreai-edge-graphql-capture` for the full Edge limits catalogue.

## Hard Rules

- **Reads use Route Handlers, not Server Actions.** Server Actions auto-trigger `router.refresh()`; reads don't want that. Universal Next.js rule, especially load-bearing here.
- **`hasChildren(hasLayout: true)` on the L1 query** so chevrons can render without a second fetch.
- **Dropdown `<ul>` flush with parent `<li>` — `top-full`, no `mt-*`.** A visible gap causes endless mouseleave flicker. Internal padding for visual breathing room.
- **Hover intent-delay (≥120ms, usually 150ms)** before closing — covers cursor traversal.
- **`field(name:)` only at root + L1.** Don't try to nest `field()` lookups at L2 in a single query — Edge will reject as too complex.
- **`hasLayout: true` on every `children` call.** Excludes data items, datasources, and structural nodes that shouldn't appear in a navigation.
- **Use `url { path }` for hrefs, NOT `path`.** `url.path` is the public URL; `path` is the Sitecore tree path (for downstream queries only).
- **Datasource is the root.** Don't add a `Root` rendering parameter — it duplicates the mechanism and creates "which wins?" ambiguity.
- **Helper files (`types.ts`, `queries.ts`, `nav-branch.tsx`, `actions.ts`-style fetchers) live OUTSIDE `src/components/<Component>/`.** Put them in `src/lib/<feature>/` or `src/app/api/`.
- **Parameter name `Level` (singular), not `Levels`.** Plural collides with base-template inheritance on some Sitecore configurations and becomes invisible in Pages.
- **`isNavVisible` filter on every result set** — both server-side (L1) and client-side (L2+ after fetch).
- **Server-rendered L1 is cacheable.** The `client.getData` call runs server-side; Next.js can cache it via the standard `fetch` cache (with appropriate `next: { revalidate }` if needed).
- **Client-side L2 cache is per-NavBranch via `useRef`/`useState`.** Re-hover doesn't re-fetch. No global cache needed for v1.

## Stop Conditions

- **Don't try to recurse L2+ in a single server query.** Edge complexity will reject it. Lazy-fetch per-branch is the only viable path at depth.
- **Don't use Server Actions for the L2 fetch.** Even if your codebase has a "use server actions everywhere" preference, the `router.refresh()` side-effect breaks client state for reads.
- **Don't omit `hasLayout: true`** — your nav will fill with datasources and settings items.
- **Don't bind nav behaviour to Pages Editor preview.** Editor mode wraps renderings in chrome (`<code type="text/sitecore">`) which can interfere with mouse handlers. Test in the live published page, not the editor preview.
- **Don't co-locate helpers in `src/components/<Component>/`.** Even though it feels right, gen-map will register them as Sitecore renderings or as variants of your main component, polluting the map.
- **Don't ship without publishing.** Edge serves the cached layout; un-published rendering parameter changes (like `Level=2`) won't propagate until publish + ~30s.

## Verification

- L1 renders server-side on initial page load (visible in `view-source` HTML).
- Each L1 item with children has a chevron; items without children don't.
- Hover an L1 item with chevron → dropdown opens with "Loading…" briefly → resolves to children.
- Re-hover → instant (no re-fetch, no loading flash).
- Mouse leaves dropdown → 150ms grace → closes cleanly. No flicker.
- Mouse moves from L1 into dropdown via the empty area between them → dropdown stays open (no-gap rule).
- The Network tab shows ONE `GET /api/nav-children?parent=...` per branch on first hover. None on re-hover.
- React DevTools shows no `router.refresh()` events on hover (proves you're using a route handler, not a server action).

## Related

- `content-sdk-resolver-patterns` — why this pattern beats Navigation Content Resolver and Integrated GraphQL for navigation.
- `content-sdk-component-naming-traps` — the rule that forces helper files out of `src/components/<Component>/`.
- `sitecoreai-edge-graphql-capture` — Edge complexity limits this pattern works around.
- `content-sdk-debug-layout-probe` — for verifying layout response shape when integrating with Sitecore.
- `content-sdk-variants-vs-siblings` — for adding visual variants (e.g., `NavigationCustom.MegaMenu.tsx`).
- `content-sdk-app-router-graphql-data-fetching` — the SDK's `client.getData` API used here.

## References

- Reference implementation: the layout in § "Head-app file layout" is the complete surface — one registered component, `src/lib/navigation/{types,queries,nav-branch}`, one route handler — and the code blocks in this skill are its load-bearing parts verbatim. (The component was called `Navigation_Custom` when first built; it is `NavigationCustom` here because `content-sdk-component-naming-traps` trap 6 makes an underscored name version-sensitive.)
- Edge complexity test: see `sitecoreai-edge-graphql-capture` for the empirical ceiling.
- SDK API: `SitecoreClient.getData<T>(query, variables, fetchOptions)` — `node_modules/@sitecore-content-sdk/content/types/client/sitecore-client.d.ts:122`.
- Next.js Server Actions vs Route Handlers: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
