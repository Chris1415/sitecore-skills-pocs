---
name: content-sdk-field-usage-image-link-text
description: "Renders Sitecore fields with the Content SDK field components (Text, RichText, Image, Link) with guards and fallbacks. Use when rendering a title, body, image or link, or fixing empty or broken images and links."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.7.2"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-field-usage-image-link-text
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-field-usage-image-link-text/SKILL.md
  upstream_note: upstream ships one copy per router template (nextjs and nextjs-app-router); folded here into a single router-agnostic skill
---

# Content SDK Field Usage

Use SDK field components to render Sitecore fields with proper validation and fallbacks. This concern is the same in App Router and Pages Router — the components, props, and guards below are identical. Only the way `fields` is delivered to the component differs by router, and that wiring belongs to the component-data-strategy skill (pointer in Hard Rules), not here.

## When to use

- User asks how to render a title, body, image, or link from Sitecore.
- Task involves displaying content fields, fixing empty/broken images or links, or using RichText/Text/Image/Link components.
- User mentions "field," "Image," "Link," "Text," "RichText," or "field value."

## How to perform

- Use SDK field components: `<Text field={fields?.title} />`, `<RichText field={fields?.content} />`, `<Image field={fields?.image} />`, `<Link field={fields?.link} />`. Guard with `fields?.` when optional; use tag prop on Text when needed. Do not hardcode media or link URLs from Sitecore.

## Hard Rules

- Prefer SDK field components over manual field value extraction: `<Text field={fields?.title} />`, `<RichText field={fields?.content} />`, `<Image field={fields?.image} />`, `<Link field={fields?.link} />`. Use tag prop for Text when needed (e.g. tag="h1").
- Guard field **existence**, not **value**, for optional fields. `fields?.title` (existence) is correct — it stops `undefined` being fed to a helper for a field absent from the datasource. But do **not** gate a helper on an empty *value* (e.g. `{field?.value?.href && <Link/>}`): that also hides the field in the **editor**, leaving the author nothing to click. The SDK helpers already render an editable empty-field placeholder in edit mode and `null` when empty + published — so render the helper and let it decide. When you must conditionally render a wrapper, admit edit mode: `{fields?.x && (isEditing || hasValue) && <Helper/>}`. For the full edit-mode contract (empty-field visibility, inert forms, field-backed labels) see `content-sdk-app-router-editing-safe-rendering` / `content-sdk-pages-router-editing-safe-rendering` → "Authoring-safe components."
- Do not hardcode image or link URLs when the data comes from Sitecore; use the field components or helpers that resolve media/URLs.
- **Never default an empty link href to `'#'`** (`href: link?.value?.href || '#'`). On a published page it produces a live, dead anchor, and a test can end up asserting the bug as intended. Pass `undefined` so the attribute is omitted, or let `<Link>` render nothing for an empty field. Assert `getAttribute('href')` is `null` on an empty Link field (one build swept six instances, 2026-09-28).
- **Wrapping `<Link>` text in an element is authoring-safe:** `<Link field={f}><span>{f.value.text}</span></Link>`. `withFieldMetadata` wraps the whole `<a>` in the field chrome, whatever its children, so the field stays inline-editable, and an empty link still renders nothing unless `renderChildrenWhenEmpty` is set. `showLinkTextWithChildrenPresent` does not do this: it renders the text as a **sibling** of the children, for an icon next to the text.
- **Match the source markup per link class, not globally.** When porting an existing site, a shared CTA helper must reproduce each class of link as the source writes it. One build had `<a><span>Text</span></a>` on one hero widget and bare `<a>Text</a>` on every other CTA. Wrapping every call site to fix the one broke all the others (2026-09-29). Make the wrap an opt-in prop.
- Follow the app's import pattern (e.g. from lib or components).
- Where `fields` comes from is router-specific and out of scope here: App Router resolves it from `getPage` (and may pass it as serializable props from a Server Component to a Client Component); Pages Router resolves it via `getComponentData` from the `[[...path]].tsx` catch-all. For that wiring use `content-sdk-app-router-component-data-strategy` or `content-sdk-pages-router-component-data-strategy`.

## Stop Conditions

- Stop if the field structure (name or type) is unknown; suggest checking the layout/data shape or asking the user.
- Do not assume field names (e.g. "title") without confirmation when the template might use different names.
- Do not commit or log raw field values that might contain PII or secrets.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
