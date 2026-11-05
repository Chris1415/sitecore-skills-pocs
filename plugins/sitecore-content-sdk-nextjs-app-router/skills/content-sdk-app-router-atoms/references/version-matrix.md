# Version matrix

**Dist-tags last checked: 2026-11-05** (`npm view <pkg> dist-tags`). The capability matrix below was measured on 2026-10-29; the stamp `20261104151713` notes under it on 2026-11-05. Older than about two weeks means stale: re-run the check before trusting a cell.

| package | latest | beta.atoms | canary |
|---|---|---|---|
| @sitecore-content-sdk/nextjs, react | 2.5.0 / 2.5.0 | 3.0.0-beta.atoms.20261104151713 (upgrade measured); matrix measured on 20261021204512 | 3.0.0-canary.20261104060918 |
| @sitecore-content-sdk/events, personalize, analytics-core | 2.x | 2.2.0-beta.atoms.20261104151713 | — |
| @sitecore-content-sdk/cli | 2.4.0 | **2.5.0**-beta.atoms.20261104151713; was **2.4.0**-beta.atoms.20261021204512 (`2.3.0-…20261021…` is E404) | 2.5.0-canary.20261104060918 |
| create-content-sdk-app | 2.4.2 | 2.5.0-beta.atoms.20261104151713 (template read, not scaffolded); scaffold measured on 20261021204512 | 2.5.0-canary.20261104060918 |
| Content Kit registry (content-kit.vercel.app/r/*) | — | pins `…20261103095219` (cli `2.4.0-`), older than the tag | — |

The `beta` dist-tag (3.0.0-canary.20260707…) is stale and has **no** atoms. Intermediate stamps `20261015085016` / `20261015110227` exist but are not tagged.

**Build history.** Numbering changed to 3.0.0 from 2026-08-24. The live source branch is `release/betas/atoms` in `Sitecore/content-sdk`; `atoms-epic` and `release/betas/atoms.pre` are stale (July). Since `20261021204512` (#666, a squash merge of `dev`) the beta tracks **stable 2.4.1 + atoms**.

## Capability matrix

| Capability | 2.4.1 | 2.5.0-canary | beta.atoms 0930 | beta.atoms 1021 |
|---|---|---|---|---|
| Atoms catalog, registry, `atomsConfig` | no | no | yes | yes |
| `library-low-code` Design Studio mode | no | no | SDK route exists (code-read) | SDK route exists (code-read), Documents validated before preview (#652). Design Studio was never observed sending it: only `library` on one test environment, 2026-11-03 |
| `ComponentRef` → MMS render | no | no | yes | yes. Still null on an `application/json` body; still lower-case `fieldNames` only (re-measured 10-29) |
| Runtime Tailwind compiler | no | no | yes | yes (re-measured 10-29) |
| `nextjs-app-router-cache-components` | — | — | **HTTP 500** on ComponentRef pages | not re-measured; code path unchanged |
| `theming.mode: 'site'` delivery link | no | no | yes | yes |
| Live theme preview (`theme-update`) | no | no | no | yes (#642), needs Providers `theming` |
| Action `legacy` flag | — | — | no | yes (#643) |
| `getPageMetadata`, llms-txt, `./experimental`, `appLocalePrefix` | yes | yes | **no** | yes (#666; llms-txt + experimental routes seen in a 10-29 build) |
| OSR item fixes #619 / #620 / #623 (shipped in 2.4.1) | yes | yes | **no** | yes |
| 2.5.0-canary items (#662, #665, #667, #645, #670, #672) | no | yes | no | **no** |
| Pages Router atoms | — | — | renders, unstyled | template unchanged |

## Stamp 20261104151713 (measured 2026-11-05, upgrade from 20261021204512)

- **`capabilities` in `/api/editing/config`:** the field arrives in `20261104112554`; the atoms capability and `ATOMS_CATALOG_METADATA_KEY` arrive in `20261104121033`. `20261103095219` has neither.
- **Upgrade cost:** exact pins plus `generateMetadata({ appInputs })`. `Providers.tsx`, `next.config.ts`, `instrumentation*.ts` and the editing routes matched the template unchanged.
- **`numberFieldSchema`** is exported from `20261103095219`; `20261021204512` lacks it, and the Kit's current Number schema imports it.
- **Passed:** lock check, `tsc`, `next build` + `next start` with a mock MMS Document using nested Containers.
- **Not repeated:** the capability matrix above, and the runtime defects listed below.

## Re-verify on a new stamp

1. Run `npm view @sitecore-content-sdk/nextjs dist-tags` and `time`; diff `release/betas/atoms` in a `Sitecore/content-sdk` clone since the last stamp's commit.
2. Scaffold literally: `npx --yes create-content-sdk-app@beta.atoms --yes --template nextjs-app-router --destination <tmp>`. Known-bad control: the same command with `@latest` must produce no `src/atoms/`.
3. Run `node scripts/check-atoms-lock.mjs --self-test`, then the lock matrix: missing lock, add a prop (IV-010, CLI still exits 0 on 10-29), `.min`→`.max`, version bump, remove an atom.
4. Re-check the runtime defects with a mock MMS and `node scripts/probe-mms.mjs`:
   - the `application/json` body
   - `FieldNames` vs `fieldNames`
   - the MMS host resolution
   - the cache-components 500
5. Check whether the scaffold `Providers.tsx` still passes `theming` and whether the bundled `.agents/skills/content-sdk-atoms-*` changed.
