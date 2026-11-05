---
name: sitecoreai-site-template
description: "Builds SitecoreAI site templates for the Create Site dialog or page blueprints from a spec, or captures an existing site or page as one; smoke-tested live. Use for reusable sites or campaign pages. Not one-off sites or serialization design."
license: Apache-2.0
compatibility: "Node 20+. An automation client whose token can write items on the CM (Authoring GraphQL). The Edge preview check also needs Deploy API read access for the environment's preview context id."
metadata:
  author: Christian Hahn
  version: "0.4.0"
  proven_on: "2026-10-19, stock xmcloud-starter-js environment (Content SDK 2.4 starter, SXA headless scaffolding)"
---

# Site templates and page blueprints

A **site template** is one item of data template **Solution template** `{1B2DFD3B-F2F2-4F40-A75C-F6C2490919C4}`. The Create Site dialog lists every such item through Authoring GraphQL `solutionTemplates`, wherever it sits. It lists immediately: no deploy, publish or index rebuild.

A new site runs the setup root (`HeadlessSiteSetupRoot`) of every module in the template's `Site Modules`. Those setup roots hold `AddItem`, `ExecuteScript` and `PostSetupStep` actions. "Skatepark" is the built-in **Basic** template.

A **page blueprint** is a branch template in a collection's `Branches/Project/<collection>` folder. It is offered through insert options, so "Create a page" produces a prefilled page with `$name` expanded and page-local datasources. Ids and the scaffold order: `references/anatomy.md`.

## Decide first: site, blueprint or capture

| The requirement says | Build | Why |
|---|---|---|
| own hostname, own navigation or brand, separate microsite | **site template** (`build-template`) | Only a site has its own host, start item, header/footer and Edge site entry. Going live still needs a head-app rebuild (sites are discovered at build) and a host. |
| campaign / landing / event pages inside an existing site | **page blueprint** (`build-blueprint`) | Seconds for a marketer, no new site, host or deploy. |
| every new site of a template should offer such pages | blueprints **inside** the site template spec (`blueprints[]`) | Each new collection gets its own branch copies. |
| "save this site / this page as a template" | **capture** (`extract-spec`), then build | Round trip measured exact on Edge (components, placeholders, grid, styles, text). |

## Procedures

All scripts take `--cm-host <xmc-….sitecorecloud.io> --client-prefix <PREFIX> [--env-file <.env>]`. Secrets come only from `<PREFIX>_ID/_SECRET`.

**Site template**
1. Write the spec (`references/spec-format.md`, example `assets/example.spec.json`): page types, pages, components, partials, `renderingHost`, `thumbnail` (or `make-thumbnail.mjs --primary #hex --accent #hex`), optional `blueprints`.
2. `build-template.mjs --spec x.json --component-map <head-app>/.sitecore/component-map.ts --dry-run`.
   - The live lint checks that renderings exist and are registered in the head app, datasource and page field names, and the host. Fix the spec until it is clean.
   - Never hand-edit the generated PowerShell.
3. Run the same command without `--dry-run` to build.
4. `verify-template.mjs --spec x.json --smoke --environment-id <deploy env id>` creates a fresh collection and a site, then checks:
   - the scaffold **job exceptions**;
   - page types and component counts;
   - partials and the page-design mapping;
   - Home's insert options;
   - every blueprint, by creating a page from it;
   - the host;
   - Edge preview componentNames.

   It then cleans up: the site and collection this run created, nothing else. `--keep` keeps the site. `--site-name <name>` names the site and requires `--keep`, and a name that already exists is refused (exit 2), so an existing site is never removed. `--collection <name>` reuses an existing collection and requires `--keep`; it is refused otherwise, so a shared collection is never removed. Done = **VERIFIED**, plus one site created **through the dialog** by a human, checked in Page Builder.

**Page blueprint in an existing site**
1. Write the blueprint spec: `{ site, name, pageTemplate?, offerOn?, fields?, components }`.
2. `build-blueprint.mjs --spec bp.json --component-map … --smoke --environment-id …`. It lints, writes the branch, and offers it on the `offerOn` templates' standard values and on Home (Home overrides at item level). It then creates a test page, checks it including Edge, and deletes it.

**Capture an existing site or page**
1. `extract-spec.mjs --site <name> --out x.json --name "…"` gives a site-template spec. Add `--page "<path under Home>" [--target-site <s>]` to get a blueprint spec instead.
2. Read every `WARN`. Set `renderingHost` when the source binds to `Default`, add a thumbnail, then build and verify as above.
   - Ids that point into the source site (Styles, NavigationRoot, …) become `site:<relative path>` tokens. They resolve in the new site, and a missing one is logged and skipped.
   - The capture does not carry personalization, child rows under a datasource (add them by hand as `datasource.children`), or internal links into the source site; each is warned.

