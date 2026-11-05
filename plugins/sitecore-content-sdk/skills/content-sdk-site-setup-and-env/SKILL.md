---
name: content-sdk-site-setup-and-env
description: "Site and environment configuration for a Content SDK app: sitecore.config.ts, environment variables, default site and language, personalize and analytics settings. Use when configuring the app or env vars. Not proxy or tracking code."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.6.3"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-site-setup-and-env
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-site-setup-and-env/SKILL.md
  upstream_note: upstream ships one copy per router template (nextjs and nextjs-app-router); folded here into a single router-agnostic skill
---

# Content SDK Site Setup and Environment

Central config in sitecore.config.ts; all secrets and environment-specific values via env vars. The config file and the env-var conventions below are identical in App Router and Pages Router. Only locale/i18n wiring is router-specific, and that belongs to the dictionary-and-i18n skill (pointer in Hard Rules).

## When to use

- User asks to configure site, default language, API host, or environment.
- Task involves sitecore.config.ts, .env, or defaultSite/defaultLanguage.
- User mentions "config," "environment variables," "API key," or "default site."

## How to perform

- Edit `sitecore.config.ts` with `defineConfig`; read all secrets and env-specific values from `process.env.*`. Add or change vars in `.env.example` (or `.env.remote.example` / `.env.container.example`) with placeholders; never commit `.env` or `.env.local`.

## Hard Rules

- Use `sitecore.config.ts` with `defineConfig` from the SDK. Expose api (edge, local), defaultSite, defaultLanguage, editingSecret, multisite, redirects, personalize as needed.
- All sensitive or environment-specific values must come from environment variables (e.g. process.env.SITECORE_API_KEY). Never hardcode API keys, secrets, or production URLs in source.
- Document every new or changed env var in `.env.example` (or `.env.remote.example` / `.env.container.example`). Use placeholder or empty value and a short comment; never put real secrets in example files.
- Never commit `.env` or `.env.local`; they are gitignored. Example files are the source of truth for which vars exist.
- `defaultLanguage` resolves config → `NEXT_PUBLIC_DEFAULT_LANGUAGE` → `en`.
- Locale/i18n wiring is router-specific and out of scope here: App Router uses next-intl (`src/i18n/routing.ts` + `request.ts`) and `[site]/[locale]` route segments; Pages Router uses the `i18n` block (`locales`, `defaultLocale`) in `next.config.js` with per-request `context.locale`. For that, use `content-sdk-app-router-dictionary-and-i18n` or `content-sdk-pages-router-dictionary-and-i18n` (and the matching route-configuration skill).

## Personalization and analytics settings

Verified against `@sitecore-content-sdk/content` 2.3.0 `dist/cjs/config/define-config.js` (defaults, lines 46-59; `deepMerge` skips `undefined`/`''`, lines 99-121; NaN fallback, lines 133-138), `@sitecore-content-sdk/nextjs` 2.4.0 `dist/cjs/config/define-config.js:15` (the Next.js pre-fill), `@sitecore-content-sdk/nextjs` 2.4.0 `dist/cjs/proxy/bot-tracking-proxy.js:128`, and the `create-content-sdk-app@2.4.0` App Router template.

| Var / key | Effect |
|---|---|
| `personalize.enabled` (no env var) | Defaults to `NODE_ENV !== 'development'`, so **on in every production build**. Each request the proxy does not skip pays one Edge lookup (up to `edgeTimeout`), even on a site with no personalization. **Set `enabled: false` when the site does not personalize** |
| `SITECORE_PERSONALIZE_SCOPE` → `CSDK_PUBLIC_PERSONALIZE_SCOPE` → `NEXT_PUBLIC_PERSONALIZE_SCOPE` | `personalize.scope`. The base chain takes the first non-empty, **but on Next.js** the nextjs `defineConfig` pre-fills `scope` from `NEXT_PUBLIC_PERSONALIZE_SCOPE`, so a non-empty `NEXT_PUBLIC_` value **wins** over `SITECORE_`. Set one name, not two that disagree. Must equal the CM environment's `PAGES_PERSONALIZE_SCOPE`. The template's `.env.remote.example` lists only `NEXT_PUBLIC_`, which `CdpPageView` also needs in the browser |
| `PERSONALIZE_MIDDLEWARE_EDGE_TIMEOUT` / `PERSONALIZE_MIDDLEWARE_CDP_TIMEOUT` | `personalize.edgeTimeout` / `cdpTimeout` in ms, default 400 each |
| `NEXT_PUBLIC_SITECORE_EDGE_CONTEXT_ID` | `api.edge.clientContextId`: the browser context id Bootstrap and `<Form>` use. **Its presence enables browser tracking**: the template's `Bootstrap.tsx` calls `initContentSdk` only when it is set (and never in development or preview) |
| `NEXT_PUBLIC_SITECORE_EDGE_PLATFORM_HOSTNAME` | `api.edge.edgeUrl`; empty = `https://edge-platform.sitecorecloud.io` |
| `SITECORE_ENABLE_BOT_TRACKING=true` | Turns `BotTrackingProxy` on in development / localhost, where it is off by default |

- **Template trap:** the scaffold's `sitecore.config.ts.example` sets `edgeTimeout` **and** `cdpTimeout` from `PERSONALIZE_PROXY_EDGE_TIMEOUT`, a name `define-config` does not read. If you copy it, one var drives both timeouts, and when it is unset `parseInt` yields `NaN`, which `resolveConfig` silently replaces with the `PERSONALIZE_MIDDLEWARE_*` / 400 default. No error either way. Use the `PERSONALIZE_MIDDLEWARE_*` names, or omit the keys.
- `defineConfig` has **no analytics or events keys**; those are plugin options (`content-sdk-analytics-events`).
- Runtime tracking needs no OAuth credential, only the context ids above (`sitecoreai-auth` § 0b).
- Wiring and behaviour: `content-sdk-personalization` (proxy, scope, variants), `content-sdk-analytics-events` (Bootstrap, events), `content-sdk-tracking-consent` (gating all of it on consent).

## Stop Conditions

- Stop if the user wants to commit real secrets or production values; insist on env vars and .env.example only.
- Stop if adding a new env var would require CI or deployment changes without explicit instruction; document the var and note that deployment must set it.
- Do not edit .next/, node_modules/, or lockfiles unless the task explicitly requires it.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
