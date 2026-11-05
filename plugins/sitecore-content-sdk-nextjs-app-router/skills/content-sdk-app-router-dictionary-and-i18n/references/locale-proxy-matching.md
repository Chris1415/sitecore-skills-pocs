# LocaleProxy matching (nextjs 2.4.0)

Source: `@sitecore-content-sdk/nextjs/dist/esm/proxy/locale-proxy.js` (2.4.0).

## Algorithm

1. **Skip** when the pathname contains `.` (`disabled()`, L84), or the proxy matcher excludes the path (`api/`, `_next/`, `sitemap`, `robots`, `-/`, `healthz`, …).
2. **Detect** (L92): `locales.find((l) => path.includes('/' + l + '/') || path.endsWith('/' + l))`. Substring, case-sensitive, first match in `locales` order.
3. **Fallback** when nothing matches: `x-sc-locale` request header → `nextUrl.locale` → `nextUrl.defaultLocale` → `defaultLanguage` option → `'en'`.
4. **Rewrite** an unprefixed path to `/<locale><path>` and set `x-sc-locale`. A path that already "contains" a locale is not rewritten.
5. `AppRouterMultisiteProxy` (cannot be skipped in App Router) prefixes `/<site>`; the catch-all gets `/[site]/[locale]/[[...path]]`.

## Measured matrix (2026-10-02)

`routing.locales = ['en','de-DE']`, default site with en + de-DE content on the Edge preview surface, `next build && next start` (next 16.3.8).

| Request | Status | `[locale]` / note |
|---|---|---|
| `/` | 200 | en |
| `/de-DE` | 200 | de-DE, `<html lang="de-DE">` with the locale root layout |
| `/de-DE/Coverage` | 200 | de-DE |
| `/de-de/` | 308 → `/de-de` | trailing-slash redirect |
| `/de-de/Coverage` | 404 | not matched (case) → rewritten under en |
| `/fr/about` | 404 | unlisted → `/en/fr/about` |
| `/Coverage/de-DE/x` | **500** | see below |
| `/Help/en/About` | **500** | same mechanism with the default locale |
| `/file.txt` | 404 | dot-skip, root not-found |
| `/de-DE/NoSuchPage` | 404 | normal |
| `/de-DE/Coverage/Life` (no de-DE version) | 404 | missing version |
| `/en/Coverage` | 200 | duplicate of `/Coverage` |

## Why mid-path locales are a 500

`/Coverage/de-DE/x` matches `/de-DE/`, so LocaleProxy does not rewrite. Multisite produces `/<site>/Coverage/de-DE/x`, so `[locale]=Coverage`, `path=['de-DE','x']`. `getPage` → null → `notFound()` → `[[...path]]/not-found.tsx` → `client.getErrorPage(NotFound, {site, locale:'Coverage'})` → Edge `siteInfo.errorHandling(language:"Coverage")` = `null` (a valid language returns an object with empty paths) → the error-pages service dereferences `errorHandling.notFoundPage` → `TypeError` → HTTP 500.

Mitigation: in the not-found page, use the default locale when `locale` is not in `routing.locales`; or check `hasLocale(routing.locales, locale)` at the top of the page and serve the default-locale 404 early.

## Underscore site names

`request.ts` and the page encode `${site}_${locale}`. `split('_')` on `my_site_en` yields `['my','site','en']`: site `my`, locale `site` (not a locale) → default locale, dictionary of site `my`. Rename sites to avoid `_`.
