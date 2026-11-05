---
name: content-sdk-layout-composition
description: "Authored page layout in a Content SDK head app: Container, row and column splitters, grid params, dynamic placeholders, layout policy, container-query fit tiers. Use for columns or nested layout, or a splitter renders stacked. Not variants."
license: Apache-2.0
compatibility: "@sitecore-content-sdk/nextjs 2.4.x App Router (placeholder resolution read in react 2.4.0); Pages Router uses the same keys with <Placeholder>. Measured on a SitecoreAI CM with the JSS Experience Accelerator Page Structure renderings and the Bootstrap 5 grid, 2026-10-15; field-tested the same day on a live site (human-built and agent-built pages, preview only). Scripts: check-layout-wiring.mjs and lint-layout.mjs Node 18+, test-layout-params.mjs Node 22.18+; no dependencies."
metadata:
  author: Christian Hahn
  version: "0.2.2"
---

# Content SDK: layout composition

Authors build page layout in Pages by nesting **structure renderings** (Container, Column Splitter, Row Splitter) and by sizing components with **grid parameters**. The CM already ships all of it. The head app has to supply three things, and each fails silently when missing: the React components, the right placeholder names, and CSS for grid classes that arrive from the CM at runtime.

## When to use

- A page or design needs columns, rows, a sidebar, a split hero, a bento grid, or nested sections an author can rearrange.
- Porting or scaffolding a head app that authors will compose in Pages (the scaffold ships none of the structure components).
- Symptoms: "Container — missing React implementation", columns stacking like rows, an invisible container, a splitter that makes everything vanish, children that never render inside a column, the class `undefined` in the DOM, a grid size picked in Pages with no effect.

**Not for:** several looks of one component (`content-sdk-variants-vs-siblings`), repeating rows of one content type (`content-sdk-list-component`), header and footer chrome via Partial Designs (`content-sdk-website-build-flow`).

## The model in four facts

1. **Placeholder keys.** Edge delivers `container-{*}`, `column-N-{*}`, `row-N-{*}` and puts the instance id in `params.DynamicPlaceholderId`. Name the child placeholder `column-${n}-${DynamicPlaceholderId}`: the SDK matches it against `^column-N-\d+$`. The literal `column-N-{*}` also works. A fixed name such as `column-1` finds nothing, and nothing errors.
2. **Active slots.** Edge emits all eight column or row keys every time. `EnabledPlaceholders` (`1,2`, sometimes unsorted: `1,3,2,4`) is the only record of which are in use.
3. **Grid classes come from the site's grid definition** (Bootstrap 5 by default), stored as one option GUID per breakpoint and delivered by Edge as space-joined class names: `ColumnWidth1: "col-12 col-md-8"`. They are runtime strings, so a Tailwind build never generates CSS for them.
4. **`params.styles` is computed by the SDK** from GridParameters + Styles, and is **absent** when both are empty. Interpolating it prints `undefined`.

Detail and evidence: `references/standard-structure.md` (renderings, params templates, placeholder settings, Edge shape, SDK resolution, writing a layout programmatically), `references/grid-and-css.md` (grid definitions, the CSS fix, the editing surface) and `references/policy-and-fit.md` (policy, responsive matrix, fit tiers, container queries).

## The layout policy

**At every nesting level exactly one mechanism decides widths.** Full table, matrix and measurements: `references/policy-and-fit.md`.

- **Container** owns the section (one per section, directly in `headless-main`). **Column Splitter** owns the horizontal split via `ColumnWidthN`. **Component grid size** (`GridParameters`) is for uniform peers straight in a Container. **Row Splitter** only for styled row bands. **Slot component** for brand compositions picked as a preset. A **fixed-layout component** when the arrangement is not the author's to change.
- **Depth:** Container → (Column Splitter | slot component) → components; one extra splitter level is the single exception. **A row holds one thing.** **Inside a column or slot a component is never sized.** **12 is often right**: a component that lays out its own items belongs at 12.
- **Responsive:** Mobile is always 12, set first (Pages gives a new column `col-6` at Mobile). The narrowest column stacks first, never below ~240 px. No orphans. Standard layouts:

