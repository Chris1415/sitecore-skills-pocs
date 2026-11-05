---
name: content-sdk-app-router-atom-create
description: "Writes a Content SDK atom (beta.atoms): atom vs component, field schemas and enum tokens, renderer, catalog and registry keys, container slots, lock lifecycle, mock-MMS proof. Use when adding or changing an atom. Not wiring atoms into an app."
license: Apache-2.0
compatibility: "@sitecore-content-sdk/nextjs 3.0.0-beta.atoms.20261021204512, App Router template, wired per content-sdk-app-router-atoms. Not in latest 2.5.0. The beta.atoms tag has moved to 3.0.0-beta.atoms.20261104121033, which is unmeasured. Node 18+ for scripts/."
metadata:
  author: Christian Hahn
  version: "0.1.0"
  status: beta
  verified: "2026-10-29: Stack container atom written, locked, evolved (IV-010) and rendered in five Documents via mock MMS, next build && next start"
---

# Create a Content SDK atom (App Router) — BETA

An atom is a **coded, governed building block** that marketers (or Design Studio's AI) compose into low-code components without a deploy (`[UNVERIFIED]`: Design Studio was never seen offering this; see `content-sdk-app-router-atoms` § 9). You write the atom once; every component built from it is content. This skill covers writing one. Wiring atoms into an app, the runtime and its traps live in `content-sdk-app-router-atoms`; run its version gate first.

## 1. Is it an atom?

| The thing… | Make it |
|---|---|
| renders one authored value (text, rich text, image, link, date, file) | **leaf atom**, bound through a field schema |
| arranges other atoms (stack, grid, columns, card shell) | **container atom** with `slots` |
| has a closed set of looks (size, tone, emphasis) | **one atom with an enum prop**, never one atom per look |
| fetches data, holds state across interactions, reads `useSitecore`, renders a list of datasource children, personalizes | **code component**, not an atom (`content-sdk-app-router-component-scaffold`) |
| is a whole section (hero, card, CTA band) | **not an atom**: compose it as a Document from atoms |

Keep the set small. A catalog of 8–15 atoms covers most marketing pages; every atom is API surface you version forever (§ 6).

## 2. Anatomy (Content Kit convention)

```
src/components/atoms/<name>/<name>.schema.ts   catalog definition (Zod) + props type
src/components/atoms/<name>/<name>.tsx         React renderer
src/atoms/catalog.ts                           defineAtomsCatalog: one entry per atom key
src/atoms/registry.tsx                         defineAtomsRegistry ('use client'): key → renderer
src/atoms/index.ts                             the ONE entry the CLI and bundler read
```

`src/components/atoms/**` and `**/*.schema.ts` must be in `componentMap.exclude`, or the folder is registered as renderings (`content-sdk-component-naming-traps`).

## 3. The schema

```ts
import { textFieldSchema, withPropMeta } from "@sitecore-content-sdk/nextjs/atoms";
import { z } from "zod";

export const calloutCatalogDefinition = {
  props: z.object({
    text: textFieldSchema().describe("Single-Line Text field shown as the callout."),
    tone: withPropMeta(z.enum(["info", "success", "warning"]).default("info").describe("Colour role."), { control: "select" }),
    className: z.string().optional().describe("Optional extra classes."),
  }),
  description: "Category: Content. Short highlighted statement with a semantic tone.",
  example: { text: { value: "Free shipping over €50" }, tone: "info" },
  slots: [],          // leaf; a container declares ["default"]
  version: "1.0.0",
};
export type CalloutProps = z.infer<typeof calloutCatalogDefinition.props>;
```

Rules:
- **Authored content goes through a field schema** (`textFieldSchema`, `richTextFieldSchema`, `imageFieldSchema`, `linkFieldSchema`, `dateFieldSchema`, `fileFieldSchema`). A Document binds it with `{"$state": "/fields/<Field>"}` and gets the field object `{value}`. There is no number, checkbox or multiline schema: use `textFieldSchema()` or a plain Zod prop.
- **Design decisions are enums, not free strings.** `gap: "sm" | "md" | "lg"` maps to your spacing scale; a free `gap: string` lets every composer invent one. Keep `className` as the single escape hatch.
- **`description` and `example` are the AI's brief.** They are serialized with the props as JSON Schema; that Design Studio's generator and catalog panel read them is `[UNVERIFIED]`. Start `description` with `Category: <X>.`, state when to use the atom, and what it is not.
- **`withPropMeta(schema, { control })`** is meant as a Design Studio editor hint (`select`, `text`, `checkbox`, …), `[UNVERIFIED]` in Design Studio itself. The control vocabulary is not documented; `select` / `text` / `checkbox` are what Sitecore's own atoms use.
- **Defaults live in Zod** (`.default()`), so a Document can omit them.
- `allowedChildren` / `allowedParents` are hints only; the runtime does not enforce them.

## 4. The renderer

```tsx
import { cn } from "@/lib/atoms-utils";
import type { CalloutProps } from "./callout.schema";

const TONE = { info: "bg-sky-50 text-sky-900", success: "bg-emerald-50 text-emerald-900", warning: "bg-amber-50 text-amber-900" } as const;

export function Callout({ text, tone = "info", className }: Partial<CalloutProps>) {
  const value = text?.value;
  if (value === undefined || value === "") return null;   // empty field renders nothing
  return <p data-slot="callout" className={cn("rounded-lg px-4 py-2", TONE[tone], className)}>{String(value)}</p>;
}
```

- **It is a client component.** Atoms render inside the SDK's `'use client'` wrapper: no `async`, no server-only imports, no data fetching. Hooks are allowed but are a smell (§ 1).
- **Every internal class must be a literal string in `src/`.** Only Document `className` tokens are compiled at runtime; the atom's own classes reach the page through the build-time Tailwind scan. A class built by concatenation (`` `gap-${n}` ``) is never emitted. Use a lookup object.
- **Handle the empty field.** Return `null` (or a placeholder in editing) rather than an empty tag.
- **Render values safely.** Prefer the SDK field components (`Text`, `RichText`, `Image`, `Link`) when the value shape fits; `dangerouslySetInnerHTML` on a Single-Line Text value (as Content Kit's Heading does) trusts whatever an author types.
- **Use `data-slot="<name>"`** on the root, as Sitecore's atoms do; tests and audits select by it.

### Container atoms

Declare `slots: ["default"]` in the schema and render `children`:

```tsx
// registry.tsx
Stack: ({ props, children }) => <Stack {...props}>{children}</Stack>,
```

A Document lists the children by element id: `{"type": "Stack", "props": {...}, "children": ["title", "cta"]}`. Named slots arrive as `slots` in the renderer props. Content Kit ships **no** container atom; a Stack (direction, gap, align, justify, padding, wrap as enums) is the first atom to write.

## 5. Register and lock

1. `catalog.ts`: import the definition, add `Callout: calloutCatalogDefinition` under `components`. Keep `stylingSolution: "tailwind"` and `actions: {}`.
2. `registry.tsx`: add `Callout: ({ props }) => <Callout {...props} />`. Keys must match the catalog exactly.
3. Export the definition from `src/components/atoms/index.ts` (barrel).
4. `npm run sitecore-tools:atoms:update`, then commit `.sitecore/atoms.lock.json` with the atom.
5. CI: `node <atoms skill>/scripts/check-atoms-lock.mjs --app . --fail-on-hash-blind`. **`atoms validate` exits 0 on an out-of-date lock** (re-measured 2026-10-29: IV-010 printed, exit 0).

## 6. Changing an atom later

| Change | Lock signal | What to do |
|---|---|---|
| Add an optional prop or enum value | IV-010 | `atoms update`. Existing Documents keep working |
| Tighten Zod (`.min`, `.max`, `.regex`), edit `.describe()` / `withPropMeta` | **none** (hash-blind) | bump the atom's `version`, then `atoms update` (IV-009) |
| Rename or retype a prop, remove an enum value | IV-010 only | **Breaking.** Every Document using it renders wrong or crashes. Add a new key (`CalloutV2`) instead |
| Retire the atom | — | `legacy: true` + `atoms update`. Design Studio stops offering it (`[UNVERIFIED]`); old Documents still render |
| Delete the atom | MV-013 | Only after no Document references it. A missing renderer is a silent null render |

The scaffold's bundled atoms-maintain skill (under `.agents/skills/`) says "delete, then update"; do not follow it while Documents may still use the atom.

## 7. Prove it (no tenant needed)

1. Write a fixture folder with `routes.json` (renderings carrying `params.ComponentRef` and `fields`) and `documents.json` (one Document per ref, using the new atom).
2. `node scripts/mock-edge.mjs --dir <fixtures> --site <site>`.
3. `.env.local`: `SITECORE_EDGE_PLATFORM_HOSTNAME` and `NEXT_PUBLIC_SITECORE_EDGE_PLATFORM_HOSTNAME` = `http://127.0.0.1:4599`, any context id, `GENERATE_STATIC_PATHS=false`.
4. `npm run build && npx next start -p 3301`, never `next dev`.
5. Assert: `data-slot="<name>"` present per expected instance; every Document class in the page's `<style>`; the atom's own classes in the build CSS; an empty field renders nothing.
6. Keep the fixture folder **outside `src/`** (Tailwind would otherwise compile the Document classes at build time and hide a runtime-compiler failure).

Document shape: `{ "name": "...", "root": "<id>", "elements": { "<id>": { "type": "<AtomKey>", "props": {...}, "children": ["<id>", ...] } } }`. The rendering's fields and params are injected as `state`; anything a Document stores in `state.fields` is overwritten.

## 8. Checklist

- [ ] § 1 says atom, not component
- [ ] Authored values use field schemas; design choices are enums; `className` is the only free string
- [ ] `description` starts with `Category:`; `example` is valid against the schema
- [ ] Renderer: client-safe, literal classes, empty-field `null`, `data-slot`
- [ ] Catalog key = registry key; barrel export; excluded from `componentMap`
- [ ] Lock updated and committed; CI gate green
- [ ] Rendered in a Document via the mock MMS, `next build && next start`
