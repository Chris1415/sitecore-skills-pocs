# Symptom index

Measured symptom → cause pairs from real Content SDK builds (2026-05 to 2026-10). Every row was hit at least once and cost real time; the date is when it was measured. Find the symptom, run the first check, then load the owning skill for the fix. A row is a hypothesis to confirm with that check, never a diagnosis on its own.

## Page renders nothing or 404s

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| Every page of a site blank or 404, preview included | Layout | Edge `layout` → `route` is null | One General Link authored `linktype="internal"` with a `url` but no resolvable item `id` breaks the whole page's layout resolution (2026-07-12) | `content-sdk-field-usage-image-link-text` |
| Whole route `undefined` after adding a Parameters Template to a datasource rendering | Layout | Edge `layout` per route | Params template must be the 4-base headless one, the Datasource Template a path (not a GUID), and the params force-republished; miss one and Edge drops the route (2026-07-20) | `content-sdk-create-component` |
| Multi-word page 404s on live, fine on preview | Edge live | `content-sdk:http` routePath | Proxy-rewritten path segments stay percent-encoded, and live Edge resolves only the hyphenated route path; preview resolves both (2026-08-11) | `content-sdk-app-router-route-configuration` |
| A real 404 crashes the not-found page on a new site | Head-app server | Does the site have error pages configured? | `getErrorPage` returns null on a fresh empty site; guard `not-found.tsx` or configure error pages (2026-07-01) | `content-sdk-app-router-route-configuration` |
| Non-default-language 404 page never shows on live | Edge live | `siteInfo.errorHandling` on live vs preview | Live Edge resolves the 404 page once per site in the site language; republishing cannot fix it (2026-10) | `content-sdk-app-router-dictionary-and-i18n` |
| curl 200, browser 404 or wrong site on localhost | Browser | Retry in a private window | Stale `sc_site` or draft-mode cookie from another app on `localhost` (2026-07-01) | this skill, `log-sources.md` § 1 |
| `public/` asset (mp4, js, css) 404s | Head-app proxy | Proxy `matcher` | Matcher does not exclude file extensions; add `.*\.[^/]+$` to the negative lookahead | `content-sdk-app-router-multisite-management` |
| Only Home 500s, other pages render stale content | CM | Authoring read of designs and renderings | CM master reverted to an old serialized baseline; others still render off stale Edge. Recover with `ser push` + a targeted publish (2026-07) | `sitecoreai-serialization` |
| Build-phase test page 404s while real pages work | Layout | Compare with a known-good page | The throwaway layout is wrong, not the schema; diagnose by rendering parity | `content-sdk-debug-layout-probe` |

