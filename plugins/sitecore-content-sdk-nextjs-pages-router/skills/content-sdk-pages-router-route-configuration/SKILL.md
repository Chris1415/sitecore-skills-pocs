---
name: content-sdk-pages-router-route-configuration
description: "Routing and layout in a Content SDK Pages Router app: catch-all src/pages/[[...path]].tsx, extractPath, locale, data via getStaticProps to Layout. Use when changing routing, placeholders or layout. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.4"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-route-configuration
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-route-configuration/SKILL.md
---

# Content SDK Route Configuration (Pages Router)

Single catch-all route; no [site] or [locale] in the URL path. Site is resolved by middleware; locale from Next.js i18n (context.locale).

## When to use

- User asks to change routing, add a route, or fix 404/500 behavior.
- Task involves catch-all route, placeholders, _app, or Layout.tsx.
- User mentions "[[...path]]," "placeholder," "layout," or "getStaticProps."

## How to perform

- Single Sitecore page: `src/pages/[[...path]].tsx`. Use `extractPath(context)` for path and `context.locale` for locale. Fetch all data in getStaticProps/getServerSideProps and pass to _app and Layout. Not-found/error: use getErrorPage in getStaticProps or 404.tsx / _error.tsx as appropriate.

## Hard Rules

- **Single Sitecore page:** `src/pages/[[...path]].tsx`. This is the **only** page that renders Sitecore content. Do not add another page or catch-all for Sitecore content.
- **Path:** Use `extractPath(context)` (from `@sitecore-content-sdk/nextjs/utils`) to get the path array. **Locale:** Use `context.locale` (Next.js i18n). Do not assume path or locale from headers or elsewhere.
- **Data flow:** All Sitecore data is fetched in getStaticProps/getServerSideProps in [[...path]].tsx and passed to _app and Layout. Do not fetch Sitecore data in _app.tsx.
- **Layout:** Layout.tsx renders page layout and placeholders; Providers wrap component props and page context; Bootstrap handles site name and preview mode.
- Placeholders are rendered by the layout; do not change placeholder names or structure without aligning with Sitecore layout definition.
- **404 / 500 / _error:** When the catch-all returns `notFound: true`, Next.js renders 404.tsx. For Sitecore-driven error content use `client.getErrorPage(ErrorPage.NotFound)` or `ErrorPage.InternalServerError` in getStaticProps when applicable. _error.tsx is the error boundary; it does not fetch from Sitecore.

## Stop Conditions

- Stop if the user wants to add a second catch-all or a different URL shape for Sitecore pages; explain single-entry-point constraint.
- Stop if changing proxy/middleware order; order is fixed (MultisiteProxy → RedirectsProxy → PersonalizeProxy).
- Do not move or rename the catch-all file without updating all references.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
