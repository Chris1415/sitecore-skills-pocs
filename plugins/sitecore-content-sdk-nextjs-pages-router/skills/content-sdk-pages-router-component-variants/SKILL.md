---
name: content-sdk-pages-router-component-variants
description: "Implements component variants: different renderings or data-driven variants of the same component type. Pages Router: register in .sitecore/component-map.ts; getComponentData resolves props. Use when one component has multiple presentations."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.2"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-variants
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-component-variants/SKILL.md
---

# Content SDK Component Variants (Pages Router)

One component definition can have multiple presentations or data-driven variants. Component props are resolved by **getComponentData(page.layout, context, components)**; keep registration and layout aligned.

## When to use

- User asks for different "variants," "versions," or "presentations" of a component.
- Task involves rendering the same component type with different layouts or props based on data (e.g. variant field or style).
- User mentions "component variants," "variations," or "multiple renderings."

## How to perform

- Prefer one component that accepts variant/style via props and branches internally; or multiple map entries if the app uses one key per variant. Use layout/fields/params for variant; register in `.sitecore/component-map.ts`. getComponentData resolves props; align with existing app convention.

## Worked example

The SDK variant mechanism is identical to App Router: `params.FieldNames` resolves to a **named export**, case-sensitive; `generate-map` merges variant files (`<Name>.<Variant>.tsx`) into one map entry. The only Pages-Router difference is that props arrive via `getComponentData`, and registration is the single `.sitecore/component-map.ts`.

```tsx
// src/components/Promo/Promo.Card.tsx — a variant of Promo
import { JSX } from 'react';
import type { PromoProps } from './Promo';

export const Card = ({ fields }: PromoProps): JSX.Element => (
  <article className="promo-card">{/* card-specific layout, same fields */}</article>
);
export default Card;
```

```ts
// .sitecore/component-map.ts — generate-map merges variant exports under one componentName
import * as Promo from 'src/components/Promo/Promo';          // provides the default fallback
import * as PromoCard from 'src/components/Promo/Promo.Card'; // exports `Card`

export const componentMap = new Map<string, NextjsContentSdkComponent>([
  // main module spread LAST so its `default` wins as the fallback; `Card` stays a named export
  ['Promo', { ...PromoCard, ...Promo }],
]);
```

Resolution: `FieldNames: "Card"` → `component.Card`; empty / missing / `"Default"` → `component.default`; unmatched name → `<MissingComponent>` + console warning. Each variant also needs a CMS **Headless Variant** item for the Pages dropdown. Full contract: `content-sdk-variants-vs-siblings`.

## Hard Rules

- Prefer a single component registration that accepts variant/style data (e.g. params or fields) and branches internally, over multiple map entries for the same logical component unless the app pattern uses separate registrations per variant.
- Use props (fields, params) from layout to decide variant; do not rely on global state or URL for variant selection when data comes from Sitecore. getComponentData passes the layout-driven props to the component.
- Register in `.sitecore/component-map.ts` only. If the app uses one key per variant, register each; if one key with variant param, single registration. Follow existing app convention.
- Keep the map in sync via `npm run sitecore-tools:generate-map` (it also runs on `npm run dev` / `npm run build`) rather than editing it — the generator merges every `<Name>.<Variant>.tsx` export into the one map entry, which is easy to get wrong by hand.

## Stop Conditions

- Stop if the variant model (one registration vs many) is unclear; ask or follow the app's existing pattern.
- Do not add new component map entries without ensuring layout and editing can provide the corresponding data.
- Do not assume variant field names (e.g. "variant," "style") without checking the layout definition.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
