# Moving a site's delivery to another tenant (measured 2026-10-06)

Use when a head app's live site must be served by a different tenant (CM + Edge) than today, with both CMs
building from the same serialization repo. Proven on six sites; every one ended with route-by-route parity and
green live gates. Every step that writes needs the user's explicit go-ahead.

## 0. Probe (read-only)

- **Source vs git drift**, by item id, `__Revision` and field values (`serialization-overlays.md` § 3). Anything on
  the source tenant that git lacks must be pulled and committed first, or it is lost with the source.
  Auto-generated page thumbnails are excluded by design; a field a template no longer defines is not drift.
- **Target live vs source live** for each route (`sitecoreai-health-check` → `check-estate-parity.mjs`): what
  visitors would lose if you switched now. A stale target live (never republished) is the common case.
- **Tenant state outside git**: personalization variants, A/B tests, Site Grouping hostname and rendering-host
  binding, robots content, Edge webhooks, forms, the target's editing host. None of it moves with the repo.

## 1. Clean the target, push, publish

1. Clear same-path DB items (`NonUniquePathException`, `serialization-overlays.md` § 4) and any probe residue.
2. Scoped push: `ser push -n <target> -i "<module>" --what-if --trace` → reconcile → real push → what-if = 0.
3. Publish on the target from an **explicit item list** with `publishChildren` and `publishRelatedItems` off, all
   content languages, asserting the token's tenant. A `--root` on `Home` with children would also publish
   build-only trees such as `Home/Components Preview`. Language-variant deletes in the job stats are expected
   when a language is added to the publish.

## 2. Prove parity, then switch

1. `check-estate-parity.mjs --site <s> --a-ctx-file <source live> --b-ctx-file <target live>` with its controls:
   A vs A = 0, a `--pair` of two different routes = 1, `--site-b <other>` = 1. Only a 0 (or a difference you can
   show is the source lagging behind git) moves the site.
2. Back up all three Vercel targets (`vercel env pull --environment=<t> <explicit path>`; never let it default,
   it overwrites `.env.local`). Keep the backups private and outside any repo.
3. Set `SITECORE_EDGE_CONTEXT_ID` and `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID` to the target's **live** context id
   on production, preview and development (one non-interactive call per target). Read each target back by value.
4. Redeploy production from the current production deployment, so the build picks up the new ids.
5. Gates on the live URL: `check-edge-context` (all three pulled targets), media, crawl, robots, and a title /
   description / OG spot check.

**Revert:** reset the two variables to the source live id on all three targets and redeploy. The editing secret
and every other variable never change in a move.

## Afterwards

- Site Grouping `TargetHostName` on the target: set it to the public host if robots or the sitemap name the CM
  host, publish that item, then capture it with a scoped pull (the push policy for hostnames is `CreateOnly`).
- Re-bind anything outside git on the target: editing-host git link (first link needs the integration's human
  creator), content-authoring tools that name no tenant (probe the binding before the first write), webhooks.
