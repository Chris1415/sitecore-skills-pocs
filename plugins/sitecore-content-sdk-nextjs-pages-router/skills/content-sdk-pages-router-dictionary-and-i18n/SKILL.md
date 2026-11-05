---
name: content-sdk-pages-router-dictionary-and-i18n
description: "Dictionary and i18n in a Content SDK Pages Router app: next.config i18n locales, context.locale, getDictionary after getPage. Use when adding translated content or changing locale behaviour. Not App Router."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.4"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-dictionary-and-i18n
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs/.agents/skills/content-sdk-dictionary-and-i18n/SKILL.md
---

# Content SDK Dictionary and i18n (Pages Router)

This app uses **Next.js built-in i18n**. There is no [locale] in the URL path; locale is provided by Next.js as `context.locale` in getStaticProps/getServerSideProps.

## When to use

- User asks to add or change translated content, locale, or dictionary.
- Task involves getDictionary, Next.js i18n, or context.locale.
- User mentions "dictionary," "i18n," "locale," or "translation."

## How to perform

- Locales: `next.config.js` → i18n.locales, defaultLocale. In getStaticProps/getServerSideProps use context.locale; after getPage use client.getDictionary({ site: page.siteName, locale: page.locale }). Use a single getDictionary per request. Do not assume locale from headers.

## Hard Rules

- **Config:** `next.config.js` → `i18n.locales` and `i18n.defaultLocale`. Match (or subset) Sitecore languages.
- **Per-request locale:** Use `context.locale` in getStaticProps and getServerSideProps. Pass it to `client.getPage(path, { locale: context.locale })`. After fetching the page, use `page.siteName` and `page.locale` (or `context.locale`) for `client.getDictionary({ site: page.siteName, locale: page.locale })` and for getComponentData.
- Align locales in next.config.js with Sitecore languages (e.g. from sitecore.config.ts defaultLanguage). Use a single client.getDictionary per request for the active site/locale.
- **Do not** assume locale from headers or a different source; always use `context.locale` and the page's site/locale for Sitecore calls.

## Stop Conditions

- Stop if adding a new locale without confirming it exists in Sitecore and in next.config.js i18n.
- Do not duplicate dictionary fetching without a clear need; prefer one fetch per request in the catch-all page.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
