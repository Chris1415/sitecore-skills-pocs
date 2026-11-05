---
name: content-sdk-app-router-atoms
description: "Content SDK Atoms (beta.atoms only): catalog, atomsConfig, ComponentRef rendering, lock CI gate, runtime CSS, Content Kit install, null-render traps. Use when wiring atoms or a low-code component renders nothing. Not code components or stable apps."
license: Apache-2.0
compatibility: "Only @sitecore-content-sdk/nextjs 3.0.0-beta.atoms, exact pins. Measured on 20261021204512 (cli 2.4.0-) and 20261104151713 (cli 2.5.0-); events, personalize and analytics-core are 2.2.0-. Next 16.2+, React 19.2+, Zod 4. Node 18+ for scripts/. Not in latest 2.5.0."
metadata:
  author: Christian Hahn
  version: "0.4.1"
  status: beta
  verified: "2026-11-05: upgrade to stamp 20261104151713, Content Kit Container, editing config capabilities (build + start + mock MMS); Design Studio atoms panel seen on 20261021204512. 2026-10-29: scaffold + Content Kit install + custom atom + mock MMS (stamp 20261021204512); tenant facts from 2026-10-02"
---

# Content SDK Atoms (App Router) — BETA

> **BETA, pre-GA, thinly documented by Sitecore.** Mostly measured on stamp `…20261021204512` (2026-10-29); capabilities, Container and Design Studio facts are from 2026-11-05; tenant facts from `…20260930142740` (2026-10-02). It churns between builds. Re-run the version gate before trusting any line below. Items marked `[UNVERIFIED]` were not reachable on the test tenant.

## 1. Version gate (hard rule, run first)

```sh
npm view @sitecore-content-sdk/nextjs dist-tags   # measured on …20261021204512 and …20261104151713
```

- **Atoms exist only under the `beta.atoms` dist-tag.**
  - It is not in `latest` (2.5.0) or `canary` (3.0.0-canary): neither has an atoms export in `npm view` on 2026-11-04, while `beta.atoms` does. Nor is it in `beta`.
  - `beta` is a stale July canary with no atoms. Never use it.
- **The tag moves often: it moved three times on 2026-11-04.** On 2026-11-05 `beta.atoms` is `3.0.0-beta.atoms.20261104151713`. Upgrading from `20261021204512` took the pins and § 4's `generateMetadata` line. Re-diff with `content-sdk-upgrade-assistant` for anything newer.
- **Exact pins only.** The scaffold pins every `@sitecore-content-sdk/*` dependency to one stamp; the package lines differ (nextjs `3.0.0-`, cli `2.4.0-`, events/personalize/analytics-core `2.2.0-`). A `^` range or a mixed stamp is unsupported.

**Since 2026-10-21 the beta is stable 2.4.1 plus atoms**, without the 2.5.0-canary items (`references/version-matrix.md`).

**When NOT to use atoms:**
- **Production with a support expectation**, or a non-React host. The runtime is React only.
- **The `nextjs-app-router-cache-components` template.** It returned HTTP 500 on every ComponentRef page (2026-10-02); the wrapper still does an uncached MMS fetch, so assume it still does until re-measured.
- **Components that must pass inline-editing checks.** Pages editing inside atoms is `[UNVERIFIED]`.
- **A component that fetches data, holds client state or renders a list over datasource children.** Atoms are leaves plus layout; see `content-sdk-atomic-design-assessment`.
- **A production project without the user's explicit opt-in.** Use a throwaway or playground workspace.

## 2. Decide: atom, code component or variant?

| Need | Use |
|---|---|
| Marketers compose new components in Design Studio from governed primitives, without a deploy per component | **Atoms + low-code** (beta). Offered under Create component in Design Studio (§ 9) |
| Server data, ComponentQuery, GraphQL, custom data strategy | Code component (`content-sdk-app-router-component-scaffold`) |
| Per-field inline editing an author must be able to use | Code component with SDK field components |
| Start from Sitecore's reference atoms (Heading, Paragraph, Image, Number, Button, Container) | Content Kit registry, fixed up after install (§ 4a). Leaf atoms field-bound since 2026-10-05 |
| Write your own atom (a container, a token-governed variant) | `content-sdk-app-router-atom-create` |
| New look for an existing rendering | Variant (`content-sdk-variants-vs-siblings`) |
| GA support, non-React host, existing 2.4.0 app | Code component |

