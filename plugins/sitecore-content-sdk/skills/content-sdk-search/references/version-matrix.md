# Version matrix: search rides on nextjs

You pin `@sitecore-content-sdk/search` by pinning `@sitecore-content-sdk/nextjs` (nextjs → react → search). Check with `npm ls @sitecore-content-sdk/search`. Docs gate features on the **Content SDK** version; npm shows the **search package** version. Both are right.

| `react` / `nextjs` | `search` | Adds |
|---|---|---|
| 1.3.0 | 0.1.0 | keyphrase, sort, paging |
| 1.4 / 1.5 | ^0.1.2 | — |
| 2.0.0 | ^0.2.0 | — |
| 2.1 / 2.2 | ^0.3.0 | CDP `sessionId` |
| 2.3.0 | ^0.4.0 | `locale`, `facet` |
| **2.4.0** | **^0.5.0** | `suggest()`, MLT (`seedItemId`, `seedItemUrl`) |

npm dist-tags on 2026-10-02: `latest` 0.5.0; `canary` 0.5.0-canary.20260908 (older than latest); `beta.atoms` 0.4.0-beta.atoms.20260930 — **behind** `latest` for search (no facets, suggest or MLT) despite the newer date. Do not use it for search.

- `search` declares `engines.node >= 24`. Check the hosting Node major (Vercel project setting) before relying on it.
- The SYNC starter's component code uses none of facets, suggest, MLT or locale even where its lockfile allows them: that is non-adoption, not a version lock.
- `content-sdk-upgrade-assistant` does not diff the search API surface; read `packages/search/CHANGELOG.md` across an upgrade.
