# Anti-patterns — check the finished blueprint against this list

Every entry renders correctly and passes a normal test suite. That is why they are on a list.

| # | Anti-pattern | What happens | Plan instead |
|---|---|---|---|
| 1 | **Fetch instead of `fields`**: the component queries its own content by fixed path and returns plain strings | Nothing is editable in Pages. Measured on one build (2026-08-11): 17 of 21 renderings un-editable, through 704 unit tests and four reviews | Content arrives on `fields`; fetch only per field for genuinely non-authored data |
| 2 | **Per-component authorability exception** ("this one is all derived") | An authored heading hides inside a "derived" component | Split authored copy from derived data per field |
| 3 | **Datasource Template the code ignores** | Pages offers attach-a-datasource; the author fills it; nothing changes | No Datasource Template on a rendering that never reads one |
| 4 | **Mutating a shared rendering** a live site depends on | Another site breaks silently | Fork: new, name-prefixed rendering with a site-relative Datasource Location |
| 5 | **Hard-GUID Datasource Location** | A second site's authors write into the first site's `/Data` | `query:$site/...`, plus a `<X> Folder` per site |
| 6 | **Multilist as a list** | Authors can re-point rows, never add one | Child items + `__Masters` + branch (`content-sdk-list-component`), or ask the user |
| 7 | **`href={x \|\| '/'}`** fallback | An empty link becomes a working-looking link to home: a silent dead link | Render through `<Link>`; empty stays empty (and selectable while editing) |
| 8 | **Unmount on empty** (`return null`, `hasValue && <Text/>`) | The empty field can never be filled; the component vanishes from the canvas | `(isEditing \|\| hasValue)`; `renderChildrenWhenEmpty` on a children-wrapping `Link` |
| 9 | **Linked Parameters Template on a datasource-backed rendering** | Edge can return an empty route; the whole page blanks with HTTP 200 | Variation knobs as Shared fields on the datasource template |
| 10 | **ComponentQuery that returns less than the component renders** | Fields arrive without metadata or as the wrong shape; text renders empty | Return every rendered field with metadata; text `{ value }`, image/link `{ jsonValue }` |
| 11 | **Unbounded Edge query** (deep nesting, `children` without `first:`) | Over-deep selections return `[]`; `children` silently stops at 10 | Depth-budgeted sub-queries; explicit `first:` |
| 12 | **Order by creation** | Children come back in item-name order | Set `__Sortorder` at creation; assert the rendered order |
| 13 | **`encodeURIComponent(itemName)` in a path segment** | Works on preview, 404s on live (live indexes only the slugified path) | Use the route path Edge returns; assert one URL on live |
| 14 | **Authored liveness copy** ("3 left", "available today") | True the day it is written, false the day after | Derive it |
| 15 | **Literal microcopy in JSX** | Untranslatable, unauthorable | Dictionary key with a literal default (`value === key` = missing) |
| 16 | **Verifying at the CM** what only Edge decides (variant selection, publish state, route resolution) | The CM read-back shows the intent; Edge serves something else | Verify at Edge, and on live for anything in a preview/live divergence class |
| 17 | **Versioned field that should be Shared** (layout knobs, tone) | A later language version reads empty and falls back silently | Mark it Shared at creation |
