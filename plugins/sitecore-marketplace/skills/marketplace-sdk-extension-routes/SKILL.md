---
name: marketplace-sdk-extension-routes
description: "Post-scaffold step for a Marketplace app: pick Cloud Portal extension points, generate a Next.js App Router route for each, and produce the App Studio values. Use right after scaffolding or when adding an extension point."
license: Apache-2.0
compatibility: "Requires a Next.js App Router project scaffolded via setup-marketplace-client-side or setup-marketplace-full-stack; runs after scaffold completes."
metadata:
  author: Christian Hahn
  version: "0.4.3"
---

# Sitecore Marketplace Extension-Point Routes

## When to use

- **Immediately after** `setup-marketplace-client-side` or `setup-marketplace-full-stack` succeeds — the scaffold ships a single `app/page.tsx`; this skill turns it into the N routes the Cloud Portal will bind to.
- Before (or alongside) Cloud Portal registration in the `marketplace-sdk-lifecycle` skill, § 3 — the route values you pick here are what get pasted into **App Studio → Extension points → Route URL**.
- When the user adds a new extension point to an existing app (e.g. "also expose this as a dashboard widget") — re-run the skill for the new point only.

For **extension-point capabilities per point** (queries available, iframe constraints), see the `marketplace-sdk-client` skill, § 7.
For **Cloud Portal registration flow** (what form fields exist), see the `marketplace-sdk-lifecycle` skill, § 3.

---

## 1. Extension-point reference

The Cloud Portal **Extension points** form exposes five options. Each maps to an SDK enum value (`marketplace-sdk-client` skill, § 7) and a **fallback Route URL** that the portal suggests if you don't override it.

| # | Display label (portal) | Area | SDK enum | Fallback Route URL | Multiple paths? |
|---|------------------------|------|---------|---------------------|-----------------|
| 1 | **Standalone** — Full screen in Cloud Portal | Cloud Portal shell (umbrella — sees *all* installs across the org) | `standalone` | `/portal` | No — single route |
| 2 | **Full screen** | SitecoreAI | `xmc:fullscreen` | `/full-screen` | No — single route |
| 3 | **Dashboard widgets** | SitecoreAI | `xmc:dashboardblocks` | `/sitecoreai-dashboardwidget` | **Yes — one route per widget** |
| 4 | **Page context panel** — left-hand panel | Page builder / SitecoreAI | `xmc:pages:contextpanel` | `/pages-context` | No — single route |
| 5 | **Custom field** — right-hand panel or context panel | Page builder / SitecoreAI | `xmc:pages:customfield` | `/sitecoreai-customfield` | No — single route |

Fallbacks are examples the portal ships — override them to match your app's naming convention. For multi-brand apps (SitecoreAI-specific vs generic), pick prefixes that make ownership obvious.

---

## 2. Prompt flow (what the agent asks)

Run this verbatim after scaffold success. Do not assume — always ask.

### Prompt 1 — select extension points (multi-select)

```
Which Cloud Portal extension points will this app support? (pick one or more)
  [ ] 1. Standalone — Full screen in Cloud Portal
  [ ] 2. Full screen — SitecoreAI
  [ ] 3. Dashboard widgets — SitecoreAI (supports multiple routes)
  [ ] 4. Page context panel — Page builder / SitecoreAI
  [ ] 5. Custom field — Page builder / SitecoreAI
```

### Prompt 2 — route URL per selected point

For **each** selected point (one prompt per point):

```
Route URL for <display label>? [fallback: <fallback from § 1>]
```

Rules:
- Must start with `/`.
- Lowercase + kebab-case (matches portal convention).
- No trailing slash.
- Must be unique across the app's routes.

### Prompt 3 — Dashboard widgets multi-path (only if # 3 selected)

```
Dashboard widgets can expose multiple widget routes (one per widget tile).
How many widget routes? [default: 1]
```

