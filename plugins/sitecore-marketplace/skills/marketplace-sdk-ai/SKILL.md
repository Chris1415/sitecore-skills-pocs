---
name: marketplace-sdk-ai
description: "API reference for @sitecore-marketplace-sdk/ai: module vs experimental client, generateBrandReview, payload traps, file inputs. Load when a Marketplace app calls AI skills such as brand review or content compliance."
license: Apache-2.0
compatibility: "Requires @sitecore-marketplace-sdk/ai, a Sitecore brand kit on the target tenant, and a registered Marketplace app. Mode B additionally requires an Auth0 user-delegated token."
metadata:
  author: Christian Hahn
  version: "0.4.3"
---

# Sitecore Marketplace AI Skills SDK

## When to use

- The project uses `@sitecore-marketplace-sdk/ai`
- The PRD mentions brand review, AI-assisted content compliance, or "AI skills"
- The architecture calls for LLM-powered checks grounded in SitecoreAI data (brand kits, content)
- You're evaluating whether to use the **module mode** (inside a Client SDK app) or the **experimental direct mode** (server-to-server)

For **auth setup** (Auth0, iframe cookies, orgId/tenantId) see the `marketplace-sdk-lifecycle` skill, § 5.
For **core Client SDK** (query/mutate/subscribe, extension points) see the `marketplace-sdk-client` skill.
For **XMC endpoints** see the `marketplace-sdk-xmc` skill.

---

## 1. Package overview

| Package | Purpose |
|---------|---------|
| `@sitecore-marketplace-sdk/ai` | Type-safe access to AI skills APIs — LLM capabilities grounded in SitecoreAI data |

**Install (always latest):** `npm install @sitecore-marketplace-sdk/ai@latest`

**Status:** interfaces marked `experimental_*` may change between releases. Currently exposes a single skill — `generateBrandReview` — with more skills expected.

---

## 2. Two usage modes

The AI package supports **two** initialization patterns, chosen by where your code runs:

| Mode | When | Init function | Call shape | Token handling |
|------|------|---------------|-----------|---------------|
| **A. Module mode** | Inside a Client SDK iframe app (architectures 4a/4b in the `marketplace-sdk-lifecycle` skill) | `ClientSDK.init({ modules: [AI, …] })` | `client.mutate('ai.skills.*', …)` | Portal brokers via postMessage — you hold no token |
| **B. Experimental direct** | Standalone / server-to-server (architecture 4c in the `marketplace-sdk-lifecycle` skill) | `experimental_createAIClient({ getAccessToken })` | `ai.skills.*(…)` | You supply an Auth0 access token via `getAccessToken` |

**Pick one per app.** Mixing is rarely needed and adds auth complexity. If the app already uses the Client SDK for XMC queries, use **Mode A**. If it runs outside the iframe (cron, background jobs, microservices), use **Mode B**.

---

## 3. Mode A — AI as a Client SDK module

### 3a. Registration

```typescript
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import { AI } from '@sitecore-marketplace-sdk/ai';

const client = await ClientSDK.init({
  target: window.parent,
  modules: [XMC, AI],   // register both — they coexist
});
```

Both modules can be registered together. Keys get prefixed: `xmc.*` for XMC, `ai.*` for AI.

### 3b. Calling a skill (mutation)

```typescript
const result = await client.mutate('ai.skills.generateBrandReview', {
  params: {
    body: {
      brandkitId: 'your-brandkit-id',
      input: {
        headline: 'Summer Sale — 50% Off Everything!',
        body: 'Shop our biggest sale of the year.',
      },
    },
    query: { sitecoreContextId },   // pass it; see § 9b
  },
});
```

**Critical — `params:` wrapper is mandatory (verified live 2026-04-22).** Mode A mutate calls through the Client SDK wrap hey-api options one level deeper than Mode B direct calls: `{ params: { body, query, path?, headers? } }`, NOT flat `{ body, query }`. Writing flat fails `tsc --noEmit` with:

```
TS2353: Object literal may only specify known properties, and 'body' does not exist in type 'MutationOptions<"ai.skills.generateBrandReview">'.
```

Same hey-api convention as XMC mutations (the `marketplace-sdk-xmc` skill, § 3). Easy to miss because `sdk.generateBrandReview(options)` signature in `sdk.gen.d.ts` reads flat — that's the Mode B shape. Mode A wraps it.

**`sitecoreContextId` rule:** technically optional in Mode A per the type, but always pass it — the contract is the same as every other `xmc.*` call documented in the `marketplace-sdk-xmc` skill, § 6a. Use the `requireContextId()` helper from the `marketplace-sdk-client` skill, § 4.

