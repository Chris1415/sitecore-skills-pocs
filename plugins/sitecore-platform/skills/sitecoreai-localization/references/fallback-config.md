# Language fallback configuration

## Switches

| Switch | Where | Governs |
|---|---|---|
| `Fallback Language` | language item `/sitecore/system/Languages/<lang>` (AGQL `addLanguage.fallbackCode`, Sites `PATCH /languages/{regionalIsoCode}`) | the rule (de-DE → en); env-wide; chains allowed (en-NZ → en-AU → en), deeper chains cost performance |
| `__Enable item fallback` (shared) | the item or its template `__Standard Values` | item-level opt-in |
| `Enable field level fallback` | the field definition item | field-level opt-in; not on shared, `__Standard Values` or `__` fields (media fields excepted); the per-language variant needs `LanguageFieldFallback.AllowVaryFallbackSettingsPerLanguage` and costs performance |
| `ExperienceEdge.EnableItemLanguageFallback` / `ExperienceEdge.EnableFieldLanguageFallback` | CM `/platform` config patch + deploy, default false | **GraphQL delivery (Edge and preview)** per the current docs |
| Host `itemLanguageFallback` / `fieldLanguageFallback` (Site Grouping) → site properties `enableItemLanguageFallback` / `enableFieldLanguageFallback` | Sites `PATCH /sites/{id}/hosts/{hostId}` or the Site Grouping item | Page builder / CM site context per the current docs; Edge effect disputed |

Patch shape:

```xml
<configuration xmlns:patch="http://www.sitecore.net/xmlconfig/">
  <sitecore><settings>
    <setting name="ExperienceEdge.EnableItemLanguageFallback" value="true" />
    <setting name="ExperienceEdge.EnableFieldLanguageFallback" value="false" />
  </settings></sitecore>
</configuration>
```

## Measured 2026-10-02 (environment without the patch, site flags false)

- de-DE → en rule set, `__Enable item fallback=1` on a page with no de-DE version: Edge preview `layout(language:"de-DE")` null; control page null; AGQL `fields(withLanguageFallback:true)` in de-DE: version 0, empty values.
- Dictionary entry without a de-DE version (template standard values have fallback on): Edge preview returns the **key** in de-DE.

## Publish semantics (documented)

- Fallback is resolved at publish time. Each fallback version must be published once before Edge serves it; afterwards publishing the source language republishes its dependants.
- Any change to a fallback setting requires republishing the affected items (in practice: a full republish).
- Without fallback, Edge returns null for a missing version; the Content SDK turns that into a 404.

## Doc conflict (C1)

- "enable-and-set-up-language-fallback": env patch only for headless; site flags affect Page builder only; "no way to enable language fallback for individual sites".
- "manage-languages-and-locales": fallback "at the environment and at the site level".
- Accelerate localization guidance: "always use the site settings (Site Grouping item)".

Working position: the env patch decides Edge. Unproven until a probe toggles one switch at a time (patch on / host flag on) and reads Edge preview and live.
