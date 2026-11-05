# Check catalogue

Every check the health check knows, with its surface, cost, severity and v0.1 status. Facts marked **(probe 2026-10-02)** were measured on a live tenant and override older documentation.

- **Layer:** CT content tree · DL delivery · EH editing host · OPS deploy, logs, infra · ST static (needs a local checkout).
- **Surface:** A Authoring GraphQL · E Edge live · P Edge preview · S Sites REST · Pub Publishing REST · D Deploy API · M Monitoring API · EA Edge Admin · C browser/HTTP · V Vercel · L local disk.
- **v0.1:** `run` = `doctor.mjs` runs it; anything else is the SKIPPED reason the report prints.
- **Severity:** P0 site broken or invisible now · P1 broken for some readers, or breaks the next publish · P2 degraded / risk · P3 hygiene, candidates, info.

| id | Check | Layer | Surface | Cost | Sev | v0.1 | Facts and false-positive traps |
|---|---|---|---|---|---|---|---|
| X0 | Tenant binding: the Deploy env read gives the CM host; Authoring answers on it; context ids from Deploy | all | D + A | 3 calls | gate | run | The org token has **no `tenant_name` claim** (probe 2026-10-02): bind by the Deploy host, not the token. An editing-host env read reports the **CM** host: refuse a non-`cm` env type. Failure = harness error (exit 2) |
| X1 | Credential matrix: which client is present, which checks it enables | all | each | 1 mint per client | gate | run | Missing credential = SKIPPED, never pass. Org client: Deploy, Authoring, **Monitoring** 200; Edge Admin 401 `edge.cdn.11`; xmapps 401; Publishing 403 (probe 2026-10-02) |
| D1 | Delivery on the LIVE context id; id alive | DL | D + E | 2 per app | P0 | run (`check-edge-context.mjs`) | The id is **not in served HTML**: compare the app's env (pulled per Vercel target) with Deploy `liveContextId`. Dead id = `404 No sitecore context` |
| D2 | robots.txt vs intended visibility | DL/CT | C + E | 2 | P0 | run (`check-live-robots.mjs`) | public: anonymous 200, no `Disallow: /`. private: anonymous 401 (or 3xx to SSO), authenticated body contains `Disallow: /`. Empty `RobotsContent` serves `Disallow: /` at 200. Authored casing `User-Agent` vs generated `User-agent` is the tell |
| D3 | Deployment protection vs visibility | DL | C | 1 | P0 | run | Only 401 or a 3xx to `/sso-api` counts as locked. Per-deployment URLs are locked by design; the production alias must not be (public) |
| D4 | Revalidate endpoint not open | DL | C | 1 | P0 | run | POST a **non-JSON** body, no header: 401 = secret set, `400 invalid JSON` = open. **Never POST `{}`**: on 2.4.0 it revalidates the dictionary when the secret is unset. 404 = plain template (no route) |
| R1 | Live route census: no `route:null` / `item:null` | CT/DL | E | 1 + R/100 + R | P0 | run | `routes(first:100)` passes on live delivery; **preview rejects it as too complex: page preview at 10** (probe 2026-10-02). Compare `total` with received |
| L1 | General Link: internal without `id=` (P0), missing target (P1) | CT | A | per batch | P0/P1 | run | An internal link without `id=` nulls the Edge route of the page |
| L6 | Rendering definition `s:id` resolves | CT | A | per id | P1 | run | |
| T5 | Params template linked on a datasource rendering | CT | A or L | per rendering | P0 risk | not in v0.1 | Disk side: schema audit on a checkout |
| D5 | Live link crawl, hydrated | DL | C (browser) | per route | P1 (blocker) | run (`crawl-live-links.mjs`) | Hrefs from the hydrated DOM; status from an **unfollowed** request; same-host redirects followed by hand. Without Playwright: server-HTML only, declared degraded. Flags `%20`/space hrefs. Side effect: one tracked page view per URL |
| D6 | Media from Edge: unfollowed 200, non-HTML | DL | C | per asset | P0/P1 | run (`check-media-delivery.mjs`) | Live media is `edge.sitecorecloud.io/<tenant>-<suffix>/media/…` (no `-/`). Strip a trailing `\` from RSC-payload URLs or a healthy asset reads as `400 ERROR 9401`. A 302 to the CM/portal = preview context or unpublished |
| D7 | Per-page markers: MissingComponent, noindex | DL | C | per page | P1 | run (in the crawl) | MissingComponent text: "component is missing React implementation" |
| D8 | Sitemap on the public host; robots `Sitemap:` line | DL | C + E | 2 + census | P1 | run | Sitecore builds both from the site hostname: **CM-host `<loc>` entries and `Sitemap:` line seen live** (probe 2026-10-02). Not a go-live blocker |
| D9 | Console errors after hydration | DL | C | per page | P2 | run (browser only) | SKIPPED without Playwright |
| D10 | Edge webhook health | DL | EA | 2 | P1/P2 | run | GET allowlist only. 0 webhooks = P2 (normal without OSR). Auto-disable after 10 failed deliveries (~7 s). GET echoes header secrets: report names only |
| D11 | Preview vs live: routes and component sets | CT/DL | E + P | 2R | P3/P2 | run | Preview-only routes = never published. Live-only routes = stale published routes |
| E1 | Editing config on the delivery surface | EH/DL | C | 1 | P2 | run | No Origin header: 401 = secret set, **500 = `SITECORE_EDITING_SECRET` unset** (seen live on a delivery-only app: policy, may be intentional) |
| E2 | EH registrations; stale Rendering Host items | EH | D + A | 1 + N | P1 | run | Registrations come from `hosts/v1/environment/{CM id}` (the EH id returns `200 []`). EH hosts answer **403 at the WAF**: any HTTP status = alive, only a transport failure = dead |
| E3 | EH env variable hygiene | EH | D | 1 per EH | P1 | run | Forbidden: `SITECORE_EDGE_CONTEXT_ID`, `NEXT_PUBLIC_*`, `SITECORE_EDITING_SECRET`. All EH envs on a shared CM are read: may include sibling sites |
| E4 | Sites API editing hosts | EH | S | 1 per site | P1 | needs a tenant-scoped client | |
| R2 | Master page with presentation, no live route | CT | A + E | join | P2 | run | Drafts and build scaffolding show here; may be intentional |
| R3 | Live route with no master item | CT | E + A | aliased lookups | P1 | run | Fix by publishing the parent or an EdgeOrphans scan (UI) |
| R5 | Error pages configured | CT | E + S | 1 per site/lang | P1 | not in v0.1 | |
| R6 | Page Design resolves (chrome) | CT | A + E | per page | P1 | not in v0.1 | Per-page datasource attribution must include Partial Designs |
| L2 | Rich-text dynamic links | CT | A | regex | P1 | run | No RTE links were observed on the probe tenant: format unconfirmed |
| L3 | Reference fields resolve | CT | A | per value | P1 | run | Pipe vs newline: a newline-joined list resolves nothing (P2) |
| L4 | Datasource `s:ds` resolves | CT | A + E | per page | P1 | run | Edge-side signature: component with `dataSource` and **no `fields`** (probe 2026-10-02) |
| L5 | Published item references an unpublished item | CT | A + E | join | P1/P2 | run | Only targets under `/sitecore/content` or `/sitecore/media library`: templates and layout are never on Edge (35/35 false positives before this rule). SKIPPED without a live id |
| T1 | `__Base template` resolves live | CT | A (+L) | 1 per template | P1 | framework script | Disk YAML hides the break |
| T2 | Item whose template is gone | CT | A + M | search + log | P1 | run | Index: `templateName == ""`. Authoring: `item(path)` with only `itemId` **still resolves**; selecting `template{templateId}` returns null + "template doesn't exist" (probe 2026-10-02). CM log: `Data template '{…}' not found for item '<path>'` |
| W5 | Edge vs master drift; reverse drift | CT | A + E | per item | P1/P3 | run | Comparator: `version` + `__Updated` (`__Revision` is not on Edge). Reverse drift = **do not republish** |
| O1 | CM log signatures | OPS | M | HEAD + capped GET | P0-P3 | run | See `log-signatures.md`. Newest file per type, capped (default 5 MB, hard 25 MB) |
| O2 | Editing-host log signatures | OPS/EH | M | same | P1 | run | EH logs live under the **EH env id** only; file `type` is mis-derived (use the `RenderingHost.` prefix) |
| O3 | Env state and deployment records (advisory) | OPS | D | 3-5 | P2/P3 | run | Deployments list is unpaged and oldest-first: sort client-side. Records can flip after completion: advisory only |
| O4 | Org health v4 and CM liveness | OPS | D + C | 3 | P0/P1 | run | v4 `status` is a string (`Healthy`), one resource (`Search Index`: the CM Solr index, not SitecoreAI integrated search, which `sitecoreai-search-sources` covers); v2 returns 500. `/healthz/live` and `/healthz/ready` answer 200 anonymously on cloud |
| O5 | Log levels, debug namespaces | OPS | D | 1 | P2/P1 | run | Report only; a change needs a redeploy |
| O6 | Publishing job health | OPS/CT | Pub | 2 | P1 | needs a tenant-scoped client | Jobs can be `Completed` with `itemsFailed > 0` |
| O7 | Vercel runtime errors | OPS/DL | V | 2 | P2 | not in v0.1 | CLI 50.x `vercel logs` streams only; history needs REST |
| O8 | Audit-log change correlation | OPS | M | 1 | P3 | not in v0.1 | `audit/v1/logsByOrg` returns months of events with the org client |
| L7 | Empty Allowed Controls | CT | A | per item | P2 | not in v0.1 | |
| L8 | Hard-pinned `Datasource Location` GUID | CT | A or L | per rendering | P2 | not in v0.1 | |
| T6 | Template resolves on LIVE Edge (no `UnknownTemplate` = P0; "Template with id … was not found" = P2, see the gate) | CT | E (live) | 1 per item | P0 | run (`check-live-templates.mjs`) | LIVE Edge names an item whose template is unpublished `UnknownTemplate`; preview reads master and hides it. Page types in the collection's template folder sit outside the site subtree, so a site publish leaves them out (measured 2026-10-31: a template-keyed site look fell back to plain on live only) |
| T3 | Missing `__Standard Values` | CT | A | per template | P2 | not in v0.1 | |
| T4 | Rendering-schema Definition of Done | ST | L | disk | P2 | local checkout | |
| W1 | Workflow-stuck items | CT | S + A | paged | P2 | not in v0.1 | `WorkflowState{final}` exists |
| W3 | Missing language versions: orphan language (versions in a language the env does not define, P1), missing page / dictionary versions, empty phrases, live route or dictionary key absent, phrase = key | CT | A + E | tree walk + 2 Edge pages per language | P1/P2/P3 | run | Port of `sitecoreai-localization` `language-census.mjs`. **Preview serves orphan-language versions, live cannot** (S4 probe 2026-10-02). Edge returns the **key** for an untranslated phrase, so value === key is the only signal; `total` counts entries, not translations. On the test environment every site's live dictionary was empty (`total:0`) while master and preview had entries. `first` goes as a variable (preview rejects a literal >= 61) |
| W4 | Empty required fields | CT | A | ~4 ms per field | P2 | not in v0.1 | Per-field `validation` only |
| M1 | Image field targets; alt text | CT/DL | A + C | per image | P2/P1 | run (targets) | Alt text not yet checked |
| M2 | Oversized media (> 50 MB) | CT | A | per item | P2/P1 | not in v0.1 | |
| N1 | Duplicate sibling names | CT | A or L | grouping | P1/P3 | not in v0.1 | |
| N2 | Invalid / URL-hostile names | CT | A or L | regex | P2 | not in v0.1 | |
| S2 | Site hosts | CT | S + E | 2 | P2 | not in v0.1 | |
| S4 | Redirects: targets, chains, loops, cap | CT/DL | E | 1 + census | P2 | not in v0.1 | |
| ST1 | Static head-app audits | ST | L | disk | per audit | local checkout | |
| W2 | Long-held locks | CT | A | per item | P3 | not in v0.1 | `ItemLock` has no date; raw `__Lock` unlocked = `<r />`; lock search criteria are ignored |
| D12 | Unreferenced data items (candidates) | CT | A | full graph | P3 | run | Descendants of a referenced datasource count as referenced (list rows are reached as children) |
| D13 | Core Web Vitals | DL | C | per URL | P3 | not in v0.1 | |
| D14 | `/llms.txt` present | DL | C | 1 | P3 | run | |
| D15 | Leftover debug routes (`/api/layout-debug`) | DL | C | 1 | P1 | run | Added during the first build |
| D16 | Unknown route returns 404 (no soft 404) | DL | C | 1 | P2 | run | Added during the first build |

**Run order:** X0, X1 → aggregates (O4, O3, O5, E2, E3, D10, D1, D2, D3, D4, E1) → census (R1, D11) → D8 and small delivery checks → content graph (L*, T2, M1, D12, R2, R3) → T6 → W5 → W3 → crawl (D5, D7, D9) → D6 → logs (O1 → T2 confirmation, O2) → report.

**Measured cost (probe 2026-10-02):** content graph ≈ 7.4 calls and 0.5 s per 100 items; live layouts ≈ 327 routes/min at 8 rps (preview 235 at 4 rps); a full site run of 43 routes, 553 items and a 60-page browser crawl took about 3 minutes and 260 calls.
