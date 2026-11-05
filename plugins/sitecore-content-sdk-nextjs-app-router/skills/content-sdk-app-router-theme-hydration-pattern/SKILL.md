---
name: content-sdk-app-router-theme-hydration-pattern
description: "Hydration-safe dark, light and system theme for a Content SDK App Router app on Tailwind v4: preflight script, useSyncExternalStore provider, mounted flag. Use when adding dark mode or on a hydration or theme-flash error."
license: Apache-2.0
compatibility: "Requires Tailwind v4 (CSS-first config), Next.js 13+ App Router, React 18+ (`useSyncExternalStore`). Tested with React 19."
metadata:
  author: Christian Hahn
  version: "0.1.4"
---

# Content SDK — Theme + Hydration Pattern

Dark+light+system theme in SSR apps has four edges that bite: FOUC, hydration mismatch, lint friction on the canonical patterns, and security tooling that blocks the standard inline-script fixes. This skill captures a working configuration that survives all four.

## When to use

- Adding dark mode / theme toggle to a Content SDK App Router head app.
- A "Hydration failed because the server rendered HTML didn't match the client" error appears in browser console.
- "Flash of wrong theme" visible on first paint before React hydrates.
- ESLint complains about `react-hooks/set-state-in-effect` in a theme provider.
- A security hook blocks writing the inline preflight script (the React prop that injects raw HTML strings via a `{ __html: '...' }` object).

## How to perform

Five files, all hydration-safe:

### 1. `public/theme-init.js` — synchronous preflight (external file, NOT inline)

```js
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'system';
    var resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        : theme;
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  } catch (_) {}
})();
```

### 2. `src/app/layout.tsx` — wire it in `<head>`

```tsx
<html lang="en" suppressHydrationWarning>
  <head>
    {/* Sync preflight runs before React hydrates — FOUC prevention.
        Parser-blocking is intentional; the rule is a generic perf hint that
        doesn't apply to a 5-line theme preflight. */}
    {/* eslint-disable-next-line @next/next/no-sync-scripts */}
    <script src="/theme-init.js"></script>
  </head>
  <body><ThemeProvider>{children}</ThemeProvider></body>
</html>
```

### 3. `src/ui/theme-provider.tsx` — `useSyncExternalStore`-based

Uses module-scope subscribe/getSnapshot (NO `useEffect` for storage reads — that triggers the cascading-render lint). Server snapshot returns `'system'` to match the preflight's default. Storage events + matchMedia trigger re-renders.

### 4. `src/ui/theme-toggle.tsx` — mounted-flag for active state

```tsx
const [mounted, setMounted] = useState(false);
// Canonical SSR-safe "after hydration" flag — setState-in-effect IS the
// pattern; useSyncExternalStore gives us `theme`, this flag separately
// guards client-only styling like "which button is active right now."
// eslint-disable-next-line react-hooks/set-state-in-effect
useEffect(() => setMounted(true), []);
// ...
const active = mounted && theme === opt.value;
```

### 5. `src/app/globals.css` — Tailwind v4 token model

```css
@import "tailwindcss";

@theme {
  --color-canvas: #fafaf7;
  --color-ink: #0c0c14;
  /* ... */
}

@custom-variant dark (&:where(.dark, .dark *));

.dark {
  --color-canvas: #0c0c14;
  --color-ink: #f4f4ef;
  /* ... */
}

:root { color-scheme: light; }
.dark { color-scheme: dark; }
```

## Hard Rules

- **NEVER use React's inline raw-HTML injection prop for the preflight script** — the one that takes a `{ __html: '...' }` object and writes the string into the element. Security tooling blocks it (false-positive XSS warning). Use a real file in `public/` referenced via `<script src>`. Same end-result (parser-blocking sync execution), no hook trip.
- **The preflight script's algorithm must match `theme-provider.tsx` exactly.** If they diverge, the first paint and the first React render will disagree. Keep them in sync; treat them as one logical unit.
- **`useSyncExternalStore` for theme reads, NOT `useEffect` + `setState`.** The cascading-render lint fires on the latter; the former is the React 19 canonical pattern for browser-API subscriptions.
- **Server snapshot returns `'system'` always.** Matches the preflight's default-when-no-localStorage. If you return anything else server-side, you'll get a hydration mismatch on the very first paint.
- **Mounted-flag pattern is unavoidable for components whose visible state depends on client-only data.** Examples: active-button highlight, "current theme" label, time-of-day greeting. Accept the one-frame visual delay; that's the cost of SSR safety. Disable `react-hooks/set-state-in-effect` on the `useEffect(() => setMounted(true), [])` call with an inline comment.
- **`suppressHydrationWarning` only silences the `<html>` element's own attribute mismatch.** It does NOT suppress mismatches in children. Fix child mismatches with the mounted-flag pattern.
- **Apply `.dark` class to `<html>`, not `<body>`.** That's where the preflight applies it and where `color-scheme` should sit.
- **Atoms (beta.atoms) compile `dark:` at runtime to `prefers-color-scheme`** unless `globals.css` declares `@custom-variant dark`, which this pattern does (`content-sdk-app-router-atoms` § 7).
- **Tailwind v4 doesn't have `tailwind.config.js`.** All token + variant config goes in `globals.css` via `@theme`, `@custom-variant`, etc.

## Stop Conditions

- **If hydration warnings persist after applying this pattern**, look for OTHER components that branch on browser globals (`typeof window`, `navigator`, `matchMedia`) in their render body. The theme system is not the only source.
- **If FOUC persists**, verify the preflight script is in `<head>` BEFORE `<body>` and is NOT marked `async` or `defer`. Both attributes break parser-blocking.
- **Don't replace `useSyncExternalStore` with a custom `useEffect`+`useState`** because of lint friction — that path leads back to the hydration bug.

## The toggle visibility env gate

If the design system says theme toggles should be hidden in some environments (e.g., embedded mode), gate ONLY the toggle's render, not the provider:

```tsx
const showToggle = process.env.NEXT_PUBLIC_SHOW_THEME_TOGGLE !== 'false';
// ...
{showToggle ? <ThemeToggle /> : null}
```

The provider always mounts so the theme is applied; just the UI surface is conditional.

## Verification

- Hard-refresh the page in light, dark, and system modes. No flash, no console warnings.
- Open browser devtools, check `<html>`'s class — `.dark` matches the resolved theme on first paint.
- Toggle theme → DOM updates instantly. Refresh → choice persists. Set to "system" → OS-level dark mode change propagates without refresh.
- `npm run lint` clean.

## Related

- `content-sdk-app-router-component-scaffold` — for the component file structure context.
- `content-sdk-component-naming-traps` — for where the UI infrastructure (`src/ui/`) should live.

## References

- [Tailwind v4 `@theme` directive](https://tailwindcss.com/docs/v4-beta#design-tokens)
- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
- [Next.js `suppressHydrationWarning`](https://react.dev/reference/react-dom/client/hydrateRoot#suppressing-unavoidable-hydration-mismatch-errors)
