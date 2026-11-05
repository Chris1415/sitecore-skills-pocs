---
name: blok-theming
description: "Blok theming tokens (colors, typography, spacing, radius, shadows, breakpoints) and how to customise while staying on brand: dark mode, RTL, iframe limits. Load before overriding any visual style in a Blok-based app."
license: Apache-2.0
compatibility: "Requires Blok theme.json installed and CSS variables enabled in the consuming app; works alongside next-themes or any standard shadcn dark-mode toggle."
metadata:
  author: Christian Hahn
  version: "0.2.3"
---

# Blok Theming

Blok's theme is applied via **CSS variables + Tailwind config** — installed in the `blok-setup` skill, Step 2, by adding `theme.json`. Do not override raw hex colors or font families in component files — change tokens at the theme level so the whole surface stays coherent.

---

## Token categories

Per <https://blok.sitecore.com/theming>, Blok exposes 8 token categories:

| Category | What it controls | Typical override need |
|----------|------------------|-----------------------|
| **Colors** | Palette and base hues | Rare — Blok colors are the brand |
| **Semantic tokens** | Contextual roles (primary, destructive, muted, accent, background, foreground) | When a surface needs a non-default role |
| **Typography** | Font family, sizes, weights, line-heights | Rare — Blok ships the Sitecore type scale |
| **Spacing** | Margin/padding scale | Rare — stay inside the scale |
| **Sizes** | Component dimensional scale | When a component needs non-standard dimensions |
| **Border radius** | Corner rounding scale | Rare — radius is part of brand |
| **Shadows** | Elevation levels | Rare — elevation is part of brand |
| **Breakpoints** | Responsive breakpoints | When the app has Sitecore-specific viewport ranges (e.g. iframe-constrained Marketplace apps) |

Full per-category reference: <https://blok.sitecore.com/theming>.

---

## Override strategy

Preferred order, from least invasive to most:

1. **Use semantic tokens directly.** `bg-primary`, `text-foreground`, `border-destructive`. These adapt automatically across themes and dark mode.
2. **Scope CSS variable overrides to a container.** If one page needs a muted surface, override `--background` on that container only.
3. **Edit `theme.json` equivalents in the global CSS.** Only for project-wide brand adjustments — document the reason in the PRD or ADR.
4. **Never hardcode hex.** `bg-[#c41230]` defeats the system — future theme updates won't reach that code.

---

## Dark mode

Blok theme variables flip automatically under a `.dark` class on `<html>` (standard shadcn pattern). Use `next-themes` or equivalent — no Blok-specific provider needed.

---

## RTL

Blok includes RTL support. See the RTL guide linked from <https://blok.sitecore.com/resources>. Enable via Tailwind's `dir` utilities or a `dir="rtl"` attribute on the root. Do not hardcode `ml-*` / `mr-*` — use `ms-*` / `me-*` (logical properties).

---

## Iframe-specific theming (Marketplace apps)

Marketplace apps render **inside an iframe** in the Cloud Portal. Two token categories deserve extra attention:

- **Breakpoints** — the iframe width is rarely full-viewport. Test at 800px, 1024px, 1440px widths explicitly.
- **Shadows** — large shadows clip at iframe edges and look wrong. Prefer smaller elevations (`shadow-sm`, `shadow`) in app-shell surfaces.

See the `blok-marketplace-integration` skill for viewport constraints.

---

## Agent guidance

- **When designing UI:** Propose designs using semantic token names (`primary`, `muted`, `destructive`) — not hex codes. Designs that reference Blok tokens are directly implementable.
- **When implementing:** If a UI design specifies a color that doesn't map to any Blok semantic token, stop and ask — don't invent a new token silently.
- **When testing:** Cover both light and dark themes, plus RTL when the app supports non-LTR locales.

---

## Pitfalls

- **Raw hex in components** — breaks dark mode and future theme updates
- **Overriding `--primary` globally** — cascades through every component; scope overrides to containers
- **Tailwind arbitrary values** like `h-[123px]` — usually a smell that a size token was missed; check the Sizes category first
- **Missing `theme.json`** — the #1 cause of "Blok doesn't look right" is forgetting Step 2 in the `blok-setup` skill
- **`--primary-foreground` collapsed onto `--primary` in dark** — verify the pair resolves to a contrasting value in **both** themes before relying on `bg-primary text-primary-foreground`. The Nova preset has shipped with them collapsed in dark mode at least once (a Marketplace app, 2026-04-27 — a share-link strip rendered as an unlabeled pastel bar). When in doubt for buttons styled `bg-primary`, prefer `text-background` as the label color, or scope a local `--primary-foreground` override.

## Color-emoji codepoints are CSS poison for state icons

`❌` (U+274C), `✅` (U+2705), `⚠️` (U+26A0+FE0F), and similar emoji codepoints render as **built-in colored bitmaps** on most platforms. They ignore `color: hsl(var(--destructive))` and any other CSS color, and they ignore dark/light theme entirely. One Marketplace app (2026-04-27) shipped with `❌` in card error states — the result was a giant red-and-white bitmap dominating the panel regardless of theme.

For state icons that must inherit theme color, use:

- **Monochrome glyphs** — `✕` (U+2715) for error/close, `✓` (U+2713) for success, `!` for warning, `i` for info. These render as font glyphs and respect `color`.
- **Inline SVG** with `currentColor` for fill/stroke.
- **Lucide-react icons** (already in Blok dependency tree) — `<XCircle className="text-destructive" />`.

Never use emoji codepoints for any UI element that needs to communicate state via theme color.
