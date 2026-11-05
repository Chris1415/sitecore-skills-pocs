---
name: content-sdk-app-router-dictionary-and-i18n
description: "Languages in a Content SDK App Router app: routing.ts locales, LocaleProxy, next-intl messages, dictionary keys, hreflang, per-locale links. Use when adding a locale or translations in the head app. Not CM languages."
license: Apache-2.0
compatibility: "@sitecore-content-sdk/nextjs 2.4.0 (content 2.3.0), Next.js 16 App Router, next-intl 4. Measured 2026-10-02 on next 16.3.8 + next-intl 4.14.8. The Pages Router (next-localization, native Next i18n, no LocaleProxy) is out of scope. scripts/check-locale-drift.mjs: Node 18+, no dependencies."
metadata:
  author: Christian Hahn
  version: "0.6.3"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-dictionary-and-i18n
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-dictionary-and-i18n/SKILL.md
---

# Content SDK language model (App Router)

The head app owns three things: which URL means which locale, how dictionary phrases reach components, and what the HTML says about its language. The CM side (environment languages, versions, fallback, translation, publishing per language) is `sitecoreai-localization`.

Tags: **[measured 2026-10-02]** = observed on a real tenant or a production build; **[probe-gated: X]** = not yet proven, X names the open check.

## 1. How a request becomes a locale

The scaffolded proxy chain is `preview → botTracking → locale → multisite → redirects → personalize` (proxy order: `content-sdk-app-router-multisite-management`).

- **LocaleProxy reads the PATH only.** No cookie, no Accept-Language. Match: `locales.find(l => path.includes('/'+l+'/') || path.endsWith('/'+l))`. No match → `x-sc-locale` header → `nextUrl.locale` → default. It then rewrites to `/<locale><path>`; multisite prefixes `/<site>`, so the catch-all receives `/[site]/[locale]/[[...path]]`.
- `locales` comes from `routing.locales` in `src/i18n/routing.ts`, **which the scaffold sets to the default language only**.
- Measured matrix [measured 2026-10-02], `routing.locales=['en','de-DE']`:

| Request | Result |
|---|---|
| `/de-DE/x` | `[locale]=de-DE`, 200 if a de-DE version exists |
| `/de-de/x` | **404**: case-sensitive, rewritten under the default |
| `/fr/about` (unlisted) | 404: rewritten to `/en/fr/about` |
| `/x/de-DE/y` (locale mid-path) | **500**: `[locale]` becomes `x`; the not-found page asks Edge `errorHandling(language:"x")`, gets `null`, and the SDK throws `Cannot read properties of null (reading 'notFoundPage')` |
| `/en/x` | 200, same page as `/x` (duplicate URL, no redirect) |
| any path with a `.` | LocaleProxy skipped |

- **One global default language.** `site.language` in `sites.json` is read only by RedirectsProxy. A per-site default needs a custom proxy [probe-gated: G14 design decision].
- A site name containing `_` breaks `${site}_${locale}` (`"my_site_en".split('_')` → site `my`, locale `site`). Rename the site.

Full matrix and source lines: `references/locale-proxy-matching.md`.

## 2. Adding a locale: four places must agree

1. The CM: an environment language, versions of the site's pages and dictionary entries in it, published (runbook in `sitecoreai-localization`).
2. `routing.locales` in `src/i18n/routing.ts`. Casing must equal the CM name exactly (`de-DE`, not `de-de`).
3. LocaleProxy (reads `routing.locales`; nothing to edit unless you copied the list).
4. SSG: `getAppRouterStaticParams(sites, routing.locales)` prerenders, per locale, **exactly the routes that have a version in that language** [measured: 12 en + 9 de-DE paths]. No 404 pages are prerendered.

**Adding a locale only in the CM changes nothing in the app:** the unlisted locale is rewritten under the default and 404s. Gate it:

```bash
node scripts/check-locale-drift.mjs --app <head-app> --site <SiteName> --context-id-env SITECORE_EDGE_CONTEXT_ID
node scripts/check-locale-drift.mjs --app <head-app> --languages en,de-DE      # offline
node scripts/check-locale-drift.mjs --self-test
```

It reads `siteInfo.rootPath` and `item(<root>/Home).languages` from Edge (public context id, query only) and FAILs on `locale-not-in-cm`, `cm-not-in-routing`, `case-mismatch`, a literal `<html lang>` with several locales, and flat `useTranslations()`; WARNs on a dictionary fetched but never read and on `t(k) || ''`. A **live** context id reports published languages; a **preview** id reports authored ones.

**Waiving a finding is consumer-bound.** A deliberate exception (e.g. a literal root `<html lang>` kept by decision, with a client component setting `document.documentElement.lang`) goes in `<head-app>/.locale-drift-ignore.json`:

```json
{ "html-lang-hardcoded": { "reason": "<ADR / decision>",
  "consumer": { "file": "src/ui/html-lang.tsx", "pattern": "document\\.documentElement\\.lang\\s*=",
                "mountedIn": "src/Layout.tsx", "mountPattern": "<HtmlLang\\b" } } }
```

The finding is reported `WAIVED` (exit 0) only while `file` matches `pattern` AND `mountedIn` matches `mountPattern`, comments stripped first (a commented-out write or mount is not a consumer). Delete the consumer, its write or its mount and the FAIL returns plus `waiver-unconsumed`; a waiver with no `reason`, no complete `consumer`, an unknown rule id or an invalid regex is `waiver-invalid` (FAIL). A waiver never outlives the code that justifies it.

## 3. URL strategy

| Want | What actually controls it |
|---|---|
| Default unprefixed, others prefixed (`as-needed`) | LocaleProxy's default behaviour |
| Redirect targets keep or drop the prefix | `redirects.appLocalePrefix` in `sitecore.config.ts` (`never` / `as-needed` / `always`) |
| `/en/` forced on the default (`always`) | **Not enforced on incoming requests**; custom proxy code |
| Locale from browser or cookie | Not supported; custom proxy code |
| No duplicate `/en/x` | Not handled; redirect `/<default>/…` to `/…` yourself, or set the canonical (§ 7) |

`localePrefix` in `routing.ts` is **inert**: the template uses neither next-intl `createMiddleware` nor `createNavigation`. It only mirrors `appLocalePrefix`.

## 4. Messages: one shape, site-namespaced

`src/i18n/request.ts` splits `requestLocale` (`${site}_${locale}`, set by `setRequestLocale` in the page) and stores the dictionary under **`messages[site]`**.

- Server component: `const t = await getTranslations(site)`.
- Client component: `const t = useTranslations(site)` under `<NextIntlClientProvider>`.
- **Porting trap (starter kits):** `useTranslations()` + `t('KEY') || ''` assumes a flat shape. Against the template it renders the **key** (`KEY`), never `''` [measured]. Either namespace every call or flatten in `request.ts` (`messages = await client.getDictionary(...)`) and change every call site at once.
- Alternative for chrome labels: read `client.getDictionary({site, locale})` once per request through React `cache()` into a typed label map with code defaults. One shipped multilingual app chose this after `getMessages()` inside renderings produced a host-only 500 on every 404 page (2026-09).
- `setRequestLocale` must run before any next-intl API in the render. Do not fetch the dictionary twice (layout and page).

Shapes, migration diff and test mocks: `references/message-shapes.md`.

## 5. Key and phrase rules

[measured 2026-10-02, production build]

