# Worked example: the starter's templates (SYNC, Alaris, Solterra & Co.)

`Sitecore/xmcloud-starter-js` ships them as one serialization module, `authoring/items/items/templates/ccl.module.json` ("click-click-launch", about 2,400 items, every include `CreateUpdateAndDelete`). Deploying the starter is what puts them in the dialog. Modelled on upstream `main@c0de3bc` (2026-10-09).

| Template | Id | Setup root | Site setup script | Host it binds | Example app |
|---|---|---|---|---|---|
| Solterra & Co. | `{6393776B-D724-49EB-8A3F-96AF12825810}` | Solterra and Co Setup | Site 1 Site Setup | kit-nextjs-article-starter | examples/kit-nextjs-article-starter |
| Alaris | `{DD0B78F3-6A05-4C09-991E-FB09D1B472D1}` | Alaris Setup | Site 2 Site Setup | kit-nextjs-location-starter | examples/kit-nextjs-location-finder |
| SYNC | `{72363216-6660-4AE7-B0A8-0991280AA5D9}` | SYNC Setup `{ADB64750-…}` | Site 3 Site Setup `{F067E471-…}` | kit-nextjs-product-starter | examples/kit-nextjs-product-listing |

Shape of one (SYNC Setup):
- `Dependencies` = 3 OOTB actions;
- ~8 AddItem actions (pages Speakers and Video, available renderings, enumerations, styles, partial designs), plus `Data Folders/*` and `Rendering Variants/*` AddItems (the engine walks all descendants);
- `Add Home Renderings` (ExecuteScript, `__Sortorder` 200) and `Post Setup Step` (PostSetupStep, 300).

A shared site root, `click-click-launch`, adds data folders and rendering variants for all three.

What the site setup script does: rewrites the collection `Page` base (see trap 1), creates collection page types via `Update-PageTemplate`, sets insert options, builds Page Designs (`Default`, `ProductPage`) + `TemplatesMapping`, links partial-design data, adds sample media, and (upstream since 2026-10) writes a default `llms.txt` into a field matched by name.

Result on a fresh environment: a 408-item site in about 30 s, with real `__Final Renderings` on every page. It renders only on a head app that registers the starter's component names (SYNC's app registers 53 of 55).

Use it as a reference for richer setups (enumerations, variants, sample media). Do not use it as a pattern for collection templates or host binding.
