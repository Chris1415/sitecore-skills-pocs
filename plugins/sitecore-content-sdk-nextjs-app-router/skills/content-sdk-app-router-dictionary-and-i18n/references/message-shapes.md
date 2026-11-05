# Message shapes

## Template (nested by site) — recommended

```ts
// src/i18n/request.ts (template)
const [parsedSite, parsedLocale] = (await requestLocale)?.split('_') || [];
const locale = hasLocale(routing.locales, parsedLocale) ? parsedLocale : routing.defaultLocale;
const messages: Record<string, object> = {};
messages[parsedSite] = await client.getDictionary({ locale, site: parsedSite });
return { locale, messages };
```

```tsx
// server component
const t = await getTranslations(site);   // site from params or page.siteName
// client component (under <NextIntlClientProvider>)
const t = useTranslations(site);
t('HeaderOpenMenu');
```

## Starter-kit flat shape — porting trap

```tsx
const t = useTranslations();
t(dictionaryKeys.HEADER_OPEN_MENU) || '';   // renders "HEADER_OPEN_MENU" against the template shape
```

Measured 2026-10-02: `getTranslations()` + `t('PLAIN')` → `PLAIN`; `getTranslations(site)` + `t('PLAIN')` → the phrase.

## Migration (kit code → template)

```diff
- const t = useTranslations();
- const label = t(dictionaryKeys.OPEN_MENU) || '';
+ const t = useTranslations(siteName);           // pass the site down or read it from page context
+ const label = t(dictionaryKeys.OPEN_MENU);     // a missing key renders "site.KEY"
```

Or flatten once in `request.ts` (`return { locale, messages: await client.getDictionary(...) }`) and keep `useTranslations()`. Do one or the other for the whole app; `check-locale-drift.mjs` flags `useTranslations()` without a namespace.

## Label map with code defaults (no next-intl in renderings)

```ts
import { cache } from 'react';
export const siteDictionary = cache((site: string, locale: string) => client.getDictionary({ site, locale }));
export function labelsFrom(d: Record<string, string>) {
  // Edge returns the KEY when a phrase is missing or empty, so treat value === key as missing.
  const pick = (k: string, fallback: string) => (d[k] && d[k] !== k ? d[k] : fallback);
  return { openMenu: pick('HeaderOpenMenu', 'Open menu'), closeMenu: pick('HeaderCloseMenu', 'Close menu') };
}
```

## Tests

```ts
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
```
