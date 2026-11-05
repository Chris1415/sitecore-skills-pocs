---
name: content-sdk-pages-router-component-data-strategy
description: "Component data in a Content SDK Pages Router app: getComponentData after getPage resolves component props for the layout. Use when wiring component data or BYOC in a Pages Router app. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.4"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-data-strategy
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-component-data-strategy/SKILL.md
---

# Content SDK Component Data Strategy (Pages Router)

This app **uses getComponentData**. After getPage, use **client.getComponentData(page.layout, context, components)** to resolve component props and pass the result to the layout renderer. All Sitecore-driven component data goes through this flow.

## When to use

- User asks how to pass data to components, wire component props, or integrate custom/BYOC components.
- Task involves getComponentData, component props, or BYOC.
- User mentions "component data," "props," "BYOC," or "getComponentData."

## How to perform

- In [[...path]].tsx: getPage(path, { locale: context.locale }), then getDictionary, then getComponentData(page.layout, context, components). Return props to Layout; do not fetch in _app or in child components. Register BYOC in .sitecore/component-map.ts; getComponentData passes resolved props.

## Hard Rules

- **Flow in catch-all page:** In getStaticProps/getServerSideProps: (1) `client.getPage(path, { locale: context.locale })`, (2) `client.getDictionary({ site: page.siteName, locale: page.locale })`, (3) `client.getComponentData(page.layout, context, components)` to resolve component props. Return `{ props: { page, dictionary, componentProps }, notFound: !page }`. Pass these props to Providers and Layout; do not fetch Sitecore data in _app.
- Do not fetch per-component data in parallel outside this flow unless the app pattern explicitly does so. All Sitecore-driven component data goes through getComponentData.
- Single client instance; do not create a new client inside components. The client is used in getStaticProps/getServerSideProps and in API routes.
- **BYOC or custom components:** Must be registered in `.sitecore/component-map.ts` and receive props in the shape the layout expects (e.g. fields, params). getComponentData will pass the resolved props.
- Do not fetch layout or page data inside a child component (e.g. another getPage call); fetch at the catch-all page level and pass props via getComponentData and layout.

## Stop Conditions

- Stop if the user wants to fetch page/layout data inside a child component; recommend fetching in [[...path]].tsx and passing via getComponentData and layout.
- Do not duplicate getComponentData or getPage logic across components; keep data fetching in the catch-all page only.
- Do not fetch Sitecore data in _app; all data flows from [[...path]].tsx.

## References

- `content-sdk-pages-router-graphql-data-fetching` skill and [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster) for getPage, getComponentData, and data flow.
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
