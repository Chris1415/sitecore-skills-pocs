---
name: content-sdk-variants-vs-siblings
description: "Decides whether a new presentation is a variant of an existing rendering or a sibling component: FieldNames resolution, file convention, variant items, failure modes. Use when adding a visual treatment or a new variant renders MissingComponent."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/react ≥ 2.x and the Sitecore CLI's `sitecore-tools project component generate-map` step (ships with @sitecore-content-sdk/cli). Resolution source re-read on @sitecore-content-sdk/react 2.4.0, 2026-09-18 (FieldNames → export, `Default` fallback, MissingComponent on a miss — unchanged). Tested with App Router; same mechanics apply to Pages Router."
metadata:
  author: Christian Hahn
  version: "0.2.3"
---

# Content SDK — Variants vs Siblings

When you need a new presentation in Sitecore, you have two options: extend an existing rendering with a new **variant**, or create a new **sibling component** (a fresh rendering). This skill says when to pick which, what's shared vs not, and exactly how the SDK resolves a variant at runtime.

## When to use

- Adding any new visual treatment for an existing concept (a new Promo style, a new Card layout, a new Hero look).
- Deciding whether to fork an existing rendering or extend it.
- A new variant was added in Sitecore but the head app renders `<MissingComponent>` or nothing.
- Reading rendering YAML and trying to predict what the React component will receive.

## The distinction

|  | **Variant** | **Sibling component** |
|---|---|---|
| Sitecore rendering item | **Same** rendering, different `FieldNames` param | **Different** rendering item entirely |
| `componentName` in layout response | Same | Different |
| `Rendering Contents Resolver` | Shared (set on the rendering) | Each sibling can have its own |
| `Datasource Template` | Shared | Each sibling can have its own |
| `Parameters Template` | Shared | Each sibling can have its own |
| `Datasource Location` query | Shared | Each can have its own |
| `ComponentQuery` (Integrated GraphQL) | Shared | Each can have its own |
| Author swap cost in Pages | One dropdown click | Remove + add a different rendering |
| Headless Variant item required for author UI | Yes — one per variant | N/A |
| Head-app file convention | `<Component>.<VariantName>.tsx`, merged into one map entry | Separate folder per component, separate map entry |

## What variants are good for

Same data, different presentation. The author picks how this "Promo" should LOOK (Card, Hero, Minimal, Editorial) without changing what content they entered. One Sitecore concept, N visual treatments, swap with one click.

**Variants only differ in head-side React representation.** Everything else (resolver, templates, queries) is bound at the rendering level and is therefore shared across all variants of that rendering. There is no escape valve — if you need a per-variant resolver or per-variant params, you need siblings.

## What forces a sibling (you cannot do this with variants)

Anything that differs at the rendering level forces siblings. Concretely:

- Different `Rendering Contents Resolver` GUID → siblings (e.g., the 4-resolver 2×2 family in `content-sdk-resolver-patterns` — Datasource Item / Datasource Children / Context Item / Context Children — must be siblings; their resolver classes differ).
- Different `Datasource Template` (different author-facing field set) → siblings.
- Different `Parameters Template` (different rendering params) → siblings.
- Different `ComponentQuery` (Integrated GraphQL) → siblings.
- Different `Datasource Location` constraint → siblings.

## Decision rule (heuristic)

```
Does the new presentation need any of:
  - Different fields the author edits?       → SIBLING
  - Different rendering parameters?          → SIBLING
  - A different resolver / data shape?       → SIBLING
  - A different ComponentQuery?              → SIBLING
Else (just a different look at the same data)?
  → VARIANT
```

A third option, beta only: a **marketer-composed low-code component** (atoms, `content-sdk-app-router-atoms`). The beta SDK reads lower-case `fieldNames`, so a Headless Variant authored in Sitecore (`FieldNames`) never selects a ComponentRef path.

## File-side convention (head app)

```
src/components/Promo_Training/
  Promo_Training.tsx           # exports `Default` AND `export default Default`
  Promo_Training.Fancy.tsx     # exports `Fancy` AND `export default Fancy`
  Promo_Training.Full.tsx      # exports `Full` AND `export default Full`
  Promo_Training.Minimal.tsx   # exports `Minimal` AND `export default Minimal`
```

