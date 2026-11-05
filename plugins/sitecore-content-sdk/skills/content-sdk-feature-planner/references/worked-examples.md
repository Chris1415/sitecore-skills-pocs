# Worked examples

Both are condensed: decisions and the reasons that matter. A real blueprint fills every row of the template.

## A. "FAQ accordion" (a list component)

**Step 0.** The site has a `Link List` clone and a `PageContent` rendering; nothing with question/answer rows. No reuse.

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Kind | Component with a datasource; the "Expand all" / "Collapse all" labels → Dictionary | Questions differ per placement; the button labels belong to the component |
| 2 | Model | Container `FAQ` (`Heading`, `Intro`) + element `FAQ Item` (`Question` Single-Line, `Answer` Rich Text). Container bases: standard + `_HorizonDatasourceGrouping` + `_PerSiteStandardValues`; element: standard + `_PerSiteStandardValues`. Container `__Standard Values.__Masters` = `FAQ Item`. Datasource Location `query:$site/*[@@name='Data']/*[@@templatename='FAQ Folder']` | Grouping base makes container + children editable in Pages; `__Masters` gives the add-a-row affordance; site-relative location keeps a second site safe |
| 3 | Rendering | Clone a JSON rendering (Promo), Datasource Template → a **branch** that ships one default `FAQ Item` | A Controller rendering has no `componentName`; the branch makes a new datasource a non-empty list |
| 3c | List? | Yes, child items. **Not** a Multilist | A Multilist lets an author re-point rows, never add one |
| 4 | Data | Datasource-children resolver (Shape B), or a ComponentQuery that returns every rendered field with metadata | Either is valid; a ComponentQuery replaces `fields`, so it must carry all of them |
| 4b | Server/Client | Server wrapper renders fields; a small Client child owns open/closed state and receives the SDK field objects | Interaction needs state; authorability needs the field objects |
| 5 | Authorability | All open in editing mode, so every `Answer` is reachable; empty `Question` stays selectable | A collapsed panel is a state-gated field; an author must not have to click to find content |
| 6 | Cross-cutting | i18n: Question/Answer versioned; dictionary keys for the labels with code defaults. Search: index Question + Answer if the site has FAQ search. SEO: optional FAQ structured data from the same fields. Others: none | |
| 7 | Delivery | Templates + rendering + branch + folder template into the collection's module; publish templates before content; set `__Sortorder` 100/200/300 at creation; live: assert the order rendered on a published page | Children come back in item-name order when `__Sortorder` is unset |

**Acceptance highlight:** in Pages, an author adds a fourth question, reorders it to first, and the page shows that order on live after publish.

## B. "Regional promo banner" (a personalized single component)

**Step 0.** The site already has a `Promo` rendering with `Heading`, `Body`, `Image`, `Link`. Reuse.

| # | Decision | Chosen | Why |
|---|---|---|---|
| 1 | Kind | Existing component, one datasource per audience | Personalization swaps the datasource of a placed component |
| 2 | Model | No new template. Add a Shared `Tone` field only if the regional banner needs a different look; not a Parameters Template | A linked params template on a datasource-backed rendering can drop the route on Edge |
| 3b | Variant vs sibling | Skin first; a Headless Variant only if the field arrangement changes | Cheapest first: skin → variant → new rendering |
| 4 | Data | Plain datasource fields | Flat, one item |
| 5 | Authorability | Every variant's datasource is an ordinary item the author can open from the component | Personalized content must be as editable as the default |
| 6 | Personalization | Page variant per region audience; COPY or SWAP the banner's datasource per variant; default stays for everyone else | Region conditions come from the condition templates; the head app's personalize proxy must be enabled and consent-gated |
| 6 | Consent | Personalization runs only for visitors who granted the matching category | Tracking without consent is a defect, not a choice |
| 6 | Caching | The personalized route is rewritten per variant; check that revalidation covers each variant path | A published variant can otherwise serve stale |
| 7 | Delivery | Publish the **page and every variant datasource** (a full publish of the page); live: request the page with a matching and a non-matching visitor and assert two different banners | Variant content reaches live only when the page and its datasources are published together; a non-default-language variant may have to be created in Pages first |

Skills used: `sitecoreai-personalization` (backend), `content-sdk-personalization` (head), `content-sdk-tracking-consent`, `sitecoreai-publishing`.
