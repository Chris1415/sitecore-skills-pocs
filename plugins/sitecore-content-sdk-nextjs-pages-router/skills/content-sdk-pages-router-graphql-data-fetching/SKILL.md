---
name: content-sdk-pages-router-graphql-data-fetching
description: "Fetches page, dictionary and component data in a Content SDK Pages Router app: getPage, getDictionary, getComponentData, getPagePaths for SSG. Use when fetching page or dictionary content. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.4"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-graphql-data-fetching
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-graphql-data-fetching/SKILL.md
---

# Content SDK GraphQL Data Fetching (Pages Router)

All Sitecore data fetching goes through the single client in `src/lib/sitecore-client.ts`. Use getPage, getDictionary, and **getComponentData** in the catch-all page. Path from **extractPath(context)**; locale from **context.locale**.

## When to use

- User asks how to fetch page data, layout, or dictionary phrases.
- Task involves getPage, getDictionary, getComponentData, getPreview, getDesignLibraryData, or getPagePaths.
- User mentions "sitecore client," "Layout Service," "page data," or "dictionary."

## How to perform

- Use the client from `src/lib/sitecore-client.ts` only. In [[...path]].tsx: use `extractPath(context)` and `context.locale`; call getPage(path, { locale: context.locale }), then getDictionary and getComponentData(page.layout, context, components). For SSG use getPagePaths in getStaticPaths. For preview use context.preview and getPreview/getDesignLibraryData(context.previewData).

## Hard Rules

- Use the single SitecoreClient instance in `src/lib/sitecore-client.ts`. Do not create a second client or instantiate SitecoreClient elsewhere.
- **Path and locale:** Use `extractPath(context)` (from `@sitecore-content-sdk/nextjs/utils`) to get the path array; use `context.locale` for locale. Do not assume path or locale from elsewhere.
- **Catch-all page flow:** In getStaticProps/getServerSideProps: `client.getPage(path, { locale: context.locale })`, then `client.getDictionary({ site: page.siteName, locale: page.locale })` and `client.getComponentData(page.layout, context, components)` for component props. Pass the result to the layout renderer.
- **SSG:** In getStaticPaths, use `client.getPagePaths(siteNames, context?.locales || [])` where site names come from `.sitecore/sites.json` (e.g. `sites.map((s) => s.name)`). Use `revalidate` in getStaticProps for ISR.
- **Preview:** Use `context.preview` and `context.previewData`; when in preview, use `client.getPreview(context.previewData)` or `client.getDesignLibraryData(context.previewData)`.
- Config for the client comes from `sitecore.config.ts`; use environment variables, never hardcode secrets.

## Stop Conditions

- Stop if the task requires moving the client to another folder without clear requirement; suggest keeping a single instance in lib.
- Do not add direct GraphQL or fetch to Layout Service bypassing the client unless the task explicitly requires it.
- Do not fetch in _app; all data flows from [[...path]].tsx.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
