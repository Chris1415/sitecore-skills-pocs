---
name: content-sdk-component-naming-traps
description: "Traps when adding or renaming Content SDK components: everything in src/components/ becomes a rendering, map keys are SDK-version sensitive, parameter names collide with template fields. Use when scaffolding, refactoring src/ or upgrading."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/nextjs ≥ 2.x and `sitecore-tools project component generate-map` (ships with @sitecore-content-sdk/cli). Trap 6 fires on @sitecore-content-sdk/content 2.2.x (nextjs 2.3.0) and is reverted on content 2.3.0 (nextjs 2.4.0) with an upstream TODO to re-enable it at the next major — verified against the installed source 2026-09-18. Treat the key derivation as version-sensitive; scripts/assert-map-keys.mjs reads the rule off the installed package."
metadata:
  author: Christian Hahn
  version: "0.6.4"
---

# Content SDK — Component Naming Traps

The `sitecore-tools generate-map` step that produces `.sitecore/component-map.ts` is silent about its assumptions, and easy to violate. Worse, the map is **generated**, so a broken registration changes no hand-written file and survives lint, tests and the build untouched — the failure surfaces only as an empty component at runtime.

## When to use

- Adding any new file under `src/components/`.
- Refactoring or relocating UI infrastructure (theme providers, layout shells, design system primitives).
- A new Sitecore rendering appears on a page but the head app can't find the component (likely a name-mismatch).
- The component-map.ts has surprising entries you didn't intend.

## How to perform

1. **Before placing a new file**, decide: is it a Sitecore rendering, or is it infrastructure?
   - **Sitecore rendering** (matches a `componentName` in the layout response): `src/components/<ComponentName>/<ComponentName>.tsx`. Gen-map will register it.
   - **Infrastructure** (theme provider, site chrome, ResolverProbe, design system primitives, helpers): `src/ui/`, `src/site/`, `src/lib/`, or any path NOT in `componentMap.paths`. Gen-map will ignore it.
2. **Run `npm run sitecore-tools:generate-map`** after creating/moving files. Inspect `.sitecore/component-map.ts` — every entry should correspond to a real Sitecore rendering.
3. **For renderings with spaces in `componentName`** (e.g. `Datasource Content Resolver`), name the folder + file with the spaces preserved. Gen-map produces:
   - An import alias with spaces stripped (e.g. `DatasourceContentResolver`).
   - A map key with the spaces PRESERVED (e.g. `'Datasource Content Resolver'`) so runtime lookup matches the layout response exactly.
   - **This preservation applies to SPACES ONLY.** `toPascalCase` splits on `[-_]` and nothing else, so a space survives into the key while an underscore or hyphen does not. Do not generalise this bullet into "the key always mirrors the filename" — see trap 6 below.
4. **For variant files**, use the `<ComponentName>.<VariantName>.tsx` convention. Gen-map merges them into one map entry: `['ComponentName', { ...Default, ...Variant1, ...Variant2 }]`. The runtime picks the right export by `params.FieldNames`.

## Hard Rules

