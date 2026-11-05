---
name: blok-components
description: "Catalog of Blok primitives (65+) and composite bloks with registry URLs and the Marketplace quickstart inventory. Use to pick the right Sitecore-styled building block before writing custom markup in a Marketplace app or any Sitecore-styled UI."
license: Apache-2.0
compatibility: "Requires Blok already set up (blok-setup), components.json declaring the @blok registry, and live access to https://blok.sitecore.com/primitives and /bloks."
metadata:
  author: Christian Hahn
  version: "0.2.2"
---

# Blok Component Catalog

Blok ships in two layers:

- **Primitives** — single-purpose components (Button, Input, Dialog). Fine-grained, composable.
- **Bloks** — composite, opinionated blocks made from primitives (Topbar, Sidebar, Dashboard widget). Copy a Blok when you want a ready-made UI region.

All components are installed via the shadcn CLI. See the `blok-setup` skill for the install command form.

> **Canonical source:** <https://blok.sitecore.com/primitives> and <https://blok.sitecore.com/bloks>. The lists below were captured on 2026-04-22 — re-verify before a client project, since the catalog grows.

---

## Primitives (65+)

Install form: `npx shadcn@latest add @blok/<name>` (kebab-case).

### Overlays & dialogs
`accordion`, `alert`, `alert-dialog`, `collapsible`, `context-menu`, `dialog`, `dropdown`, `hover-card` *(if published)*, `popover`, `sheet`, `tooltip`, `sonner` *(toast)*

### Forms & input
`button`, `checkbox`, `combobox`, `command`, `date-picker`, `editable`, `field`, `filter`, `input`, `input-group`, `input-otp`, `label`, `radio-group`, `search-input`, `select`, `select-react-select`, `slider`, `switch`, `textarea`, `time-picker`, `toggle`, `toggle-group`

### Data display
`avatar`, `badge`, `calendar`, `card`, `carousel`, `chart`, `circular-progress`, `empty-states`, `error-states`, `progress`, `skeleton`, `spinner`, `stepper`, `table`, `timeline`

### Layout & navigation
`action-bar`, `aspect-ratio`, `breadcrumb`, `draggable`, `kbd`, `navigation-side`, `navigation-stack`, `navigation-menu`, `pagination`, `resizable`, `scroll-area`, `separator`, `tabs`

### Utility
`icon`

Full list and per-component docs: <https://blok.sitecore.com/primitives>.

### What the Marketplace quickstart actually installs

The shadcn Marketplace quickstart registry URL (`quickstart-with-client-side-xmc.json`) only installs a subset of the primitive catalog. Inventory of `components/ui/` from a fresh Scaffold 2 run (a Marketplace app build, 2026-04-22):

| Installed by quickstart | NOT installed (common gotchas) |
|---|---|
| `alert`, `badge`, `button`, `card`, `collapsible`, `separator`, `skeleton` | `toggle-group`, `radio-group`, `tabs`, `select`, `dialog`, `input`, `table`, and most other primitives |

Anything missing from the left column needs an explicit `shadcn add` after the scaffold. Re-inventory with `ls components/ui/` on a fresh scaffold before trusting this list — the quickstart registry can drift.

### `toggle-group` specifically — not installed by default

`@blok/toggle-group` is in the primitive catalog but **is not pulled in by the Marketplace quickstart**. If you need a segmented-control / radio-group-styled button row, you have two options:

- **Install it post-scaffold:** `npx shadcn@latest add @blok/toggle-group` (requires the `@blok` registry entry in `components.json` — see the `blok-setup` skill, Step 3).
- **Compose a native button group** styled with Blok semantic tokens. Use `<button role="radio" aria-checked>` for single-selection toggles or `<button aria-pressed>` for multi-selection toggles, and style with `bg-primary` + `text-inverse-text` for the selected state, `bg-muted` + `text-muted-foreground` for the unselected state, and `ring-ring` for keyboard focus. This keeps bundle size minimal and doesn't introduce a new registry dependency for a trivial UI pattern (one Marketplace app uses this approach for its viewport + height togglers).

---

## Bloks (composite blocks)

Install form: `npx shadcn@latest add @blok/<name>`.

| Blok | Purpose | Typical use |
|------|---------|-------------|
| `topbar` | Application topbar with logo, tenant switcher, user menu | Any Sitecore-styled app shell |
| `sidebar-rhs` | Right-hand sidebar (properties, inspector, details) | Marketplace apps with a detail/edit pane |
| `site-card` | Card showing a Sitecore site with metadata | Site lists, dashboards |
| `all-site-section` | Section listing all sites | Landing / picker pages |
| `pinned-site-section` | Section showing pinned/favorite sites | Dashboard home |
| `dashboard-widget` | Framed widget for a dashboard | Custom Dashboard Blocks extension |
| `collaboration` | Avatar stack + live presence indicators | Multi-user editing views |

Full list: <https://blok.sitecore.com/bloks>.

---

## Graphics

Blok also provides Sitecore-branded **graphics** (icons, illustrations, logos) at <https://blok.sitecore.com/graphics>. These are not installed via the registry — they are downloaded or referenced from the site's brand portal. Check the Graphics page for the current delivery mechanism before using.

---

## How to pick a component

1. **Is there a matching Blok?** Prefer composites — they encode Sitecore UX patterns and save layout work.
2. **If not, pick a primitive.** Compose primitives rather than reinventing.
3. **Only author custom markup** when neither layer matches — and stay inside Blok tokens from the `blok-theming` skill.

---

## Recording picks in the implementation plan

When planning implementation for a Marketplace app, the picked components go in the plan's scope/files section:

```text
Blok components to install:
  Primitives: button, input, dialog, table, badge
  Bloks: topbar, sidebar-rhs
Registry URL: https://blok.sitecore.com/r/{name}.json
Install command: npx shadcn@latest add @blok/<name>
```

This gives the implementing developer everything they need without opening this file.

---

## Pitfalls

- **Registry URL drift** — always use `{name}.json`, kebab-case. `button.json` not `Button.json`.
- **Missing theme** — components render without Blok colors when `theme.json` wasn't installed first. See the `blok-setup` skill, Step 2.
- **Using primitives when a Blok exists** — composing a topbar from primitives recreates work Sitecore already did and misses accessibility refinements. Check the Bloks list first.
- **Legacy Chakra names leaking in** — if a Stack Overflow answer says `@chakra-ui/...` or `@sitecore/blok-theme`, it is v1 and wrong for new work.
