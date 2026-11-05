# `<html lang>`, alternates, links

## Locale root layout (keeps SSG; measured 2026-10-02)

Delete `src/app/layout.tsx` and `src/app/[site]/layout.tsx`, then:

```tsx
// src/app/[site]/[locale]/layout.tsx
import '../../globals.css';
import { draftMode } from 'next/headers';
import Bootstrap from 'src/Bootstrap';

const RTL = new Set(['ar', 'he', 'fa', 'ur']);
export default async function LocaleRootLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ site: string; locale: string }>;
}) {
  const { site, locale } = await params;
  const { isEnabled } = await draftMode();
  return (
    <html lang={locale} dir={RTL.has(locale.split('-')[0]) ? 'rtl' : 'ltr'}>
      <body>
        <Bootstrap siteName={site} isPreviewMode={isEnabled} />
        {children}
      </body>
    </html>
  );
}
```

`src/app/not-found.tsx` (root not-found, e.g. `/file.txt`) must now render `<html lang={scConfig.defaultLanguage}><body>…</body></html>` itself; `global-error.tsx` already does. API routes are unaffected. The build output must still show `●` for `/[site]/[locale]/[[...path]]`. The `dir` line is unmeasured (no RTL language was probed).

Not this: `await getLocale()` in the template root layout → "Usage of next-intl APIs in Server Components currently opts into dynamic rendering" during static generation, and every route turns `ƒ`.

## `generateMetadata` with alternates

```ts
export const generateMetadata = async ({ params }: PageProps): Promise<Metadata> => {
  const { path, site, locale } = await params;
  const page = await client.getPage(path ?? [], { site, locale });
  const base = getPageMetadata(page?.layout.sitecore.route);
  const rel = '/' + (path ?? []).join('/');
  const href = (l: string) => `${process.env.PUBLIC_URL}${localizeHref(rel, l, routing.defaultLocale)}`;
  const available = await pageLanguages(site, locale, page); // Edge item.languages ∩ routing.locales
  return {
    ...base,
    alternates: {
      canonical: href(locale),
      languages: Object.fromEntries([...available.map((l) => [l, href(l)]), ['x-default', href(routing.defaultLocale)]]),
    },
  };
};
```

`pageLanguages` = Edge `item(path:<item path>, language:<locale>){ languages{ language{ name } } }`, wrapped in React `cache()`. On live it lists only published versions, which is what hreflang should advertise. This snippet is a recipe, not a measured build.

## Links

Edge `url.path` and resolved rich-text links carry no language segment (live and preview, 2026-10-02). Use `localizeHref` (SKILL.md § 7) in the shared link component; external links, anchors and `//` URLs pass through.
