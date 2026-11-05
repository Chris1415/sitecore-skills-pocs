---
name: content-sdk-debug-layout-probe
description: "Diagnostic toolkit for live Content SDK layout responses: a temporary layout-debug route, a resolver probe and an instrumented frame. Use when a component renders empty or wrong, a resolver's field shape is unknown, or Edge and Preview differ."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/nextjs ≥ 2.x and a working SitecoreClient in `src/lib/sitecore-client.ts`. Tested on App Router; the same pattern works for Pages Router with minor route changes."
metadata:
  author: Christian Hahn
  version: "0.1.3"
---

# Content SDK — Debug Layout Probe

Inspecting what SitecoreAI actually delivers to your head app is harder than it should be: the layout response is opaque JSON, the SDL only types `LayoutData { item: Item }`, and Edge caches changes for ~30 s after publish. This skill installs three small, reusable pieces that turn the head app into a diagnostic surface.

## When to use

- A Sitecore component renders empty / wrong / nothing and you need to see the raw payload.
- A new content resolver is on the rendering and you don't know what shape `fields` will be (array? object? nested data?).
- You suspect Edge cache is hiding recent author changes.
- You want to verify dataSource resolution, FieldNames variant selection, or rendering-parameter values without checking the CMS.
- You're learning a Sitecore pattern (content resolver, integrated GraphQL, navigation) and want a fast feedback loop.

## How to perform

Three pieces, in order:

### 1. Temporary `/api/layout-debug` route

Create `src/app/api/layout-debug/route.ts`:

```ts
import { NextResponse } from 'next/server';
import client from 'src/lib/sitecore-client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const site = searchParams.get('site') ?? 'training';
  const locale = searchParams.get('locale') ?? 'en';
  const rawPath = searchParams.get('path') ?? '/';
  const pathSegments =
    rawPath === '/' || rawPath === '' ? [] : rawPath.split('/').filter(Boolean);
  try {
    const page = await client.getPage(pathSegments, { site, locale });
    return NextResponse.json({ request: { site, locale, path: rawPath, pathSegments }, result: page });
  } catch (err) {
    return NextResponse.json(
      { request: { site, locale, path: rawPath, pathSegments }, error: err instanceof Error ? { name: err.name, message: err.message } : String(err) },
      { status: 500 }
    );
  }
}
```

Hit it with `curl -s "http://localhost:3000/api/layout-debug?site=<site>&locale=<locale>&path=<route>" | python3 -m json.tool`. Returns the raw `LayoutServiceData` the SDK pulled from Edge.

### 2. Reusable `ResolverProbe` component (`src/ui/resolver-probe.tsx`)

Pretty-prints `fields`, `params`, and `rendering` as JSON inside a card. Drop it in any new component that receives an unknown payload:

```tsx
export const Default = (props) => (
  <ResolverProbe component="My Mystery Component" {...props} />
);
```

The probe reports the payload's `kind` (array vs object vs primitive) so you can immediately classify the shape.

### 3. `InstrumentedFrame` wrapper

A thin caption strip above the rendered component showing `componentName · variant · pattern · dataSource`. Color-coded left rail per resolver pattern (accent=standard, ok=all-fields, warn=integrated-graphql, ink=content-resolver). Makes the four delivery patterns visually distinct on a single page.

## Hard Rules

- **The `layout-debug` route uses `client.getPage()` which hits Edge Delivery.** Author changes need a publish + ~30 s before they appear here. If a parameter change has "no effect," publish first and wait — don't change more things blindly.
- **For unpublished state, use `client.getPreview(searchParams)` inside `draftMode()`** instead of `getPage`. Add a `?mode=preview` flag to the route if needed. Preview bypasses Edge.
- **Always wrap unknown components in `ResolverProbe` before writing a real implementation.** Discover the payload shape from the live response, not from prose docs.
- **For new content resolvers, scaffold the dummy first, add to a page, publish, capture the JSON, THEN write the real component.** The reverse loop (assume shape → write component → debug) costs 5× as much time.
- **Remove or gate `/api/layout-debug` before production deploy.** It leaks the layout payload (incl. internal item IDs). Gate by `process.env.NODE_ENV !== 'production'` or delete before merge.
- **`tone="content-resolver"` on InstrumentedFrame** is the right default for any rendering whose payload shape isn't yet known — it visually flags "needs probing."

## Stop Conditions

- **Stop and capture** the layout response as a fixture in `tests/fixtures/graphql/<rendering>.json` (with provenance comment) once the shape is confirmed, so future tests don't depend on a live tenant.
- **Do not assume `fields` is always an object.** Some resolvers return arrays (Navigation, ChildrenContentResolver). Some return nested `{ data: { datasource: ... } }` (Integrated GraphQL). The probe tells you which.
- **Do not ship the ResolverProbe to production for a known-shape component.** Replace with the real implementation once you know the shape; keep the probe pattern only for genuinely-unknown ones.

## Verification

- Hitting the route should return JSON with `result.layout.sitecore.route.placeholders` populated.
- The InstrumentedFrame caption should match the layout response's `componentName` / `dataSource` exactly — if it doesn't, the wrong component is registered for that name.
- A 500 from the route with `Edge fetch failed` usually means Edge context ID is wrong in `.env.local`; check `SITECORE_EDGE_CONTEXT_ID`.

## Related

- `content-sdk-resolver-patterns` — the catalog of payload shapes the probe will reveal.
- `content-sdk-playground-pattern` — the playground that owns this debug toolkit by default.
- `sitecoreai-cli-cloud-workflow` — pulling local serialized YAML lets you cross-check resolver behavior against authored state.

## References

- [Layout Service / LayoutData GraphQL](https://doc.sitecore.com/xmc/en/developers/xm-cloud/the-layout-service.html)
- [Content SDK `getPage` API](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecoreclient-getpage.html)
