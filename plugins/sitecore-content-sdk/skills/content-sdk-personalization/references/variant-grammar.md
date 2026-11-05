# Variant id and friendlyId grammar

Source: `content/types/personalize/utils.d.ts` (`CdpHelper`, `getPersonalizedRewrite*`, `getGroomedVariantIds`), implementation `content/dist/cjs/personalize/utils.js:19-141`, and `nextjs/dist/cjs/proxy/personalize-proxy.js:241-256` for execution grouping.

## Normalization

- Page id: the item GUID, dashes removed, lowercased.
- Language: lowercased, and `.replace('-', '_')` replaces only the **first** hyphen.
- Scope: `CdpHelper.normalizeScope(scope)` strips every non-alphanumeric character. An empty scope adds no segment and no extra `_`.

## Formulas

| Id | Formula | Helper |
|---|---|---|
| Edge page variant id | `<variantId>` (contains no `_`) | — |
| Edge component variant id | `<componentId>_<variantId>` | — |
| Component control | `<componentId>_default` (always added to the candidates) | — |
| Page friendlyId | `embedded_[<scope>_]<pageId>_<lang>` | `CdpHelper.getPageFriendlyId(pageId, lang, scope?)` |
| Component friendlyId | `component_[<scope>_]<pageId>_<componentId>_<lang>*` | `CdpHelper.getComponentFriendlyId(pageId, componentId, lang, scope?)` |
| VIEW `pageVariantId` | `[<scope>_]<pageId>_<lang>_<variantId\|default>` | `CdpHelper.getPageVariantId(pageId, lang, variantId, scope?)` |
| Rewrite path | `<path>/_variantId_<pageVariant>[/_variantId_<componentVariant>…]` | `getPersonalizedRewrite(pathname, variantIds)` |
| Parse rewrite | `{ variantId, componentVariantIds? }`, default `variantId` `'_default'` | `getPersonalizedRewriteData(pathname)` |
| Strip rewrite | clean path | `normalizePersonalizedRewrite(pathname)` |
| Split Edge list | `{ variantId, componentVariantIds }` | `getGroomedVariantIds(variantIds)` |

The `*` on the component friendlyId is Personalize's fuzzy match; `personalize()` passes the friendlyId verbatim, so a self-invoked call can use it.

## How the proxy groups executions

From one Edge `variantIds` list:

- Ids **without** `_` → one execution: page friendlyId, candidates = all page variant ids.
- Ids **with** `_` → one execution per component id: component friendlyId, candidates = `[<compId>_default, <compId>_<v1>, …]`.

## Worked example (illustrative values)

Page id `{AB12CD34-…-9F}` → `ab12cd34…9f`; language `en-US`; scope `prod-eu` → `prodeu`; Edge `variantIds = ["v1a2", "c77_v9b8"]`.

| Id | Value |
|---|---|
| Page friendlyId | `embedded_prodeu_ab12cd34…9f_en_us` |
| Component friendlyId (component `c77`) | `component_prodeu_ab12cd34…9f_c77_en_us*` |
| Page candidates | `["v1a2"]` |
| Component candidates | `["c77_default", "c77_v9b8"]` |
| Rewrite when both match | `/about/_variantId_v1a2/_variantId_c77_v9b8` |
| VIEW `pageVariantId` | `prodeu_ab12cd34…9f_en_us_v1a2` |

Measured with an empty scope (P3, 2026-10-01): a live VIEW carried `pageVariantId` `<pageIdLowerNoDashes>_en_default`, whose stem matched the Edge item id.

## Edge cases

- A head-app scope that differs from the CM's `PAGES_PERSONALIZE_SCOPE` gives a friendlyId no flow has. Changing `PAGES_PERSONALIZE_SCOPE` orphans existing rules. Response for an unknown or wrongly scoped friendlyId: `404 No experiences found for friendlyId …` (measured P7); the SDK maps it to `null` → default.
- Region locales (`en-US`, `de-CH`): whether `_` substitution and case match what Personalize stores, and whether Edge language equals `route.itemLanguage`, is `[probe-gated: P11]`.
- Decision tables (component personalization): SDK 2.4.0 has no separate code path. Whether they reuse the component grammar is `[probe-gated: P9]`.
- **Variants are URL-addressable.** A direct request to `/page/_variantId_<id>` finds no Edge route for the lookup, so the proxy skips, and `getPage` then parses the segment and renders that variant. Anyone can force a variant by URL, and `x-sc-rewrite` exposes ids. Measured live (P7): it renders the variant with no consent cookie and no condition (0 edge-platform calls). It keeps rendering from the ISR cache after the variant is reset and republished, until revalidation. With consent, its VIEW reports `pageVariantId …_<v>`. Each variant path is its own ISR entry (`x-nextjs-cache: MISS` on first render, `s-maxage=31536000`).