- **`sitecore.cli.config.ts` declares `componentMap.paths`** — usually `['src/components']` with `exclude: ['src/components/content-sdk/*']`. Anything under a scanned path is a candidate Sitecore rendering. Anything under `exclude` (or outside the scanned paths entirely) is invisible.
- **Never put UI infrastructure under `src/components/`.** It will register as a Sitecore rendering named e.g. `theme-toggle`, which (a) is wasteful, (b) might collide with a future real rendering of that name. Put it in `src/ui/`, `src/site/`, etc.
- **Don't hand-edit `.sitecore/component-map.ts`.** It's regenerated on every `npm run dev` / `npm run build`. Edits are lost. Adjust source structure or `sitecore.cli.config.ts` instead.
- **Map key === rendering `componentName` exactly** — including spaces, casing, hyphens, and underscores. Mismatch → empty component placeholder at runtime.
- **NEVER put `_` or `-` in a component folder/file name.** On `@sitecore-content-sdk/content` 2.2.x the key is `toPascalCase(filename)`, which splits on `[-_]`, so `Navigation_Custom.tsx` registers as `NavigationCustom`, and **no filename can produce a key containing an underscore or hyphen** — the split is unconditional. Content 2.3.0 **reverted** this (key = the verbatim file name, `moduleName` still PascalCased) and left a TODO to re-enable it at the next major, so an underscored name works today and breaks again on the 3.0 bump. The safe name is the one that is right under both rules. If a rendering's `componentName` has one, the *rendering* must be renamed on the CM (Authoring GraphQL `updateItem` on the `componentName` field); renaming the folder alone cannot fix it. Rename the rendering **item** at your peril — its path and its `<X> Parameters` template are path/GUID-coupled, and page layouts reference the rendering by GUID, so changing only `componentName` is the safe minimal edit.
- **Folder name === file name** (within the folder) for the gen-map to pick up the base component. Variant files add `.<Variant>` to the basename.
- **When in doubt, check the live layout response** (`content-sdk-debug-layout-probe` skill) to find the exact `componentName` string before naming the folder.
- **Only the Sitecore-registered `.tsx` file (and its `.<Variant>.tsx` siblings) belong inside `src/components/<Component>/`.** Every other file — types (`*.types.ts`), GraphQL queries (`*.gql.ts`), sub-components (e.g. a client-side `NavBranch.tsx`), server actions, route-handler logic, helpers — MUST live outside that folder. Recommended homes: `src/lib/<feature>/` for non-React code + tightly-coupled internal components; `src/ui/` for cross-cutting UI primitives; `src/app/api/` for route handlers. The same holds for starter folders: the integrated-search starter's `search-experience/search-components/` placed under `src/components/` registers every hook and helper as a rendering (`content-sdk-search`). **Atoms (beta.atoms) live in `src/atoms/`**, outside `src/components/` and outside the map; never move them in (`content-sdk-app-router-atoms`). Otherwise gen-map sees the support files and either (a) registers them as separate top-level Sitecore renderings (e.g. `['NavBranch', { ... }]`) or (b) interprets them as variants of the main component (e.g. `*.types.ts` is seen as variant `types`) and spreads their non-React exports into the main map entry, polluting it.
- **Avoid generic single-word rendering-parameter names** like `Levels`, `Depth`, `Style`, `Type`, `Items`. They can silently collide with base-template fields (or SXA standards like `LevelFrom`, `LevelTo`, `Styles`, `EnabledPlaceholders`) and become invisible in Pages even though the field exists in the template. Use namespaced names (`NavDepth`, `NavMaxItems`) or singular forms (`Level` worked, `Levels` did not in one verified case). When in doubt, scope-prefix.

## Stop Conditions

- **Stop and ask** if the `componentName` from the rendering contains characters that aren't valid in file paths on Windows (e.g. `<>:"|?*`). Suggest the user rename the rendering in Sitecore first.
- **Don't relocate the existing `src/components/content-sdk/` folder** — it holds SDK-provided helpers (CdpPageView, SitecoreStyles) and is explicitly excluded in `sitecore.cli.config.ts`.
- **Don't create a component with a `componentName` that matches a built-in** (`BYOCWrapper`, `FEaaSWrapper`, `Form`) — those are always registered first and your version will be shadowed.

## Verification

- After moves/edits, run `npm run sitecore-tools:generate-map` and read `.sitecore/component-map.ts`. Every key should be a Sitecore rendering name; no infrastructure names should appear.
- Build the app (`npm run build`) and check the "Registering Content SDK component <X>" log lines. They list every key being registered — if there's a surprise, fix the source.
- **After ANY SDK upgrade, `git diff .sitecore/component-map.*` and treat a changed KEY as a breaking change**, not regeneration noise. The key derivation is version-sensitive (trap 6), and a one-line key change passes every other gate.
- **Reconcile keys against the CM.** Every rendering's `componentName` must appear as a key. Cheapest source is a live layout response (`content-sdk-debug-layout-probe`) or the serialized rendering YAML; a mismatch is a guaranteed runtime blank. Worth a committed snapshot test of the key list so silent changes fail the PR.
- **⭐ The only check that PROVES the match is rendering a real page.** A local test can assert the key set and ban `[-_]` filenames, but it cannot know what the CM calls a rendering — that lives in another system (often another repo, absent in CI). Do not fake it with a conditional skip; a test that silently no-ops in CI is worse than none. Instead **smoke the PR's preview deployment** and assert no `MissingComponent` placeholder appears on any route. That is the reconciliation, performed empirically. See `content-sdk-website-build-flow` § "Gate the PR preview deployment" for the harness, the honest-target precondition, and the pixel-diff trap.

## Worked example #1 — the spaced-name pattern

Rendering with `componentName: "Datasource Content Resolver"`:

- Folder: `src/components/Datasource Content Resolver/`
- File: `src/components/Datasource Content Resolver/Datasource Content Resolver.tsx`
- Gen-map output:
  ```ts
  import * as DatasourceContentResolver from 'src/components/Datasource Content Resolver/Datasource Content Resolver';
  // ...
  ['Datasource Content Resolver', { ...DatasourceContentResolver }],
  ```