## Component or zone empty, or wrong

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| Placeholder shows the raw component name / MissingComponent | Head app | Generated component map key vs `componentName` | Key mismatch (version-sensitive naming), a support file or colocated test registered as a rendering | `content-sdk-component-naming-traps` |
| Server shell loses interactivity after a rebuild | Head app | `.sitecore/component-map*.ts` | Map regenerated every build; needs `export const componentType = 'client'` as a bare string literal | `content-sdk-app-router-component-registration` |
| Nested zone empty although children are on the page | Layout | Child's `s:ph` in the layout XML | Child placed with the bare key; Edge needs the full path (`/headless-main/container-1`). The Marketer MCP writes the bare key | `sitecoreai-content-composition` |
| Nested placeholder renders nothing in the head app | Head app | Which placeholder component the parent uses | Use the app placeholder with the server component map passed explicitly, not the bare `Placeholder` (2026-06) | `content-sdk-app-router-component-data-strategy` |
| Columns stack like rows, a Container is invisible, or dropping a splitter empties the page | Browser | Computed style of `.row` / `.col-md-6` in DevTools | No CSS for the grid classes Edge delivers at runtime (or Tailwind purged them); the scaffold ships none (2026-06, re-measured 2026-10-15) | `content-sdk-layout-composition` |
| Children never render inside a column; console "Placeholder 'column-1' was not found" | Head app | The `name` the splitter passes to its placeholder | Edge keys are `column-N-{*}` with the id in `DynamicPlaceholderId`; a fixed name matches nothing (2026-10-15) | `content-sdk-layout-composition` |
| Component renders the wrong variant after MCP placement | Layout | `FieldNames` param on the rendering | A present-but-empty `FieldNames` resolves to the first variant; delete the key. CM reads back "correct", only Edge shows it (2026-08-09) | `content-sdk-variants-vs-siblings` |
| Authored fields vanished, `fields.data` appeared | Layout | Rendering's ComponentQuery field | Setting a ComponentQuery replaces the whole `fields` payload | `content-sdk-resolver-patterns` |
| ComponentQuery text renders blank or objects | Layout | `{value}` vs `{jsonValue}` | `<Text>` needs `{value}`; there is no `orderBy` on children | `content-sdk-resolver-patterns` |
| Field managed in the CM renders nothing | Head app | Field key casing in the payload | Fields are keyed by exact name; read the exact casing | `content-sdk-field-usage-image-link-text` |
| Deep GraphQL query returns `[]` / null, no error | Edge live | Split the query and compare | Undocumented query-depth budget degrades silently (2026-08-06) | `sitecoreai-edge-graphql-capture` |
| List rows in the wrong order | Layout | `__Sortorder` on the children | Children resolve in name order when sort order is unset (three instances in one build) | `content-sdk-list-component` |
| Multilist renders, shape differs from the component's reads | Layout | Payload shape | Plain multilist delivers `fields.X = [{id, url, fields}]`; ComponentQuery delivers `fields.data.datasource…` | `content-sdk-resolver-patterns` |
| Date sorts or renders wrong | Head app | Raw field value | Dates arrive as `yyyyMMddTHHmmssZ`; normalise before `new Date()` | `content-sdk-field-usage-image-link-text` |
| `tel:` / `mailto:` links dead | Head app | Rendered `href` | Sitecore prepends `http://`; fix at the render seam | `content-sdk-field-usage-image-link-text` |
| In-page anchor renders `http://#x` | Head app | Link field `linktype` | Use `linktype="anchor"` | `content-sdk-navigation-component` |
| Link silently goes to Home | Head app | Grep for `|| '/'` on `href` | Fail-open fallback; every crawl passes because `/` is 200 | `content-sdk-navigation-component` |
| Nav empty or one level off | Head app | `siteInfo.rootPath` | `rootPath` is the site node, not Home | `content-sdk-app-router-component-level-navigation` |
| Inherited fields missing in a read or an MCP write no-ops | CM / Edge | Template `__Base template` chain | Multi-base chains drop inherited fields from `ownFields` reads and make MCP writes silent no-ops | `sitecoreai-graphql-schemas` |
| Header and footer missing on a new page | CM | Page's `Page Design` field | Page created without a Page Design; the MCP cannot set it | `sitecoreai-content-composition` |
| Fixed overlay renders inline on the real page | Browser | Ancestor `transform` / `contain` | A transformed ancestor traps `position: fixed`; portal to `body` | `content-sdk-app-router-component-scaffold` |

## Works on preview, not on live

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| Rich-text links 404 on live | Edge live | `/-/link.aspx` in the field | Dynamic links are expanded on preview, not on live; rewrite to the plain route | `content-sdk-field-usage-image-link-text` |
| Images 302 to a login page on preview | Edge preview | Media host in `src` | Preview media is CM media and auth-walled; only live media is public. Assert media on live | `content-sdk-field-usage-image-link-text` |
| Dictionary edit published, live label unchanged | Publishing | Publish scope | Only a folder publish with children updates the site dictionary (2026-08) | `sitecoreai-localization` |
| Personalized variant content missing on live | Publishing | What was published | Variant content reaches live only with a full publish of page + datasource | `sitecoreai-personalization` |
| Pages editor broken, live site fine | CM vs Edge | Authoring read vs live Edge read | Tenant-only fix reverted on master while Edge keeps the last good publish (reverse drift). Do not republish | `sitecoreai-serialization` |
| Live robots says `Disallow: /` at 200 | Hosting / CM | Site `RobotsContent` field | Empty field composes `Disallow: /`; fixing it needs a publish (2026-08-14, 6 sites) | `content-sdk-app-router-sitemap-robots` |
| Live serves preview content or nothing | Hosting | `vercel env ls` on production | Production carries the preview context id | `content-sdk-site-setup-and-env` |

## Stale after publish

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| Published, live unchanged for minutes | App cache | Redeploy and compare | ISR window, not the publish; verify which context production serves first | `content-sdk-app-router-cache-components-and-osr` |
| `next: { revalidate, tags }` has no effect | Head app | Where the fetch option is passed | The GraphQL client ignores a per-call `fetch`; only the one bound at construction counts (core 2.1.2, 2026-08-09) | `content-sdk-app-router-cache-components-and-osr` |
| Item-level OSR never fires | App cache | `DEBUG=content-sdk:revalidate` + webhook `lastRuns` | Item-level OSR broken on nextjs ≤ 2.4.0 (measured 2026-10-02); fixed in 2.4.1 per its release notes (2026-10-12) — upgrade, pin exactly | `content-sdk-app-router-cache-components-and-osr` |
| Webhook stopped firing | Edge Admin | `GET /webhooks/{id}` → `lastRuns`, `disabled` | Receiver returned 401 and the webhook auto-disabled within seconds | `sitecoreai-edge-admin-webhooks` |
| "There is no publish to preview" | Publishing | Publishing targets | SitecoreAI has one target (Edge); preview reads master, so preview-first means do not publish | `sitecoreai-publishing` |

