---
name: content-sdk-pages-router-component-scaffold
description: "Creates a new Sitecore component in a Content SDK Pages Router app: file layout, props interface, src/components/ placement, generated component map. Use when adding or scaffolding a component. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.3"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-scaffold
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-component-scaffold/SKILL.md
---

# Content SDK Component Scaffold (Pages Router)

Scaffold new Sitecore components so they integrate with the layout and editing pipeline. This app uses Pages Router with a single component map.

## When to use

- User asks to add a new Sitecore component, create a component from scratch, or scaffold a component.
- Task involves creating a new React component that will be rendered from Sitecore layout/placeholders.
- User mentions "new component," "add component," or "component file structure."

## How to perform

- Create a new file under `src/components/` (or existing feature folder). Define props (fields, params), export a single default component.
- **Do not register it by hand.** `.sitecore/component-map.ts` regenerates from `src/components/` during `npm run dev` and `npm run build`; run `npm run sitecore-tools:generate-map` to refresh it on demand (see the `content-sdk-pages-router-component-registration` skill).
- Run `npm run build` to verify, then confirm the component appears in the map.

## Worked example

Pages Router has **no Server/Client split** — one component shape, one map, no `'use client'` map routing. Value components (`Text`/`Image`/`Link`) and field types import from `@sitecore-content-sdk/nextjs`. Convention: `src/components/<Name>/<Name>.tsx`.

```tsx
// src/components/Promo/Promo.tsx
import { JSX } from 'react';
import { Text, Image, Link } from '@sitecore-content-sdk/nextjs';
import type { TextField, ImageField, LinkField } from '@sitecore-content-sdk/nextjs';
import type { ComponentRendering, ComponentParams } from '@sitecore-content-sdk/nextjs';

export interface PromoFields {
  Title?: TextField;
  Image?: ImageField;
  Cta?: LinkField;
}

export interface PromoProps {
  rendering: ComponentRendering & { fields?: PromoFields };
  fields?: PromoFields;
  params?: ComponentParams;
}

const Promo = ({ fields }: PromoProps): JSX.Element => (
  <section>
    <h2>
      <Text field={fields?.Title} />
    </h2>
    <Image field={fields?.Image} />
    {/* guard field EXISTENCE, not value — empty fields stay authorable in Pages */}
    {fields?.Cta && <Link field={fields.Cta} />}
  </section>
);

export default Promo;
```

Props are resolved by `getComponentData(page.layout, context, components)` in the catch-all page (see `content-sdk-pages-router-component-data-strategy`), then register in the single `.sitecore/component-map.ts`.

## Hard Rules

- Place components under `src/components/`. Use existing folder conventions.
- Define a props interface with the component's fields (e.g. `fields: { title: Field; ... }`) and any params. Use types from `@sitecore-content-sdk/react` or the app's types.
- Export a single default component; one component per file unless the app pattern differs.
- Prefer `npm run sitecore-tools:generate-map` over hand-editing the map; register manually only when the generator cannot handle the change, and expect the next `dev`/`build` to overwrite it.
- The component is not done until it **appears in `.sitecore/component-map.ts` after regeneration** (see the `content-sdk-pages-router-component-registration` skill). Pages Router has a single map, used by getComponentData and the editing API routes.

## Stop Conditions

- Do not create components in `.next/`, `node_modules/`, or build output.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