`sitecore-tools project component generate-map` produces:

```ts
import * as Promo_TrainingMinimal from 'src/components/Promo_Training/Promo_Training.Minimal';
import * as Promo_TrainingFull    from 'src/components/Promo_Training/Promo_Training.Full';
import * as Promo_TrainingFancy   from 'src/components/Promo_Training/Promo_Training.Fancy';
import * as Promo_Training        from 'src/components/Promo_Training/Promo_Training';

['Promo_Training', { ...Promo_TrainingMinimal, ...Promo_TrainingFull, ...Promo_TrainingFancy, ...Promo_Training }]
```

All variant exports merge into one map entry keyed by `componentName`. The merged object carries:
- Named exports for each variant (`Default`, `Fancy`, `Full`, `Minimal`)
- A single `default` (the last-spread module's `export default` — i.e., the main `Promo_Training.tsx`)

## SDK-verified resolution flow (the runtime contract)

From `@sitecore-content-sdk/react/dist/cjs/components/Placeholder/placeholder-utils.js`:

```js
const exportName = renderingDefinition.params?.FieldNames;

const renderedComponent =
  exportName && exportName !== 'Default'
    ? component[exportName]                                       // (A) named-export lookup
    : component.default || component.Default || component;        // (B) default fallback chain

if (!renderedComponent) {
  logUnknownComponentError(...);
  return <MissingComponent />;
}
```

| `FieldNames` value | Path | What renders |
|---|---|---|
| `undefined` / missing | **(B)** | `component.default` → `component.Default` → `component` |
| `""` (empty string) | **(B)** | Same as above (falsy) |
| `"Default"` (literal) | **(B)** | Same as above — does **NOT** try `component.Default` via path A |
| `"Fancy"` (exact, case-sensitive) | **(A)** | `component.Fancy` if it exists |
| `"fancy"` (wrong case) | **(A)** | undefined → `<MissingComponent>` + console warning |
| Any value with no matching export | **(A)** | undefined → `<MissingComponent>` + console warning |

**Three things to remember:**
1. **Case-sensitive.** `FieldNames` value must match the export name exactly (`Fancy` ≠ `fancy`).
2. **Empty/missing is safe in the SDK, and not always in the CM.** The SDK falls back to the default export. But once the rendering has **any** Headless Variant item, the Layout Service resolves a missing `FieldNames` to the **alphabetically first** variant, before the head app sees it (§ Authoring side).
3. **Wrong name is loud, not silent** — visible `<MissingComponent>` placeholder + console warning.

## Authoring side — Headless Variant items are required for the dropdown

To make a variant available to authors via the Pages dropdown, you MUST create a Headless Variant item in the CMS:

```
/sitecore/content/<tenant>/<site>/Presentation/Headless Variants/<Rendering>/<VariantName>
```

Example: `/sitecore/content/dog-feeding/training/Presentation/Headless Variants/Promo_Training/Fancy`

- These items are **manually created** in the CMS — they are not auto-generated from the head-app `.tsx` files.
- The item name (e.g. `Fancy`) becomes the `FieldNames` value when the author selects it.
- Without a Headless Variant item, the variant cannot be selected in Pages — even if the export exists in the head app.
- Without a matching `.tsx` export, the dropdown still shows the variant but selecting it renders `<MissingComponent>`.

**The two sides must stay in sync.** Adding a variant is a **two-step** operation: head-app `.tsx` file + CMS Headless Variant item. Either one alone is broken.

### Writing a placement raw (measured 2026-09-27 → 28)

Pages writes these values for you. A script writing `__Renderings` XML over Authoring GraphQL has to get three things right, and a mistake in any of them silently renders the **wrong** variant:

- **`FieldNames` in `s:par` is the variant ITEM's GUID**, braced and dashed: `s:par="FieldNames={0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}"`. The Layout Service turns it into the item's **name** before it reaches the head app, so the SDK contract above is unchanged. A literal name (`FieldNames=Light`) resolved to the alphabetically first variant (`Basic`), with no error.
- **Create an explicit `Default` Headless Variant item once any sibling variant exists, and reference its GUID.** Without that item, an omitted `FieldNames` means "first child", not `"Default"`. `"Default"` resolves only on a rendering with **no** variant items.
- **Every other parameter needs its own `key=value` token** (`FieldNames={GUID}&HeadlineStyle=eyebrow`). A save can also rewrite `s:par` as bare, valueless tokens (`GridParameters&FieldNames&Styles&…`), and one such placement resolved to a non-default variant. Remove bare tokens.

**After any raw placement write, read `params` back through the layout** (`content-sdk-debug-layout-probe`, or a direct Edge `layout` query). The page builds, renders and passes review with the wrong variant, so reading `params` back is the only check that catches it.

## Hard Rules

- **Variants share EVERYTHING rendering-side.** No exception — if you find yourself needing per-variant params or per-variant resolvers, you're choosing the wrong tool and must use siblings instead.
- **`FieldNames` value === React export name, case-sensitive.** No casing normalization, no fuzzy match.
- **Variant addition is two-step:** create `.tsx` export AND create Headless Variant item. Missing either side breaks one of two failure paths (no dropdown vs MissingComponent).
- **gen-map merges variants into ONE map entry.** Don't try to register variants as separate map keys — gen-map will produce the wrong structure and `componentName`-based lookup will miss.
- **Main file (`<Component>.tsx`) is spread LAST in gen-map output**, so its `export default` wins as `component.default`. Keep the main file's default export as the "Default" variant for safe fallback behavior.
- **`FieldNames="Default"` triggers the fallback chain, not a named lookup.** Don't accidentally rely on `component.Default` being picked via path A — it's only picked via path B (as the second link after `component.default`).
- **For a clean sibling, create a separate folder with its own `componentName`** matching the rendering item exactly (see `content-sdk-component-naming-traps`).

## Stop Conditions

- **Stop and ask** if the user describes a new presentation that needs different fields/params/resolver — that's a sibling, not a variant; confirm before scaffolding.
- **Don't add a variant `.tsx` without also creating the CMS Headless Variant item** (or telling the user they need to). The variant will silently not appear in Pages.
- **Don't add a CMS Headless Variant item without a matching `.tsx` export** — production will render `<MissingComponent>` for that variant.
- **Don't switch a sibling to a variant just because "they look similar"** — verify the rendering items would actually share resolver/templates/params first. Forcing a merge fights Sitecore and produces brittle author UX.

## Verification

- After adding a variant, the regenerated `.sitecore/component-map.ts` should have the variant's import alias added alongside the others, and they should all merge into the same `componentName` map entry.
- Set `FieldNames` to the variant name in Pages → the head app should render the variant's component.
- Set `FieldNames` to a deliberately wrong name → the head app should render `<MissingComponent>` and log a warning to console (proves the resolution flow is wired right).
- Clear `FieldNames` entirely → the head app should render the default variant (the main file's export). On a rendering with Headless Variant items, assert that the resolved `params.FieldNames` is `Default` and not the first variant alphabetically.

## Related

- `content-sdk-app-router-component-scaffold` — for the underlying file-structure rules.
- `content-sdk-app-router-component-variants` — generic SDK guidance on variants; this skill is the playground-derived, runtime-verified deep dive.
- `content-sdk-component-naming-traps` — folder/file naming for components AND variants.
- `content-sdk-resolver-patterns` — the resolver-level distinctions that often force sibling vs variant choices.

## References

- SDK resolution source: `@sitecore-content-sdk/react/dist/cjs/components/Placeholder/placeholder-utils.js` (function that resolves `FieldNames` to an export).
- `DEFAULT_EXPORT_NAME` constant: `@sitecore-content-sdk/react/dist/cjs/components/sharedTypes/components.js` = `"Default"`.
- Captured example: a `Promo` component with four variants (Default, Fancy, Full, Minimal) and the four matching Headless Variant items under the site's `Presentation/Headless Variants/Promo/`; the file convention and the resolution behaviour above are transcribed from that run.