## Pages and editing

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| "Preview content is not found or access is denied" | Editing host | Proxy matcher | Matcher widened to `/api/*` makes the preview proxy 403 `/api/editing/config` | `content-sdk-app-router-troubleshoot-editing` |
| Field renders but cannot be edited in Pages | Head app | How the value is rendered | Raw `.value`, partial guards, unmount on empty or ComponentQuery: four ways a component is unauthorable | `content-sdk-app-router-editing-safe-rendering` |
| Editing chrome JSON occupies layout | Browser | `.scpm` markers | Markers must be `display: none` | `content-sdk-app-router-editing-safe-rendering` |
| Duplicate edit chrome on one value | Head app | Value rendered twice from a referenced item | Fields reached through a multilist carry editing metadata | `content-sdk-app-router-editing-safe-rendering` |
| Pages body in one language, labels and `lang` in another | Editing host | `[locale]` source in the editing render | The editing render takes the locale from the route, not `sc_lang` (2026-10-02) | `content-sdk-app-router-dictionary-and-i18n` |
| Datasource picker opens another site's tree | CM | Rendering `Datasource Location` | A hard GUID pins the picker to the first site; use `query:$site` | `content-sdk-variants-vs-siblings` |
| `set_component_datasource` returns 422 | CM | Rendering's Datasource Template | Renderings created by raw Authoring GraphQL lack a datasource template the Agent API reads | `sitecoreai-content-composition` |

## Build, deploy and hosting

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| Editing host deploy green, container never starts | Deploy | Variables on the editing-host environment | App variables (`SITECORE_EDGE_CONTEXT_ID`, `NEXT_PUBLIC_*`, editing secret) set on the host; any upsert can poison rollout | `content-sdk-site-setup-and-env` |
| Editing host build fails `ERR_SWC_NATIVE_CACHE` | Deploy | `@swc/core` version | `@swc/core` 1.16.13 fails in the build container | `content-sdk-upgrade-assistant` |
| Merged code not on the editing host | Deploy | Linked branch | A git-linked host builds one fixed branch; a renamed repository breaks the pull | `content-sdk-website-build-flow` |
| `next build` fails, `next dev` fine | Build | Build-only Edge reads | Static params, error pages, dictionary and site info call Edge only in the build | this skill, `log-sources.md` § 2 |
| Smoke test passes against a login page | Hosting | First status, unfollowed | `curl -L` followed an SSO 302 to a 200 sign-in page | this skill, Discipline 5 |
| New Vercel project's first deploy is public | Hosting | Which alias is protected | First `vercel deploy` goes to production; standard protection leaves that alias public | `content-sdk-website-build-flow` |
| `.env.local` changed after linking | Hosting | `vercel link` history | Linking to a project with variables overwrites `.env.local` | `content-sdk-site-setup-and-env` |
| Path-scoped script sweeps nothing on Windows | Tooling | The argument as received | Git Bash rewrites `/sitecore/...` into a Windows path; set `MSYS_NO_PATHCONV=1` | `sitecoreai-cli-cloud-workflow` |

## Browser and client

| Symptom | Layer | First check | Likely cause | Skill |
|---|---|---|---|---|
| "Hydration failed" on load | Browser | First mismatching node | Browser-only checks in render or state init; nested `<p>` from `RichText tag="p"` | `content-sdk-app-router-theme-hydration-pattern` |
| Wrong theme flashes on first paint | Browser | Preflight script | Theme applied after hydration instead of before paint | `content-sdk-app-router-theme-hydration-pattern` |
| Theme token absent in the browser, present in source | Browser | Computed `:root` styles | Tailwind v4 drops `@theme` properties no CSS references | `content-sdk-app-router-theme-hydration-pattern` |
| Content stuck invisible below the hero | Browser | Motion on vs reduced motion | Reveal-on-scroll gate never fires; screenshot gates run reduced-motion and miss it | `content-sdk-app-router-component-scaffold` |
| Search UI stays idle | Browser | Search context provider | Hooks run idle without context; client-only rule | `content-sdk-search` |
| Variant never shows for a visitor | Browser / proxy | Consent state, `_variantId_` rewrite | Personalize proxy skipped (no consent) or no variant for the audience | `content-sdk-personalization` |