**Live-verified response shape (2026-04-22):** `.data` unwraps to `Array<SectionReview>` with at least `sectionId`, `score`, `reason` fields populated per entry. Example:

```typescript
{
  data: [
    {
      sectionId: '<section-id>',
      score: 1,           // 1–5
      reason: 'The provided image lacks sufficient detail to demonstrate alignment with the mandatory brand-kit requirements…',
      // additional SectionReview fields (fieldReviews, etc.) present when sections are targeted
    },
    // …one entry per reviewed section
  ],
}
```

---

## 4. Mode B — experimental direct client

### 4a. Create the client

```typescript
import { experimental_createAIClient } from '@sitecore-marketplace-sdk/ai';

const ai = await experimental_createAIClient({
  getAccessToken: async () => {
    // Return an Auth0 access token with the right audience/scopes.
    // See the marketplace-sdk-lifecycle skill, § 5, for Auth0 config.
    return await getUserAccessToken();
  },
});
```

`getAccessToken` is called on every request — fetch from session / refresh as needed. Do not return an expired token; the function can (and should) be async.

### 4b. Calling a skill

```typescript
const brandReview = await ai.skills.generateBrandReview({
  body: {
    brandkitId: 'your-brandkit-id',
    input: {
      headline: 'Your marketing headline',
      body: 'Your marketing body copy',
    },
  },
  query: { sitecoreContextId: 'your-context-id' },   // REQUIRED in Mode B
});
```

### 4c. Getting `sitecoreContextId` for Mode B

In Mode B you need a `sitecoreContextId` per request. Capture it once with a small Client SDK standalone page:

```typescript
// One-time capture in a Client SDK app
const appCtx = await client.query('application.context');
const contextId = appCtx.data?.resourceAccess?.[0]?.context?.live
              ?? appCtx.data?.resourceAccess?.[0]?.context?.preview;
// Persist contextId in your server-side config
```

Then pass it in every `experimental_*` call. See the `marketplace-sdk-lifecycle` skill, § 5c, for the orgId / tenantId companions.

### 4d. Required env vars (Mode B)

Same env vars as any Mode B module — `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_SCOPE`, `SITECORE_ORGANIZATION_ID`, `SITECORE_TENANT_ID`. Full values and where to capture them: the `marketplace-sdk-lifecycle` skill, § 5b + § 5c. Mandatory `Auth0Client` cookie block: the `marketplace-sdk-testing-debug` skill, § 4a.

---

## 5. AI Skills API reference

### 5a. `generateBrandReview`

Runs input content against a **brand kit** using an LLM and returns compliance scores, explanations, and fix suggestions. The brand kit defines tone-of-voice, visual identity, and other sections; the review scores how well the input matches.

**Signature — Mode A wraps, Mode B does not (verified live 2026-04-22):**

```typescript
// Mode A — via client.mutate (hey-api double-wrap)
{
  params: {
    body: GenerateBrandReviewBody;
    query?: { sitecoreContextId: string };
    headers?: { 'x-sc-feature'?: string; /* … */ };
  };
}

// Mode B — via experimental_createAIClient (flat hey-api options)
{
  body: GenerateBrandReviewBody;
  query: { sitecoreContextId: string };   // REQUIRED in Mode B
}

// Shared body shape
type GenerateBrandReviewBody = {
  brandkitId: string;
  input: Record<string, InputValue>;
  sections?: Array<{
    sectionId: string;
    fieldIds?: string[];
  }> | null;
};
```