**Optional, durable:** `emit-module.mjs` writes a serialization module for `ser pull -i`; without it a template lives only in this CM. **Remove:** `remove-template.mjs`. It refuses while foreign items sit under the module roots, `Templates` or the script library's `Functions` (hand-made templates; --force overrides) and while sites carry the template's id in `SiteTemplate`, and reports a locked path instead of stopping.

## How generated scaffolds behave

- **Page types.** Module page types `/sitecore/templates/<Layer>/<module>/<Type>` inherit the five base templates of a collection `Page`. At site creation the script creates collection types of the same name that inherit the module type **and** the collection `Page`, which owns `Title` and `Content`. It throws if another template family already owns that type name in the collection, and never edits shared collection templates.
- **Pages** are created by the script at deterministic paths (`Test-Path` guards), not by `AddItem`.
- **Home insert options** are set at item level, because the skeleton's item-level `Base Page` would otherwise hide every page type.
- **Components:** `-FinalLayout` on pages and shared layout on partials. Datasources sit under `<owner>/Data` as `local:/Data/<name>`, and each rendering gets a `DynamicPlaceholderId`. A `Container` places its children in `/<ph>/container-<id>`, nested to any depth.
- **Variants:** a missing variant is created beside the rendering's `Default`. A custom rendering has no Headless Variants folder on a new site, so the folder is created too (template from a sibling folder; definition template from an existing definition), and `FieldNames` is the variant item id.
- **Datasource rows:** `datasource.children` creates child items (gallery frames, list rows, nested to any depth) in array order with explicit `__Sortorder`. `datasource.insertOptions` writes the datasource's `__Masters`, so authors can add rows in Pages. Pages, partials and blueprints take both. A failing child is collected like a failing component, and verify checks the child count and the `__Masters` read-back. Syntax: `references/spec-format.md`.
- **Dictionary and settings:** `dictionary[]` makes Dictionary entries and `settings{}` sets fields on `<site>/Settings` (e.g. `RobotsContent`). An unknown top-level spec key warns in the lint. **Failures:** each component is added inside try/catch, so one failure no longer drops the rest. Failures are collected and thrown once, so the job reports them.
- **Partials** become Partial Designs. A `Default` Page Design maps the collection `Page` and every type to them. The **host** is bound in a PostSetupStep, which logs when the host is missing.

## Traps (full list with evidence: `references/traps.md`)

0. **The dialog is a different runtime than the API.** A site created in the dialog from a script that passed template **paths** came out with pages but no components (`Spe.log`: NullReferenceException in `New-Item`). Generated scripts use template IDs and `master:` paths. Have a human create one site through the dialog before calling a template done.
1. **Scaffold failures are silent.** The job ends `FINISHED` and the dialog shows success; only `job.status.exceptions` has the error. Always smoke-verify.
2. **The collection decides page templates.** The starter's scripts rewrite the collection `Page` base. The dialog keeps one template family per collection, but `createSite` over the API does not.
3. **Home's item-level `__Masters`** (Base Page) overrides page-type insert options.
4. **The rendering host is a literal name with no existence check.** Sites from Basic bind to `Default`.
5. **Sites depend on template modules after creation:** renderings are referenced, page types are inherited. Deleting or un-deploying breaks the layout while the content survives.
6. **Site names are unique CM-wide.** `Enabled=0` shows greyed out. No thumbnail gives a skeleton card.
7. **Captured layouts** carry `?`-prefixed `s:par` (Basic), site-local Styles and NavigationRoot ids, and site-created variants (`Banner` on Image). The extractor and scaffold handle all of them.
8. **Edge preview lags creation by seconds.** In Git Bash, `/` arguments become Windows paths (`MSYS_NO_PATHCONV=1`).

## Scope

- Proven live: three templates (one written by hand, one captured from a stock Basic site plus a blueprint page) and blueprints both in templates and in an existing Basic site. Coverage includes two-deep containers, partials, custom text and date fields, thumbnails, host binding, Edge on every route, and an exact capture round trip.
- Not generated: column splitters, personalization, multi-language content, workflow, media copying across CMs. Custom renderings need an `availableRenderings` group and must exist in the head app.
- Starter templates as a worked example: `references/starter-ccl.md`.
