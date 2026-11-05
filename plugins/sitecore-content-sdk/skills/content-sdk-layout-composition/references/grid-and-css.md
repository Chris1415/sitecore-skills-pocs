# Grid parameters, grid definitions and the CSS behind them

## 1. Where a grid class comes from

`GridParameters` (every rendering whose params template inherits `Grid Parameters`) and `ColumnWidth1..8` (Column Splitter) share one field type, **Grid Parameters**, with an **empty source**. The options an author sees in Pages come from the **site's grid definition**:

- Site `Settings` item, field **`Grid Mapping`**: a url-encoded name-value list `{device id}={grid definition id}`. Measured 2026-10-15: 6 of 6 headless sites on one CM mapped the default device to **Bootstrap 5**, the SitecoreAI default.
- Grid definitions under `/sitecore/system/Settings/Feature/Experience Accelerator/`: `Bootstrap 5` (`2472cee0fbb4474b8d1cd8517199cc08`), `Bootstrap 4`, `Bootstrap 3`, `Foundation`, `Grid960`, `GridTailwind`, each with a sibling `Grid Setup` item.
- A definition holds Device items (Extra small .. Extra extra large, with breakpoints), then `Size` / `Offset` / `Order` dropdowns, then option items of template `Class`, whose **`Class`** field is the CSS class. Bootstrap 5 `Size` options `1`..`12` are `col-1`..`col-12`, plus `Auto-fit to full size` = `col`. GridTailwind's `Size` options are `basis-1/12`.., and its `Row Class` is `row flex flex-wrap -mx-4`.
- Definition fields: `DefaultGridParameters` (Bootstrap 5: the `12` option, i.e. `col-12`), `Fixed` (`container`), `Flex` (`container-fluid`), `Row Container Class`, `Wrapping Class`.

Raw vs delivered: the raw layout stores the option item's GUID (`GridParameters=%7B7465D855-992E-4DC2-9855-A03250DFA74B%7D`); **Edge delivers the class** (`col-12`). A literal class name stored raw is passed through unchanged, which is how migrated content arrives (`col-xs-12`).

**Multi-breakpoint values** (measured 2026-10-15 on a Pages-authored splitter): the raw layout stores one option GUID per device, pipe-joined (`ColumnWidth1={col-6}|{col-xxl-4}`), and **Edge delivers them space-joined** (`col-6 col-xxl-4`). Every breakpoint has its own option items, so `col-md-6` is a different GUID from `col-6`. Migrated literals can still arrive `|`-joined (`col-xs-12|col-sm-6`), so `classTokens()` splits on both.

Read the active grid of a site before writing CSS:

```graphql
query { item(where: { path: "/sitecore/content/<collection>/<site>/Settings", language: "en" }) {
  field(name: "Grid Mapping") { value } } }
```

Decode it twice (the inner id is double-encoded), then list the option classes: `item(where:{path:"/sitecore/system/Settings/Feature/Experience Accelerator/Bootstrap 5"})` and walk `children` down to the `Class` items.

## 2. The CSS problem in a Tailwind head app

Every grid class arrives **from the CM at runtime**. A Tailwind build only generates utilities it finds in source, so:

- Bootstrap class names (`row`, `col-md-6`, `container-fluid`) have **no CSS at all**: Tailwind v4 has no Bootstrap grid.
- Even GridTailwind's `basis-1/2` gets **purged** unless something names it in source.