| Desktop | Tablet | Mobile | Classes |
|---|---|---|---|
| 12 | 12 | 12 | `col-12` |
| 6/6 | 6/6 | 12 | `col-12 col-md-6` |
| 8/4 · 4/8 | 8/4 | 12 | `col-12 col-md-8` / `col-12 col-md-4` |
| 9/3 · 3/9 | 12 | 12 | `col-12 col-lg-9` / `col-12 col-lg-3` |
| 4/4/4 | 12 | 12 | `col-12 col-lg-4` |
| 3/3/3/3 | 6/6 | 12 | `col-12 col-md-6 col-lg-3` |

- **Component fit:** a column placeholder does not know its width, so fit belongs to the component. Each head app keeps `src/lib/layout/component-fit.ts` (template `assets/component-fit.ts`): **chrome** (Partial Designs only), **section** (top-level Container at 12 only), **wide** (≥ 6/12 wherever it sits side by side), **flexible** (any column ≥ 240 px). It is a living list: when a case does not fit, re-tier the component or **adapt it with container queries** so it responds to its own width, not the viewport (`policy-and-fit.md` § 4).

## Procedure: structure components

1. **Copy the helper**: `assets/layout-params.ts` → `src/lib/layout/layout-params.ts`. Never place it under `src/components/`, where generate-map registers every file as a rendering (`content-sdk-component-naming-traps`).
2. **Copy the components** from `assets/components/`: `Container.tsx`, `ColumnSplitter.tsx`, `RowSplitter.tsx`, each into `src/components/<Name>/<Name>.tsx`. The file name must equal the `componentName`. They are upstream's markup with the defects fixed (no `undefined` class, `EnabledPlaceholders` order with a fallback, a placeholder name that survives a non-numeric id). Keep `PartialDesignDynamicPlaceholder` from the scaffold.
3. **Add grid CSS**: `@import` `assets/bootstrap5-grid.css` at the top of `src/app/globals.css`, right after `@import "tailwindcss"`. It is plain CSS (the build cannot purge it), scoped to the rows the structure components emit, and styles empty drop zones in Pages. **Then grep the app's own CSS for bare `.row`, `.container`, `.col-N` rules** and scope or rename them: an unlayered app rule beats the layered grid. Another grid definition: read its classes first (`references/grid-and-css.md` § 1).
4. **Make ordinary components honour grid params**: add a `params` prop where a component takes only `fields`, and put `className={cx('component <own-classes>', styleClasses(params))}` on its root element.
5. **Nested placeholders always use `AppPlaceholder`** with the server map (`import componentMap from '.sitecore/component-map'`). The bare `Placeholder` resolves the client map in App Router, and every child renders "unknown component".
6. `npm run sitecore-tools:generate-map`; check the keys `Container`, `ColumnSplitter` and `RowSplitter` are present, and update any component-map key snapshot test the app keeps.
7. **Write the fit file** (`assets/component-fit.ts` → `src/lib/layout/component-fit.ts` + `component-fit.json`), every rendering with a tier and a reason.
8. **CM side**: confirm the three JSS Page Structure renderings are in the site's Available Renderings. They usually are, but a site can repurpose the group.
9. Run `node scripts/check-layout-wiring.mjs --app <head-app>`, then **Verification** below.

## Procedure: custom slot component

Follow `references/custom-layout-component.md`:

1. Decide the slot prefix, the slot count and the presets.
2. Create the items: a params template on `BaseRenderingParameters` + `IDynamicPlaceholder`, one Placeholder Settings item per slot (`<prefix>-N-{*}`), and a Json Rendering with `Placeholders` and `OtherProperties = IsRenderingsWithDynamicPlaceholders=true`. Then Available Renderings, and Style items for the presets. Item mechanics: `content-sdk-create-component`.
3. Copy `assets/components/LayoutGrid.tsx` + `layout-grid.css` and adapt `PREFIX` and `PRESETS`.
4. Run the reference's § 6 probe on a throwaway page before the first real use. The CM wiring and delivery were field-tested; authoring a slot component in Pages has not been yet.

