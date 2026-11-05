---
name: content-sdk-troubleshooting
description: "Triage for a misbehaving Content SDK head app: symptom to layer (browser, server, editing host, Edge, publishing, CM, build, hosting) to its logs and the right skill. Use for blank pages, preview vs live gaps or stale content. Not a health audit."
license: Apache-2.0
compatibility: "Content SDK head apps (App Router or Pages Router) on SitecoreAI. Debug namespaces verified on @sitecore-content-sdk/nextjs 2.4.1, content 2.3.1, core 2.1.4, search 0.5.0. Monitoring API reads need an org automation client; Vercel reads need the Vercel CLI."
metadata:
  author: Christian Hahn
  version: "0.1.4"
---

# Content SDK troubleshooting (triage hub)

A Content SDK page passes through eight layers before a visitor sees it, and most failures are **silent**: a 200 with an empty zone, a green build that never starts, a preview that works and a live site that doesn't. This skill does not fix anything itself. It finds the layer, reads that layer's own signal, and hands over to the skill that owns the fix.

## Discipline (apply before every step)

1. **Reproduce first, with the exact surface.** Note the URL, environment (local / editing host / preview / live), language and whether you are in Pages. "Broken" on preview and "broken" on live are different bugs.
2. **Isolate the layer before touching code.** Walk the layer table below from the outside in. A layer whose signal is clean is excluded, not suspected.
3. **Read the raw payload before reading the component.** If `layout.sitecore.route` or `fields` is wrong, no amount of JSX change helps (`content-sdk-debug-layout-probe`).
4. **Every check gets a known-good and a known-bad control.** A probe that cannot fail proves nothing: query a route you know works and one you know does not exist, and confirm they differ.
5. **Assert the first HTTP status, unfollowed.** `curl -L` behind SSO or a login shell follows to a sign-in page and reports 200. Use `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}'`.
6. **Preview is the permissive runtime.** Route-path forms, media resolution, the 404 page and cache semantics are all looser on preview. A preview pass proves nothing about live; budget one assertion against live.
7. **Clear the build cache after any CM write** (`rm -rf .next`) before trusting a build-time read: `.sitecore/sites.json`, the component map and SSG output are snapshots.
8. **Never print secrets.** `DEBUG=content-sdk:editing` logs the real editing secret on a mismatch (`sent "…" expected "…"`); the revalidate handler and Edge Admin webhook reads echo secrets too. Redact before pasting anything into a ticket, and rotate a secret that reached a log.

## Step 1: classify the symptom to a layer

| Symptom | Start at layer | First instrument |
|---|---|---|
| Hydration error, wrong theme flash, dead click, console error | Browser / client | DevTools console + network |
| 404 / 500 locally, wrong site, wrong language, redirect loop | Head-app server + proxy | `next dev` stdout with `DEBUG=content-sdk:*` |
| Page 200 but a zone or component empty | Layout payload (Edge) | `content-sdk-debug-layout-probe`, then Edge GraphQL |
| Works on preview, wrong or 404 on live | Edge preview vs live | the same query on both contexts, side by side |
| Content edited and published, live unchanged | Publishing + cache | publishing job status, webhook `lastRuns`, ISR window |
| Pages: no chromes, "Preview content is not found", component not found | Editing host + Pages | editing-host RenderingHost log, `/api/editing/config` status |
| Build or deploy red, or green but never serving | Deploy / build | deployment record + logs, Vercel build log |
| Item missing, template gone, publish fails | CM | CM `Log` / `Publishing` files via the Monitoring API |
| Live site not indexed, assets 404, protection wrong | Hosting / delivery | unfollowed HTTP on the live host |

Unsure which row applies? Run the cheapest probe of each of the first four layers in order: console, server log, layout payload, preview-vs-live diff. The first one that disagrees with expectation is your layer.

## Step 2: read that layer's signal

Where each log lives, how to fetch it and how to read it: **`references/log-sources.md`**. The short form:

| Layer | Where the signal is | Watch for |
|---|---|---|
| Browser | DevTools console + network; `localStorage.debug = 'content-sdk:*'` for client-side SDK logs | first error, not the cascade; the RSC payload contains the not-found copy on every page |
| Head-app server | `next dev` / `next start` stdout; `DEBUG=content-sdk:<ns>` (17 namespaces, see reference) | `content-sdk:http` shows every Edge request and its timing |
| Layout payload | `/api/layout-debug` (temporary), Edge GraphQL `layout(site, routePath, language)` | `route: null` = the whole route failed to resolve |
| Editing host | Monitoring API, `RenderingHost.*` files, listed only under the **editing-host** environment id | raw stdout, no timestamps |
| CM | Monitoring API, `Log.*` / `Publishing.*` per instance and day | match by level; signatures in the log-signatures reference of `sitecoreai-health-check` |
| Deploy | Deploy deployment record + `/api/deployments/v1/{id}` | every line is `info`: read `calculatedStatus` and `*LastFailureMessage`, not levels |
| Publishing | Publishing API job status (`sitecoreai-publishing`) | job done ≠ Edge updated: check the item on Edge |
| Edge → app cache | Edge Admin `GET /webhooks/{id}` → `lastRuns` | a 401 from the receiver auto-disables the webhook within seconds |
| Hosting (Vercel) | `vercel inspect <url> --logs` (build), `vercel logs <url>` (runtime, live tail ≤ 5 min) | which Edge context id the production env actually carries |

## Step 3: pick the instrument that can prove the claim

| Claim | Only this proves it | Never use |
|---|---|---|
| "It is published" | live Edge context read of the item / route | Authoring GraphQL, the preview context, the publish job status |
| "Master is correct" | Authoring GraphQL | Edge in any context |
| "A visitor sees it" | unfollowed HTTP or a real browser on the live host | `curl -L`, localhost, a Pages screenshot |
| "The app uses the live context" | the hosting environment's variables (`vercel env ls`), then a live route read with that id | the local `.env.local` |
| "The editor can author it" | Pages: select the field and change it | a rendered page |

The full instrument table and its traps: `sitecoreai-health-check` § the four instruments. For a whole-site sweep instead of one symptom, run that skill's doctor.

## Step 4: hand over to the owning skill

Known symptom-to-cause pairs, each with the first check and the owning skill: **`references/symptom-index.md`**. Routing by layer:

| Layer / topic | Load |
|---|---|
| Pages editing, preview, Design Library | `content-sdk-app-router-troubleshoot-editing`, `content-sdk-app-router-editing-safe-rendering` |
| Empty or wrong `fields`, resolver shape | `content-sdk-debug-layout-probe`, `content-sdk-resolver-patterns` |
| Component not found / MissingComponent | `content-sdk-component-naming-traps`, `content-sdk-app-router-component-registration` |
| Route, 404, placeholders | `content-sdk-app-router-route-configuration` |
| Proxy, site resolution, redirects | `content-sdk-app-router-multisite-management` |
| Language, dictionary | `content-sdk-app-router-dictionary-and-i18n`, `sitecoreai-localization` |
| Stale after publish, revalidation | `content-sdk-app-router-cache-components-and-osr`, `sitecoreai-edge-admin-webhooks` |
| Publish jobs | `sitecoreai-publishing` |
| Edge query errors, depth, complexity | `sitecoreai-edge-graphql-capture`, `sitecoreai-graphql-schemas` |
| Serialization, `ser pull` / `push` | `sitecoreai-serialization`, `sitecoreai-cli-cloud-workflow` |
| Robots, sitemap | `content-sdk-app-router-sitemap-robots` |
| Variants not shown | `content-sdk-personalization`, `sitecoreai-personalization` |
| Tracking, consent | `content-sdk-tracking-consent`, `content-sdk-analytics-events` |
| Search UI idle or empty | `content-sdk-search`, `sitecoreai-search-sources` |
| Theme flash, hydration | `content-sdk-app-router-theme-hydration-pattern` |
| After an SDK upgrade | `content-sdk-upgrade-assistant` |
| Env vars, site config | `content-sdk-site-setup-and-env` |
| Whole-environment health | `sitecoreai-health-check` |

## Stop conditions

- The fix is a write to a live tenant (publish, republish, webhook re-enable, cache clear, variable change): stop, state the finding with its evidence and let the user run it.
- **Do not add variables to an editing-host environment to switch on `DEBUG`**: the platform injects the app's variables there, and a variable upsert on an editing host has left it unable to roll out, even after the variable was deleted (measured). Reproduce locally against the same context instead.
- Reverse drift (master broken, live Edge good): do not republish. A publish would push the broken state live; repair master and verify on preview first.
- Two layers disagree and you cannot say which instrument is wrong: add a control, do not pick the convenient one.

## When NOT to use

- A full health sweep of an environment or site: `sitecoreai-health-check`.
- Building a feature or component: the specialist skills above.
- Pages Router editing specifics: the Pages Router twin of the editing skill, if installed.
