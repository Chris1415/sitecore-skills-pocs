# Design Studio bridge (beta)

The low-code builder talks to the rendering host over `postMessage` inside the Design Library iframe. It extends the existing Design Library protocol (`mode=library|library-metadata`, `component:update`).

## Mode

- `DesignLibraryMode.LowCode = 'library-low-code'` sets `page.mode.designLibrary.isLowCode = true` and `isEditing = true`.
- `DesignLibraryApp` (nextjs) routes this mode to `DesignLibraryLowCodeComponent`. Other modes keep the normal client and server Design Library paths.
- Pages Router also compiles `DesignLibraryApp` with the low-code branch. Whether Design Studio drives it there is `[UNVERIFIED]`.

## Sequence (`DesignLibraryLowCodeComponent`)

1. Post `READY`.
2. Post **`atoms:catalog`** with a `SerializedCatalog`. With no catalog configured, post **`atoms:error`** `{ type: 'atoms-missing' }` instead.
3. Listen for **`component:atoms:preview`** (`e.data.document`, a Document whose `state.fields` / `state.params` carry the data; the separate `component:update` leg was removed in #654).
4. Validate with `validateAtomsDocument` (#652); on failure post `atoms:error` `{ type: 'validation', issues, formatted }`. Otherwise render through `createNCC(doc)`, then post `RENDERED`; on a render failure post `atoms:error` `{ type: 'render', error }`.
5. Wrap the output in `PlaceholderMetadata componentType="atom"`. In edit mode, each atom also gets a `<code type="text/sitecore" chrometype="atom" class="scpm" data-atom-type data-atom-slots>` chrome. `data-atom-slots` appears only when slots are declared.

The normal `DesignLibrary` also posts `atoms:catalog` whenever a catalog is configured, including in AI variant generation.

## `SerializedCatalog` (wire shape)

```json
{
  "stylingSolution": "tailwind",
  "version": "1",
  "components": [
    { "name": "Heading", "propsSchema": { "type": "object", "properties": { } }, "description": "…",
      "slots": ["default"], "allowedChildren": null, "allowedParents": ["Stack"], "example": null,
      "legacy": false, "version": "1.0.0" }
  ],
  "actions": [ { "name": "track", "description": "…", "paramsSchema": { } } ]
}
```

- `propsSchema` comes from Zod `toJSONSchema()`.
- `legacy` defaults to `false` **at serialization**, so a catalog without the key keeps its hash.
- `version` appears only when it is set.
- The legacy event name `atom:registry` was replaced by `atoms:catalog`.

## Reaching the builder

In Design Studio, Studio → Create component opens the builder, with an Atoms panel listing the catalog (seen 2026-11-05 on one environment). Which tenants have it is `[UNVERIFIED]`, so a missing panel does not prove the app is misconfigured. Existing code components open without it. The editing host log records neither the mode change nor a healthy session, so it cannot prove or disprove that the builder ran.

## What reaches Design Studio

- The serialized catalog over `postMessage`.
- From stamp `20261104121033`, also `capabilities.designLibrary.atoms.metadata.catalog` in the `/api/editing/config` response, when `generateMetadata` receives the catalog. Whether Design Studio reads it is `[UNVERIFIED]`.
- The CLI lock is local and makes no network call.
- No CM item carries the catalog: the test tenant's Authoring GraphQL has no atoms or low-code types.
- Design Studio therefore sees a new atom only after the editing host that Design Studio loads is redeployed with it.

## Saved components (delivery side)

- A saved low-code component appears to be a rendering item of template `Foundation/JavaScript Services/HostedJsonRendering` whose `ComponentRef` field names the MMS Document path(s).
- Edge layout delivers that field as `rendering.params.ComponentRef`. This was measured with a hand-made rendering item; a Design-Studio-created one was not available to inspect.
- Who writes MMS, how a Document is published or versioned, and whether a Document edit notifies anything (webhook, revalidation) are all `[UNVERIFIED]`.
