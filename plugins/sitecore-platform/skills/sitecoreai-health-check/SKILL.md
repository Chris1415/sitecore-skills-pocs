---
name: sitecoreai-health-check
description: "Read-only health check of a SitecoreAI environment and its sites: tenant binding, Edge routes, broken links, missing templates, logs, delivery, P0-P3 report. Use for 'is this site healthy?'. Not fixes, publishing or writes."
license: Apache-2.0
compatibility: "SitecoreAI (Content SDK head apps for the delivery checks). Node 18+, no dependencies; Playwright optional (hydrated crawl). Needs an org automation client; an Edge administration client is optional (webhook state, read verbs only)."
metadata:
  author: Christian Hahn
  version: "0.2.8"
---

# SitecoreAI health check (doctor)

Nothing doctor-shaped exists in SitecoreAI behind an API: the Broken Links report, EdgeOrphans and Validate are UI-only, there is no referrers query, and logs live on a separate Monitoring API. This skill composes its own read-only checks across four instruments and writes one prioritized report. Every instrument sees one truth:

| Instrument | Sees | Never use it as |
|---|---|---|
| Authoring GraphQL | master (and the search index) | proof of publication |
| Edge, **live** context | what is published | proof that master is fine |
| Edge, preview context | master in Edge shape | the "published" side of any join |
| Browser / unfollowed HTTP | what a visitor gets | a followed status (`curl -L` behind SSO = false 200) |

## Read-only contract (hard rules)

All traffic goes through `scripts/lib/http.mjs`, which refuses before the network:
- any verb other than GET, HEAD, POST;
- any POST except a GraphQL **query** (the document is parsed: a `mutation` or `subscription` anywhere is refused), the `client_credentials` token mint, and the non-JSON `/api/revalidate` probe with no credential header (it cannot revalidate);
- any Edge Admin path outside `GET /webhooks`, `/webhooks/{id}`, `/settings`, and every `/content` route (the Edge administration client also holds `edge.content:clearall`);
- redirects are never followed; Edge is throttled (default 8 rps live, 4 rps preview, hard caps 80 and 5).

Each guard is mutation-tested (`scripts/__tests__/http.mutation.test.mjs`). Beyond the layer: never `--yes`, never `ser pull` into a product repo, never `ser validate --fix`, never change a log level, never republish, never create a credential. **Declared side effect:** the crawl fires the head app's page-view tracking once per URL.

## Step 1: choose the scope

| Scope | Flags | Runs |
|---|---|---|
| env | `--env <cmEnvId>` | X0, X1, ops (O3-O5), editing hosts (E2, E3), webhooks (D10), logs (O1, O2, T2 from logs) |
| site (default with `--site`) | `+ --site <name> [--url <live>]` | everything: census, content graph, drift, delivery, crawl |
| page | `+ --page /route` | D1, R1 and the graph for that page's subtree, crawl of one page, media; logs SKIPPED |
| language | `--lang <code>[,<code>…]` (default `en`) | census (R1, D11) per language; graph, drift and D1 on the first; W3 on exactly these, or on every environment + version language when absent |

`--checks` narrows by id or family (`binding ops eh delivery census graph crawl logs`); X0 and X1 always run. A URL-only run (no `--env`) does the delivery checks alone. `--root` overrides the site root when Authoring `sites` cannot resolve it.

**Git Bash** rewrites `/sitecore/...` and `/route` arguments into Windows paths. Under Git Bash (`MSYSTEM` + `EXEPATH` set) the scripts undo the rewrite for paths under the Git install root; any other drive-letter path is refused, never guessed. `MSYS_NO_PATHCONV=1` still works and is the safe choice in other shells.

## Step 2: credentials (X1). Missing = SKIPPED, never pass

