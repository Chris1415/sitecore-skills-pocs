---
name: content-sdk-pages-router-sitemap-robots
description: "Sitemap and robots.txt in a Content SDK Pages Router app: API routes, rewrites, and the trap that an empty RobotsContent field serves 'Disallow: /'. Use when configuring SEO or a live site is not crawled. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.3"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-sitemap-robots
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-sitemap-robots/SKILL.md
---

# Content SDK Sitemap and Robots (Pages Router)

Sitemap and robots.txt are served via **API routes** and rewrites. Use the SDK middleware getHandler pattern and sites from .sitecore/sites.json.

## When to use

- User asks to add or change sitemap or robots.txt.
- Task involves SEO, sitemap.xml, or robots route.
- User mentions "sitemap," "robots," "SEO," or "rewrites."

## How to perform

- Sitemap: `src/pages/api/sitemap.ts` with `SitemapMiddleware(scClient, sites).getHandler()`; robots: `src/pages/api/robots.ts` with `RobotsMiddleware(scClient, sites).getHandler()`. Use sites from `.sitecore/sites.json`. Add rewrites in next.config.js for /sitemap*.xml and /robots.txt to these API routes.

## Where robots.txt content actually comes from

**The middleware serves nothing of its own — the body is CMS content.** `RobotsMiddleware` resolves the site from the request host, then calls `client.getRobots(siteName)`, which issues one Edge query:

```graphql
query RobotsQuery($siteName: String!) {
  site { siteInfo(site: $siteName) { robots } }
}
```

`siteInfo.robots` is the **`RobotsContent`** shared field on the site's Settings item — `/sitecore/content/<Collection>/<Site>/Settings`, field `{64971FA7-F8AC-4C88-9BB2-2949F2A28670}`, shown in Pages under **Robots → Robots content**. Changing robots.txt is a content edit, not a code change. This is identical in App Router; only the handler wrapper differs.

**An empty `RobotsContent` field does NOT mean "no robots.txt" — it means `Disallow: /`.** Sitecore composes the document server-side when the field is empty and returns a literal `User-agent: *\nDisallow: /`, which the middleware serves as a clean **HTTP 200**. Every crawler honours it, so a site with an untouched Settings item launches **excluded from search** while every other check is green. Verified against a live SitecoreAI CM 2026-08-12 across six sites: the five with an empty field all served the blocking document; the one with an authored value served it back verbatim.

Two consequences worth internalising:

- **The SDK's `if (!robotsContent)` branch is unreachable in practice.** It exists to return a 404 when Edge yields nothing, but Edge never yields nothing — it always composes a document. The field is the only control surface, so "we didn't configure it" and "we blocked all crawlers" are the same state.
- **A publish IS required — and the reasoning that said otherwise is the trap worth learning.** This bullet previously claimed no publish was needed, on the evidence that preview and live returned byte-identical `siteInfo.robots` across six sites. The observation was correct; the inference was not. They were identical because **every one of those sites had an empty field, so both contexts were serving the same composed default**. Identical-when-broken tells you nothing about identical-when-fixed. Re-measured 2026-08-14 immediately after writing the field: preview returned `Allow: /` while live still returned `Disallow: /`. The write lands on master, preview Edge follows within seconds, and **live Edge does not move until the Settings item is published**. This field *is* subject to the usual preview/live divergence.

  So **verify against the live Edge context, never preview** — a preview-side check will pass while the public site stays blocked. That is not hypothetical: a fix committed on this evidence read as done for a full day while the live site remained excluded from search.

The default you almost always want:

```
User-Agent: *
Allow: /
```

**Do not "fix" a blocking robots.txt with a static `public/robots.txt`.** The rewrite would shadow the CMS-managed value and take robots.txt out of the author's reach permanently. Fix `RobotsContent` on the Settings item.

⚠️ Sitecore auto-appends a `Sitemap:` line to whatever the field contains, pointing at the **CM host** (`https://xmc-….sitecorecloud.io/sitemap.xml`) rather than the site's public domain — observed on every site measured, including correctly-configured ones. Verify it before treating the served robots.txt as production-correct.

## Hard Rules

- **Sitemap:** `src/pages/api/sitemap.ts` — use `new SitemapMiddleware(scClient, sites).getHandler()`. Export the handler. Use `sites` from `.sitecore/sites.json`.
- **Robots:** `src/pages/api/robots.ts` — use `new RobotsMiddleware(scClient, sites).getHandler()`. Same pattern.
- **Rewrites:** In `next.config.js`, add rewrites for `/robots.txt` and `/sitemap*.xml` to the corresponding API routes (e.g. `/sitemap.xml` → `/api/sitemap`).
- Use the same SitecoreClient instance (e.g. from `src/lib/sitecore-client.ts`) as the rest of the app; do not create a dedicated client for sitemap/robots.
- Avoid hardcoding the site list; use .sitecore/sites.json.
- **Never ship a static `public/robots.txt`** — it shadows the CMS-managed `RobotsContent` field and removes robots.txt from authoring control.
- **Before calling a site done, fetch `/robots.txt` and read the body.** Assert 200 *and* that it does not say `Disallow: /`. A 200 is not sufficient — the blocking default is served at 200.

## Stop Conditions

- Stop if the user wants to serve sitemap/robots from a different origin or with different auth; document and suggest proxy or edge config.
- Do not add new env vars for sitemap/robots without documenting them in .env.example.
- Do not change rewrite paths without updating docs and any references.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