Symptoms: the container is invisible, Row and Column Splitter both stack like rows, and "everything disappears when I drop a splitter" (the editor's drop zones collapse to zero height).

## 3. The fix: a static grid, not a plugin

Pick one:

1. **Static CSS (recommended).** Copy `assets/bootstrap5-grid.css` and `@import` it at the **top** of `src/app/globals.css`, right after `@import "tailwindcss"` (imports must precede every other rule). Plain CSS cannot be purged; it covers `.col`, `.col-auto`, `.col-{1..12}`, `.offset-{0..11}` at every Bootstrap 5 breakpoint (sm 576, md 768, lg 992, xl 1200, xxl 1400), Bootstrap 3 `col-xs-*` aliases for migrated content, and the rows and containers the structure components emit. It sits in `@layer components`, so Tailwind utilities still override it. Tune the gutter with `--grid-gutter-x` (`0` for a gutterless design).
   - **Row and container rules are scoped** to structure output (`.container-default > .component-content > .row`, `.row.column-splitter`, `.column-splitter > * > .row`, the Row Splitter's inner row; `.container-default.container`). An unscoped `.row { margin-inline: -12px }` / `.row > * { padding }` shifted an app's own live `.row` feature band by 12 px and padded its media (measured against the live site; 0 of 12 boxes differ after scoping).
   - **The Container's `.component-content` carries the half gutter**, offsetting the row's negative margin; without it every page with a top-level Container was 12 px wider than the viewport at every width.
   - **The reverse collision is the app's job:** an app rule on a bare `.row`, `.container` or `.col-N` that is unlayered beats the layered grid and takes over the splitter rows (a `.row { width: 100vw; transform }` band did). Grep the app CSS for those selectors and scope or rename them; `check-layout-wiring.mjs` warns (`app-css-collision`).
2. **Upstream plugin.** The starter kit uses npm `tailwind-bootstrap-grid` ^6 in `globals.css` (`@plugin 'tailwind-bootstrap-grid' { container_max_widths: ... }`), `@source inline("col-{1..12}")` and `@source inline("offset-{1..12}")` to stop the purge, plus `tailwind-bootstrap-grid.css` (maps `.col-md-6` to `@apply md:col-6`, `xxl` to `2xl`) and `column-splitter.css`. It works, at the cost of a dependency and three files that must all be present.
3. **Site on GridTailwind.** Safelist every `Class` value of the definition with `@source inline(...)`, read from the CM as in § 1. A class added to the definition later is purged until the safelist follows.

## 4. Editing surface

- An empty placeholder in Pages renders `div.sc-jss-empty-placeholder`. Inside a flex `.row` it shrinks to its "+" button. The static grid gives it `flex: 1 0 100%` and a minimum height. Do the same inside any custom slot (`layout-grid.css`).
- **Give the root element the class `component`.** Pages refreshes styles live by finding it (Sitecore's "build your first component" guide); upstream structure components and the hardened copies do.
- **A column's width is set by selecting the column itself** (not the Column Splitter, whose panel only manages columns, and not a component in it): Design → Layout → Size, Mobile first, then Override inheritance at a larger breakpoint. Pages gives a new column `col-6` at Mobile.
- **A local editing host** (Pages pointed at `http://localhost:<port>`) is called with the **CM environment's** editing secret (`/api/editing/config?secret=…`); the app's `SITECORE_EDITING_SECRET` must equal it or every editing request answers 401. Read it with the Deploy API `GET /api/environments/v1/{cmEnvironmentId}/obtain-editing-secret` (compare by hash, never print it) and restart the dev server after changing `.env.local`.
- Check Pages in a real browser after any grid change. **Turbopack does not hot-reload `globals.css`** in the Content SDK dev server: stop it, `rm -rf .next`, restart, and grep the served CSS chunk for a new selector before trusting a refresh.

## 5. Grid classes on ordinary components

Grid params are not only for structure. Any rendering whose params template inherits `Grid Parameters` (every rendering built on `BaseRenderingParameters`) gets a size picker in Pages, and the class arrives in `params.GridParameters`. Placed inside a Container or a column (whose inner element is `.row`), components sized `col-md-6` sit side by side **without any splitter**. That only works if each component puts `styleClasses(params)` on its root element, which means it must accept `params` at all: components scaffolded with `fields` only need the prop added. A component that ignores its params silently drops the author's choice, and nothing reports it. Which components may be sized below 12 at all is their fit tier (`policy-and-fit.md` § 3).

`headless-main` itself is not a `.row`, so top-level siblings never flow side by side; put them in a Container.
