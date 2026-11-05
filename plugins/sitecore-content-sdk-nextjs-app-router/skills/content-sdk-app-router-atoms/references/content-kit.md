# Content Kit (Sitecore shadcn registry)

**Install recipe and runtime results measured 2026-10-29** against `3.0.0-beta.atoms.20261021204512` (App Router scaffold, `shadcn@latest`, mock Edge/MMS, `next build && next start`). **Registry inventory, Container and adding a single atom measured 2026-11-05.** Re-verify before trusting it (last section).

## What it is

- **Sitecore, official.** Apache-2.0. The doc site and registry JSON at `https://content-kit.vercel.app/r/` are public.
- **Atoms only.** On 2026-11-05 the registry holds 8 items: `atoms-utils`, `utils`, `button`, `image`, `heading`, `number`, `paragraph`, `container`, plus build-generated bundles: `atoms.json` and per-atom `<atom>.component.json`. The Blok UI items and the Blok theme dependency are gone since 2026-10-05. `/components` and `/templates` are "under development" pages; no SYNC / Alaris / Solterra code exists.
- **No philosophy, authoring or migration docs.** The only copy: "Basic building blocks feeding Low code - No Code builder in Design Studio … initial list … will most likely change."

## Atom inventory

Every leaf atom has an optional `className` and `slots: []`. No cva variants, no `allowedChildren`, no `version`.

| Key | Catalog props | Render | Notes |
|---|---|---|---|
| `Heading` | `text: textFieldSchema()` | `<div dangerouslySetInnerHTML>` | The field value carries the tag (`<h2>…</h2>`); no level prop |
| `Paragraph` | `richText: richTextFieldSchema()` | `<div dangerouslySetInnerHTML>` | No sanitizer |
| `Image` | `image: imageFieldSchema()` | plain `<img>` | Warns on empty alt; no `next/image`, no media resolution |
| `Button` | `link: linkFieldSchema()`, `placeHolderText`, `ariaLabel` (`withPropMeta`) | `next/link`, `<a>` (external) or `<button>` | Own zinc look; override with `className` |
| `Number` | `number: numberFieldSchema()` in the current Kit; `value`, `label: textFieldSchema()`, `min`, `max`, `decimalsAllowed` before 2026-11-04 | form **input** (`NumericInput`) | Not a number display. The current schema needs stamp `20261103095219` or later, and the prop rename affects existing Documents |
| `Container` | `breakpoints: [{ className, columns, direction, wrap, justify, align, gap, padding, margin, width, height, background, border, opacity }]` | flex `<div>`, plus a sibling `<style>` when `columns` is set | Only `slots: ["default"]` atom. Only the first `breakpoints` entry is used, so it is not responsive yet. Values are free CSS strings, not tokens. Its working name upstream was "super layout" |

- **Bundle `r/atoms.json`** writes `src/components/atoms/<atom>/…` (`atom.tsx`, `atom.schema.ts`, Container also `container.props.ts`), `src/components/atoms/index.ts`, `src/lib/atoms-utils.ts` (clsx + tailwind-merge `cn`) and `src/atoms/{catalog.ts,registry.tsx,index.ts}`. The generated catalog carries `version: "1.0.0"` and `stylingSolution: "tailwind"`. `r/button.json` wires only that atom. `r/<atom>.component.json` writes only the atom's own files and wires nothing.

## Install: documented vs measured

| Step | Result (2026-10-29) |
|---|---|
| `npx shadcn@latest add …/r/atoms.json --yes`, no `components.json` | exit 0; files in the right folders, but **imports rewritten to `"/lib/atoms-utils"`** (absolute) in button, image, number, paragraph |
| `package.json` | exact pins rewritten to `^…20261006083839`; **cli downgraded** `2.4.0-…` → `^2.3.0-…` (mixed stamp); adds `clsx`, `tailwind-merge` |
| Entry files | Kit `src/atoms/index.ts` next to the scaffold's `index.tsx` |
| componentMap | not touched; the installer only *prints* the exclude |
| tsconfig | the scaffold has no `"@/*"` alias; the atoms need it |

## Recipe (measured green, 2026-10-29)

