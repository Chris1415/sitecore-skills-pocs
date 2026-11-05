# Backend APIs, MMS and theming (as of 2026-10-02)

## What exists per surface

| Surface | Atoms | Low-code / Hosted | Tokens / themes | Auth |
|---|---|---|---|---|
| **Components API** (GA, `https://edge-platform.sitecorecloud.io/authoring/api/v1/components…`) | indirect: `POST drafts/{id}/model-suggestion {atoms: string}` ("raw atoms payload from Rendering Host"; the spec example is HTML) | Drafts and components are `type: Code \| Hosted` ("based on its rendering template"). `ComponentVariantDraft {name, code}`, `code` example `<Button>Click</Button>`. `DELETE drafts/{id}` → 204. **`POST drafts/{id}/activation` is one-way**: it creates the content type, component and variants, then deletes the draft | none | **Environment** automation client JWT (`audience=https://api.sitecorecloud.io`). An org client gets **401** (measured). Auth: `sitecoreai-auth` |
| Content Types / Content Items API | none | the data template a Hosted component binds to | none | same |
| Agent API v2 / Marketer MCP | none | list / detail components. `add_component_on_page` takes no rendering params, so it can place a Hosted rendering by id but cannot set a page-level `ComponentRef` | brand kits: read only | MCP OAuth / bearer |
| Authoring GraphQL (CM) | no types | the `HostedJsonRendering` template (base `Json Rendering`) with a `ComponentRef` Single-Line Text field. On the test tenant only its Standard Values used it | none | CM JWT |
| **MMS** `{edge}/mms/<path>` | — | read-only Document delivery. **No authoring API found** | — | the SDK sends **no auth, no context id, no query string**. Unknown paths return 404 with an empty body on both `edge-platform` and `edge` hosts |
| **Themes delivery** (undocumented, SDK-consumed) | — | — | `GET {edge-platform}/authoring/api/v1/themes/delivery/{site}/web-css?contextID=<clientContextId>` | anonymous: 404 "Authorization header is missing" (the gateway's generic answer for any `/authoring` path). Edge-admin or org bearer: empty 404, **identical for a bogus site** |
| FEaaS Component builder (legacy) | **not atoms** | its own "low code components" and "atomic styles library" | own stylesheets REST | — |

## Theming (`sitecore.config` `theming.mode: 'none' | 'site'`, default `'none'`)

- **What `site` adds.** A `<link>` to the themes delivery URL above. The scaffold's `layout.tsx` sets `<body class="sc-ds-theme">` when theming is enabled. The editing config route reports the mode to Pages.
- **Why it is not usable yet.** The SDK sends no auth header, and no credential reached a theme route on the test tenant. On such a tenant `site` mode adds a 404 stylesheet and nothing else.
- **Which tenants serve themes** (feature flag, brand-kit link via the Sites API `brandKitId`, or an authoring source for tokens) is `[UNVERIFIED]`. Leave it at `none` unless a read of the URL returns CSS.

## Probing a Hosted draft safely (when an environment client exists)

1. `GET /api/v1/components` with the environment client must return 200. The org client must return 401 (known-bad credential).
2. `POST /api/v1/components/drafts` with `{ name, type: 'Hosted', variants: [{ name: 'Default', code: '<Heading>Probe</Heading>' }] }`. Known-bad control: `type: 'Bogus'` must return 400.
3. `POST drafts/{id}/model-suggestion` with HTML and then with the serialized catalog. Which one yields a field model is `[UNVERIFIED]`. It may consume AI credits.
4. `DELETE drafts/{id}`, then GET must return 404. **Never call `activation` in a probe**: it cannot be undone and leaves a content type plus a component behind.
