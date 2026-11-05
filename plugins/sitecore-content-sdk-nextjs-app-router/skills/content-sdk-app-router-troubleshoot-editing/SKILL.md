---
name: content-sdk-app-router-troubleshoot-editing
description: "Troubleshoots SitecoreAI Pages editing, preview and design library in a Content SDK App Router app: draftMode, preview data, locale, component maps. Use when editing or preview is broken, chromes are missing or data is wrong."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Sitecore
  version: "0.4.6"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-troubleshoot-editing
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-troubleshoot-editing/SKILL.md
---

# Content SDK Troubleshoot Editing (App Router)

This skill focuses on **diagnosing** editing, preview, and design library issues. For implementing editing-safe rendering (draftMode, getPreview/getDesignLibraryData, API routes), use the **`content-sdk-app-router-editing-safe-rendering`** skill; the two are complementary (implementation vs. troubleshooting).

Diagnose and fix editing, preview, and design library issues without breaking the single client or proxy order. This app uses **draftMode()** and **searchParams** for preview data.

## When to use

- User reports that editing, preview, or design library is broken or inconsistent.
- Task involves debugging "not working in editor," missing chromes, or wrong data in preview.
- User mentions "editing broken," "preview not working," "design library," or "editor issues."

## How to perform

- Confirm `draftMode()` and searchParams-based getPreview/getDesignLibraryData; ensure `setRequestLocale` is called at the top of the page. Verify editing API routes are not rewritten (check proxy matcher) and both component maps include the component. Check env (editingSecret, API config) and .env.example documentation.

## Hard Rules

- **Preview flow:** Use `draftMode()` in Server Components; when enabled, use `client.getPreview(editingParams)` or `client.getDesignLibraryData(editingParams)` from **searchParams**. Ensure site/locale are passed correctly (e.g. from route params or editingParams).
- **next-intl:** Ensure `setRequestLocale(\`${site}_${locale}\`)` is called at the top of the page; missing setRequestLocale can cause locale or dictionary issues in editor.
- Editing API routes (`src/app/api/editing/config/route.ts`, `editing/render/route.ts`) must be reachable and use the same component maps (component-map.ts and component-map.client.ts) and config as the app. Check matcher in proxy.ts so /api/editing is not rewritten or blocked.
- Check that both component maps include all components used in the layout; missing registration causes "component not found" in editor.
- Environment: editingSecret and API config must be set (in env); document in .env.example only. Do not log or commit secrets.
- **Symptom: Pages shows a German body but English labels and `<html lang="en">`** → the editing render takes `[locale]` from `route`, not `sc_lang` (measured 2026-10-02); see `content-sdk-app-router-dictionary-and-i18n` § 8.
- **Design Library `library-low-code` mode / `atoms:*` events** (beta.atoms only) → `content-sdk-app-router-atoms`.

## Stop Conditions

- Stop if the fix would require changing CI, deployment, or SitecoreAI project settings; suggest the user do that and document the required env or config.
- Stop if the issue might be in Sitecore (layout, template) rather than the app; suggest checking layout and content in SitecoreAI.
- Do not recommend disabling security (e.g. skipping secret validation) without explicit user request and warning.

## References

- `content-sdk-app-router-editing-safe-rendering` skill and [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster) for preview and editing flow.
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
