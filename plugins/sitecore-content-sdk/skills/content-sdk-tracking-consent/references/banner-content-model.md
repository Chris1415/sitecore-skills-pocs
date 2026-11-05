# Consent banner content model

## Decision: a datasource rendering, not dictionary entries

| Criterion | Datasource rendering (chosen) | Dictionary entries |
|---|---|---|
| Values arrive on `fields` and render through SDK field components | yes: `Text`, `RichText` and `Link` are inline-editable in Pages | no: the phrases come from `getDictionary` / next-intl `t()` as plain strings, so an author cannot select them on the page |
| Rich body copy with a policy link | `Rich Text` + `General Link` | plain strings only, so a link is hand-built in code |
| Per-language copy | language versions of one item | language versions of N phrase items |
| Marketer finds it | one item, on the page, in the footer partial | Dictionary folder, by key |
| Authored re-prompt (`PolicyVersion`) | a field next to the copy it versions | an orphan phrase |

## Template `Consent Banner`

One datasource template. Every field is versioned per language **except** `PolicyVersion`, which is a **Shared** field (the `Shared` checkbox on its `Template field` item = `1`).

| Field | Type | Versioned | Purpose |
|---|---|---|---|
| `Title` | Single-Line Text | per language | dialog heading (`aria-labelledby`) |
| `Body` | Rich Text | per language | the explanation (`aria-describedby`) |
| `PolicyLink` | General Link | per language | link to the cookie policy page |
| `NecessaryLabel` / `NecessaryDescription` | Single-Line / Multi-Line Text | per language | always on, shown disabled |
| `FunctionalLabel` / `FunctionalDescription` | Single-Line / Multi-Line Text | per language | preferences |
| `AnalyticsLabel` / `AnalyticsDescription` | Single-Line / Multi-Line Text | per language | page views and events |
| `MarketingLabel` / `MarketingDescription` | Single-Line / Multi-Line Text | per language | personalization and identity. The description should say that it includes analytics |
| `AcceptAllLabel`, `RejectAllLabel`, `CustomizeLabel`, `SaveLabel` | Single-Line Text | per language | action buttons |
| `ReopenLabel` | Single-Line Text | per language | the footer "Cookie settings" trigger |
| `PolicyVersion` | Single-Line Text | **shared** | bump it (for example `2026-10`) to re-prompt every visitor. Shared, so a translation cannot fork it |

Put sensible defaults on `__Standard Values`, so a fresh datasource is never blank. The cloned Promo template has **no** `__Standard Values`: create one (`createItem` named `__Standard Values`, template = the new template, parent = the new template) and point the template's `__Standard values` field at it (braced, dashed). Measured: the Marketer MCP's auto-created datasource then shows every default.

Field `Source` values: `Body` → `query:$xaRichTextProfile`, `PolicyLink` → `query:$linkableHomes`, text fields none. `PolicyLink` must target the site's real cookie-policy page; a site without one needs that page first.

## Building it on the tenant (verified on a live tenant 2026-10-01)

Follow `content-sdk-create-component` (clone the JSS Experience Accelerator **Promo** bundle, Make-a-copy mode). The names this skill's code and query expect:

| Item | Path (under `/sitecore/templates/Project/<Brand>/<Site>/` unless noted) | Notes |
|---|---|---|
| Datasource template | `Consent Banner` | clone of JSS `Promo`; delete the copied `Promo` section, add a `Data` section with the 17 fields above (`__Sortorder` in steps of 100) |
| Folder template | `Folders/Consent Banner Folder` | `__Standard Values.__Masters` = `{datasource tpl}\|{folder tpl}`, dashed |
| Parameters template | `Rendering Parameters/ConsentBanner Parameters` | clone of JSS `Promo` parameters: 4-base headless set, empty |
| Rendering | `/sitecore/layout/Renderings/Project/<Brand>/<Site>/ConsentBanner` | `componentName` = `ConsentBanner` (the `.tsx` file name, exactly); `Parameters Template` = params id (dashed); `Datasource Template` = the template **path**; `Datasource Location` = `query:$site/*[@@name='Data']/*[@@templatename='Consent Banner Folder']\|query:$sharedSites/*[@@name='Data']/*[@@templatename='Consent Banner Folder']` |
| Available Renderings | `<Site>/Presentation/Available Renderings/<group>` → `Renderings` | append the rendering id, `\|`-joined; verify with `get_allowed_comps_by_ph` |
| Container | `/sitecore/content/<Brand>/<Site>/Data/Consent Banner` | an item of `Consent Banner Folder`, directly under `Data`; its insert options must list `Consent Banner` |
| Shared datasource | `…/Data/Consent Banner/<Site> Consent Banner` | the one item every page uses |

