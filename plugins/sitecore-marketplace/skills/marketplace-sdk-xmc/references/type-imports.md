# 5. Type imports

Supporting reference for the `marketplace-sdk-xmc` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance; the heading is kept so `SKILL.md` cross-references still resolve here.

## 5. Type imports

### 5a. The `Xmapp` type namespace (mode-independent)

XMC payload types are exposed at the package root under the `Xmapp` namespace. The namespace is **mode-independent** — Mode A iframe code and Mode B server-side code both import from the same place.

**Mode A (wrapped options, double-unwrap response)** — the shadcn quickstart uses this in `components/examples/built-in-auth/with-xmc/list-languages.tsx`:

```typescript
import type { Xmapp } from '@sitecore-marketplace-sdk/xmc';

const [languages, setLanguages] = useState<Xmapp.Language[]>([]);

// Mode A: options wrapped under `params:`; response double-unwraps (the marketplace-sdk-client skill, § 8b)
const result = await client.query('xmc.sites.listLanguages', {
  params: { query: { sitecoreContextId } },
});
setLanguages(result.data?.data ?? []);
```

**Mode B (flat options, single-unwrap response)** — the Scaffold 3 Server Action uses this in `components/examples/custom-auth/with-server-action/action.ts`:

```typescript
import type { Xmapp } from '@sitecore-marketplace-sdk/xmc';
import { experimental_createXMCClient } from '@sitecore-marketplace-sdk/xmc';

export async function fetchLanguagesAction(
  context: { sitecoreContextId: string; accessToken: string },
): Promise<Xmapp.Language[]> {
  const client = await experimental_createXMCClient({
    getAccessToken: async () => context.accessToken,
  });
  // Mode B: flat options (no `params:`); response single-unwrap
  const languages = await client.sites.listLanguages({
    query: { sitecoreContextId: context.sitecoreContextId },
  });
  return languages?.data ?? [];
}
```

Same `Xmapp.Language[]` return type in both modes; only the call shape differs (wrapped vs flat, double vs single unwrap).

Common `Xmapp.*` members include `Language`, `Site`, `Page`, `ContentItem`, and response shapes like `ListLanguagesResponse`, `ListSitesResponse`. IntelliSense resolves them once `@sitecore-marketplace-sdk/xmc` is installed.

### 5b. Mode B — `experimental_*` namespaces

For Mode B IntelliSense:

```typescript
import {
  experimental_Sites,
  experimental_Pages,
  experimental_Authoring,
  experimental_ContentTransfer,
  experimental_Content,
} from '@sitecore-marketplace-sdk/xmc';

const response = await xmc.sites.listLanguages();
let data: experimental_Sites.ListLanguagesResponse = response.data!;

const searchResponse = await xmc.pages.search();
let searchData: experimental_Pages.SearchResponse = searchResponse.data!;
```

Do not mix — use `Xmapp` for Mode A, `experimental_*` for Mode B.
