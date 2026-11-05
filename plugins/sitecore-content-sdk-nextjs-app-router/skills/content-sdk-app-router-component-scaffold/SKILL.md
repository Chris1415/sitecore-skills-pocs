---
name: content-sdk-app-router-component-scaffold
description: "Creates a new Sitecore component in a Content SDK App Router app: file layout, props interface, src/components/ placement, Server vs Client choice. Use when asked to add, create or scaffold a component Sitecore layout renders."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.5"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-scaffold
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-component-scaffold/SKILL.md
---

# Content SDK Component Scaffold (App Router)

Scaffold new Sitecore components so they integrate with the layout and editing pipeline. This app uses App Router with separate server and client component maps.

## When to use

- User asks to add a new Sitecore component, create a component from scratch, or scaffold a component.
- Task involves creating a new React component that will be rendered from Sitecore layout/placeholders.
- User mentions "new component," "add component," or "component file structure."

## How to perform

- Create a new file under `src/components/` (or existing feature folder). Define props (fields, params), export a single default component.
- Decide Server vs Client: default Server; add `'use client'` only if the component needs hooks or event handlers.
- **Do not register it by hand.** The component maps regenerate from `src/components/` during `npm run dev` and `npm run build`; run `npm run sitecore-tools:generate-map` to refresh them on demand (see the `content-sdk-app-router-component-registration` skill).
- Run `npm run build` to verify, then confirm the component appears in the expected map.

## Worked example

A Server Component is the default — value components (`Text`/`Image`/`Link`) and field types both import from `@sitecore-content-sdk/nextjs`. Convention is one folder per component: `src/components/<Name>/<Name>.tsx`.

```tsx
// src/components/Promo/Promo.tsx — Server Component (the default)
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
    {/* guard field EXISTENCE, not value — empty fields stay authorable in Pages
        (see content-sdk-field-usage-image-link-text / -editing-safe-rendering) */}
    {fields?.Cta && <Link field={fields.Cta} />}
  </section>
);

export default Promo;
```

Needs hooks or event handlers (interactivity)? Make it a Client Component — add `'use client'` as the **first line**. Everything else (props interface, field helpers, default export) is identical, and the generator takes care of placement: a `'use client'` component lands in `.sitecore/component-map.client.ts` *and* in `.sitecore/component-map.ts` tagged `componentType: 'client'`.

## Hard Rules

- Place components under `src/components/`. Use existing folder conventions.
- Define a props interface with the component's fields (e.g. `fields: { title: Field; ... }`) and any params. Use types from `@sitecore-content-sdk/react` or the app's types.
- Export a single default component; one component per file unless the app pattern differs.
- **Server vs Client:** Use Server Components by default. Add `'use client'` only for interactivity (hooks, event handlers). The generator decides map placement from that directive — Server components into `.sitecore/component-map.ts`, Client components into `.sitecore/component-map.client.ts` **and** the server map tagged `componentType: 'client'`.
- Prefer `npm run sitecore-tools:generate-map` over hand-editing the maps; register manually only when the generator cannot handle the change, and expect the next `dev`/`build` to overwrite it.
- The component is not done until it **appears in the expected map after regeneration** (see the `content-sdk-app-router-component-registration` skill). Do not leave it unregistered.

## Stop Conditions

- Stop and ask if the component should be a Server or Client Component when the app does not have a clear convention.
- Do not create components in `.next/`, `node_modules/`, or build output.

## References

- Before naming the folder, read `content-sdk-component-naming-traps` — everything under `src/components/` registers as a rendering, and a `_` or `-` in the name is version-sensitive.
- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
