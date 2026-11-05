# Base map detail — full type shapes + sitecoreContextId extraction

The SKILL.md gives you the QueryMap / MutationMap / SubscribeMap tables at a glance. This file expands the two key context-shape interfaces (`ApplicationContext` and `PagesContext`) and walks through the canonical sitecoreContextId extraction pattern with the cast-vs-guard discussion.

## ApplicationContext shape

```typescript
interface ApplicationContext {
  id: string;
  url: string;
  name?: string;
  type?: string;           // 'portal' | 'xmc:xmapps' | 'xmc:pages-contextview'
  installationId?: string;
  organizationId?: string;
  permissions?: { iframe?: { sandbox?: string[]; allow?: string[] } };
  resourceAccess?: Array<{
    resourceId: string;
    tenantId: string;
    tenantName?: string;
    context: { live: string; preview: string };  // ← sitecoreContextId values
  }>;
  extensionPoints?: Array<{ ... }>;
}
```

### Getting `sitecoreContextId`

```typescript
const appCtx = await client.query('application.context');
const resourceAccess = appCtx.data?.resourceAccess ?? [];
const contextId = resourceAccess[0]?.context?.live
                ?? resourceAccess[0]?.context?.preview;
// contextId is typed: string | undefined
```

`context.live` and `context.preview` are both typed `string | undefined`. The optional-chain above propagates that — **`contextId` is `string | undefined`, never plain `string`**.

**Do NOT cast with `as string`.** The shadcn quickstart (`components/examples/built-in-auth/with-xmc/list-languages.tsx`) ships this anti-pattern — treat it as a post-scaffold edit, not a template. Casting silently papers over the undefined case; the XMC call then fires with `undefined` in the query string and returns 401/403 with no type-level warning.

**Correct pattern — guard clause before use:**

```typescript
const contextId = appCtx.data?.resourceAccess?.[0]?.context?.live;
if (!contextId) {
  setError('No Sitecore context available for this app');
  return;
}
// contextId is narrowed to string from here on — no cast needed
await client.query('xmc.sites.listLanguages', {
  params: { query: { sitecoreContextId: contextId } },
});
```

**Or — typed helper for reuse across components:**

```typescript
import type { ApplicationContext } from '@sitecore-marketplace-sdk/client';

export function requireContextId(ctx: ApplicationContext | null): string {
  const id = ctx?.resourceAccess?.[0]?.context?.live
           ?? ctx?.resourceAccess?.[0]?.context?.preview;
  if (!id) throw new Error('Sitecore context unavailable — app not bound to a resource');
  return id;
}
```

Both patterns satisfy the `as never` / `as any` ban from SKILL.md § 8a: they narrow through runtime guards, not casts. See the `marketplace-sdk-xmc` skill, § 6a, for the same rule from the XMC side.

## PagesContext shape

```typescript
interface PagesContext {
  siteInfo?: {
    id?: string;
    name?: string;
    displayName?: string;
    language?: string;
    supportedLanguages?: string[];
    properties?: { isSxaSite?: boolean };
    permissions?: { canAdmin?, canWrite?, canCreate?, canDelete?, canPublish? };
  };
  pageInfo?: {
    name?: string;
    id?: string;
    version?: number;
    displayName?: string;
    path?: string;
    url?: string;
    template?: { name: string; id: string; displayName: string };
    permissions?: { canWrite?, canDelete?, canCreate?, canPublish? };
    workflow?: any;
    publishing?: { hasPublishableVersion?, isPublishable? };
  };
}
```

`pages.context` is only available in the Pages editor extension points (`xmc:pages:contextpanel`, `xmc:pages:customfield`). It is **subscribable** via path A (subscribe-via-query) — see the `references/subscriptions.md` reference for the mechanism.

### Which `pageInfo.*` field do you match on?

When the panel needs to match the current page against external rules (e.g. "is this page the source / target of a redirect?"), pick the field deliberately — they differ:

| Field | What it is | Use for |
|---|---|---|
| `pageInfo.route` | The **clean published path** (e.g. `/about`) | **Matcher key for content rules.** This is what you want for redirect / personalization / variant matching. |
| `pageInfo.url` | The published URL **with editor query string** (e.g. `/about?sc_site=solo-website&sc_lang=en`) | Display only — don't match on this; the `sc_site` / `sc_lang` query params will break exact-string matches. |
| `pageInfo.path` | The Sitecore item tree path (e.g. `/sitecore/content/<COLLECTION>/<SITE>/Home/About`) | Tree-walking / item-tree operations — NOT the matcher key for URL-based rules. |

Verified against a real tenant 2026-05-11: a Context Panel matcher that initially used `pageInfo.url` saw zero matches on `/foo` because the actual value was `/foo?sc_site=…`. Switching to `pageInfo.route` resolved it. The takeaway: **for URL-based matching, the canonical matcher key is `pageInfo.route`**.

## ApplicationContext is tenant-scoped, not site-scoped

The `ApplicationContext.resourceAccess[]` entries identify **tenants**, not individual sites. Embedding the same app as `xmc:dashboardblocks` on two different site dashboards within the same tenant yields **identical `ApplicationContext` snapshots** — there is no per-site signal in `ApplicationContext`. Dashboard widget designs that assume a per-site context get bitten by this.

**Workaround for site-scoped widgets:**

- Best (when available): use `pages.context` in a `xmc:pages:contextpanel` placement — that channel does carry `siteInfo`.
- For `xmc:dashboardblocks` (which doesn't have `pages.context`): enumerate sites via `xmc.sites.listSites` and expose a **site picker** to the user. Persist the choice in `localStorage` so it carries across reloads. The widget's job is then "show stats for the picked site"; the SDK does not tell the widget which site the parent dashboard is currently showing.
- Best-effort fallback: scan `document.referrer` (the parent Cloud Portal page URL) and `window.location.search/hash` for any site slug that matches a known site name. This works opportunistically — `document.referrer` is the strongest signal — but Cloud Portal does not guarantee it carries the site, so design for picker-falls-back-cleanly.

Verified 2026-05-11 on a redirect-manager app: the Dashboard Widget was embedded on multiple site dashboards in the same tenant; `ApplicationContext` was identical across all of them; site picker fallback is the honest UX.