Where `InputValue` (from the SDK's `GenerateBrandReviewModelRequest["input"]` union) is one of:
- `string` — **live-confirmed as a first-class pattern** (2026-04-22): pass short copy, tone guidelines, prompt snippets as raw strings under arbitrary keys. No `ExtractableFile` wrapping required. Example: `{ brandVoice: "Our brand voice is warm, confident, and direct." }`.
- `number`, `boolean`, `null`
- `Array<unknown>`, `Record<string, unknown>` (structured content)
- `ExtractableFile` (file-based content — see § 6)
- `Array<ExtractableFile>`

**Response:** `.data` unwraps to `Array<SectionReview>`. One entry per reviewed section with `sectionId`, `score` (1–5), `reason`. Additional fields populated when `sections` targeting is used.

**Default behavior:** all brand-kit sections are reviewed. Use `sections` to target specific sections / field IDs.

---

## 6. `ExtractableFile` — sending images and documents

Use when the content under review is a file rather than plain text.

### 6a. Common shape

```typescript
interface ExtractableFile {
  name: string;
  type: 'image' | 'document';
  url: string;              // HTTPS URL, or a data: URL (base64)
  mimeType: string;         // see per-type tables below
  detail?: 'low' | 'auto' | 'high';   // images only — controls LLM processing depth
  auth?: {
    authType: 'bearer' | 'basic' | 'custom';
    value: string;          // token, username:password base64, or header value
    customHeaderName?: string;   // required when authType === 'custom'
  };
}
```

### 6b. Images

| `mimeType` | Accepted |
|-----------|---------|
| `image/jpeg` | yes |
| `image/png` | yes |
| `image/webp` | yes |

```typescript
input: {
  heroImage: {
    name: 'hero-banner.png',
    type: 'image',
    url: 'https://cdn.example.com/hero-banner.png',
    mimeType: 'image/png',
    detail: 'high',
  },
}
```

**Base64 inline variant:**
```typescript
logo: {
  name: 'logo.png',
  type: 'image',
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA…',
  mimeType: 'image/png',
  detail: 'auto',
}
```

### 6c. Documents

| `mimeType` | Accepted |
|-----------|---------|
| `application/pdf` | yes |
| `text/plain` | yes |

```typescript
input: {
  pressRelease: {
    name: 'press-release.pdf',
    type: 'document',
    url: 'https://example.com/press-release.pdf',
    mimeType: 'application/pdf',
  },
}
```

### 6d. Auth for protected files

If the `url` needs auth to download:

```typescript
internalDoc: {
  name: 'style-guide.pdf',
  type: 'document',
  url: 'https://internal.example.com/style-guide.pdf',
  mimeType: 'application/pdf',
  auth: {
    authType: 'bearer',
    value: 'your-file-access-token',
  },
}
```

`authType` options:
- `'bearer'` → `Authorization: Bearer <value>`
- `'basic'` → `Authorization: Basic <value>` (value is base64 `user:pass`)
- `'custom'` → `<customHeaderName>: <value>`

### 6e. Mixed input

`input` is a flexible record — combine text, images, and documents in one request:

```typescript
input: {
  headline: 'Summer Sale — 50% Off Everything!',
  body: 'Shop our biggest sale of the year.',
  banner: { name: 'summer-banner.webp', type: 'image', url: '…', mimeType: 'image/webp', detail: 'high' },
  campaign: { name: 'brief.pdf', type: 'document', url: '…', mimeType: 'application/pdf' },
  productPhotos: [
    { name: 'front.jpg', type: 'image', url: '…', mimeType: 'image/jpeg' },
    { name: 'back.jpg', type: 'image', url: '…', mimeType: 'image/jpeg' },
  ],
  wordCount: 150,
  tags: ['summer', 'sale'],
}
```

---

## 7. Targeting specific brand-kit sections

By default all sections are reviewed. Narrow with `sections`:

```typescript
sections: [
  { sectionId: 'tone-of-voice', fieldIds: ['headline', 'body'] },
  { sectionId: 'visual-identity' },   // whole section
]
```

- Omit `fieldIds` to evaluate the whole section.
- Use when you only want scores for specific dimensions (e.g. tone, not visual).

---

## 8. Type imports (Mode B)

For better IntelliSense in Mode B:

```typescript
import {
  experimental_Skills,
} from '@sitecore-marketplace-sdk/ai';

const request: experimental_Skills.GenerateBrandReviewModelRequest = {
  brandkitId: 'your-brandkit-id',
  input: { headline: 'Your headline' },
};

const file: experimental_Skills.ExtractableFile = {
  name: 'banner.png',
  type: 'image',
  url: 'https://example.com/banner.png',
  mimeType: 'image/png',
};

const contentType = experimental_Skills.ContentType.SHORT_TEXT;
```

---

## 9. Common pitfalls

### 9a. Wrong mode for the runtime

Client-side browser code that uses `experimental_createAIClient` with a user access token will leak the token through the network tab and violate iframe cookie rules. For iframe apps **always use Mode A**. Mode B is for server routes, cron jobs, microservices.

### 9b. Missing `sitecoreContextId` — always pass it

Mode B types mark `query.sitecoreContextId` as required; Mode A types mark it optional. **Always pass it in both modes** — same rule as every `xmc.*` call (the `marketplace-sdk-xmc` skill, § 6a). Without it, responses may silently land on the wrong environment. Use the `requireContextId()` helper from the `marketplace-sdk-client` skill, § 4, to narrow from `application.context.resourceAccess[]` without the `as string` anti-pattern.

### 9c. `as never` / `as any` on skill keys

The SDK is fully typed. If TS complains about `'ai.skills.generateBrandReview'`:
- Did you pass `modules: [AI]` to `ClientSDK.init()`? (Mode A)
- Did you use `client.mutate` (not `client.query`)? AI skills are mutations.
- Is the key spelled exactly as shown? (case-sensitive)

Do not cast — fix the underlying issue.

### 9d. Treating generateBrandReview as a query

It's a **mutation** in both modes (POST under the hood). In Mode A use `client.mutate`, not `client.query`. In Mode B it's just a method call, no mode distinction needed.

### 9d-bis. Flat `{body, query}` in Mode A (the TS2353 trap)

First-attempt bug observed in real use: writing `client.mutate('ai.skills.generateBrandReview', { body: {...}, query: {...} })` — flat at the top level, like the Mode B shape — fails `tsc --noEmit` with `TS2353: Object literal may only specify known properties, and 'body' does not exist in type 'MutationOptions<…>'`. Mode A wraps hey-api options under `params:` (`{ params: { body, query, headers?, path? } }`), same as every `xmc.*` mutation. See § 3b for the canonical shape. Mode B (experimental client, § 4b) uses flat options — do NOT add the `params:` wrapper there.

### 9e. Unauthenticated file URLs from internal hosts

If `url` points to a host that requires auth, the server can't download it — include the `auth` field. Forgotten auth is a common cause of "file not found" errors even when the URL is reachable from a browser.

### 9f. Oversized base64 payloads — silent SyntaxError on submit

Base64-inline files in `url` inflate request size ~33%. There is an **undocumented practical payload ceiling** somewhere between ~30 KB (confirmed working) and ~5 MB (confirmed failing, with a 3.8 MB PDF → ~5 MB base64). When the ceiling is exceeded, the Marketplace bridge or AI backend returns an empty / truncated response body, and the SDK's JSON response handler surfaces the failure as:

```
SyntaxError: Unexpected end of JSON input
Failed to execute 'json' on 'Response': Unexpected end of JSON input
```

The error name mentions nothing about size — pure diagnostic trap. If you see this exact SyntaxError on a `generateBrandReview` call, payload size is the first thing to suspect.

**Practical rule:** keep base64 payloads under ~1 MB; anything above is risky. For larger files, host the file publicly (or behind auth via § 6d) and pass an HTTPS URL instead of an inline data URL. A reasonable UI guardrail: warn users at 1 MB base64 and hard-warn at 3 MB.

### 9g. `detail` tuning

- `'low'` — cheap, fast, OK for small UI-style images
- `'auto'` (default) — balanced
- `'high'` — full LLM vision pass; use for hero imagery and detailed brand reviews

Pick explicitly once, don't oscillate per-request. Document the choice in the implementation plan.

---

## 10. Mode A vs Mode B — quick reference

```typescript
// ─── Mode A — inside a Client SDK iframe app ──────────────────────────
import { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { AI } from '@sitecore-marketplace-sdk/ai';

const client = await ClientSDK.init({ target: window.parent, modules: [AI] });
const result = await client.mutate('ai.skills.generateBrandReview', {
  params: {
    body: { brandkitId, input: { headline, body } },
    query: { sitecoreContextId },
  },
});

// ─── Mode B — server-to-server / standalone ───────────────────────────
import { experimental_createAIClient } from '@sitecore-marketplace-sdk/ai';

const ai = await experimental_createAIClient({
  getAccessToken: async () => auth0.getAccessToken().then(r => r.token),
});
const brandReview = await ai.skills.generateBrandReview({
  body: { brandkitId, input: { headline, body } },
  query: { sitecoreContextId },
});
```

---

## 11. Agent guidance

**During discovery / requirements:** If the feature involves "brand compliance check", "AI-powered review", or "content scoring against a brand kit" — this SDK is the path. Surface in the requirements whether the content is text-only or also includes images/documents (affects input design).

**During architecture:** Pick mode (A vs B) in the ADR. Default to **Mode A** unless the app runs outside the iframe. Document the brand-kit selection strategy (single brandkitId vs user-selected) and whether `sections` targeting is used. Record the `detail` level decision for images.

**During implementation planning:** Specify (a) which mode, (b) exact key strings (`'ai.skills.generateBrandReview'`), (c) `ExtractableFile` usage and mime types if images/documents are involved, (d) for Mode B, the env vars and `sitecoreContextId` capture strategy. If Mode B, include a task for the one-time `application.context` capture page.

**During testing:** Test scenarios must cover (a) text-only input, (b) image input with each supported mimeType, (c) document input with and without `auth`, (d) large files / timeout behavior, (e) Mode B token expiry / refresh. Responses are LLM-dependent — verify in the real portal with a known brand kit.

**During implementation:** Use exact key strings. Call `client.mutate` (not `query`) in Mode A. For Mode B, never hardcode the access token — always go through `getAccessToken`. Unwrap Mode A responses with `.data` (per the `marketplace-sdk-client` skill, § 8b).
