# Atoms API surface (beta `3.0.0-beta.atoms.20260930142740`, re-checked against `…20261021204512`)

Source of truth: the installed `.d.ts` files (`node_modules/@sitecore-content-sdk/nextjs/types/atoms/index.d.ts`, `.../react/types/atoms/*.d.ts`). Re-read them when the stamp changes.

## Exports

| Entry point | Exports |
|---|---|
| `@sitecore-content-sdk/nextjs/atoms` | `defineAtomsCatalog`, `defineAtomsRegistry`, `useBoundProp`, `withPropMeta`, `extractDocumentClasses`, `textFieldSchema`, `richTextFieldSchema`, `dateFieldSchema`, `linkFieldSchema`, `imageFieldSchema`, `fileFieldSchema`, types `AtomsCatalog`, `AtomsCatalogInput`, `AtomsConfig`, `AtomComponentDefinition`, `AtomActionDefinition`, `AtomsStylingSolution`, `PropMeta`, `*FieldSchema` types |
| `@sitecore-content-sdk/nextjs/instrumentation` | `registerTailwindCssCompiler(cssFilePath = 'src/app/globals.css')` — stores the compiler on `globalThis[Symbol.for('sitecore-content-sdk.atomsCssCompiler')]` |
| `@sitecore-content-sdk/nextjs/server-actions` | `compileCssForDocumentAction(classes)` (`'use server'`, returns `''` without a compiler), `updateComponentAction`, `previewComponentAction` |
| `@sitecore-content-sdk/content/atoms` | `Document`, `SerializedCatalog` types; bridge helpers `getDesignLibraryAtomsCatalogEvent`, `sendAtomsErrorEvent`, `addDocumentUpdateHandler` (validates since #652), `validateAtomsDocument`; `addComponentPropsUpdateHandler` was REMOVED in #654 |

## `defineAtomsCatalog`

```ts
import { z } from 'zod';
import { defineAtomsCatalog, defineAtomsRegistry, textFieldSchema, linkFieldSchema } from '@sitecore-content-sdk/nextjs/atoms';

export const catalog = defineAtomsCatalog({
  stylingSolution: 'tailwind',            // default is 'inline-css' — set it
  // version: '1',                         // optional catalog version (IV-008 on drift)
  components: {
    Stack:   { props: z.object({ className: z.string().optional() }), description: 'Vertical container', slots: ['default'] },
    Heading: { props: z.object({ text: textFieldSchema(), level: z.enum(['h1','h2','h3']).default('h2'), className: z.string().optional() }),
               description: 'Heading bound to a text field', allowedParents: ['Stack'], version: '1.0.0' },
    Button:  { props: z.object({ link: linkFieldSchema(), className: z.string().optional() }), description: 'Link button' },
  },
  actions: {},                             // required, even when empty
});

export const registry = defineAtomsRegistry(catalog, {
  components: {
    Stack:   ({ props, children }) => <div className={props.className}>{children}</div>,
    Heading: ({ props }) => { const Tag = props.level ?? 'h2'; return <Tag className={props.className}>{String(props.text?.value ?? '')}</Tag>; },
    Button:  ({ props }) => <a className={props.className} href={props.link?.value?.href}>{props.link?.value?.text}</a>,
  },
});
```

Per-component keys: `props` (Zod 4), `description`, `slots` (default `['default']`), `allowedChildren`, `allowedParents`, `example`, `version` (free string), `legacy`. Renderer args: `{ props, children, emit, on, bindings, loading }`. `defineAtomsRegistry` returns `{ registry, handlers, executeAction }` and is a `'use client'` module. A `className` catalog prop is allowed on this branch.

Field schemas return Zod objects shaped like SDK field values (`{ value }`), with `.meta({ meta: { control, fieldType } })` Design Studio hints. `withPropMeta(schema, { control?, fieldType? })` adds hints to any schema. No helper exists for Number, Checkbox, Multi-Line Text or reference (Droplink / Multilist) fields.

`AtomsConfig = { catalog, registry, navigate?, compileCssAction? }` → `SitecoreProvider atomsConfig`. `navigate` is what json-render's built-in `navigate` action calls; `emit` reaches only registry `handlers` (no analytics / events path).

## Document (what MMS returns)

A json-render 0.20 **flat** Spec plus `name`:

```json
{ "name": "PromoTile", "root": "stack",
  "elements": {
    "stack":   { "type": "Stack",   "props": { "className": "flex flex-col gap-4 p-8" }, "children": ["heading", "button"] },
    "heading": { "type": "Heading", "props": { "text": { "$state": "/fields/Title" }, "level": "h1", "className": "text-4xl font-bold" }, "children": [] },
    "button":  { "type": "Button",  "props": { "link": { "value": { "href": "/x", "text": "Go" } } }, "children": [] } },
  "state": {} }
```

- State at render = `{ ...doc.state, fields: <rendering datasource fields>, params: <rendering params> }`; bind with `$state`, `$cond`, `$template`, `$bindState`, `$item` (json-render README).
- `extractDocumentClasses` walks `doc.elements[*].props.className` only — classes elsewhere are never compiled.
- The nested `root: { id, type, children: [...] }` shape in the repo's `test-data/atom-component-layouts.ts` is stale; it renders nothing.

## Variant selection (`StudioComponentServerWrapper`)

`ComponentRef` = pipe-separated paths; the last segment of each path is its variant key. The SDK picks `paths.get(params.fieldNames) || paths.get('default') || null`. It reads **lower-case `fieldNames`**; Sitecore delivers **`FieldNames`** (and Edge rewrites an unresolvable value to `"Default"`), so authored variants do not select a path on this beta. No `default` segment and no match → `console.warn` + null.

## CLI codes (`sitecore-tools project atoms update|validate`, measured)

| Code | Meaning | Exit (breakOnError false) |
|---|---|---|
| MV-010 | `src/atoms/index.{ts,tsx}` not found | **1 (thrown)** |
| MV-011 | module does not export `catalog` (or `default.catalog`) | **1 (thrown)** |
| MV-012 | lock file missing | 0 |
| MV-013 | atom in lock, missing from catalog | 0 |
| MV-014 | atom new, not in lock | 0 |
| IV-008 | catalog `version` drift | 0 |
| IV-009 | per-atom `version` drift | 0 |
| IV-010 | schema hash changed | 0 |
| IE-008 | header "Lock file validation failed" | — |
| IE-009 | thrown after issues when `breakOnError: true` | 1 |

Hash = sha256 of the serialized definition minus `version`. **Changes the hash:** prop added/removed, type, enum values, `.default()`, `description`, `allowedParents/Children`, `legacy`. **Does not:** `.min/.max/...` parameters, `.meta()`, `.describe()`, `withPropMeta`, catalog `stylingSolution`. `validate -c <file>` accepts an alternative config (spread the base, force `breakOnError: true`).

Lock shape: `{ "version"?: string, "generated": ISO, "atoms": { "<Name>": { "version"?: string, "hash": "<sha256>" } } }`. Never hand-edit; `atoms update` regenerates.

## Component-map interaction

Atoms never enter `.sitecore/component-map*`. The beta map generator keys a dotted file by its prefix (`Promo.WithText.tsx` → `Promo`) and keeps `_` names verbatim; anything under `src/components/` is registered, so keep atoms in `src/atoms/`.

`componentMap.exclude` globs (`'src/components/atoms/**'`) work on this beta (measured), and are the supported way to colocate atoms under `src/components/`.
