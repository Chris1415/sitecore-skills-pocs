---
name: content-sdk-app-router-route-handler-vs-server-action
description: "Next.js App Router: Server Action vs Route Handler. Server Actions refresh the router, so using one for reads from a client component wipes state in a loading loop. Use when adding an endpoint a client component calls or debugging refreshes."
license: Apache-2.0
compatibility: "Next.js 13+ App Router. Applies equally to React 18 and React 19. Examples assume the canonical App Router file layout (`src/app/api/...` for route handlers, `'use server'` files for actions)."
metadata:
  author: Christian Hahn
  version: "0.3.1"
---

# Next.js — Route Handler vs Server Action

Server Actions and Route Handlers both run on the server and can be invoked from client components. They look interchangeable — but they're not. Picking the wrong one for the wrong job produces a class of "page mysteriously refreshes after every interaction" bugs that take hours to diagnose.

## When to use

- Adding any server-side endpoint that a client component will call.
- Debugging a Next.js app where the page seems to reload / re-render unexpectedly after user interactions.
- Scaffolding a new API surface and unsure which primitive to reach for.
- Reviewing PRs that introduce `'use server'` files or `src/app/api/...` routes.

## The one-line decision rule

- **Server Action** = the server is going to **change state** (DB write, file write, external API mutation, cache invalidation, redirect after action). The auto-refresh of the RSC tree is a FEATURE — your client UI should re-render with the new server state.
- **Route Handler** = the server is going to **return data** (read from DB / API / GraphQL, compute a value, look something up). The lack of auto-refresh is a FEATURE — your client state survives the call.

In other words: **mutations → Server Action. Reads → Route Handler.**

## How the auto-refresh side-effect works

Every Server Action invocation, after returning, triggers Next.js to:

1. Refetch the React Server Component tree for the current route
2. Update any RSC state with the new data
3. Re-render the entire route

This is correct for mutations: after you write data, you want the UI to reflect the new server state without manual cache busting.

This is **catastrophic for reads from client components** that hold local state:

```
User hovers nav item
  → client state: open=true, loading=true
  → fetch via Server Action
  ← Server Action returns data
  → Next.js auto-refreshes RSC tree
  → entire route re-renders
  → CLIENT STATE IS LOST (NavBranch unmounts/remounts)
  → fresh render: open=false, loading=false, dropdown gone
  → user re-hovers, repeat
```

This produces the classic "endless loading flicker" symptom. Indistinguishable from a hover-state bug until you realize the page itself is re-rendering.

## Quick comparison

| Concern | Server Action | Route Handler |
|---|---|---|
| File | Any `.ts`/`.tsx` with `'use server'` directive, or inline `async function` in a Server Component | `src/app/api/<path>/route.ts` with `export function GET/POST/...` |
| Invocation from client | Direct function call (`await myAction(args)`) | `await fetch('/api/path?...')` |
| Type safety | Yes — full TS contract through the function signature | Manual — must parse JSON, validate at boundary |
| **Auto-refreshes RSC tree** | **YES** — every call | **NO** — pure response |
| Cacheable via HTTP | Limited (action-specific) | Yes — standard `Cache-Control`, Next.js `fetch` cache, CDN |
| Testable in isolation | Hard (needs RSC runtime context) | Easy — `curl`, Postman, Vitest with `fetch` mock |
| Streaming | Limited | Yes via `ReadableStream` / `NextResponse` |
| Best for | Mutations (write/delete/update), form submissions, redirects | Reads (GET data, compute, lookup), webhooks, public APIs, BFF endpoints for client components |

## Canonical examples

### ✅ Server Action — form submission that writes

```ts
// app/posts/[id]/actions.ts
'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';

export async function updatePostTitle(postId: string, title: string) {
  await db.posts.update({ where: { id: postId }, data: { title } });
  revalidatePath(`/posts/${postId}`);   // explicit cache invalidation
}
```

```tsx
// app/posts/[id]/EditTitle.tsx
'use client';
export function EditTitle({ id }: { id: string }) {
  return (
    <form action={(formData) => updatePostTitle(id, formData.get('title') as string)}>
      <input name="title" />
      <button>Save</button>
    </form>
  );
}
```

Why this is right: writing to the DB is a mutation; the auto-refresh ensures the form's surrounding UI (which reads the post title from a Server Component) reflects the new title.

### ✅ Route Handler — read called from a client hover

```ts
// src/app/api/nav-children/route.ts
import { NextResponse } from 'next/server';
import client from 'src/lib/sitecore-client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parent = searchParams.get('parent');
  if (!parent) return NextResponse.json({ error: 'parent required' }, { status: 400 });
  const result = await client.getData(NAV_BRANCH_QUERY, { parent });
  return NextResponse.json(result.item?.children ?? []);
}
```

```tsx
// src/lib/navigation/nav-branch.tsx
'use client';
export function NavBranch({ item }) {
  const [children, setChildren] = useState(null);
  const onHover = async () => {
    const r = await fetch(`/api/nav-children?parent=${item.path}`);
    setChildren(await r.json());
  };
  return <li onMouseEnter={onHover}>...</li>;
}
```

