# Log sources: where each layer writes, and how to read it

Ordered from the visitor inward. Each entry: where, how to fetch, how to read, what it cannot tell you.

## 1. Browser

- **Where:** DevTools console and network tab; Playwright `page.on('console')` / `page.on('pageerror')` for an unattended run.
- **Client-side SDK logs:** the SDK uses the `debug` package (4.4.3), whose browser build reads `localStorage.debug` (or `DEBUG`). Set `localStorage.debug = 'content-sdk:*'` and reload.
- **Read:** the **first** error, not the cascade. A hydration error names the first mismatching node. React does not repair attribute mismatches in production hydration, so a wrong `lang` or `class` on a prerendered page stays wrong.
- **Traps:** the not-found copy ships in the RSC payload of every page, so grepping raw HTML for "not found" gives false positives (read visible text). Cookies are keyed by host, not port: every app on `localhost` shares `sc_site` and the draft-mode cookie, so "curl works, browser 404s" usually means a stale cookie from another app or a Pages session. Use a private window.

## 2. Head-app server (`next dev` / `next start`)

- **Where:** the terminal stdout of the Next.js process.
- **Switch on SDK logging:** `DEBUG=content-sdk:*` (all) or a list such as `DEBUG=content-sdk:http,content-sdk:layout`. `DEBUG_MULTILINE=true` pretty-prints objects across lines.
- **Namespaces** (verified by grepping the published `dist/` of @sitecore-content-sdk/core 2.1.4, content 2.3.1, nextjs 2.4.1, search 0.5.0 on 2026-10-13):

| Namespace | Package | Logs |
|---|---|---|
| `common`, `http`, `init` | core | shared helpers, **every GraphQL request with timing**, SDK initialisation |
| `layout`, `dictionary`, `errorpages` | content | page, dictionary and error-page fetches |
| `editing` | content, nextjs | editing render/config routes, preview proxy. **Prints the editing secret on a mismatch** |
| `locale`, `multisite`, `redirects`, `personalize` | content | the proxy chain steps |
| `robots`, `sitemap`, `llmsTxt` | content | the SEO route handlers |
| `form` | content | form submissions |
| `revalidate` | nextjs | the revalidate route and Edge webhook handling (secret mismatch, invalid body, unresolved site) |
| `search` | search | integrated search |

- **Read:** `content-sdk:http` first: if the request to Edge is wrong (site, language, routePath with `%20` instead of a hyphen), the rest follows.
- **Build vs dev:** `npm run build` and `npm run dev` run Edge reads that `npx next dev` skips (site info for `.sitecore/sites.json`, static params, error pages, dictionary). A green dev server and a red build usually means one of those calls.
- **Windows:** under Git Bash, Turbopack can fail every page spawning its PostCSS worker; launch `next dev` from PowerShell.

## 3. Layout payload (Edge)

- **Where:** a temporary `/api/layout-debug` route (`content-sdk-debug-layout-probe`) or a direct Edge GraphQL `layout(site:, routePath:, language:)` query (`sitecoreai-edge-graphql-capture`).
- **Read:** `item.rendered.sitecore.route` null means the whole route failed: an internal link without an item id, a broken parameters template, a reverted master. An empty placeholder with a non-null route means the zone key or the component registration.
- **Compare contexts:** run the same query against the preview and the live context id. A difference is the finding.
- **Cannot tell you:** whether the head app renders the payload. Remove the debug route before shipping (the doctor flags a 200 on it).

## 4. Editing host (Pages)

- **Where:** Monitoring API, file names `RenderingHost.<app>.log.YYYYMMDD.HHMMSS.txt`, listed **only under the editing host's own environment id** (not the CM's).
- **Fetch:** list, size-gate with HEAD, then read. Endpoints and limits: the query-recipes reference of `sitecoreai-health-check`, § Monitoring API (org automation client, max 50 files per type, no paging).
- **Read:** raw `next start` stdout with **no timestamps**: correlate by file name time and order. `Missing or invalid editing secret` means Pages cannot render through this host.
- **Quick external probe:** unfollowed `GET /api/editing/config` with no Origin: 401 = secret set, 500 = secret unset, 404 = no editing routes.
- **Do not** set `DEBUG` or any app variable on the editing-host environment to get more log: the platform injects the app's variables there, and an upsert has left an editing host unable to roll out, even after deletion. Reproduce locally against the same context.

## 5. CM

- **Where:** Monitoring API, `<Type>.log.<instance>.YYYYMMDD.HHMMSS.txt` for types Client, ContentTransfer, Crawling, Log, Owin, Publishing, RenderingHost, Search, Spe. The instance segment changes per container restart.
- **Read:** lines carry date and level. Match signatures with a minimum level: at INFO the Solr health agents log every minute and are noise. Signature table, severity and reading rules: the log-signatures reference of `sitecoreai-health-check`.
- **Correlate:** `GET /api/audit/v1/logsByOrg/{org}` gives months of change events (who deployed or changed what, when).

## 6. Deploy and build

- **SitecoreAI deploy:** `GET /api/deployments/v1/{id}` on the Monitoring API returns stages and log lines, **all at `info`**. Find a failure from the deployment record (`calculatedStatus`, `*LastFailureMessage`) on the Deploy API, then read the lines of the failed stage. Deployment status can flip after completion: re-read before concluding.
- **"Build green, never serves":** an editing host whose variables were upserted, or a git-linked host building a branch other than the one you merged to.
- **Vercel build:** `vercel inspect <deployment-url> --logs` prints the build log; `--wait` blocks until done (`--timeout`, default 3m). Flags per CLI 50.1.6 help, 2026-10-13.

## 7. Publishing and cache

- **Publishing jobs:** Publishing API `GET /jobs/{id}` (`sitecoreai-publishing`). A finished job means the CM handed off; confirm on live Edge.
- **Edge publish failures:** CM `Publishing` log; signatures `edge-ack-hung`, `edge-batch-failed` and friends in the health-check signature table.
- **Edge → app:** Edge Admin `GET /webhooks/{id}` shows `lastRuns` with the receiver's status. A 401 from the receiver disables the webhook automatically. A GET echoes header secrets: report names only.
- **App cache:** without on-demand revalidation, "published but not live" is the ISR window or a full-route cache; a redeploy busts it. With OSR, `DEBUG=content-sdk:revalidate` on the app shows what the webhook asked for.

## 8. Hosting (Vercel)

- **Runtime:** `vercel logs <deployment-url>` tails runtime logs from now, for at most 5 minutes (`--json` for one object per line; CLI 50.1.6). Reproduce while it runs. Older runtime logs: the Vercel dashboard.
- **Context check:** `vercel env ls` shows which variables each target has. The production target must carry the **live** Edge context id; the preview id there is a P0.
- **Protection:** only the production alias is public under SSO protection; deployment URLs and branch aliases 302 to a login page. Assert the first status.
- **Link traps:** `vercel link` to a project that already has variables overwrites `.env.local`; a project with a Root Directory must be deployed from the repository root.