Then for each: repeat Prompt 2 with a widget-specific label, e.g. `"Route URL for Dashboard widget 1? [fallback: /sitecoreai-dashboardwidget]"`. When count > 1, the fallback for widgets 2..N should be derived (e.g. `/sitecoreai-dashboardwidget-2`, `-3`, …) and confirmed.

### Prompt 4 — landing route

The scaffold's `app/page.tsx` (root `/`) is the demo page. Ask:

```
How should the root route "/" behave?
  (a) Keep the scaffold demo (application-context + listLanguages)
  (b) Redirect to one of the extension-point routes (specify which)
  (c) Return 404 / empty — not part of the app's surface
```

### 2e. Invalid input handling

If the user enters anything outside the documented set for any of Prompts 1–4, **re-prompt with the same options** — do not silently convert or assume a default. Examples:

- Prompt 1 with `"six"` or `"8"` — out-of-range number. Re-prompt the full multi-select list.
- Prompt 2 with `"portal"` (no leading `/`) or `"/Portal"` (uppercase) — violates § 2 Route URL rules. Re-prompt with the fallback and the specific rule that failed ("must start with `/`" / "must be lowercase").
- Prompt 3 with `"0"` or a negative number — re-prompt with the default hint.
- Prompt 4 with `"d"`, `"yes"`, or anything outside `a/b/c` — re-prompt showing only the three valid letters plus a one-line reminder of each option.

When re-prompting, echo back what the user entered and name the rule that rejected it. Never guess what they meant ("you said `d`, I'll assume `a`") — that hides the miscommunication and bakes in the wrong answer.

### 2f. Changing a selection mid-flow

If the user changes their mind after a prompt has been answered (e.g. "actually, make that Page context panel instead" after selecting Standalone), **restart the affected prompts from the changed point, not the whole skill**:

- Change in Prompt 1 (extension-point set) → re-run Prompts 2 + 3 from scratch; Prompt 4 answer is preserved only if it still references a valid new route.
- Change in Prompt 2 (route URL) → re-run that single prompt; Prompt 4 is re-asked only if it referenced the changed route.
- Change in Prompt 3 (widget count) → re-run Prompts 2 only for the affected widget indices.
- Change in Prompt 4 (root behavior) → re-run that single prompt.

Clear any partial file generation before restarting — if you already wrote `app/<old-route>/page.tsx`, delete it before the new prompt cycle so the route table stays consistent with the final answer. State what was deleted and why.

Hard rule: never carry forward a partial earlier answer that the restart invalidates. Example — if Prompt 2 named a route `/portal` and the user later drops Standalone from Prompt 1, the `/portal` answer is dead; do not reuse it for a different extension point.

---

## 3. Generating Next.js App Router files

For each (extension point, route) pair — including every Dashboard widget route — create:

```
app/<route-without-leading-slash>/page.tsx
```

Examples:
- Route `/portal` → `app/portal/page.tsx`
- Route `/full-screen` → `app/full-screen/page.tsx`
- Route `/pages-context` → `app/pages-context/page.tsx`
- Dashboard widget routes `/widgets/traffic` + `/widgets/performance` → `app/widgets/traffic/page.tsx` + `app/widgets/performance/page.tsx`

Pick the template variant that matches the page's job:

| Variant | When | Key imports |
|---------|------|-------------|
| **§ 3a Full hooks** | Page calls SDK queries/mutations (typical default) | `useMarketplaceClient`, `useAppContext` |
| **§ 3b Reads-only** | Page only displays `appContext` — no SDK calls | `useAppContext` only |
| **§ 3c Redirect** | Prompt 4 option (b) — root `/` redirects to an extension-point route | `redirect` from `next/navigation` |
| **§ 3d 404** | Prompt 4 option (c) — root `/` returns 404 | `notFound` from `next/navigation` |

### 3a. Full hooks template (default)

Use when the page actually calls the SDK. The scaffold's `MarketplaceProvider` hooks (from `setup-marketplace-client-side` or `setup-marketplace-full-stack`) provide both client and context.

