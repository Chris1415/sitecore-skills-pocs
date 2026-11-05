# A custom layout component with its own slots

For a layout the splitters cannot express (a two-to-one hero split, a bento grid, a sidebar with a sticky rail), build ONE rendering that owns N dynamic placeholders and lets the author pick a preset. The CM wiring mirrors the OOTB Column Splitter exactly (`standard-structure.md` § 1-3), so the recipe copies it.

> **Evidence level.** Field-tested 2026-10-15 on a live site (preview only): a 5-slot rendering created exactly as in § 2, placed twice on one page with two presets. Edge delivered all five `layout-grid-N-{*}` keys on both instances with distinct `DynamicPlaceholderId` values, the preset arrived as its Style `Value`, and the head app rendered both presets at four widths. **Not yet exercised: authoring a slot component in Pages** (dropping into slots, switching presets with content in them); run § 6 steps 2, 5 and 6 in Pages before relying on the author experience.

## 1. Decide the shape first

- **Slot prefix**: a namespaced stem, e.g. `layout-grid`. Slots become `layout-grid-1-{*}` .. `layout-grid-N-{*}`. Avoid `container`, `column`, `row`: they collide with the OOTB keys.
- **Slot count N**: the largest preset's count. All N keys are wired once; a preset renders fewer.
- **Preset mechanism**: one of
  - **Styles (recommended).** Create Style items under the site's `Presentation/Styles` (a group such as "Layout"), each with a `Value` that is a preset token (`layout-grid--two-one`) and `Allowed renderings` = this rendering. The author picks it under Styling in Pages; Edge delivers the token in `params.Styles` (measured: Styles arrive as class names). No new params field, no new UI.
  - **A droplist param** (`LayoutPreset`, namespaced: generic names such as `Layout` or `Type` collide with base fields and vanish in Pages, `content-sdk-component-naming-traps`). Droplist stores the item NAME, which is what you want in a param.
- **Datasource**: usually none. If the layout itself carries authored content (a heading over the grid), give it a datasource like any component, and keep `UsePlaceholderDatasourceContext` off unless children should inherit that context.

## 2. CM items

Create with the Authoring GraphQL mutations in `content-sdk-create-component` (clone-first; cloning the JSS Column Splitter and relinking is the shortest path), under the project's module paths so serialization owns them (`sitecoreai-serialization`).

| Item | Where | Fields |
|---|---|---|
| Parameters template `<Name> Parameters` | `/sitecore/templates/Project/<collection>/Rendering Parameters/` (or Feature) | Create it with `createItemTemplate` and a `baseTemplates` list (cleaner than cloning). Bases: `BaseRenderingParameters` (which inherits `IStyling` → Styles, `IComponentVariant` → FieldNames, `Grid Parameters` → GridParameters), `IDynamicPlaceholder` (`/sitecore/templates/Foundation/Experience Accelerator/Dynamic Placeholders/Rendering Parameters/IDynamicPlaceholder`, gives `DynamicPlaceholderId`), `IRenderingId`, `_PerSiteStandardValues`. Own fields only for a droplist preset. Without `Base Rendering Parameters` Page Builder does not treat the template as rendering parameters at all. |
| Placeholder Settings, one per slot | `/sitecore/layout/Placeholder Settings/Project/<collection>/<Name>/` | `Placeholder Key` = `layout-grid-1-{*}` .. `layout-grid-N-{*}`; `Editable` = 1; `Allowed Controls` optional (§ 3). |
| Json Rendering `<Name>` | `/sitecore/layout/Renderings/Project/<collection>/` | `componentName` = the head-app file name; `Parameters Template` = the template above; **`Placeholders`** (shown as "Layout Service Placeholders") = the N settings ids, pipe-separated; **`OtherProperties`** = `IsRenderingsWithDynamicPlaceholders=true`; no Datasource Template unless § 1 says so; an icon (`content-sdk-icon-chooser`). |
| Available Renderings | the site's `Presentation/Available Renderings/<group>` | add the rendering id, or it is missing from the Pages toolbox. |
| Style group (Styles preset) | the site's `Presentation/Styles/<group>` | template `Styles`; **`Type` = `droplist`** (one preset at a time; `checkbox-folder` makes them stackable), `AllowEmpty` as wanted. |
| Style items | inside that group | `Value` = preset token; `Allowed Renderings` = this rendering. |

`IsRenderingsWithDynamicPlaceholders=true` is what makes the platform number the keys (`layout-grid-1-<id>` in the raw layout) and deliver them in `{*}` form. Without it, every instance on a page would share one key.

## 3. Allowed Controls

Unset (the OOTB default: 0 of the 17 structure keys restrict) means any rendering can be dropped into a slot. Set `Allowed Controls` on a slot's Placeholder Settings item when the slot has a job, e.g. slot 1 of a hero split only takes media. Each slot has its own settings item, so each can differ. Multisite: the settings item is shared by every site that uses the rendering; per-site restrictions need a forked rendering with its own settings items: fork, never mutate a shared rendering.

## 4. Head app

Copy `assets/components/LayoutGrid.tsx` to `src/components/<Name>/<Name>.tsx` and `assets/components/layout-grid.css` beside your global styles, then:

1. Set `PREFIX` to the key stem from § 1, exactly.
2. Edit `PRESETS`: token → slot count. Keep the default preset's count at least 1 so a fresh drop shows a slot.
3. Write one CSS rule per preset (CSS grid with `grid-template-columns` / `grid-template-areas`, collapsing to one column on small screens). Plain CSS in `@layer components`: the tokens arrive from the CM and a Tailwind build would purge utilities it never saw. Use `minmax(0, Nfr)` tracks, and keep every track wide enough for the components authors drop in: a 4-track bento at 768 px gave 174 px tracks and an ordinary contact block overflowed the page, so the template's bento uses 2 tracks on tablet and 4 from 1024 px. A slot is a column: the components in it follow `policy-and-fit.md` § 3.
4. Keep `styleClasses(params)` on the root and the `component` class, so GridParameters and live style refresh work.
5. `npm run sitecore-tools:generate-map` and check the new key equals `componentName`.

Children need nothing special: they are ordinary renderings rendered by `AppPlaceholder`, which injects `page` and `componentMap`.

**Changing a preset's slot count later strands content.** Components placed in slot 4 of a 5-slot preset stay in the layout when the author switches to a 3-slot preset, but nothing renders slot 4. They reappear on switching back. Document this for authors, or render overflow slots in a trailing row in editing mode.

## 5. Nesting

Slots can hold Containers, splitters or other layout components; each instance gets its own `DynamicPlaceholderId` from the per-page counter, so nested keys never collide. Keep nesting shallow (two levels is typical): every level adds Edge layout depth, and deep layouts make the Pages canvas hard to select in.

## 6. Probe before the first real one

On a throwaway page (never a live page; first prove which tenant your write tool is bound to, with a throwaway item read back through an independent instrument):

1. Create the items in § 2 with N = 2.
2. Place the rendering twice on one page in Pages and drop a different component into each of the four slots.
3. Read the Edge preview layout (`content-sdk-debug-layout-probe`): expect `placeholders` keys `layout-grid-1-{*}` and `layout-grid-2-{*}` on both instances, with distinct `DynamicPlaceholderId` values.
4. Read the raw `__Final Renderings`: expect `layout-grid-1-<id>` in the child placement paths.
5. Render in the head app in preview and in Pages edit mode: every slot shows its child, and an emptied slot shows a full-width drop zone.
6. Switch presets via Styling and confirm the token arrives in `params.Styles`.

Record what differed from this file and fix the file.
