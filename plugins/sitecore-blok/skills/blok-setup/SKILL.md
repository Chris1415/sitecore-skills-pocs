---
name: blok-setup
description: "Exact commands to add Blok to a project: shadcn init, Blok theme, registry aliases, first component, Tailwind v4 notes. Use when scaffolding a Sitecore-styled UI or asked for the Sitecore design language. Never Chakra or legacy blok-theme."
license: Apache-2.0
compatibility: "Requires Node 18+, npm 10+, Tailwind v3 or v4, React 18+, and network access to https://blok.sitecore.com/r/* via npx shadcn."
metadata:
  author: Christian Hahn
  version: "0.4.2"
---

# Blok Setup

## When to use

- A new app has been scaffolded (Content SDK head, Marketplace app, or plain Next.js/Vite) and now needs Blok-styled UI
- An existing app without Blok needs to adopt it
- The user asks for UI matching "Sitecore design language", "Blok", or references Marketplace app visual consistency

Do **not** install Chakra or `@sitecore/blok-theme` — that's legacy Blok v1. Always use the shadcn registry path below.

---

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Node.js | 16+ | shadcn CLI requirement |
| npm | 10+ | or pnpm/yarn equivalent |
| Tailwind CSS | v3 or v4 | must be configured before `shadcn init` |
| React | 18+ | primitives assume modern React |
| TypeScript | Recommended | registry components ship with `.tsx` + types |

For Next.js projects, Tailwind is enabled via the `--tailwind` flag at `create-next-app` time.
For Vite projects, shadcn auto-detects Vite during init.

---

## Step 1 — Initialize shadcn

```bash
npx shadcn@latest init
```

Follow the prompts:

- **Base color:** pick any (Blok's theme overrides this in step 2)
- **CSS variables:** yes (required — Blok theme uses CSS vars)
- **Import alias:** default `@/*` is fine

This creates `components.json` at the project root.

---

## Step 2 — Install the Blok theme

**Run this before adding any component.** The theme provides the CSS variables that all Blok primitives and bloks depend on.

```bash
npx shadcn@latest add https://blok.sitecore.com/r/theme.json
```

This writes Blok's color, typography, spacing, radius, and shadow tokens into your global CSS and Tailwind config.

---

## Step 3 — Register the Blok registry (optional but recommended)

Adding Blok as a named registry in `components.json` lets you reference components as `@blok/button` instead of the full URL.

Edit `components.json` to add:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "registries": {
    "@blok": "https://blok.sitecore.com/r/{name}.json"
  }
}
```

After this, installs become:

```bash
npx shadcn@latest add @blok/button @blok/card @blok/dialog
```

Without the registry entry, use the full URL form: `npx shadcn@latest add https://blok.sitecore.com/r/button.json`.

---

## Step 4 — Add components

Individual primitive:

```bash
npx shadcn@latest add @blok/button
```

Multiple at once:

```bash
npx shadcn@latest add @blok/button @blok/card @blok/dialog @blok/input
```

A full blok (composite block):

```bash
npx shadcn@latest add @blok/topbar
npx shadcn@latest add @blok/sidebar-rhs
npx shadcn@latest add @blok/dashboard-widget
```

See the `blok-components` skill for the full catalog.

---

## Step 5 — Verify

1. Imports resolve via the `@/` alias: `import { Button } from "@/components/ui/button"`
2. Tailwind classes apply Blok colors (e.g. `bg-primary`, `text-foreground`)
3. Dev server renders a Button with Sitecore styling (rounded corners, Blok primary color)

If styling looks generic shadcn instead of Blok: the theme wasn't installed — re-run Step 2.

---

## Fonts — Geist already ships with Nova preset

The Nova preset's scaffolded `app/layout.tsx` already loads **Geist Sans** and **Geist Mono** via `next/font/google`. Do **not** additionally `npm install geist` and import from `geist/font/sans` — that adds a parallel font loader that fights the scaffolded one (duplicate `@font-face` rules, two sets of CSS variables, flash of unstyled text on cold loads).

Instead: **use the scaffolded `next/font/google` loader** and, if your project / Tailwind layer expects the canonical `--font-sans` / `--font-mono` variable names, rename Next's emitted variables to those names:

```tsx
// app/layout.tsx — scaffolded form, renamed to canonical variable names
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

**Heads-up:** the scaffolded `app/globals.css` contains a self-referential token declaration that looks broken at first glance — something like:

```css
--font-sans: var(--font-sans);
```

It is **not** a bug. The `var(--font-sans)` on the right-hand side is the variable that `next/font/google` publishes on the `<body>` (from `geistSans.variable` above); the `--font-sans` on the left is the Tailwind / Nova token consumers reference. The rule only becomes meaningful once `app/layout.tsx` sets the outer variable with a real font loader. A newcomer inspecting `globals.css` in isolation can spend five minutes staring at the no-op CSS rule before the layering clicks — flag it so future builders skip the detour.

---

## Tailwind v4 / Nova preset — tokens live in CSS, not JS

Blok's Nova preset is **Tailwind v4**, which is CSS-first. There is **no `tailwind.config.ts`** in a scaffolded project (verify with `ls` — you won't find one). Design tokens (colors, shadows, motion, typography, spacing, radius) live in `app/globals.css` inside the `@theme inline { … }` block, not in a JS config file.

When an implementation plan, ADR, or code-review checklist references "extend the Tailwind config" or "add a color to `tailwind.config.ts`", that's **Tailwind v3 language**. Translate to v4 before acting:

| v3 (legacy) | v4 / Nova preset (current) |
|---|---|
| Extend colors in `tailwind.config.ts` → `theme.extend.colors` | Add `--color-<name>: …;` inside `@theme inline { … }` in `app/globals.css` |
| Extend spacing / typography in `theme.extend.*` | Add `--spacing-<name>` / `--font-<name>` inside `@theme inline { … }` |
| Declare keyframes in `theme.extend.keyframes` + animation in `theme.extend.animation` | `@keyframes <name> { … }` at the top level of `app/globals.css` + `--animate-<name>: <name> <duration> <easing>;` inside `@theme inline { … }` |
| `plugins: [require('tailwindcss-animate')]` | `@import "tw-animate-css";` at the top of `app/globals.css` (the quickstart already does this) |

No `tailwind.config.ts` file is present, needed, or correct to create for Nova preset work. If an implementation plan says "edit tailwind.config.ts", treat that as a doc bug and patch the token inside `@theme inline { … }` in `globals.css` instead.

---

## Forbidden shortcuts

- **Do not** `npm install @sitecore/blok-theme` — that's the deprecated Chakra v1 route
- **Do not** copy components from the Blok site by hand — always use `shadcn add` so future updates are traceable
- **Do not** skip the theme install — components will render with shadcn defaults (wrong colors, wrong radius)
- **Do not** create a `tailwind.config.ts` "to extend Blok" — Nova is Tailwind v4; extend `@theme inline { … }` in `app/globals.css` instead (see section above)
- **Do not** commit node_modules or the registry JSON; only the generated component files

---

## Post-setup handoff

Record in your project's dependencies log (or the implementation plan's dependencies section):

- `shadcn` CLI used (version auto-resolved via `@latest`)
- `components.json` exists with `@blok` registry entry
- Components installed: `<list>` (from `components/ui/` directory)
- Tailwind config file modified (Blok tokens merged)

No package-lock entry is added for Blok itself — it's code-owned, not dependency-managed.