| Credential (env names, three-segment convention) | Enables | Without it |
|---|---|---|
| Org automation client `SITECORE_DEPLOY_<LABEL>_ADMIN_CLIENT_ID/_SECRET` (`--org <label>`) | X0, Deploy, Authoring, Monitoring logs, context ids | delivery-only run |
| Edge administration client `SITECORE_EDGE_<LABEL>_CLIENT_ID/_SECRET` | D10 webhooks + settings | D10 SKIPPED |
| Tenant-scoped automation client | O6 Publishing jobs, E4 Sites API | SKIPPED (the org client gets 403 / 401 there) |
| Access-gate cookie `DOCTOR_GATE_COOKIE` / `--auth-cookie` | authenticated robots + crawl on a **private** surface | those checks UNKNOWN |
| Playwright (cwd or `PLAYWRIGHT_MODULE`) | hydrated crawl, console errors | crawl degraded to server HTML, D9 SKIPPED |

**Unsuffixed fallback:** when `--org <label>` finds no `SITECORE_DEPLOY_<LABEL>_ADMIN_CLIENT_*` but the unsuffixed `SITECORE_DEPLOY_ADMIN_CLIENT_*` exists, that pair is used and a note says so. It names no estate, so it is only safe because every check reads the named environment with it: a client of the wrong estate cannot read it and the check answers UNKNOWN, never pass.

The org token carries **no tenant claim**: X0 binds by the Deploy env read (host + context ids) and proves Authoring answers on that host. An editing-host env id is refused (its env read reports the CM host). Credentials come from env or `--env-file`; values are registered for redaction and never printed.

## Step 3: run

```sh
MSYS_NO_PATHCONV=1 node scripts/doctor.mjs --org <label> --env-file <creds.env> \
  --env <cmEnvId> --site <SiteName> --url https://<live-host> [--visibility private --auth-cookie "<c>"] \
  --out <dir> [--redact]
```

Run order (any P0 in the cheap steps is already in the report if you stop early):
1. X0 binding, X1 matrix.
2. Aggregates: O4 org health + `/healthz`, O3 deployments (advisory), O5 log levels, E2 registrations + stale Rendering Host items, E3 EH variables, D10 webhooks, D1 context, D2 robots, D3 protection, D4 revalidate, E1 editing config.
3. Census: R1 every live route's layout, D11 preview vs live.
4. D8 sitemap, D14-D16.
5. Content graph: inventory → forward edges → resolve on Authoring and live Edge → L1-L6, T2, M1, L5, D12, then R2/R3 joins, W5 drift, W3 language versions (orphan languages, missing versions, live keys absent or equal to the key; `sitecoreai-localization`).
6. Crawl D5/D7/D9, media D6.
7. Logs: O1 newest CM file per type → T2 confirmation on Authoring; O2 editing-host files.

Cost: about 3 minutes and 260 calls for a 43-route, 553-item site with a 60-page crawl; the graph costs ~7.4 calls per 100 items. Cap with `--max-routes`, `--max-pages`, `--log-max-bytes`.

## Severity and verdict rules

| Sev | Means | Examples |
|---|---|---|
| P0 | broken or invisible for everyone now | `Disallow: /` on a public site, live route `route:null`, app on the preview context, open revalidate endpoint, media from the CM |
| P1 | broken for some readers, or breaks the next publish | internal 404, missing datasource/reference, item whose template is gone, sitemap on the CM host, disabled webhook |
| P2 | degraded or risky | soft 404, no webhook, editing secret unset on a delivery-only app, unpublished pages |
| P3 | hygiene, candidates, info | unreferenced data items, preview-only routes, noisy log lines |

- **Instrument error = UNKNOWN**, never clean; UNKNOWN makes the exit code 1. Compare `total` with what was received everywhere.
- Assert the **first** status; a 3xx to `/sso-api` means locked.
- `--visibility private` inverts robots, protection and noindex verdicts: ask whether the site is meant to be public or private, never infer it.
- Deployment records are advisory (they can flip after completion).
- **Reverse drift** (master broken, Edge good) prints a "Do not republish" banner: a publish would push the broken state live. Repair master, verify on preview, publish only the repaired items.
- `may_be_intentional` marks policy findings (no webhook, unset editing secret on a delivery-only app, drafts): the user decides.

## Read the report, then remediate (never from the doctor)

