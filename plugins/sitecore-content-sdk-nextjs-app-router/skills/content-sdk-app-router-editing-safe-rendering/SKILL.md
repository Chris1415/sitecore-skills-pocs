---
name: content-sdk-app-router-editing-safe-rendering
description: "Makes Content SDK App Router components work in SitecoreAI Pages editing, preview and design library: draftMode, editing data, chromes, selectable empty fields. Use when a component breaks or differs in the editor."
license: Apache-2.0
compatibility: "Requires @sitecore-content-sdk/* packages, Next.js 13+, and access to a SitecoreAI Edge endpoint with valid Edge context values (SITECORE_EDGE_CONTEXT_ID etc.)."
metadata:
  author: Christian Hahn
  version: "0.6.6"
  upstream_repo: Sitecore/content-sdk
  upstream_commit: 70eccc43
  upstream_name: content-sdk-editing-safe-rendering
  upstream_path: packages/create-content-sdk-app/src/templates/nextjs-app-router/.agents/skills/content-sdk-editing-safe-rendering/SKILL.md
---

# Content SDK Editing-Safe Rendering (App Router)

Ensure components behave correctly in SitecoreAI editing, preview, and design library. This app uses **draftMode()** and **searchParams** for editing data.

## When to use

- User asks about editing, preview, design library, or "component not working in editor."
- Task involves draft mode, editing chromes, or design library integration.
- Fixing issues where components render differently or break in editor vs published.
- User mentions getPreview, getDesignLibraryData, or editing API routes.
- **Authors can't manage a field in Pages**: empty fields are invisible in the editor, a submit button fires form validation instead of selecting its label, or a `<label>` jumps focus into its input instead of selecting the field. See "Authoring-safe components" below.

## How to perform

- In the page or layout: call `draftMode()`; when enabled, read editing params from searchParams, use `isDesignLibraryPreviewData(editingParams)` to choose getDesignLibraryData vs getPreview; otherwise use getPage. Editing routes: config route uses `createEditingConfigRouteHandler`, render route uses `createEditingRenderRouteHandlers`; set `dynamic = 'force-dynamic'` on both.

## Hard Rules

- Use `draftMode()` in Server Components (e.g. in the page or [site] layout). When `draft.isEnabled`, get editing params from **searchParams** and use `isDesignLibraryPreviewData(editingParams)` to distinguish: if true, use `client.getDesignLibraryData(editingParams)`; otherwise use `client.getPreview(editingParams)`. When not in draft mode, use `getPage(path ?? [], { site, locale })`.
- Do not assume editing/preview context in components that might run in static or non-editing contexts; guard on `draftMode()`.
- Editing API routes: `src/app/api/editing/config/route.ts` uses `createEditingConfigRouteHandler({ components, clientComponents, metadata })` (import from `.sitecore/component-map`, `.sitecore/component-map.client`, `.sitecore/metadata.json`). `src/app/api/editing/render/route.ts` uses `createEditingRenderRouteHandlers({})`. Set `export const dynamic = 'force-dynamic'` on both. Do not duplicate client creation; config and render routes use the same component maps as the app.
- Never commit editing secrets; use environment variables and document in .env.example only.
- **Design Library modes** include `library-low-code` on beta.atoms (low-code components, `atoms:*` bridge events) → `content-sdk-app-router-atoms`.
- **Editing language** (measured 2026-10-02): with `sc_lang=de-DE` and `route=/` the body renders German but the dictionary and `<html lang>` stay English, because `[locale]` comes from the route, not `sc_lang`. Fix and details: `content-sdk-app-router-dictionary-and-i18n` § 8.
- **Make field-driven components authorable in edit mode** (see "Authoring-safe components"): gate field helpers on existence + edit mode (never on value alone), keep presentational forms inert while editing, and detach field-backed `<label htmlFor>` in edit. These break authoring in Pages but pass unit tests — verify in a real editor.

## Authoring-safe components (component-level editing UX)

The plumbing above gets editing **data** into the page; this section keeps each **component** authorable once it's there. Symptom class: the page renders fine but an author can't select/manage a field in Pages. Applies to field-driven components (built with `Text`/`RichText`/`Image`/`Link`), especially anything interactive (forms, labelled inputs) or with optional fields.

**Detect edit mode inside a component:**
- **Client component:** `const { page } = useSitecore(); const isEditing = page.mode.isEditing;` (`useSitecore` from `@sitecore-content-sdk/nextjs`; needs `SitecoreProvider` in the tree — the scaffold provides it). `useSitecore()` is the unified hook; there is no `useSitecoreContext` in Content SDK.
- **Server component (no hooks):** derive from a Text/RichText field's metadata — `const isEditing = !!fields?.SomeTextField?.metadata;`. Sitecore emits `field.metadata` only in edit/preview. `TextField`/`RichTextField extends FieldMetadata`; `ImageField`/`LinkField` carry metadata only via `& FieldMetadata`, so read editing off a **text** field, not an image/link.

