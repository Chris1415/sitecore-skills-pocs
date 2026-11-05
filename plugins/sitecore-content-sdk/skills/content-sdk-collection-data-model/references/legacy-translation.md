# Legacy lists to modern collections

Legacy renderings (XSLT, WebForms, MVC) read lists by walking the content tree. Layout data on SitecoreAI carries only a rendering's datasource, so every walk needs a decision. Classify by who authors the rows.

| Legacy pattern | Typical example | Class | Modern shape |
|---|---|---|---|
| `./item` loop over the datasource's children, rows only used here | tabs, FAQ panels | A | Container datasource + `ComponentQuery`; move the rows under the datasource (a page-local Data folder) if they lived beside the page |
| `./item` loop over the **context page's** children | news list, product list, child-page tiles | B | Server fetch of the page's children; no datasource |
| Sibling loop (`$parent/item`) | left menu | B | Navigation component (tree-derived) |
| `sc:item(id)` read of one fixed item | footer contact block | — | Bind that item as the rendering's datasource |
| `sc:item(id)/item` loop over a fixed folder, many items | client logos, partners | D | Folder with insert options; ids-then-fetch for the subset shown |
| Same, but only a handful is ever shown and an editor chose them | featured logos | C | Multilist on the datasource; the folder stays the library |
| Children sorted by a date, newest N | recent news | B | Server fetch of the section's children, sorted in code, cached |
| `sc:random` then first N | random clients | D | Ids-then-fetch with a sample; or an authored Multilist (C) if the business wants control |
| Tag-filtered gallery reading a tag folder by id | product gallery | A or D (by row ownership) | A `Tags` Multilist on the container (or a fetch parameter); filter buttons from the tags the rows carry |
| Slides picked in a Multilist of shared items | home slider | C | Keep the Multilist; or A if the slides belong to this component |
| Rows read from the logged-in member, xDB or workflow items | profile, form submissions | — | Not deliverable from Edge: visual rebuild only, or a separate service |

## Migration checklist per list

1. Name the class and write it next to the component.
2. Class A: create the container template (Manage items bases, `__Masters`), a branch with one starter row, the `ComponentQuery`; move the rows; set `__Sortorder`.
3. Class B / D: implement the server fetch with paging and caching; add the "Edit source" link in editing mode.
4. Class C: add the Multilist field, migrate the picks, write the field's help text ("items are edited in …").
5. Run `scripts/probe-list-delivery.mjs` on the routes; for class A, add and edit a row in Pages.