```tsx
"use client";

import { useAppContext, useMarketplaceClient } from "@/components/providers/marketplace";

export default function <ExtensionPointName>Page() {
  const client = useMarketplaceClient();
  const appContext = useAppContext();

  // Extension-point-specific UI goes here.
  // See the marketplace-sdk-client skill, § 7, for which queries / subscriptions this extension point supports.
  // For sitecoreContextId extraction, see the marketplace-sdk-xmc skill, § 6a — guard before use, do not cast.

  return <div>{/* ... */}</div>;
}
```

### 3b. Reads-only variant

Use when the page only reads `appContext` — for example, a Page context panel that shows the selected page's metadata without issuing XMC calls. Importing `useMarketplaceClient` here would be unused and trip `@typescript-eslint/no-unused-vars`.

```tsx
"use client";

import { useAppContext } from "@/components/providers/marketplace";

export default function <ExtensionPointName>Page() {
  const appContext = useAppContext();

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold">{appContext.name ?? "App"}</h1>
      <pre className="bg-muted p-2 rounded text-xs overflow-auto">
        {JSON.stringify(appContext, null, 2)}
      </pre>
    </div>
  );
}
```

Promote to § 3a the moment the page needs to call `client.query(...)`.

### 3c. Redirect template (Prompt 4 option b)

Use only for the **root** `app/page.tsx` when Prompt 4 answer was (b). Keeps `/` out of the extension-point surface by redirecting into the real route.

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/<target-route>");  // e.g. "/pages-context"
}
```

No `"use client"` directive — `redirect()` runs at render time on the server. No hooks, no provider access.

### 3d. 404 template (Prompt 4 option c)

Use only for the **root** `app/page.tsx` when Prompt 4 answer was (c). Returns Next.js's `not-found` page for requests to `/`, making it clear the app has no landing surface.

```tsx
import { notFound } from "next/navigation";

export default function RootPage() {
  notFound();
}
```

Same server-side rules as § 3c — no `"use client"`, no hooks.

**Per-extension-point guidance for what goes inside:**

| Extension point | Typical content | Supported queries |
|-----------------|-----------------|-------------------|
| Standalone | Full portal-area UI — dashboards, tool landings, multi-environment admin UIs | All base + XMC (no `pages.context`). **Umbrella surface** — `application.context.resourceAccess[]` lists every installation of the app across the organisation (one per SitecoreAI install, each with its own live + preview `sitecoreContextId`). XMC calls scope via the chosen install's contextId, so one Standalone app can drive many environments. Worked pattern: the `marketplace-sdk-xmc` skill, § 2c. |
| Full screen | Full-pane SitecoreAI tool | All base + XMC (no `pages.context`) |
| Dashboard widget | Compact widget — single-metric, chart, quick action | Limited to dashboard scope; each widget route is independent |
| Page context panel | Left-hand panel beside the Pages canvas — reads selected page | Base + XMC + **subscribable** `pages.context` (via the `marketplace-sdk-client` skill, § 6a) |
| Custom field | Right-hand / in-canvas field editor — reads + writes a single field | `pages.context` + `getValue` / `setValue` (read/write surface — see the `marketplace-sdk-client` skill, § 3d + § 3e). Field-change events via `client.subscribe('pages.content.fieldsUpdated', …)` (see the `marketplace-sdk-client` skill, § 6b); filter by `fieldId` / `itemId` client-side. |

Do not copy-paste Dashboard widget code between widget routes — each one is its own logical surface. Share logic via hooks, not via duplicated files.

---

## 4. Cloud Portal registration output

After Prompt 2–3 are answered, emit this table for the user to paste into **Cloud Portal → App Studio → your app → Extension points**:

```
Extension point          | Route URL
-------------------------|---------------------------------
Standalone               | <user-chosen or fallback>
Full screen              | <user-chosen or fallback>
Dashboard widgets #1     | <user-chosen or fallback>
Dashboard widgets #2     | <user-chosen or fallback>
...
Page context panel       | <user-chosen or fallback>
Custom field             | <user-chosen or fallback>
```

Only emit rows for extension points the user selected in Prompt 1. Each Dashboard widget row becomes a separate extension-point entry in the portal.

---

## 5. Common pitfalls

### 5a. Running this before scaffold
The templated `page.tsx` files import `@/components/providers/marketplace` — that module only exists after Scaffold 2/3. Run this skill **after** the scaffold, not before.

### 5b. Forgetting to update Cloud Portal
Creating the Next.js routes is only half the job. The portal binds extension points by **Route URL** — if you change a route later, update App Studio too or the iframe will load the old URL and break the handshake (see the `marketplace-sdk-testing-debug` skill, § 6c).

### 5c. Using the root `/` route for an extension point
The scaffold's `app/page.tsx` is a demo. If you bind an extension point to `/`, that demo becomes production. Prompt 4 exists to force the decision — don't skip it.

### 5c-bis. Root `/` template fires inside `<MarketplaceProvider>` — § 3c and § 3d never resolve outside the portal iframe

The scaffold wraps `<MarketplaceProvider>` at `app/layout.tsx`, which means every route — including the root `/` — renders as a child of that provider. The provider's state machine renders `<div>Attempting to connect to Sitecore Marketplace...</div>` until `ClientSDK.init()` resolves against a parent window. **Outside the portal iframe (i.e. visiting `http://localhost:3000/` directly in a browser), that init never resolves** — the provider sits on the loader forever and the § 3c `redirect()` / § 3d `notFound()` page never renders.