1. `npx shadcn@latest add https://content-kit.vercel.app/r/atoms.json --yes` (or write a `components.json` with `@/components`, `@/lib` aliases first to avoid step 3).
2. **Restore the exact beta pins** for every `@sitecore-content-sdk/*` package (§ 1 of the skill), then `npm install`; `npm ls` must show one stamp.
3. `grep -rn 'from "/' src` and fix every hit to `@/lib/atoms-utils`.
4. Add `"@/*": ["src/*"]` to `tsconfig.json` `paths`.
5. Delete the scaffold's empty `src/atoms/index.tsx`. Keep exactly one `src/atoms/index.*`. Merge any atoms you already had into `catalog.ts` / `registry.tsx`; never reuse a key with new props while Documents use the old ones.
6. Add `'src/components/atoms/**'` and `'**/*.schema.ts'` to `componentMap.exclude` in `sitecore.cli.config.ts`.
7. Keep the scaffold's `Providers.tsx` (`navigate`, `compileCssAction`, `theming`); `@/atoms` and `src/atoms` resolve to the same entry.
8. `npm run sitecore-tools:atoms:update`, commit `.sitecore/atoms.lock.json`, then `node scripts/check-atoms-lock.mjs --app . --fail-on-hash-blind`.
9. Use the Kit's `Container`, or add a governed token Stack when composers should only pick from a scale (`content-sdk-app-router-atom-create`).
10. Prove it with `next build && next start` and a Document per atom.

## Add one atom to an existing app (measured 2026-11-05)

`r/atoms.json` rewrites `catalog.ts` and `registry.tsx`, which drops your own atoms and takes the Kit's latest props. `npx shadcn@latest add` with no `components.json` stops at a prompt that `--yes` does not answer, and writes nothing.

1. Read `r/<atom>.component.json` and write each entry of `files[]` to its `target`, relative to the app root. This leaves `package.json` alone; check `dependencies` and `registryDependencies` for anything new. The files import `@/lib/atoms-utils`, so the app needs that file and the `"@/*": ["src/*"]` alias.
2. Add the import and the entry to `src/atoms/catalog.ts`, the render to `src/atoms/registry.tsx` (Container forwards `children`), and the export to `src/components/atoms/index.ts`.
3. Run `npm run sitecore-tools:atoms:update`, `node scripts/check-atoms-lock.mjs --app . --fail-on-hash-blind`, `tsc`, then `next build && next start` with a Document using the atom.

## Container defects (Kit code of 2026-11-05)

- **Explicit-width columns ignore a nested Container with its own `columns`.** Its sibling `<style>` takes the column's `nth-child` index. Measured at 1278 px with `columns: ["25%", "75%"]`: the column was 98 px, and 936 px with the fix below, measured on a production build. `columns: 2` is not affected. Fix: change `:not(code.scpm)` to `:not(code.scpm, style)` in `buildColumnRules`, and recheck after any reinstall, which overwrites it.
- **Column rules set `height: 100%` and `max-width` with `!important`**, which override a nested Container's own `height` and `width` (code-read).
- **Mixed `px` and `%` columns with a gap can pass 100% and wrap:** only `%` widths get the gap deduction (code-read).

## Runtime results (`next build && next start`, mock MMS)

- Five Documents composed from the Kit atoms plus a custom `Stack` rendered; Heading / Paragraph / Image / Button bound with `{"$state": "/fields/X"}` (the field object, matching the field schemas).
- Document classNames (`bg-indigo-950`, `bg-amber-400`, …) were in the runtime `<style>` and in **no** build CSS file; an unknown class was dropped.
- The atoms' own classes (Button's zinc look, Stack's token classes) come from the **build-time** CSS only (Tailwind scans `src/**`).
- Upper-case `FieldNames` (what Sitecore sends) still fell back to the default Document; lower-case `fieldNames` selected the variant.
- Not tested: Design Studio posting of the `withPropMeta` controls, Pages chromes, Vercel.

## Re-verify

```sh
curl -s https://content-kit.vercel.app/r/atoms.json | jq .dependencies
curl -s https://content-kit.vercel.app/r/container.component.json | jq -r '.files[].content' | grep nth-child
curl -s https://content-kit.vercel.app/r/registry.json | jq '.items[].name'
npm view @sitecore-content-sdk/nextjs dist-tags
```

If the registry pins match the current `beta.atoms` stamp, step 2 may be moot: re-run the install on a throwaway scaffold before dropping it.