Why this is right: it's a read; no server state is changing. The hover handler updates LOCAL state. A Server Action would auto-refresh the route and wipe `children` (and any other client state in the tree).

### ❌ Anti-pattern — Server Action for a read

```ts
'use server';
export async function fetchNavChildren(parent: string) {
  return client.getData(NAV_BRANCH_QUERY, { parent });    // a READ
}
```

```tsx
'use client';
const onHover = async () => {
  const children = await fetchNavChildren(item.path);     // ← triggers router.refresh()
  setChildren(children);                                   // ← state set, then immediately wiped by the refresh
};
```

Symptom: dropdown opens → data loads → page "reloads" → dropdown closes → user re-hovers → repeat. **The page isn't actually doing a hard browser reload; it's an RSC refresh that resets your component tree.**

## Hard Rules

- **Server Actions auto-trigger `router.refresh()` after returning.** This is documented but easy to miss. Plan around it.
- **Reads from client components use Route Handlers.** If you find yourself reaching for a `'use server'` function to fetch data on hover/click/scroll/visibility, stop and write a route handler instead.
- **Mutations should use Server Actions** (or accept the manual `router.refresh()` boilerplate if you really want a route handler — usually not worth it).
- **Pure data lookups from a Server Component are NEITHER** — they're just async function calls in the Server Component body. Server Actions and Route Handlers are both for cross-runtime invocation (client → server).
- **`revalidatePath` / `revalidateTag` belong inside Server Actions — except for server-to-server webhooks.** A Route Handler called by an external system (an Experience Edge publish webhook → `/api/revalidate`, see `content-sdk-app-router-cache-components-and-osr`) is the correct home: there is no client to refresh. Any other route handler calling them is a mutation and probably should be a Server Action.
- **If a route handler is called frequently** (e.g., on every hover), add an HTTP cache header (`Cache-Control: public, max-age=60`) or use Next.js's `fetch` cache to dedupe upstream calls.
- **Server Actions can return data**, but the returned value is consumed BY THE CLIENT after the auto-refresh fires. So if the client's state depends on the returned value, the state will be set AFTER the refresh wipe — sometimes that's fine (component remounts and uses fresh data), sometimes it produces the flicker. Route handlers are the cleaner contract for "client decides what to do with the data."
- **Form actions (`<form action={...}>`) inherently mutate from the user's perspective** (POST + redirect/refetch). Server Actions are correct there even when the "action" technically reads.

## Stop Conditions

- **Don't add `'use server'` to a file you just want to "make server-side."** Server-side execution and the Server Action runtime are different things. Pure server-side computation in a Server Component is just an async function call, no directive needed.
- **Don't put route-handler-like logic in a Server Action and call it from many client components.** Each call refreshes the RSC tree — N parallel calls = N refreshes. Use a route handler.
- **Don't fight the auto-refresh with `experimental_useOptimistic` or manual state-restore.** That's papering over the wrong architectural choice. Switch to a route handler.
- **Don't use route handlers for true mutations expecting cache invalidation.** Without `revalidatePath`/`revalidateTag` (which only exist server-side and are awkward to call from a route handler), your other server-rendered UI won't reflect the write.

## Verification

- **Open Network tab.** Server Action invocations show up as POST requests to the current route URL with a special `next-action` header. Route Handler invocations show up as your declared HTTP method to the route URL.
- **Open React DevTools.** After invocation, look for "Update Server Components Tree" events (Server Action) vs nothing (Route Handler).
- **Stamp `window.__probe = Date.now()` before the call and check after.** Both should preserve the window object (no full browser navigation), but the RSC refresh from a Server Action will re-render client components from scratch (their state resets), while a Route Handler leaves them alone.

## Migration sketch — converting a misused Server Action to a Route Handler

```diff
- // src/lib/foo/actions.ts
- 'use server';
- import { fetchSomething } from '@/lib/source';
- export async function getSomething(id: string) {
-   return fetchSomething(id);
- }
+ // src/app/api/foo/route.ts
+ import { NextResponse } from 'next/server';
+ import { fetchSomething } from '@/lib/source';
+ export async function GET(request: Request) {
+   const id = new URL(request.url).searchParams.get('id');
+   if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
+   return NextResponse.json(await fetchSomething(id));
+ }
```

```diff
  // some-client-component.tsx
  'use client';
- import { getSomething } from '@/lib/foo/actions';
  const onSomething = async () => {
-   const data = await getSomething(id);
+   const r = await fetch(`/api/foo?id=${encodeURIComponent(id)}`);
+   const data = await r.json();
    setData(data);
  };
```

That's the entire migration. The function signature semantics are identical from the client's perspective (both are `(id) => Promise<Something>`); only the side-effect on the RSC tree differs.

## Related

- `content-sdk-app-router-component-level-navigation` — the worked Sitecore example where this skill's rule was learned the hard way (Server Action for a nav lazy-read caused the endless flicker).
- `content-sdk-debug-layout-probe` — uses a Route Handler (correctly) for the layout-debug endpoint; another example of "read → handler."

## References

- Next.js Server Actions docs: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
- Next.js Route Handlers docs: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- React's `useOptimistic` (used to mask the refresh delay on Server Actions, not to suppress the refresh): https://react.dev/reference/react/useOptimistic
