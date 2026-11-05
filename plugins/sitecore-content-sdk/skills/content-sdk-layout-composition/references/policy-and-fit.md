# Layout policy, responsive matrix and component fit

Set by the author and field-tested on a live SitecoreAI site on 2026-10-15 (four human-built and agent-built test pages, measured at 390 / 576 / 768 / 992 / 1200 / 1400 px). Sitecore's own guidance points the same way: *prioritize changing the grid settings of a rendering over using splitters* ("Recommendations: structuring pages", SitecoreAI developer docs).

These are defaults. A site may deviate when its design needs it; record the deviation in the site's fit file or decision log.

## 1. One width owner per level

At every nesting level exactly one mechanism decides widths. Mixing them is what makes layouts unpredictable.

| Mechanism | Owns | Use it for | Never |
|---|---|---|---|
| **Container** | the section: contained vs full-bleed, background, vertical rhythm | one per page section, directly in `headless-main` | deciding columns; sitting inside a column |
| **Column Splitter** | the horizontal split (`ColumnWidthN` only) | columns with *different* content stacks (content + sidebar, text + media) | components inside it carrying their own grid size (they stay at 12) |
| **Component grid size** (`GridParameters`) | the component's own width | *uniform peers* placed straight into a Container (3 stats, 4 cards) | combined with a splitter on the same level |
| **Row Splitter** | per-row styling inside one section | only when rows need their own background / style band | plain vertical stacking: a placeholder already stacks |
| **Slot component** | a brand composition chosen as a preset | 2:1 hero, bento: shapes the grid cannot express or that must stay on-brand | components inside it sizing themselves |

Structural rules:

1. **Depth:** Container → (Column Splitter | slot component) → components. One more splitter level (e.g. Container → Row Splitter → Column Splitter) is the single allowed exception; anything deeper is redesign material, usually a slot-component preset.
2. **A row holds exactly one thing:** one Column Splitter, or components. A second band is another row, never a Container inside the row.
3. **Peers vs stacks:** same-kind peers get component grid sizes; different stacks get a Column Splitter; a fixed brand shape gets a slot component.
4. **Inside a column or slot, a component is never sized.**
5. **12 is often right.** A component that lays out its own items (card list, stat band) belongs at 12, not inside a splitter that imitates its grid.

The author's sequence in Pages is therefore: drop a Container → either drop components (and size them with Design → Layout → Size) or drop a Column Splitter (Row Splitter only for styled bands) → size each column by selecting the column → drop components into columns.

## 2. Responsive matrix

Desktop layout → what it becomes on smaller screens. "Pages" is the Size value set per column (Design → Layout → Size), Mobile first, larger breakpoints by **Override inheritance**. Pages names: Mobile (xs), Mobile large (sm 576), Tablet (md 768), Desktop small (lg 992), Desktop (xl 1200), Desktop large (xxl 1400).

| Desktop | Tablet | Mobile | Pages per column | Delivered classes | Narrowest column measured |
|---|---|---|---|---|---|
| **12** | 12 | 12 | 12 everywhere (no splitter) | `col-12` | full |
| **6/6** | 6/6 | 12 | Mobile 12 → Tablet 6 | `col-12 col-md-6` | 372 px at 768 |
| **8/4**, **4/8** | 8/4 | 12 | Mobile 12 → Tablet 8 / 4 | `col-12 col-md-8` / `col-12 col-md-4` | 248 px at 768 |
| **9/3**, **3/9** | 12 | 12 | Mobile 12 → Desktop small 9 / 3 | `col-12 col-lg-9` / `col-12 col-lg-3` | 242 px at 992 |
| **4/4/4** | 12 | 12 | Mobile 12 → Desktop small 4 | `col-12 col-lg-4` | 323 px at 992 |
| **3/3/3/3** | 6/6 (2×2) | 12 | Mobile 12 → Tablet 6 → Desktop small 3 | `col-12 col-md-6 col-lg-3` | 242 px at 992 |

Rules behind it:

1. **Mobile is 12, set first.** Pages gives a NEW column `col-6` at Mobile, so a fresh two-column splitter stays side by side on a phone until the author changes it (measured on a human-built page). Exception: small uniform peers (stats, logos) may stay 6/6 on Mobile.
2. **The narrowest column stacks first; no column below ~240 px.** That is why 9/3 stacks on tablet while 8/4 does not. The 3-columns sit at 242 px at 992: fine for compact components; for text-heavy content split them from Desktop (1200) instead.
3. **No orphans:** at every breakpoint the columns divide evenly into lines (2×2, never 2+1). 4/4/4 therefore goes straight from stacked to three across.

## 3. Component fit

A column placeholder does not know its width: `column-1-{*}` is 12 on Mobile and 3 on Desktop. So Pages' Allowed Controls cannot say "only if at least 6 wide"; fit is a property of the **component**, declared per head app and checked by `lint-layout.mjs`.

| Tier | Where it may go | 12 | 6/6 | 8/4 · 4/8 | 9/3 · 3/9 | 4/4/4 | 3/3/3/3 |
|---|---|---|---|---|---|---|---|
| **chrome** | Partial Designs only (header, footer, consent), never on a page | — | — | — | — | — | — |
| **section** | directly in a top-level Container at 12; never in a column or slot | yes | no | no | no | no | no |
| **wide** | at least 6/12 wherever it sits side by side | yes | either side | the 8 side | the 9 side | no | no |
| **flexible** | any column of 240 px or more | yes | yes | both | both | yes | yes |

**The fit file** lives in the head app, `src/lib/layout/component-fit.ts` (+ a generated `component-fit.json` the lint reads), every rendering listed with its tier and a one-line reason. Template: `assets/component-fit.ts`. Keep a unit test that the two agree and that every component folder is covered. It is a living list: when a case does not fit, either **re-tier** (the component does or does not work at that width) or **adapt** the component so it earns a more flexible tier (§ 4). Measured on one brand app: 2 flexible, 8 wide, 14 section, 5 chrome, 4 structure; almost every brand band is section-only until someone makes it container-aware.

## 4. Adapting a component: container queries

A component built against the viewport (media queries, `vw` type) picks its desktop layout inside a 314 px column at a 1280 px viewport. Measured: a stat band's 2×2 readout overflowed into the next column ("710 km" bled over, "2.6 s" collided with "3"); a quote band kept full-size type and split words mid-word, 925 px tall in a 427 px column.

The fix is to respond to the component's own width:

```css
.statband { container: statband / inline-size; }
.statband .readout { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@container statband (max-width: 900px) { .statband .readout { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container statband (max-width: 560px) { .statband .readout { grid-template-columns: minmax(0, 1fr); } }
.quoteband { container: quoteband / inline-size; }
.quoteband blockquote { font-size: clamp(2rem, 5.4cqi, 4.4rem); overflow-wrap: normal; word-break: normal; hyphens: manual; }
```

- The component's **root** becomes the named container; its inner elements query it. A container cannot query itself, so the root's own padding stays as it was.
- Use `cqi` units in `clamp()` for type that should scale with the component.
- Pick thresholds so the **full-width** rendering is unchanged: in the field test the single-column switch moved from 360 px to 560 px because the viewport layout already stacked below 560 px; full-width pages re-measured with 0 boxes moved > 2 px.
- **Do not combine with "Auto-fit to content"** (`col-auto`): inline-size containment makes a content-sized element collapse.
- Regression-test full width before and after (element boxes on the pages that already use the component); then re-tier it in the fit file.
