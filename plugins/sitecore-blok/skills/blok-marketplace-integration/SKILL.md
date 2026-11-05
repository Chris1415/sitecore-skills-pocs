---
name: blok-marketplace-integration
description: "How Blok works inside a Marketplace app: iframe size limits per extension point, which Bloks fit where, shell patterns, theming in iframes, public-app submission checklist. Load when building a Marketplace app with Blok UI."
license: Apache-2.0
compatibility: "Requires a Sitecore Marketplace app running in the Cloud Portal iframe, Blok already installed, and @sitecore-marketplace-sdk/client."
metadata:
  author: Christian Hahn
  version: "0.2.2"
---

# Blok × Marketplace SDK

Blok is the design system; the Marketplace SDK is the runtime. Together they produce Marketplace apps that look native to the Cloud Portal.

Load alongside:
- The `marketplace-sdk-client` skill — SDK base
- The `marketplace-sdk-lifecycle` skill — extension points + app architecture
- The `blok-setup`, `blok-components`, `blok-theming` skills — Blok fundamentals

---

## Extension point → Blok shell recommendation

| Extension point | Recommended shell | Notes |
|-----------------|-------------------|-------|
| **Full Screen** | `@blok/topbar` + main content area + optional `@blok/sidebar-rhs` | Mirrors the Cloud Portal layout — users stay oriented |
| **Pages Context Panel** | No topbar; compact primitives (`card`, `badge`, `separator`, `action-bar`) | Narrow width — avoid bloks designed for full-width |
| **Dashboard Blocks** | `@blok/dashboard-widget` as the outer frame | One registration per block; widget frame is sized by portal host |
| **Sites Context Panel** | `@blok/site-card` variants + primitives | Matches Sites listing visual language |

When the implementation plan lists components, match the extension point to the shell pattern above.

---

## Iframe viewport constraints

Marketplace extension iframes are not full-viewport:

| Extension point | Typical width | Typical height |
|-----------------|--------------|----------------|
| Full Screen | 1024–1920px | 600–1080px |
| Pages Context Panel | 320–400px | variable, scrollable |
| Dashboard Block | 300–800px | 200–400px |
| Sites Context Panel | 320–400px | variable |

See the `marketplace-sdk-client` skill, § 7, for authoritative numbers.

**Implications for Blok choices:**
- **Topbar** only fits Full Screen reliably — it is too tall for panels
- **Tables** need `scroll-area` wrappers in panels or the whole app overflows
- **Large shadows** clip at iframe edges — prefer `shadow-sm` in panel shells
- **Breakpoints** — Blok's `md`/`lg` breakpoints map poorly inside panels; treat panel shells as mobile-first

---

## Theming inside iframes

- The Cloud Portal passes theme preference (light/dark) into the iframe. Respect it — do not force one mode.
- Read host theme via the Marketplace SDK (`pages.context` or equivalent from the `marketplace-sdk-client` skill) and toggle the `.dark` class on the iframe's `<html>`.
- Never render a visible border/background that fights the portal chrome — Blok's `bg-background` is the safe default.

---

## Auth + loading states

- Initial SDK handshake takes 100–500ms — show `@blok/skeleton` placeholders during this window, not a spinner
- For empty tenants or missing permissions, use `@blok/empty-states` and `@blok/error-states` with Marketplace-appropriate copy (refer users to the Cloud Portal, not to a marketing page)

---

## Submission / public-app checklist (Blok-related)

Before submitting a Marketplace app for public listing:

- [ ] `theme.json` was installed; no raw hex colors in component code
- [ ] All primitives and bloks used are from the canonical registry (not copied from Stack Overflow / forked)
- [ ] Dark mode tested at all iframe widths
- [ ] RTL tested if the app targets non-LTR locales
- [ ] No `@sitecore/blok-theme` (Chakra v1) dependency anywhere in `package.json`

Full submission requirements live in the `marketplace-sdk-lifecycle` skill, public-app submission sections.

---

## Pitfalls

- **Using Topbar in a Context Panel** — visually wrong and wastes vertical space; use primitives instead
- **Hardcoding iframe width** — iframes are resized by the portal; use responsive Blok tokens, not `w-[1024px]`
- **Fighting the portal theme** — users reported that apps with forced-light or forced-dark themes feel "foreign"; always honor the host preference
- **Missing SDK handshake during skeleton** — Blok skeletons look right but if the SDK never connects, they persist forever; always pair skeletons with a timeout → `empty-states` / `error-states`