## Traps

| Symptom | Cause | Fix |
|---|---|---|
| "Container — Content SDK component is missing React implementation" | The scaffold ships no structure components | Step 2 |
| Columns stack like rows; container invisible; dropping a splitter "deletes" the page | No CSS for the runtime grid classes, or it was purged | Step 3 |
| Children never render inside a column; console "Placeholder 'column-1' was not found" | A fixed placeholder name | `slotName()` |
| Children render as "Placeholder X contains unknown component" | Bare `Placeholder`, which uses the client map | `AppPlaceholder` + server map |
| `class="row component column-splitter undefined"` | Raw `${params.styles}` | `styleClasses(params)` |
| Eight columns render, six of them empty | Slots taken from `rendering.placeholders` | `enabledSlots(params)` |
| Author sets a width in Pages, nothing changes | The component ignores its params | Step 4 |
| The Column Splitter panel has no width control | Widths live on each **column** | Select the column, then Design → Layout → Size |
| A fresh two-column splitter stays side by side on phones | Pages gives a new column `col-6` at Mobile | Set 12 at Mobile, override at a larger breakpoint |
| An app's own `.row` band shifts or gets padded after adding the grid | An unscoped grid `.row` rule | The scoped `bootstrap5-grid.css` (0.2.0+) |
| Splitter rows turn into the app's own 100vw band | The app's unlayered `.row` rule wins | Scope the app rule (`app-css-collision`) |
| The page is 12 px wider than the viewport | Row negative margin with no padded parent | The grid's Container padding (0.2.0+) |
| A component overflows or breaks words in a narrow column | It sizes itself by the viewport | Re-tier it, or make it container-aware (`policy-and-fit.md` § 4) |
| Pages on a local editing host gets 401 on `/api/editing/config` | `.env.local` secret is not the CM environment's editing secret | `grid-and-css.md` § 4 |
| A layout written through GraphQL renders nothing | Not Pages' delta form, or `updateItem` without `version: 1` | `standard-structure.md` § 4a |
| Grid change not visible locally | Turbopack does not hot-reload `globals.css` | Stop the dev server, `rm -rf .next`, restart |
| A Bootstrap 3 `col-xs-*` from migrated content | The source grid survived migration | The static grid aliases `col-xs-*` |
| Content vanishes after switching a preset | It sits in a slot the new preset does not render | Switch back, or render overflow slots while editing |

## Verification

Static checks prove the wiring; only a rendered page proves the layout.

- `node scripts/check-layout-wiring.mjs --app <dir>`: missing grid CSS, partial structure set, fixed keys, bare Placeholder, unguarded `styles` and slots taken from `placeholders` (FAIL or WARN); components ignoring their params (WARN). Exit 1 on FAIL. `--self-test` runs its fixtures and a mutation sweep.
- `node scripts/test-layout-params.mjs --self-test`: the helper against param shapes captured from Edge.
- `node scripts/lint-layout.mjs --site <s> --route </path> --env-file <app/.env.local> --fit <app>/src/lib/layout/component-fit.json` (or `--layout <edge-layout.json>`): checks a delivered page against the policy (depth, one thing per row, unstyled Row Splitter, sized component in a column), the responsive rules (12 on Mobile, orphans, columns under 240 px) and the fit tiers (section in a column, wide below 6/12, chrome on a page). Point `--env-file` at a PREVIEW context for unpublished pages; in Git Bash prefix `MSYS_NO_PATHCONV=1`. Run it after a page is composed, by an agent or an author.
- **One real page**: a Container holding a two-column Column Splitter with a component in each column. Read its layout (`content-sdk-debug-layout-probe`), then render it in a real browser at a mobile and a desktop width: the columns sit side by side at `md` and stack below it. Jest masks every failure above, because a mocked layout never carries `{*}` keys or runtime classes.
- **In Pages edit mode**: an empty column shows a full-width drop zone, and changing a column width or style refreshes live.
- **After adapting a component**: re-measure the pages that already use it at full width (element boxes before and after) before re-tiering it.
