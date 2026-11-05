---
name: content-sdk-app-router-route-configuration
description: "Routing and layout in a Content SDK App Router app: the catch-all [site]/[locale]/[[...path]] page, setRequestLocale, placeholders, root layout. Use when changing routes, fixing 404s or the layout. Not the proxy chain."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.7"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-route-configuration
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-route-configuration/SKILL.md
---

# Content SDK Route Configuration (App Router)

Single catch-all route and layout hierarchy. Site and locale are **in the path**; proxy rewrites incoming requests to /[site]/[locale]/...path.

## When to use

- User asks to change routing, add a route, or fix 404/not-found behavior.
- Task involves catch-all route, placeholders, root layout, or Layout.tsx.
- User mentions "[site]," "[locale]," "[[...path]]," "placeholder," or "layout hierarchy."

## How to perform

- Single Sitecore page: `src/app/[site]/[locale]/[[...path]]/page.tsx`. Use `await params` for `{ site, locale, path? }`; pass to getPage and call `setRequestLocale(\`${site}_${locale}\`)` at the top. Layout: app/layout.tsx → app/[site]/layout.tsx (Bootstrap, draftMode) → page. Not-found: use getCachedPageParams and getErrorPage in the route's not-found.tsx.

## Hard Rules

- **Single Sitecore page:** `src/app/[site]/[locale]/[[...path]]/page.tsx`. This is the **only** page that renders Sitecore content. Do not add another page or catch-all for Sitecore content.
- **Params:** Next.js 15+ — `params` is a Promise. Use `await params` to get `{ site, locale, path? }`. Pass `site` and `locale` to `client.getPage(path ?? [], { site, locale })`.
- **Locale for next-intl:** Call `setRequestLocale(\`${site}_${locale}\`)` at the **top** of the page so next-intl and `src/i18n/request.ts` see the correct locale. Do not omit when adding new page branches.
- **Layout hierarchy:** `app/layout.tsx` → `app/[site]/layout.tsx` (Bootstrap with `siteName={site}` and `draftMode()`) → page. Do not put site/locale-specific data fetching in the root layout.
- Placeholders are rendered by the layout (e.g. Placeholder component); do not change placeholder names or structure without aligning with Sitecore layout definition.
- **Missing language version = 404, per site and locale** (measured 2026-10-02): `getPage` returns null, there is no default-language fallback. A locale segment mid-path (`/Coverage/de-DE/x`) makes `Coverage` the `[locale]`, the not-found page asks Edge for `errorHandling(language:"Coverage")`, gets null and throws a **500**. Language model: `content-sdk-app-router-dictionary-and-i18n`.
- **Not-found:** `src/app/[site]/[locale]/[[...path]]/not-found.tsx`. For Sitecore-driven 404 use `getCachedPageParams()` from `@sitecore-content-sdk/nextjs` for site/locale, then `client.getErrorPage(ErrorPage.NotFound, { site, locale })`.

## Stop Conditions

- Stop if the user wants to add a second catch-all or a different URL shape for Sitecore pages; explain single-entry-point constraint.
- Stop if changing the proxy order. The 2.4.0 template chain in `src/proxy.ts` is preview → botTracking → locale → multisite → redirects → personalize, instantiated per request with the `NextFetchEvent` (source: `create-content-sdk-app@2.4.0` `dist/templates/nextjs-app-router/src/proxy.ts:16-28,105`). BotTrackingProxy must precede PersonalizeProxy, which reads its `sc_bot` cookie to skip bots (Sitecore's doc says bot tracking must be *first*; the scaffold puts preview first, follow the scaffold). `xmcloud-starter-js` main lags (5 proxies, no bot tracking): not a reference. Full rationale: `content-sdk-app-router-multisite-management`; personalize proxy: `content-sdk-personalization`; consent skip: `content-sdk-tracking-consent`.
- On Next 16, `src/proxy.ts` alone runs as the proxy; do not add a `src/middleware.ts` re-export (the template's AGENTS doc saying so is stale).
- Do not move or rename the catch-all file without updating all references.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
