# Feature blueprint — <feature name>

One page. Fill every row; write "none" deliberately, never by omission.

## Ask

- **Feature:** <one sentence, in the requester's words>
- **Site(s):** <site name(s); collection>
- **Author journey:** <who edits what, where (Pages / Content Editor), how often>
- **Reuse found in step 0:** <existing renderings / templates / variants considered, and why reused or not>

## Decisions

| # | Decision | Chosen | Why | Skill to load |
|---|---|---|---|---|
| 1 | Kind (page field / component / setting / dictionary / derived), per value | | | |
| 2 | Content model (templates, Shared vs versioned, Datasource Location) | | | `content-sdk-create-component` |
| 3a | New vs clone (source rendering) | | | `content-sdk-create-component` |
| 3b | Variant vs sibling | | | `content-sdk-variants-vs-siblings` |
| 3c | List component? | | | `content-sdk-list-component` |
| 3d | Navigation data source (if nav) | | | `content-sdk-navigation-component` |
| 4a | Data shape (fields / resolver / ComponentQuery / fetch per field) | | | `content-sdk-resolver-patterns` |
| 4b | Server vs Client component | | | `content-sdk-app-router-component-data-strategy` |
| 5 | Authorability exceptions (per field, with the visible source) | | | `content-sdk-app-router-editing-safe-rendering` |
| 6 | Cross-cutting: i18n · personalization · search · analytics/consent · caching · SEO · multisite · URLs | | | (per row) |
| 7 | Serialization module · publish scope · live assertions | | | `sitecoreai-serialization` |

## Items to create (CM)

| Item | Path | Template / base templates | Notes (Shared fields, `__Masters`, `__Sortorder`, Datasource Location) |
|---|---|---|---|
| | | | |

## Files to create (head app)

| File | Purpose | Notes (component-map key = `componentName`; variants = named exports) |
|---|---|---|
| `src/components/<Name>/<Name>.tsx` | | |

## Acceptance

- [ ] Every authored value can be **selected and edited in Pages**, including when empty (real browser, real tenant).
- [ ] An author can **add a row** (list components) and **reorder** it.
- [ ] Datasources land in the right folder for **each** site (site-relative Datasource Location, `<Page>/Data` for local).
- [ ] Render matches the design with populated **and** empty content.
- [ ] **Live** assertions (named environment): <route form, media 200 unfollowed, revalidation after publish, variant at Edge>.
- [ ] Cross-cutting checks from step 6: <one line each>.

## Open questions (for the user)

- <e.g. Multilist or child items for the rows?>

## Risks

| Risk | Likelihood | Detect by | Mitigation |
|---|---|---|---|
| | | | |