Exit 0 clean · 1 findings ≥ P1 or UNKNOWN · 2 harness error. Work P0 first. Each finding carries evidence, a remediation line, an owner (`cms` / `code` / `ops`) and, with an item id, Pages and Content Editor links. Typical routes:
- content (`cms`): fix on master, verify on preview, publish only the item; stale Edge orphans → smart-publish the parent or an EdgeOrphans scan (UI);
- code: a bug report with the evidence;
- ops: variables, context ids, webhook re-enable after the receiver is fixed (`sitecoreai-edge-admin-webhooks`).

Layout of the report, statuses and the finding schema: `references/report-format.md`.

## The five gates, standalone

Go-live pipelines can call these directly; same scripts, same verdicts (exit 0 pass, 1 fail, 2 unknown):

| Script | Gate |
|---|---|
| `scripts/check-edge-context.mjs --env <cm> --site <s> [--app-env-file <pulled .env>]...` | LIVE id serves the home route; each app env carries the LIVE id (preview = P0) |
| `scripts/check-live-robots.mjs --url <live> --visibility public\|private [--auth-cookie]` | robots per visibility; CM-host `Sitemap:` line is advisory |
| `scripts/check-media-delivery.mjs --url <live> [--pages /,/x]` | unfollowed 200, non-HTML, from Edge; no media found = unknown |
| `scripts/check-live-templates.mjs --root <site root> [--context-id <live id>]` | no item of the site reads `UnknownTemplate` on LIVE Edge (unpublished template); a template not on Edge at all is a P2 advisory; absent root = unknown |
| `scripts/crawl-live-links.mjs --url <live> [--require-browser]` | every internal link resolves; MissingComponent; media sources on a dev host; noindex; console errors |

Run standalone, the crawl finds Playwright only from the cwd: point `PLAYWRIGHT_MODULE` at a head app's `node_modules/playwright` (with `--require-browser`, no browser = exit 2, never a pass). The context gate reads credentials from `DOCTOR_ENV_FILES` / `--env-file`. Exit codes are set via `process.exitCode` (a hard `process.exit()` while sockets close tripped a libuv assertion on Windows: exit 127 after a printed verdict).

## Estate parity: before moving a site to another tenant

`scripts/check-estate-parity.mjs --site <s> --a-ctx-file <f> --b-ctx-file <f> [--lang en,de-DE] [--normalize-cm-host]` compares one site's LIVE Edge delivery on two contexts (source and target tenant): route set, component structure, fields, route metadata, dictionary, media set, and an unfollowed GET of the target's media. Exit 0 parity, 1 differences, 2 undecided. A context file holds a bare id or a pulled `.env`. **Prove the instrument first:** A vs A must give 0; `--pair /x=/y` of two different routes and `--site-b <other>` must give 1. The full move procedure (drift probe, same-path cleanup, push, publish, parity, repoint, revert): the `sitecoreai-cli-cloud-workflow` skill, its estate-move reference.

## When NOT to use

- To fix anything, publish, re-enable a webhook or clear a cache: those are writes; route the finding to its owner.
- As proof that a page is published: only the live Edge leg proves that, and the doctor reports it, it does not change it.
- For a disk-only audit of a checkout (schema, map keys, authorability): use those audits directly.
- For load testing: the throttle and caps exist because Edge limits are shared with production.

## References and related skills

- `references/check-catalogue.md`: every check with surface, cost, severity, v0.1 status and the measured traps.
- `references/query-recipes.md`: Authoring, Edge, Deploy, Monitoring and Edge Admin reads with their measured limits.
- `references/log-signatures.md`: formats, the level-aware signature table, reading rules.
- `references/report-format.md`: exit codes, statuses, finding schema, redaction.
- Shapes: `sitecoreai-graphql-schemas` · census: `sitecoreai-edge-graphql-capture` · webhooks: `sitecoreai-edge-admin-webhooks` · CLI logs and `ser pull` to scratch: `sitecoreai-cli-cloud-workflow` · robots: `content-sdk-app-router-sitemap-robots` · revalidate: `content-sdk-app-router-cache-components-and-osr`.