| Input | Output |
|---|---|
| Missing key, `t('X')` and `t('X') \|\| ''` | `site.X` both: the `\|\| ''` fallback is dead code |
| Key with a dot (`A.B`) | treated as nesting → `site.A.B` (Edge itself serves dotted keys; next-intl's `INVALID_KEY` check runs only in development) |
| Phrase `Hi {name}`, no argument | `Hi {name}` (no throw) |
| Phrase `It's '{literal}'` | `It's {literal}`: **ICU quoting eats apostrophes around braces** |
| Phrase `<b>x</b>` via `t()` / `t.raw()` | the literal string; use `t.rich` with handlers for markup |
| Untranslated / empty Sitecore phrase | Edge returns the **key** as the value, so the UI shows the key |

Rules: UPPER_SNAKE or PascalCase keys without dots; one constant map of keys in code; tests mock `useTranslations: () => (k) => k`. Detect untranslated phrases with "value === key" (the census in `sitecoreai-localization` does).

## 6. Missing language version = 404, and how to tell

- `getPage` returns `null` when Edge has no route for that language → `notFound()` → the site's 404 for that locale [measured on a real page without a de-DE version]. **The SDK never falls back to the default language.** Fallback is a CM + Edge feature (`sitecoreai-localization` § fallback, gated by an environment patch).
- A brand-new language version is **empty** (every versioned field blank, `__Final Renderings` empty): the route exists and renders a blank page, not a 404.
- `page.layout.sitecore.context.language` and `route.itemLanguage` are the language actually served. If fallback is ever enabled they are the way to detect it [probe-gated: G3].

## 7. Links, `<html lang>`, SEO

**Links.** Edge `url.path` carries **no language segment**, on live as well as preview, and resolved rich-text internal links have none either [measured on live]. Prefix in code:

```ts
export function localizeHref(href: string, locale: string, defaultLocale: string): string {
  if (locale === defaultLocale || !href.startsWith('/') || href.startsWith('//')) return href;
  if (href === `/${locale}` || href.startsWith(`/${locale}/`)) return href;
  return href === '/' ? `/${locale}` : `/${locale}${href}`;
}
```

Apply it in the link component and wherever `url.path` is rendered. Rich-text bodies need a post-process or an authoring convention.

**`<html lang>`.** The template hard-codes `<html lang="en">` in `src/app/layout.tsx`. Calling `getLocale()` there throws during static generation and makes **every route dynamic** [measured]. The pattern that keeps SSG [measured: ● kept]: delete `src/app/layout.tsx` and `src/app/[site]/layout.tsx`, add `src/app/[site]/[locale]/layout.tsx` that renders `<html lang={locale}><body>` plus `Bootstrap`, and give `src/app/not-found.tsx` its own `<html>`. A client `HtmlLang` effect is the fallback (crawlers and the first paint see the wrong value). Set `dir` from the locale (RTL list) in the same place. Code: `references/seo-and-html-lang.md`.

**SEO.** `getPageMetadata` emits no `alternates`; build `alternates.canonical` (with the locale prefix) and `alternates.languages` from the page's available languages (Edge `item(path, language){ languages{ language{ name } } }`, which lists only versions that exist on that surface). The sitemap route serves the CM sitemap, resolved by host only, with no locale in its cache key; single-language sitemaps carry no `hreflang` [measured]; multilingual output depends on the site's alternate-links setting [probe-gated: G9]. Sitemap/robots: `content-sdk-app-router-sitemap-robots`.

## 8. Editing language (Pages)

**Defect** [measured 2026-10-02]: the editing render handler fetches `route` (e.g. `/`) back through the proxy, so LocaleProxy assigns the **default** locale, while `getPreview` renders the body in `sc_lang`. In Pages with German selected, the body is German but **dictionary phrases and `<html lang>` are English**. With `route=/de-DE` everything is German.

Fix direction [probe-gated: P8-fix]: in draft mode, derive the locale from the preview payload before any next-intl call, and keep it inside `routing.locales`:

```ts
const effective = draft.isEnabled ? (page?.layout.sitecore.context.language ?? locale) : locale;
setRequestLocale(`${site}_${effective}`); // move below the getPreview/getPage call
```

## 9. Language switcher

The SDK ships none. Build it from `useLocale()` (the next-intl locale is the plain locale) and a prefix swap on the current path; offer only languages the page has (`item.languages` on the delivery surface, see § 7). Do not offer a locale that is not in `routing.locales`.

## 10. Cost: a dictionary nobody reads

`request.ts` fetches the dictionary on every uncached request (memory cache 60 s per process, `dictionary.caching`). If no component calls `getTranslations`/`useTranslations`, it is pure cost, and under OSR every page also carries an `sc:dict` tag (`content-sdk-app-router-cache-components-and-osr`). `check-locale-drift.mjs` WARNs `dictionary-unused`. Removing the fetch is a product decision; keep it if the app will translate.

## Gotchas

| Trap | Effect |
|---|---|
| `routing.locales` left at the default | other languages 404 (rewritten under the default) |
| Locale casing differs from the CM | 404 on the CM-cased URL |
| Locale segment mid-path | 500 from the not-found page, not 404 |
| `requestLocale` undefined | messages stored under the key `"undefined"`, dictionary of `defaultSite` |
| A `sites.json` site Edge does not know | `next build` fails: `[IV-007] Site "<name>" does not exist` |
| Hand-written Edge preview query with literal `first:` ≥ 61 | "Query is too complex"; pass `first` as a variable (the SDK does) |
| Edge `language` argument is case-insensitive | `de-de` returns de-DE content on Edge, while the app 404s `/de-de/` |

## Stop conditions

- Stop before changing the `${site}_${locale}` encoding: `request.ts`, every `setRequestLocale` and SSG params change together.
- Stop before adding a locale that `check-locale-drift.mjs` reports as `locale-not-in-cm`; fix the CM first (`sitecoreai-localization`).
- Stop before moving the root layout if the app has other top-level routes needing `<html>`; each root layout must render its own.

## References

- `references/locale-proxy-matching.md`: LocaleProxy algorithm, measured matrix, the 500 path.
- `references/message-shapes.md`: nested vs flat, migration diff, mocks.
- `references/seo-and-html-lang.md`: locale root layout, `generateMetadata` alternates, `localizeHref`.
- CM side: `sitecoreai-localization`. Proxy order: `content-sdk-app-router-multisite-management`. Catch-all and not-found: `content-sdk-app-router-route-configuration`. `defaultLanguage` resolution: `content-sdk-site-setup-and-env`.