- The alias is sanitized; the path is preserved (paths with spaces are valid in TS imports when handled by Webpack/Turbopack); the map key matches the layout response.

## Worked example #2 — the support-files pitfall (and the relocation that fixed it)

> **⚠ The name in this example is itself a trap.** It is shown verbatim as it happened, on a
> component then called `Navigation_Custom`. **Do not copy that name** — the underscore is exactly
> what trap 6 forbids, and it later broke this component outright on an SDK upgrade. The
> support-files lesson below is independent of the name and still correct; the component has since
> been renamed `NavigationCustom`.

Building a navigation component, the first scaffold colocated four support files alongside the Sitecore-registered component file:

```
src/components/Navigation_Custom/
  Navigation_Custom.tsx        ← intended: the only Sitecore registration
  Navigation_Custom.types.ts   ← types
  Navigation_Custom.gql.ts     ← GraphQL queries
  NavBranch.tsx                ← client component (dropdown logic)
  actions.ts                   ← Server Action (later switched to a route handler)
```

After running `generate-map`, `.sitecore/component-map.ts` contained:

```ts
import * as Navigation_Customtypes from 'src/components/Navigation_Custom/Navigation_Custom.types';
import * as Navigation_Customgql   from 'src/components/Navigation_Custom/Navigation_Custom.gql';
import * as Navigation_Custom      from 'src/components/Navigation_Custom/Navigation_Custom';
import * as NavBranch              from 'src/components/Navigation_Custom/NavBranch';
import * as actions                from 'src/components/Navigation_Custom/actions';

export const componentMap = new Map<string, NextjsContentSdkComponent>([
  // ...
  ['Navigation_Custom', { ...Navigation_Customtypes, ...Navigation_Customgql, ...Navigation_Custom }],
  ['NavBranch', { ...NavBranch, componentType: 'client' }],   // ← unintended Sitecore rendering
  ['actions',   { ...actions }],                              // ← unintended Sitecore rendering
  // ...
]);
```

**Two distinct failure modes simultaneously:**

1. **`*.types.ts` and `*.gql.ts` got interpreted as variants** of `Navigation_Custom` (because the basename pattern `<Component>.<X>.<ext>` matches the variant-file convention). Their non-React exports (`NavItem` type, `NAV_LEVEL_1_QUERY` string) got spread into the `Navigation_Custom` map entry, polluting its export surface — `componentMap.get('Navigation_Custom').NAV_LEVEL_1_QUERY` becomes a string. Setting `params.FieldNames="types"` in a rendering instance would attempt to "render" the types module as a React component.

2. **`NavBranch.tsx` and `actions.ts` got registered as standalone Sitecore renderings** named `NavBranch` and `actions`. If an author ever named a real rendering `NavBranch` it would collide. Even without collision, the SDK now believes `NavBranch` is a routable component, which it absolutely is not.

**The fix — relocate all support files outside `src/components/`:**

```
src/
  components/
    Navigation_Custom/
      Navigation_Custom.tsx    ← only this file remains here
  lib/
    navigation/
      types.ts                 ← was Navigation_Custom.types.ts
      queries.ts               ← was Navigation_Custom.gql.ts
      nav-branch.tsx           ← was NavBranch.tsx (still a 'use client' component, just lives in lib/)
  app/
    api/
      nav-children/
        route.ts               ← was actions.ts (re-architected as a route handler — read-only fetches should never be Server Actions; see content-sdk-app-router-route-handler-vs-server-action)
```

After regen, `.sitecore/component-map.ts` is pristine — `['Navigation_Custom', { ...Navigation_Custom }]` with no extra imports. The fix is purely structural (file paths); the runtime imports in the component file change from `./types` to `src/lib/navigation/types`, but the actual code is unchanged.

**Generalisable rule:** `src/components/<Component>/` is for the Sitecore-registered React component and its variant siblings — nothing else. The moment you reach for a `.types.ts`, `.gql.ts`, `.client.tsx`, `actions.ts`, `helpers.ts` to put alongside, send it elsewhere first.

## Worked example #3 — trap 6: the underscore an SDK upgrade ate