## 3. Mental model

- **An atom is code.**
  - It is a Zod-typed entry in `defineAtomsCatalog` plus a React renderer in `defineAtomsRegistry`, built on `@json-render/*` 0.20.0.
  - It is registered **only** through `SitecoreProvider atomsConfig`, **never** in `.sitecore/component-map*`.
- **A low-code component is content**: a json-render Document stored in "MMS".
  - The CM ships a rendering template `Foundation/JavaScript Services/HostedJsonRendering` (base `Json Rendering`) with a Single-Line Text field **`ComponentRef` on the rendering definition item**.
  - The Layout Service copies that field into `rendering.params.ComponentRef` (measured on Edge preview).
  - The Components API `type: Hosted` means "this rendering template".
  - The Document itself is not a CM item, so `ser pull` does not see it.
- **Render path.** For each rendering, `Placeholder` → `getComponentForRendering` checks hidden / empty → then **`params.ComponentRef`** → then the component map → then the FEaaS / BYOC fallbacks. ComponentRef wins over everything.
  - A ComponentRef rendering goes to `StudioComponentServerWrapper` (async server component).
  - The wrapper picks a path, `GET {edge}/mms/<path>`, compiles the Document's Tailwind classes into a `<style>`, and renders the client `StudioComponentWrapper` → `createNCC(doc)` (no props since #654).
  - The wrapper builds `state = {...doc.state, fields, params}`: **the rendering's fields and params overwrite** any `state.fields` / `state.params` stored in the Document. Datasource fields bind with `{"$state": "/fields/<Field>"}`. The bound value is the field object `{value}`. That fits the field schemas; a plain-string prop needs `"/fields/<Field>/value"` (the object crashes the page, § 8).
  - The output is wrapped in `<div class="component {params.styles}" id="{params.RenderingIdentifier}">`.
  - **Production does not validate Documents.** `validateAtomsDocument` (#652) runs only on Design Studio previews; a malformed Document from MMS goes straight to `createNCC`.

Details, shapes and payloads: `references/api-surface.md`, `references/design-studio-bridge.md`.

## 4. Wiring (scaffold literally)

```sh
npx --yes create-content-sdk-app@2.5.0-beta.atoms.20261021204512 --yes --template nextjs-app-router --destination <dir>
```

Verify all of these exist; the stock steps are in the scaffold's own bundled atoms setup skill under `.agents/skills/`:
- `src/atoms/index.tsx` (fixed path; the CLI accepts only `index.ts` or `index.tsx`)
- **exactly ONE** of `src/atoms/index.ts` / `index.tsx`. Two means the lock validates one catalog and the runtime renders the other (§ 4a)
- `Providers.tsx` `atomsConfig={{ catalog, registry, navigate: router.push, compileCssAction: compileCssForDocumentAction }}` and `theming={scConfig.theming}` (scaffolds older than 2026-10-05 lack the `theming` line, so live theme preview silently does nothing)
- root `instrumentation.ts` → `instrumentation-node.ts` with `await registerTailwindCssCompiler('src/app/globals.css')`
- `next.config.ts` `serverExternalPackages: ['@tailwindcss/node']`
- `zod ^4` and `@tailwindcss/node ^4` as app dependencies
- `.gitignore` `.sitecore/*` + `!.sitecore/atoms.lock.json`
- **From `20261104121033`:** `generateMetadata({ appInputs: { [ATOMS_CATALOG_METADATA_KEY]: catalog } })` in `sitecore.cli.config.ts`, with the key from `@sitecore-content-sdk/nextjs/atoms` and `catalog` from `src/atoms`. An upgraded app without it still builds, with an empty catalog in its metadata (§ 9)

**Template differences** (all three beta templates scaffold `src/atoms`):
- **Pages Router (`--template nextjs`):** no instrumentation, no `serverExternalPackages` and no `compileCssAction`. Atoms render server-side but **unstyled**; wire the compiler by hand if you need styles.
- **`nextjs-app-router-cache-components`:** returns 500 on ComponentRef pages. Do not use.

### 4a. Content Kit (Sitecore shadcn registry)

`https://content-kit.vercel.app/r/atoms.json` is Sitecore's official shadcn registry (Apache-2.0): 5 field-bound leaf atoms (Heading, Paragraph, Image, Number, Button) and the `Container` layout atom, nothing else installable. **The install still needs fixing up.** Use only the recipe in `references/content-kit.md`. Measured 2026-10-29:
- **`shadcn add` rewrites the SDK pins** to the registry's stamp as `^` ranges (2026-10-29: `^…20261006083839`, cli **down** to `^2.3.0-…`, a mixed stamp). Restore the exact pins right after (§ 1).
- **Without a `components.json`, imports land as `"/lib/atoms-utils"`** (an absolute path). The docs say none is needed; add one, or fix the imports to `@/lib/atoms-utils`. The scaffold tsconfig also lacks the `"@/*": ["src/*"]` alias.
- **It writes `src/atoms/index.ts` next to the scaffold's `index.tsx`.** The CLI and tsc read `index.ts`; the bundler reads `index.tsx`. Keep exactly one (delete the empty scaffold `index.tsx`).
- **Exclude `'src/components/atoms/**'` and `'**/*.schema.ts'` from `componentMap`.** The installer prints this; it does not do it.
- `scripts/check-atoms-lock.mjs` fails on both layouts (two entry files, unexcluded atoms under `src/components/`).
- **Field-bound but not SDK-rendered.** Heading expects the tag inside a Single-Line Text value (`<h2>…</h2>`); Heading and Paragraph render with `dangerouslySetInnerHTML`; Image is a plain `<img>`. Pages inline editing inside them is `[UNVERIFIED]`.
- **`Container` is the Kit's only atom with children** (`slots: ["default"]`). Free CSS strings, so a governed token Stack (`content-sdk-app-router-atom-create`) still has a place. Explicit-width `columns` ignore a nested Container with its own `columns`; fix in `references/content-kit.md`.
- **Adding one atom to an existing app:** not `r/atoms.json`, which rewrites the catalog and registry. See `references/content-kit.md`.

**MMS host.** The wrapper calls `resolveEdgeUrl()` with no argument. It honours **only** the server env `SITECORE_EDGE_PLATFORM_HOSTNAME`, else `https://edge-platform.sitecorecloud.io`. A custom `sitecore.config` `api.edge.edgeUrl` or `NEXT_PUBLIC_SITECORE_EDGE_PLATFORM_HOSTNAME` moves layout but **not** MMS.

## 5. Catalog rules that bite

- `components` **and** `actions` are both required (`actions: {}`). `Exact<>` rejects unknown keys at compile time only.
- **Set `stylingSolution: 'tailwind'` explicitly.** The default is `'inline-css'`, whatever PR summaries say.
- For Sitecore-bound props, use the field schemas: `textFieldSchema`, `richTextFieldSchema`, `linkFieldSchema`, `imageFieldSchema`, `dateFieldSchema`, `fileFieldSchema`. None exist for number, checkbox, multi-line text or reference fields.
- **Retire an atom with `legacy: true`, then run `atoms update`.**
  - `legacy` is hashed (IV-010).
  - **Never delete an atom that a Document still uses.** The render goes null with only a console line.
  - This overrides the scaffold's bundled atoms maintain skill, which says delete.
- **Splitting the catalog across modules is fine** as long as `src/atoms/index.tsx` re-exports `catalog` and `registry` (validated).
- **Keep atoms out of `src/components/`, or add the folder to `componentMap.exclude`** in `sitecore.cli.config.ts` (`'src/components/atoms/**'`). Everything there is auto-registered as a rendering (`content-sdk-component-naming-traps`). Content Kit installs there by default; name clashes with `src/components/ui/*` then break the generated map at compile time.
- **Renaming the props of an existing atom key** (e.g. the scaffold's `Heading{text}` → Content Kit's `Heading{defaultValue}`) raises only IV-010 and exits 0. Every Document using the old props renders wrong or crashes. Treat it as retire-and-add (new key), not replace.
- **`allowedChildren` / `allowedParents` are Design Studio hints.** The runtime does not enforce them: a Paragraph inside a Button rendered `<a><p><p>`.

## 6. Lock file CI policy

`sitecore-tools project atoms validate` **exits 0 on every lock issue** (MV-012 "lock not found" included) unless `atoms.validation.breakOnError` is true. The exceptions are MV-010 (no `src/atoms/index.ts(x)`) and MV-011 (no `catalog` export): those throw and exit 1 regardless.

- Run `npm run sitecore-tools:atoms:update` after an intentional change, and commit `.sitecore/atoms.lock.json`.
- **In CI, run `node scripts/check-atoms-lock.mjs --app . --fail-on-hash-blind`.** It parses the codes and fails on any of them, whatever the config says. Alternatively pass `-c <config>` with a config that spreads the base and sets `breakOnError: true`.
- **The hash cannot see** Zod check parameters (`.min/.max/.regex…`), `.meta()`, `.describe()`, `withPropMeta`, or the catalog's `stylingSolution`. Bump the atom's `version` by hand for those (that raises IV-009, and `update` accepts it). The script warns when such a line changed since the last lock commit without a `version` edit.
- **Hashed** (IV-010): new props, types, enum values, defaults, `description`, `allowedParents/Children`, `legacy`.

Full code table: `references/api-surface.md` § CLI codes.

## 7. Runtime CSS

- **How it works.** The compiler runs `@tailwindcss/node` against `globals.css` for the Document's `className` tokens. It emits only the used `@layer theme` tokens plus `@layer utilities` in a `<style>` next to the component.
  - Unresolvable classes are dropped from the CSS and stay in the markup.
  - The in-memory LRU holds 200 class sets and is lost on every cold start.
  - Measured locally: p50 about 11 ms per unique 30-class set.
- **No registered compiler** → the Document renders **unstyled**, with **no log line** (debug only).
- **`dark:`** compiles to `prefers-color-scheme`. With a class-driven 3-state theme, declare `@custom-variant dark` in `globals.css` (`content-sdk-app-router-theme-hydration-pattern`).
- **Atom-internal classes** (cva variants, fixed layout classes) are **not** compiled at runtime. They reach the page only through the build-time stylesheet, because Tailwind scans `src/**`. An atom whose source lives outside the scanned tree (a package) renders unstyled unless you add an `@source`.
- **Installing the Blok theme** (Content Kit) adds `@custom-variant dark (&:is(.dark *))` to `globals.css`, which switches `dark:` to class-driven.
- **`compileCssForDocumentAction` is a public Server Action.**
  - Its id ships in the client bundle, and an anonymous POST returns compiled CSS. Each new class set costs a compile.
  - It is only needed in Design Library editing. Rate-limit it or gate it on draft mode before exposing the app.
- **Vercel / editing-host viability** (native oxide binary, file tracing of `globals.css`) is `[UNVERIFIED]`. The Windows lockfile does list `@tailwindcss/oxide-linux-x64-gnu`.

## 8. Debugging a low-code component that renders nothing

Run `node scripts/probe-mms.mjs --context-id <preview ctx> --site <site> --route </path>`, or pass `--layout-file`. It finds every ComponentRef rendering, picks the path the way the SDK does, fetches it, and judges the response against the beta parser.

| Symptom | Cause | Signal |
|---|---|---|
| Nothing renders, `<style>` present | `atomsConfig` missing in `Providers.tsx` | **no log at all** |
| Nothing renders | MMS non-200 | `console.error … failed to fetch … HTTP 404` |
| Nothing renders although MMS is 200 | **body served as `application/json`**: the fetcher pre-parses it and the beta `JSON.parse`s the object | `failed to parse … "[object Object]" is not valid JSON` |
| Nothing renders | bad JSON, or the stale nested Document shape | `failed to parse` / empty render |
| Wrong (default) variant | Sitecore sends **`FieldNames`**, the SDK reads lower-case **`fieldNames`**. Edge also rewrites an unknown variant to `"Default"` | probe prints `WARN params.FieldNames … ignored` |
| A **code** component vanished | its params carry a `ComponentRef` param, so it is diverted before the map lookup | `failed to extract path from ComponentRef` |
| Renders unstyled | no compiler registered, or Pages Router template | no log |
| MMS fetched from the wrong host | `edgeUrl` / `NEXT_PUBLIC_*` set, but `SITECORE_EDGE_PLATFORM_HOSTNAME` not | URL in the error |
| Whole page HTTP 500, `x.trim is not a function` | a field OBJECT bound (`$state "/fields/X"`) to a plain-string prop | bind `"/fields/X/value"`, or use the field schemas |
| Lock green but `No renderer for component type: X` | two `src/atoms/index.*` files: the bundler loads `.tsx`, the CLI `.ts` | server log |
| Null render persists after MMS is fixed | SSG cached the null render (`s-maxage=31536000`) | `x-nextjs-cache: HIT`; revalidate or rebuild |
| Values authored into a Document's `state.fields` never show | the wrapper overwrites `state.fields` / `state.params` with the rendering's (#654) | bind to datasource fields instead |
| Kit atoms import `"/lib/atoms-utils"` (absolute path) | Content Kit installed without `components.json` | `grep -rn 'from "/' src`; fix to `@/lib/atoms-utils` |
| Design Studio shows nothing | catalog missing → `atoms:error {type:'atoms-missing'}` | see `references/design-studio-bridge.md` |

- To dump the raw layout `params`, use `content-sdk-debug-layout-probe`.
- **Prove a fix with `next build && next start`, never `next dev`.**
- **Preview proves nothing about live**.

## 9. Design Studio bridge

- **Mode.** `library-low-code` sets `isLowCode`, and `DesignLibraryApp` routes it to `DesignLibraryLowCodeComponent`.
- **Message sequence** (since #652 / #654):
  1. `READY`
  2. `atoms:catalog` (props as JSON Schema, plus `legacy`, `version`, `stylingSolution`), or `atoms:error {type:'atoms-missing'}`
  3. Design Studio sends `component:atoms:preview {document}`; fields and params travel inside `document.state` (the `component:update` leg is gone)
  4. The app runs `validateAtomsDocument`; on failure `atoms:error {type:'validation', issues, formatted}` (meant to be fed back to the AI generator), no render
  5. `RENDERED`, or `atoms:error {type:'render'}`
- **Any library session posts the catalog** when one is configured.
- **Theme preview** (#642): Design Studio or Pages posts `theme-update {message:{css}}`; in editing mode with `theming.mode !== 'none'` the app injects `<style id="sitecore-theme-preview">` last in `<head>`. Needs the Providers `theming` prop.
- **Editing chromes:** `<code type="text/sitecore" chrometype="atom" class="scpm">` per atom, in edit mode only.
- **Where to find it.** In Design Studio, Studio → **Create component** opens the builder with Layers, Selected Atom and an Atoms panel listing the catalog (seen 2026-11-05, stamp `20261021204512`, custom atoms included). An existing code component opens without it, so do not judge availability from that.
- **The editing host log cannot confirm this.** It records problems such as unknown components, not healthy sessions, so `mode: library` entries do not mean low-code is off.
- **Which tenants have the builder, and how it is switched on, is `[UNVERIFIED]`.**
- **Capabilities (from `20261104121033`).** The build writes `capabilities.designLibrary.atoms.metadata.catalog` into `.sitecore/metadata.json`, and `/api/editing/config` returns it (measured locally). Whether Design Studio reads it is `[UNVERIFIED]`: the panel listed the atoms on a stamp without it.

## 10. Backend surfaces and open items

- **No API that creates atoms, Documents or theme tokens is known.** Who writes MMS is `[UNVERIFIED]` (`references/design-studio-bridge.md`).
  - The Components API (GA) has `type: Hosted` drafts with variant `code` (example `<Button>Click</Button>`) and `model-suggestion {atoms: string}`.
  - Activation is **one-way**, and the API needs an **environment** automation client (an org client gets 401).
  - `theming.mode: 'site'` adds a `<link>` to `{edge}/authoring/api/v1/themes/delivery/{site}/web-css?contextID=…` and the body class `sc-ds-theme`. That endpoint returned 404 for anonymous and bearer calls on the test tenant (2026-10-02). The SDK only delivers theme CSS; it does not author or store tokens.
  - See `references/apis-and-theming.md`. **FEaaS "low code components" are a different system.**
- **Open `[UNVERIFIED]` items:**
  - which tenants have the low-code builder, and what switches it on
  - the real MMS content type and cache headers, and whether Document edits revalidate pages (the fetch carries no `sc:*` tag). A null render is cached for a year (§ 8)
  - Pages inline editing inside atoms
  - theme delivery
  - deploy-time CSS
  - the model-suggestion payload

Version history and the dated matrix: `references/version-matrix.md`. Content Kit inventory and install recipe: `references/content-kit.md`.
Writing an atom: `content-sdk-app-router-atom-create`. Which existing components to move to atoms: `content-sdk-atomic-design-assessment`.
