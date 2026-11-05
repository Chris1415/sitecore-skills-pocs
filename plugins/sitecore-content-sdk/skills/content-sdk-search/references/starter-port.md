# Porting the starter `SearchExperience`

Source: `Sitecore/xmcloud-starter-js`, `examples/kit-nextjs-product-listing/src/components/search-experience/` (component unchanged since 2026-06-15; upstream main locks nextjs 2.4.0 / search 0.5.0). Read 2026-10-02.

## Files (≈1,130 lines)

```
search-experience/
  SearchExperience.tsx            Default variant: useSearch + pagination
  SearchExperience.LoadMore.tsx   LoadMore variant: useInfiniteSearch
  search-components/
    constants.ts   DEBOUNCE_TIME 400, DEFAULT_PAGE_SIZE 6, gridColsClass, DICTIONARY_KEYS
    models.ts      SearchParams, SearchDocument (SYNC product fields), SearchFieldsMapping, SearchExperienceProps
    useSearchField.tsx  parses fields.search.value (JSON string)
    useRouter.tsx  ?q= via router.replace, 400 ms debounce
    useEvent.tsx   event({type:'search', …})
    useParams.tsx  styles, RenderingIdentifier, pageSize, columns
    useDebounce.tsx, SearchInput, SearchPagination, SearchEmptyResults, SearchError,
    SearchSkeletonItem, SearchItemCommon, SearchItem/{index,Category,Image,Link,SubTitle,Summary,Tags,Title}
```

Everything under `src/components/` is auto-registered as a rendering, support files included (`content-sdk-component-naming-traps`): keep `search-components/` where the generator ignores it, or accept the extra map entries knowingly.

## Patches (apply on the way in)

### 1. Encode the query (`useRouter.tsx`)

```diff
-      const queryString = value ? `?q=${value}` : '';
+      const queryString = value ? `?q=${encodeURIComponent(value)}` : '';
```

### 2 + 3. Real `nullResults`, consent gate, instance id (`useEvent.tsx`)

```diff
-import { event } from '@sitecore-content-sdk/events';
+import { trackEvent } from 'lib/consent/track'; // content-sdk-tracking-consent
-export const useEvent = ({ query, uid }: { query: string; uid?: string }) => {
+export const useEvent = ({ query, uid, total }: { query: string; uid?: string; total: number }) => {
 …
-      event({
+      trackEvent({
         type: 'search',
 …
         core: {
           componentId: uid ?? '',
+          componentInstanceId: uid ?? '',   // value to use: [probe-gated: P7]
           interactionType: type,
           keyword: query ?? '',
-          nullResults: false,
+          nullResults: total === 0,
         },
```

and in `SearchExperience.tsx`: `useEvent({ query: searchQuery, uid: props.rendering.uid, total })`. Consider sending `viewed` only for the settled query (the 400 ms debounce already applies to the URL; the effect fires per successful search).

### 4. Local Suspense

`useSearchParams()` needs a `<Suspense>` boundary or `next build` fails. Wrap the search component (or the page region that holds it), not the app-wide `Providers`: wrapping Providers bails the whole tree out to client rendering.

### 5. Your own `SearchDocument`

Replace the SYNC type (`sc_item_id, Description, Price, ProductName, AmpPower, Link`) with the fields your source returns. Capture first: `probe-search.mjs --index <id> --out search-response.json`, then type from the capture. Whether content sources return `sc_item_id` / site sources `sc_url` **[probe-gated: P4]**.

### 6. Loud config failure (`useSearchField.tsx`)

Validate the parsed object (`typeof searchIndex === 'string' && searchIndex.length > 0`). In editing mode render a visible "Search is not configured: pick a source in the Search Configuration tab" notice instead of empty skeletons; outside editing render nothing and log once.

### 7. Tailwind grid class (`constants.ts`)

`` `md:${baseClass}` `` is assembled at runtime, so Tailwind never sees `md:grid-cols-2|3`. List the three literal classes (`md:grid-cols-1 md:grid-cols-2 md:grid-cols-3`) in the map instead.

## CM items the component needs

| Item | Detail |
|---|---|
| Datasource template `Search Experience` | one field `search`, **Type: Plugin**, Source = the Search Configuration Manager Marketplace app id (`pub-958f3b66-0fb0-4675-8808-a5dc40949051` in the starter; whether global or per tenant **[probe-gated: P2-UI]**) |
| Folder template `Search Experience Folder` | under the site's `Data`; site-setup action *Add Search Experiences Data Folder* creates `Data/Search Experiences` |
| Rendering `Search Experience` | JSON rendering, `componentName: SearchExperience`, Datasource Location `query:$site/*[@@name='Data']/*[@@templatename='Search Experience Folder']` (+ a `$sharedSites` branch); parameters template with `columns` |
| Headless Variants | `Default`, `LoadMore` (`content-sdk-variants-vs-siblings`) |
| Dictionary | `SearchExperience_ResultsFound`, `_NoResultsFound`, `_TryAdjustingYourSearch`, `_ClearSearch`, `_SomethingWentWrong`, `_TryAgain`, `_LoadMore`, `_SearchInputPlaceholder`, `_PreviousPage`, `_NextPage`, `_ReadMore` |
| Available Renderings | add the rendering. One older starter clone did not; a 2026 SYNC-created site did carry it (read-only check 2026-10-02) |

Datasource value (written by the app's *Search Configuration* tab in Page builder):

```json
{ "searchIndex": "<source id>", "fieldsMapping": { "title": "<index field>", "description": "…", "type": "…", "link": "…", "images": "…", "tags": "…" } }
```

The exact JSON the app writes, and the Edge shape of a Plugin field on live vs preview, **[probe-gated: P7, P10]**. Which index field can fill `link` for a content source (General Link is not indexable) **[probe-gated: P4]**.

For a non-SYNC site in your own namespace: fork, do not reference SYNC templates, keep the Plugin field type and Source, and serialize the template, rendering, variants and dictionary in the brand module. Datasource Location must resolve per site (`query:$site/...`), never a GUID hard-pin.
