---
name: content-sdk-app-router-component-registration
description: "Registers components in the generated Content SDK App Router component maps (.sitecore/component-map*.ts, never hand-edited). Use when adding a component, a placeholder shows the raw name, or the editor cannot find a component."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.6"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-registration
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-component-registration/SKILL.md
---

# Content SDK Component Registration (App Router)

Register components in the Sitecore component maps so the layout and editing pipeline can resolve and render them. This app has **two** maps: server and client.

## When to use

- After scaffolding or adding a new Sitecore component (must be registered).
- User reports a component not rendering, "component not found," or layout/placeholder showing raw component name.
- Task involves `.sitecore/component-map.ts` or `.sitecore/component-map.client.ts`.
- User asks how to register a component or fix component resolution.

## How to perform

- **Both maps are GENERATED, not hand-written.** `.sitecore/component-map.ts` (Server) and `.sitecore/component-map.client.ts` (Client) are produced from `src/components/` by `sitecore-tools project component generate-map`, which the scaffold wires into **both** `npm run dev` and `npm run build` (`npm-run-all --serial sitecore-tools:generate-map …`), plus a `--watch` variant during dev. So the normal way to register a component is to **create the file in `src/components/` and re-run dev/build**.
- Refresh manually with `npm run sitecore-tools:generate-map`. Edit a map by hand only when the generator genuinely cannot express your case — and expect the next `dev`/`build` to overwrite it.

## Worked example

This is **what the generator emits**, shown so you can recognise a correct map and spot a broken one — not a template to type out. The map key is the layout `componentName` (case-sensitive). Each entry spreads the imported module (`{ ...Promo }`). A Server Component appears in `component-map.ts` only. A `'use client'` component appears in **both** maps — the server entry tagged `componentType: 'client'`, the client entry untagged.

```ts
// .sitecore/component-map.ts — Server map
import { NextjsContentSdkComponent } from '@sitecore-content-sdk/nextjs';
import * as Promo from 'src/components/Promo/Promo';
import * as StatsBand from 'src/components/StatsBand/StatsBand';

export const componentMap = new Map<string, NextjsContentSdkComponent>([
  // ...built-ins from the scaffold (BYOCWrapper, FEaaSWrapper, Form) stay as-is...
  ['Promo', { ...Promo }],                                    // server component
  ['StatsBand', { ...StatsBand, componentType: 'client' }],  // client comp placed in a server placeholder
]);

export default componentMap;
```

```ts
// .sitecore/component-map.client.ts — Client map ('use client' components only)
import { NextjsContentSdkComponent } from '@sitecore-content-sdk/nextjs';
import * as StatsBand from 'src/components/StatsBand/StatsBand';

export const componentMap = new Map<string, NextjsContentSdkComponent>([
  // ...built-ins (BYOCWrapper, FEaaSWrapper, Form)...
  ['StatsBand', { ...StatsBand }],
]);

export default componentMap;
```

A wrong/missing key renders `<MissingComponent>`. If a component is missing from a map, the fix is almost always **re-run the generator**, not add the line by hand — a component absent after regeneration usually means it is not where the generator looks (`src/components/`) or does not export what it expects.

## Hard Rules

- Every component rendered from Sitecore layout must be registered — but achieve that by running `npm run sitecore-tools:generate-map` (or just `npm run dev` / `npm run build`), not by editing the maps. Do not hand-edit generated entries unless the generator cannot handle the case.
- **Server components** (no `'use client'`): the generator emits them into `.sitecore/component-map.ts` only.
- **Client components** (`'use client'`): the generator emits them into **both** maps — `.sitecore/component-map.client.ts`, *and* `.sitecore/component-map.ts` tagged `componentType: 'client'`. Editing API routes consume both (e.g. `clientComponents` from the client map). Verified against generated output: in a 32-component app all 9 client components appeared in both maps.
- Component **names** come from the file/folder name, so renaming a component file renames its map key and breaks the layout binding. Rename deliberately and update the Sitecore rendering to match.
- Do not remove or rename registrations without updating all references (layout, editing routes).
- **Atoms (beta.atoms only) are not in `.sitecore/component-map*`.** A rendering whose params carry `ComponentRef` bypasses the map entirely (checked after FEaaS/BYOC, before the map lookup) → `content-sdk-app-router-atoms`.

## Stop Conditions

- Stop if it is unclear whether the new component is Server or Client; ask or follow app convention.
- Stop if modifying the maps would break existing layout or editing; suggest a safe change or ask for confirmation.
- Do not edit `.sitecore/metadata.json` or import-map unless the task explicitly requires it.

## References

- The six traps the generated map does not warn about (support files registered as renderings, the version-sensitive key derivation, parameter-name collisions): `content-sdk-component-naming-traps`.
- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
