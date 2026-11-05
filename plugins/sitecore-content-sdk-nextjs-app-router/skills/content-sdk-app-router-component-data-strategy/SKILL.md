---
name: content-sdk-app-router-component-data-strategy
description: "How component data flows in a Content SDK App Router app: layout data from getPage, editing data, site and locale from route params, Server vs Client components, BYOC. Use when wiring component props or choosing server vs client."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.6"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-component-data-strategy
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-component-data-strategy/SKILL.md
---

# Content SDK Component Data Strategy (App Router)

This app does **not** use getComponentData. Page and layout data come from **getPage** (or getPreview/getDesignLibraryData in editing). Component props are derived from the layout/placeholders; pass site and locale from route params.

## When to use

- User asks how to pass data to components, wire component props, or integrate custom/BYOC components.
- Task involves component props, server vs client components, or BYOC.
- User mentions "component data," "props," "BYOC," "server component," or "client component."

## How to perform

- Fetch at page/layout with getPage (or getPreview/getDesignLibraryData in draft). Pass site and locale from route params. Server Components use the client in server context; Client Components receive serializable props only. Register BYOC in the correct component map and pass props from layout.

## Hard Rules

- **Data source:** Page and layout from `client.getPage(path ?? [], { site, locale })` in the catch-all page (or getPreview/getDesignLibraryData when draftMode() is enabled). All Sitecore-driven data flows from this single fetch at the route level.
- **Server Components:** Use the same SitecoreClient in server context (e.g. in the page or layout). Pass data as props to children.
- **Client Components:** Receive **serializable** props from parent (no functions or non-serializable values). Do not create a new client inside components. Pass data from page/layout level into components.
- **BYOC or custom components:** Must be registered in the appropriate component map (.sitecore/component-map.ts or component-map.client.ts) and receive props in the shape the layout expects (e.g. fields, params).
- Do not fetch layout or page data inside a child component (e.g. another getPage call); fetch at page/layout level and pass props.
- **Low-code components (beta.atoms)** get `fields` / `params` seeded into json-render state (`$state: /fields/<Field>`). They are client-rendered after a server MMS fetch, with no ComponentQuery → `content-sdk-app-router-atoms`.

## Stop Conditions

- Stop if the user wants to fetch page/layout data inside a child component; recommend fetching at page/layout level and passing props.
- Stop if server/client boundary is ambiguous and the change could cause "use client" or serialization issues; clarify and follow Next.js and app conventions.
- Do not introduce getComponentData or duplicate getPage logic; this app uses getPage-only data flow.

## References

- `content-sdk-app-router-graphql-data-fetching` skill and [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster) for getPage and data flow.
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