- **`copyItem` carries the source's `__Display name`.** The cloned datasource template showed as **"Promo"** in the tree until `__Display name` was rewritten. Set it on every language the site defines.
- **Icon:** one probed icon on all seven items (rendering, 3 templates, 3 `__Standard Values`). `office/16x16/shield.png` resolved (`content-sdk-icon-chooser`, both controls).
- **No publish is needed** to place and preview it: Pages and the Edge **preview** context read the authoring database.

## Placing it (Marketer MCP)

- `add_component_on_page` **auto-creates a page-local datasource** (`local:/Data/ConsentBanner`, filled from `__Standard Values`). Repoint the placement to the shared item with `set_component_datasource(pageId, <placement uid from get_components_on_page>, <shared item id>)`, then `delete_content` the orphaned local item. `set_component_datasource` **works** on this cloned rendering because its `Datasource Template` is set; it 422s only on renderings built without one.
- The MCP writes `s:ds` as a bare dashless lowercase GUID in `__Final Renderings`. Edge preview resolves it.
- The footer Partial Design has no MCP tool: it is placed in Pages (or by a layout write on the Partial Design item). **Not yet verified on a tenant.**

## Placement

- **One shared datasource** under the site's `Data` folder (not page-local `<Page>/Data`). Every page shows the same item.
- Add the rendering once to the **footer Partial Design**. It renders the reopen trigger in place and portals the dialog to `document.body`, because a fixed overlay inside a transformed ancestor mis-positions.
- Set the rendering's `Datasource Template` and `Datasource Location` to the site-relative `Data` folder, never a GUID hard-pin (see `content-sdk-create-component`).
- The rendering is a client component (`'use client'`). It sits under `src/components/ConsentBanner/`, and the store and helpers sit under `src/lib/consent/`, because everything under `src/components/` registers as a rendering.

## Modes

| `page.mode` | Renders |
|---|---|
| `isNormal` | trigger plus dialog when undecided, when `pv ≠ PolicyVersion`, or when reopened |
| `isEditing`, `isDesignLibrary` | a static inline panel showing **every** field, `PolicyVersion` included. No overlay, no store, no cookie writes |
| `isEditing`, `isDesignLibrary`, **no datasource** | a visible `role="alert"` placeholder ("choose its datasource"), so the author can find and fix the placement |
| `isPreview` | nothing. Bootstrap does not init in preview either |

## Accessibility contract

- `role="dialog"`, `aria-modal="false"` (a non-blocking banner: no focus trap on first visit), labelled by `Title` and described by `Body`.
- **Necessary-only takes one click.** "Reject all" uses the same element and style as "Accept all".
- Category toggles are native checkboxes inside a `fieldset`, each `aria-describedby` its description. Necessary is checked and disabled. Turning marketing on turns analytics on, and turning analytics off turns marketing off.
- When reopened, focus moves to the heading. `Escape` closes, and focus returns to the trigger. On first visit `Escape` does nothing: no choice is implied.
- The default state is **necessary-only**: nothing is pre-ticked.

## No datasource: what arrives, and the fix

A placement with no `s:ds` arrives on Edge preview as `{ "componentName": "ConsentBanner", "dataSource": "", "isContentResolved": true, "params": {…} }`: **`fields` is absent**, not `{}` (measured). A bare `if (!fields) return null` therefore makes the rendering invisible in Pages, with nothing to click. The asset wraps the component in the SDK's `withDatasourceCheck({ editingErrorComponent })` (`@sitecore-content-sdk/react/types/enhancers/withDatasourceCheck.d.ts`): a missing **or** unresolved (`isContentResolved: false`, a deleted datasource) datasource renders `null` in normal mode and the placeholder in editing. The HOC skips its check in Design Library, so the component itself also shows the placeholder there when `fields` is absent. The HOC needs the `rendering` prop, which the SDK placeholder always passes; a hand-mounted `<ConsentBanner fields={…} />` without `rendering` now renders nothing.

**Unit-testing the modes:** the HOC reads `useSitecore` through a relative import inside `@sitecore-content-sdk/react`, so mocking only `@sitecore-content-sdk/nextjs` leaves it with no provider (`Cannot read properties of undefined (reading 'mode')`). Also mock `node_modules/@sitecore-content-sdk/react/dist/esm/components/SitecoreProvider.js`, or render inside a real `SitecoreProvider`.

## Styling is the app's job

The asset ships **no CSS**. Unstyled, the dialog is ordinary flow content at the top of `<body>`: readable and operable, but not a banner (measured screenshot). Style `.consent-banner` (for example fixed to the bottom of the viewport, with a z-index above the header), `.consent-banner__actions`, and `.consent-banner--authoring` / `--missing` for the editing panel with the app's own tokens. Keep Reject and Accept visually identical.
