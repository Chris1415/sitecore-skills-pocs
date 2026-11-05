---
name: content-sdk-pages-router-component-registration
description: "Registers components in the generated .sitecore/component-map.ts of a Content SDK Pages Router app (regenerate, never hand-edit). Use when adding a component or layout or the editor cannot find one. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.3"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-registration
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-component-registration/SKILL.md
---

# Content SDK Component Registration (Pages Router)

Register components in the Sitecore component map so the layout and editing pipeline can resolve and render them. This app has a **single** map: `.sitecore/component-map.ts`.

## When to use

- After scaffolding or adding a new Sitecore component (must be registered).
- User reports a component not rendering, "component not found," or layout/placeholder showing raw component name.
- Task involves `.sitecore/component-map.ts`.
- User asks how to register a component or fix component resolution.

## How to perform

- **The map is GENERATED, not hand-written.** `.sitecore/component-map.ts` is produced from `src/components/` by `sitecore-tools project component generate-map`, which the scaffold wires into **both** `npm run dev` and `npm run build`, plus a `--watch` variant during dev. So the normal way to register a component is to **create the file in `src/components/` and re-run dev/build**.
- Refresh manually with `npm run sitecore-tools:generate-map`. Edit the map by hand only when the generator genuinely cannot express your case — and expect the next `dev`/`build` to overwrite it. The map is consumed by getComponentData and the editing API routes; keys must match the layout `componentName`.

## Worked example

Pages Router has ONE map (no `component-map.client.ts`) and no `componentType: 'client'` split. The key is the layout `componentName` (case-sensitive); each entry spreads the imported module.

```ts
// .sitecore/component-map.ts — the single Pages Router map
import { NextjsContentSdkComponent } from '@sitecore-content-sdk/nextjs';
import * as Promo from 'src/components/Promo/Promo';

export const componentMap = new Map<string, NextjsContentSdkComponent>([
  // ...built-ins from the scaffold (BYOCWrapper, FEaaSWrapper, Form) stay as-is...
  ['Promo', { ...Promo }],
]);

export default componentMap;
```

This map is consumed by `getComponentData(page.layout, context, components)` in `src/pages/[[...path]].tsx` and by the editing API routes (`src/pages/api/editing/config.ts`, `render.ts`, `feaas/render.ts`). A wrong/missing key renders `<MissingComponent>`.

## Hard Rules

- Every component rendered from Sitecore layout must be registered in `.sitecore/component-map.ts` — but achieve that by running `npm run sitecore-tools:generate-map` (or just `npm run dev` / `npm run build`), not by editing the map. Do not hand-edit generated entries unless the generator cannot handle the case.
- Component **names** come from the file/folder name, so renaming a component file renames its map key and breaks the layout binding. Rename deliberately and update the Sitecore rendering to match.
- The map is used by `getComponentData(page.layout, context, components)` in the catch-all page and by editing API routes (`src/pages/api/editing/config.ts`, `render.ts`, `feaas/render.ts`).
- Use consistent component names (same key in map as used in layout). Follow existing naming in the map.
- Do not remove or rename registrations without updating all references (layout, getComponentData, editing routes).

## Stop Conditions

- Stop if modifying the component map would break existing layout or editing; suggest a safe change or ask for confirmation.
- Do not edit `.sitecore/metadata.json` or import-map unless the task explicitly requires it.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