**Version window, measured from the installed source.** `@sitecore-content-sdk/content` 2.2.x (shipped with `nextjs` 2.3.0) derives the key with `toPascalCase`; content **2.3.0** (with `nextjs` 2.4.0) sets `componentName: name` again — the verbatim file name — with a `// TODO: enabled using toPascalCase() … with NextJS CSDK major release` beside it (verified 2026-09-18 in `dist/esm/tools/templating/components.js` across three apps on content 2.3.0, and one of them carries a working `['Navigation_Custom', …]` key). So the trap fires in one minor window today and is announced to return at 3.0. **It has not returned in the `3.0.0-beta.atoms` stamp** (measured 2026-10-02): `Foo_Bar.tsx` → key `Foo_Bar` verbatim, and dotted files are **keyed by prefix, not dropped** (`Promo.WithText.tsx` → `Promo` as a variant, `foo.component.tsx` → `foo`). `scripts/assert-map-keys.mjs` reads the rule off whatever is installed instead of trusting this paragraph.

A head app carried `src/components/Navigation_Custom/Navigation_Custom.tsx` against a rendering whose `componentName` was `Navigation_Custom`. It worked for months on SDK 2.2. The 2.2 → **2.3** bump (`nextjs` versions; content 2.1 → 2.2) regenerated the maps and produced:

```diff
-import * as Navigation_Custom from 'src/components/Navigation_Custom/Navigation_Custom';
-  ['Navigation_Custom', { ...Navigation_Custom }],
+import * as NavigationCustom  from 'src/components/Navigation_Custom/Navigation_Custom';
+  ['NavigationCustom', { ...NavigationCustom }],
```

The nav disappeared from **every page of a live site**, and Page Builder showed *"Content SDK component is missing React implementation."*

**The mechanism** — the key is `toPascalCase(filename)`, and the split is unconditional:

```js
// @sitecore-content-sdk/content/dist/esm/tools/templating/components.js
const toPascalCase = (name) => name.split(/[-_]/)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
// componentName: toPascalCase(name)          ← the MAP KEY
// moduleName:    toPascalCase(name).replace(/[^\w]+/g, '')   ← the import alias
```

Lookup is an exact `Map.get(rendering.componentName)` with **no normalization**, so it misses and the placeholder falls back to `MissingComponent`.

**Why nothing caught it.** The only changed file was *generated*, and nothing in `src/`, the e2e suite or the tests asserted a map key. Lint, **814 passing tests**, a clean build and an unchanged SSG route count all stayed green across the break. The upgrade was even recorded as *"package-only — no source file changed"*, which was true of `src/` and blind to a generated file changing semantics.

**Proven by control, not inference:** a sibling app held the identical folder, stayed on `^2.2.0`, and kept the correct key. One variable changed.

**The fix.** Because no filename can yield an underscored key, the rendering moved: `componentName` → `NavigationCustom` via Authoring GraphQL, and the component renamed to match so the key is right *by construction*. The rendering **item name, its path and its `<X> Parameters` template were deliberately left alone** — all path/GUID-coupled, and layouts reference the rendering by GUID, so authored pages were unaffected.

**Two publish traps met on the way out:**

- **Publishing the rendering item alone did nothing** — `Completed, 0 processed`. The layout Edge serves is composed **when the PAGE is published**; it took the site's `Home --children`.
- **Correct Edge data does not mean a correct site.** Live Edge was right on 12/12 routes while the public site still served build-time HTML (`x-vercel-cache: HIT`, `age: 2070`, `x-nextjs-prerender: 1`). Those SSG routes carried no `revalidate`, so they never refreshed — only a redeploy did.

**Prevention:** after ANY SDK upgrade, diff `.sitecore/component-map.*` and reconcile the keys against the renderings' `componentName`. A one-line key change is invisible to every other gate. `scripts/assert-map-keys.mjs --app <head-app> --renderings <serialized renderings dir>` does the reconciliation (exit 1 on a `componentName` with no key, WARN on a `[-_]` filename because the rule is version-sensitive); `content-sdk-upgrade-assistant`'s `upgrade-surface.mjs` prints the key rule of the installed and the target package side by side.

## Related

- `content-sdk-app-router-component-scaffold` — the canonical scaffold instructions.
- `content-sdk-app-router-component-registration` — how the map is consumed at runtime.
- `content-sdk-debug-layout-probe` — to discover the exact `componentName` from a live response.
- `content-sdk-website-build-flow` § "Gate the PR preview deployment" — the CI gate that catches a key/`componentName` mismatch empirically, which no local check can.

## References

- `scripts/assert-map-keys.mjs` — keys vs serialized `componentName` values, plus the installed key rule; dependency-free Node.
- `.sitecore/component-map.ts` — generated output (do not hand-edit).
- `sitecore.cli.config.ts` — `componentMap.paths` + `exclude` config.