**Inside the portal iframe** this is a non-issue: widgets and extension points are loaded by their own route URLs, never `/`. The trap bites only during local smoke tests.

Two ways to handle it:

- **(a) Accept the trap.** Document for your team that local smoke tests must hit a widget / extension-point route directly (`http://localhost:3000/<your-extension-route>`), never `/`. This is the default for most harnesses — simplest, zero refactor.
- **(b) Move `<MarketplaceProvider>` out of the root layout.** Introduce a per-extension-point layout (e.g. `app/(marketplace)/layout.tsx` or `app/dashboard/layout.tsx`) that wraps only the extension-point routes. The root `/` then renders provider-free and the redirect / 404 templates work exactly as documented. More refactor, cleaner long-term story.

Pick one explicitly during architecture so the implementing developer knows which pattern to use. Do not leave the root route and provider-wrap decision implicit — it surfaces as a "why does my redirect hang?" bug every time.

### 5d. Dashboard widgets as a single route
Dashboard widgets are the **only** extension point that supports multiple routes. Binding all widgets to one route means one React component has to switch based on some context param — the portal doesn't pass a "which widget" identifier cleanly. One route per widget is cleaner.

### 5e. Naming that fights the portal
The fallback `/sitecoreai-*` names make sense inside SitecoreAI but look out of place in a generic custom app. Pick names that match the app's brand — but keep them lowercase + kebab-case so the portal UI doesn't reject them.

### 5f. Case sensitivity
Route URLs are case-sensitive in the portal **and** in Next.js. `/Full-Screen` and `/full-screen` are different routes. Stay lowercase.

---

## 6. Agent guidance

**During architecture:** Before finalizing the ADR, list which extension points the app will target and record the route URLs in the architecture doc. The ADR drives the Cloud Portal registration values; if it's blank here, the implementing developer has to guess.

**During implementation planning:** the plan's stack/tooling section must include: (a) the list of extension points from this skill's Prompt 1, (b) the route URLs from Prompt 2–3, (c) a discrete task per `app/<route>/page.tsx` file to create, (d) Prompt 4's answer for the root `/` route. The Cloud Portal registration table (§ 4) is an output artifact the user will need.

**During testing:** Every route URL registered in the portal must also resolve in the running app (and vice versa — no orphan routes). Test scenarios: (a) navigate to each registered route and verify the page loads, (b) verify the portal binding actually opens the correct page, (c) for Dashboard widgets, verify each widget route renders the right widget.

**During implementation:** Do not invent route URLs — use the ones in the implementation plan exactly. When adding a new extension point later, re-run this skill (Prompts 1–4) rather than hand-rolling a route.
