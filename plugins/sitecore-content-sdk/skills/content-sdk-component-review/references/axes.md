# Review axes: checks, evidence, severity

Default severity applies to a FAIL; raise it when the component is already live or widely reused. "Script" means a bundled script in `scripts/`.

## A1 Authorability

| Check | Evidence | Default |
|---|---|---|
| The component renders at least one SDK field component (`Text`, `RichText`, `Image`, `Link`) | authorability script `no-field-components` | P0 |
| Field components imported from the framework package (`@sitecore-content-sdk/nextjs`), not the router-agnostic React package | `wrong-import` | P1 |
| No authored value rendered as raw `.value` outside a field component | `raw-field-value` (per field; waivable per field) | P2 |
| Visitor-facing literals (JSX text, `aria-label`, `alt`, `title`, `placeholder`) live in the Dictionary with a literal default | `literal-microcopy` | P3 |
| Every exception is per field, with a reason that names where the author changes it instead | waiver file | P2 |

The script proves the mechanism, not the outcome. The human check closes it.

## A2 Editing safety

| Check | Evidence | Default |
|---|---|---|
| Empty fields still render a selectable element in edit mode (no `return null` before any field) | authorability `unmount-on-empty` | P1 |
| Every `hasValue`-style guard has an editing escape (`isEditing` / page mode) | authorability `bare-hasvalue-guard` | P2 |
| Renders in Pages edit, preview and the design library | human check | P1 |
| Client-only code (browser globals, effects) does not break the server render in edit mode | code read; `content-sdk-app-router-editing-safe-rendering` | P1 |

## A3 Registration and naming

| Check | Evidence | Default |
|---|---|---|
| Component map key equals the rendering's `componentName` exactly (version-sensitive) | `.sitecore/component-map*.ts` vs rendering item | P0 |
| Only registered `.tsx` (and `.<Variant>.tsx`) under `src/components/<Name>/`; helpers, types, tests elsewhere | file listing; `content-sdk-component-naming-traps` | P1 |
| Server vs client map matches the `componentType` annotation | map files | P1 |
| Parameter names do not collide with base-template fields | params template vs bases | P2 |

## A4 Variant vs sibling

| Check | Evidence | Default |
|---|---|---|
| A new presentation of the same data is a variant (`<Name>.<Variant>.tsx` export + Headless Variant item), not a fork | `content-sdk-variants-vs-siblings` | P2 |
| A sibling is deliberate: different data shape or behaviour, its own rendering | blueprint row 3b | P2 |
| Every Headless Variant item has a matching export (otherwise the component renders as missing) | variant items vs exports | P1 |

## A5 Data strategy

| Check | Evidence | Default |
|---|---|---|
| The data shape is the planned one: plain fields, a content resolver, or a ComponentQuery | blueprint row 4a; `content-sdk-resolver-patterns` | P2 |
| A ComponentQuery **replaces** the whole `fields` payload: every field the component renders is in the query | query vs component | P1 |
| No client or server fetch replacing `fields` for authored values (the value loses editing) | code read | P1 |
| Query depth stays inside the Edge budget (degrades silently past it) | query depth; `sitecoreai-edge-graphql-capture` | P2 |
| Server vs client component split is deliberate | `content-sdk-app-router-component-data-strategy` | P3 |

## A6 Content model and scoping

| Check | Evidence | Default |
|---|---|---|
| Rendering `Datasource Template` holds an item path (a branch for list components) | schema script; YAML | P1 |
| `Datasource Location` is a site-relative query, never a hard-pinned GUID into one site | schema script; YAML; live read | P1 |
| A params template exists and is linked (`Parameters Template`) | schema script | P2 |
| Local datasources live under `<Page>/Data`; shared ones under the site's data folder | schema script (loose datasources) | P2 |
| Field `Source` scoping by type (e.g. image pickers rooted at the site's media) | schema script | P2 |
| Template folder layout follows the project convention | schema script | P3 |
| A rendering shared across sites was forked for a site-specific change, not mutated in place | item history / blueprint | P1 |
| One icon per component across every item it owns | schema script; `content-sdk-icon-chooser` | P3 |

## A7 List wiring (list components only)

| Leg | Check | Evidence | Default |
|---|---|---|---|
| 0 | Container template has `_HorizonDatasourceGrouping` in its base chain (gives Page Builder the Items section) | schema script; live base chain | P1 |
| 1 | Container Standard Values `__Masters` = element template id (which template a new row uses) | YAML; live read | P1 |
| 2 | Rendering `Datasource Template` points at a BRANCH that ships one default row | YAML; live read | P2 |
| 3 | Delivery is children-aware: an added row actually renders (not a Multilist on the container) | code + resolver; human check | P1 |

Legs 0 and 1 are independent; either alone fails. Human check: add a row in Pages.

## A8 Template integrity (live)

| Check | Evidence | Default |
|---|---|---|
| Every project template's base chain resolves in the live engine (non-empty `baseTemplates`) | base-chain script | P0 |

A broken chain empties the Pages Content pane and drops inherited fields while the item's own fields still read fine.

## A9 Serialization completeness

| Check | Evidence | Default |
|---|---|---|
| Rendering item, datasource template(s), params template, branch, placeholder settings and Standard Values are all inside a module include | `ser explain -p <path>` per item | P1 |
| A template is serialized wherever its items are (a push aborts on a missing template) | module includes vs item templates | P1 |
| Include scope and `allowedPushOperations` fit the item class; nothing authored is `CreateUpdateAndDelete` | module JSON; `sitecoreai-serialization` checklist | P1 |
| The YAML on disk carries the values just written (scoped pull after the last CM write) | git diff of `authoring/items` | P2 |
| No path included by two modules | `ser explain` | P2 |

## A10 Comment economy

| Check | Evidence | Default |
|---|---|---|
| No header essay or comment wall (25+ lines) | density script `header-essay`, `comment-wall` | P3 |
| No long blocks (10+ lines) or comment-heavy files without cause | `long-block`, `density` | P3 |
| Reasoning that does not fit in a line or two lives in a decision record the comment links to | code read | P3 |

Never resolve a finding by deleting the comment: move the reasoning first. The script measures volume; a short wrong comment passes it.

## A11 Cross-cutting (where relevant)

| Concern | Check | Owning skill | Default |
|---|---|---|---|
| i18n | Dictionary keys have a literal default (Edge returns the key when untranslated); no locale hard-coded | `content-sdk-app-router-dictionary-and-i18n` | P2 |
| Personalization | Variants scoped as planned; default variant still authorable | `content-sdk-personalization`, `sitecoreai-personalization` | P2 |
| Consent | Any tracking the component adds is gated | `content-sdk-tracking-consent` | P1 |
| Caching | Data the component reads carries the cache tags revalidation targets | `content-sdk-app-router-cache-components-and-osr` | P2 |
| Search | Indexed fields match the index configuration | `sitecoreai-search-sources` | P3 |