**1. Empty fields must stay authorable — gate on existence + edit mode, never on value.** `{fields?.Cta?.value?.href && <Link .../>}` hides the field in the editor too, so there's nothing to click. The SDK helpers already render the default empty-field editing placeholder when `field.metadata` is present + value empty + `editable !== false`, and render `null` when empty + published — they just have to be rendered:
```tsx
{fields?.Cta && (isEditing || fields.Cta.value?.href) && (
  <Link field={fields.Cta} className="btn" />
)}
```
The existence check (`fields?.Cta &&`) stops an **absent** datasource field (e.g. a template you haven't finished building) from feeding `undefined` to the helper and crashing it. For repeated/flat fields (e.g. `MetaValue1-3`/`MetaLabel1-3`), render **all** rows in editing and `.filter()` to non-empty only when published.

**2. Presentational forms must go inert in edit mode.** A `<form onSubmit={validate}>` with a `type="submit"` button whose label is a field: clicking the button to author the label fires submit → validation errors + focus-stealing, so the field can't be managed.
```tsx
function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  if (isEditing) return;                       // no validation in the editor
  /* ...validate / set state... */
}
// submit button:
<button type={isEditing ? 'button' : 'submit'}>…</button>  // also neutralizes Enter-to-submit
```

**3. Field-backed `<label htmlFor>` steals the click.** A `<label htmlFor="x"><Text field={NameLabel}/></label>` focuses its associated input on click (native label behavior) instead of selecting the label field. When the label is a **sibling** of its input (associated only via `htmlFor`), drop the association in edit:
```tsx
<label htmlFor={isEditing ? undefined : 'x'} className="field-label">
  <Text field={fields?.NameLabel} />
</label>
```
Published keeps the proper `label → input` a11y association (`isEditing` is false in normal mode).

**4. Custom / transformed field presentation must stay editing-safe.** If a component renders a field's **raw `field.value`** with its own markup — splitting a headline into animated spans, formatting a number, concatenating a string — instead of passing the field to `<Text>`/`<RichText>`, it **never emits the editing chrome** (`field.metadata` is dropped), so the field is **not inline-editable in Pages** (only the right-hand Content panel can change it), while sibling fields rendered through the SDK helpers stay inline-editable. This is the "some fields inline-edit, some don't" tell. Branch on edit mode — SDK field component when editing, the custom presentation when published:
```tsx
export function KineticHeadline({ field }: { field: TextField }) {
  const isEditing = !!field?.metadata;                     // server-safe edit signal
  if (isEditing) return <Text field={field} tag="h1" />;   // ONE editable node, un-split
  return <h1 aria-label={String(field?.value ?? '')}>{/* split .kin-line spans */}</h1>;
}
```
Keep it **one** editable node in edit mode — never split one field across multiple `<Text>` (each would try to save the whole value → corruption). Preserve a11y in both branches (accessible name via `aria-label`; decorative pieces `aria-hidden`).

**5. Integrated GraphQL (ComponentQuery) text fields must be fetched as `{ value jsonValue }` — check the DATA path FIRST, not just the render.** For a Shape-B / ComponentQuery component (`fields.data.datasource…`), a text field fetched as `field(name:"X") { value }` returns the raw string with **no editing metadata**, so it is **not inline-editable no matter how you render it** — `<Text>`, `ed()`, everything is downstream of a field that has no `.metadata`. This is the deeper cause behind "I already render through `<Text>` and it *still* won't edit": the render was never the blocker; the query was. Fix on the rendering item's **`ComponentQuery`**: request `{ value jsonValue }` (the universal safe shape — `.value` keeps rendering working, `.jsonValue` carries `{ value, editable, metadata }`), then render the metadata-bearing `jsonValue`:
```tsx
type Cq<F> = F & { jsonValue?: F };
const ed = <F,>(f?: Cq<F>): F | undefined => f?.jsonValue ?? f;   // defensive: falls back to value-only
// ComponentQuery:  Title: field(name:"Title") { value jsonValue }
<Text field={ed(item.Title)} />   // reads the editable jsonValue; still renders if jsonValue absent
```
Image/Link fields already use `{ jsonValue }` (already editable). **When a Shape-B field won't edit, read the LIVE `ComponentQuery` first** — a `{ value }` text selection is the smoking gun; don't just inspect the component. (See `content-sdk-app-router-graphql-data-fetching` for the query; the value-vs-jsonValue asymmetry also affects rendering.)

**Verify in a real editor, not jest.** All five only surface in Pages (they are metadata-driven). A structural unit test that reads props directly passes regardless — Playwright/manual editor smoke is the gate.

## Stop Conditions

- Stop and clarify if the issue is preview vs design library vs published; behavior differs.
- Do not change proxy or middleware order to "fix" editing; editing is driven by API routes and draft/preview data.
- Do not recommend disabling secret validation without explicit user request and warning.

## References

- [Content SDK skills overview](https://github.com/Chris1415/sitecore-skills-pocs#skills-by-cluster).
- [Official Content SDK docs](https://doc.sitecore.com/sai/en/developers/content-sdk/sitecore-content-sdk-for-sitecoreai.html).
