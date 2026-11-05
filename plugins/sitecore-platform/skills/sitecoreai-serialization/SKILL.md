---
name: sitecoreai-serialization
description: "Designs Sitecore Content Serialization modules for SitecoreAI: sitecore.json, module includes, scope, push operations, module grain, deploy modes, and traps that delete items. Use when creating or changing a module. Not CLI login."
license: Apache-2.0
compatibility: "SitecoreAI with the Sitecore CLI Serialization plugin (CLI 4.0+ for roles and excludedFields). Run the repo-local CLI (`dotnet tool run sitecore`)."
metadata:
  author: Christian Hahn
  version: "0.2.1"
---

# Sitecore Content Serialization: module design

Serialization (SCS) is how developer-owned items (templates, renderings, placeholder settings, branches, the site shell) travel with the code. The CLI mechanics of reaching a tenant (login, connect, `user.json`, `allowWrite`, endpoint names) live in **`sitecoreai-cli-cloud-workflow`**. This skill is the layer above: **what a module contains, how it is cut, and how it is deployed**. Almost every failure here is silent or destructive: a default that deletes, a pull that writes the wrong tenant, a push that stops halfway and exits 0.

Schema tables, an annotated module and the `xmcloud.build.json` options: `references/module-json-reference.md`.

## The model in five lines

1. `sitecore.json` → `modules: [globs]` finds every `*.module.json`. `serialization.defaultModuleRelativeSerializationPath` sets where YAML lands when a module gives no `items.path`.
2. A module = `namespace` (unique) + `items.includes[]` (+ optional `references`, `roles`, `users`, `excludedFields`).
3. An include = `name` (it **is** the on-disk folder name) + `path` + `scope` + `allowedPushOperations` + `rules[]`.
4. Rules are **first-match-wins**, relative to the include path; finish a selective include with `{ "path": "*", "scope": "Ignored" }`.
5. **A content item may be included only once across all modules.**

## Defaults that hurt

| Property | Default | Why it hurts |
|---|---|---|
| `scope` | `ItemAndDescendants` | An include with no scope takes the whole subtree, including author content under it |
| `allowedPushOperations` | `CreateUpdateAndDelete` | A push deletes every item in scope that is not on disk, author-created items included |
| `items.path` | the shared default root | Sibling modules share one folder tree (§ Grain) |
| `-n` (environment) | `default` | Resolves to whatever endpoint the last login wrote, which can be another tenant |

Set `scope` and `allowedPushOperations` on **every** include explicitly, and treat a missing one as a review finding.

## Choose the site strategy first: shell or full record

Decide this once per collection; it changes every site include.

| Strategy | Site include | When |
|---|---|---|
| **Full record** (default here) | `ItemAndDescendants`, `CreateAndUpdate`, **no** `"*"` → Ignored | git must be able to rebuild a tenant or move an estate; content is pulled after authoring |
| **Shell only** (Sitecore's Accelerate sample) | selected children, `/Home` SingleItem CreateOnly, `"*"` → Ignored | authors own all pages and git never holds them |

The shell shape fails quietly when someone expects a record: a site seeded from it serialized the home item and **none of its pages**, and every subtree an author added later was dropped without a word. Under the full record, add rules only to **change a push policy** for a subtree, never to opt a subtree in.

## Push policy by item class

| Item class | Push | Why |
|---|---|---|
| Templates, branches, renderings, placeholder settings, `/sitecore/system/Settings/Project/<C>` | CreateUpdateAndDelete | Developer-owned: removals must propagate |
| Site `/Presentation` (page and partial designs, headless variants) | CreateUpdateAndDelete | Structure the code depends on |
| Tenant root `/sitecore/content/<C>` | CreateAndUpdate, **SingleItem** | The container only, never its sites |
| Pages, datasources, dictionary, media | **CreateAndUpdate** | A push must never delete an authored item |
| `/Settings/Site Grouping` (hostnames, robots) | **CreateOnly** | Environment-coupled: lands once on a fresh target, never overwritten |

**Never serialize:**
- **A Rendering Host item.** Its fields are absolute editing-host URLs for one tenant. `CreateOnly` does not save you: a fresh tenant still gets the item with dead URLs and the push then refuses to fix it (2026-08-13). Bind the host per environment through the Site Grouping `RenderingHost` field (a host name).
- **Auto-captured thumbnails.** The platform writes a media item per page and site thumbnail under `<site media>/System/…`; with media at ItemAndDescendants every pull committed them as base64 blobs (632 files, ~14 MB across six sites, 2026-09-28). Cap that folder with a rule at `ItemAndChildren`.
- Individual media items as IAR (Sitecore: performance; ship media through `scsModules`), personalization variants and A/B tests (tenant state), Edge or cache state, and anything under `/sitecore/system` you did not create. Sitecore's guidance: serialize only under `*/Project/*`.

**Include order matters:** a template include must come before content that uses it in the same module; use `references` for templates in another module. An annotated module: `references/module-json-reference.md`.

## Grain: one module per site collection

On a CM that hosts several collections:
- **One module per COLLECTION.** A new site in an existing collection gets a new *site include* in that collection's module, never a second module. A second module would claim the collection's template and rendering paths with `CreateUpdateAndDelete`, which is exactly the collision.
- **Give every module its own folder.** Put `<x>.module.json` in its own directory and set `items.path: "."`. A distinct `items.path` alone is not enough: the items-as-resources build groups modules by **where the manifest sits**, and fails on two manifests in one folder sharing an include name (*"There are several modules … with the same include name … split those modules into folders"*), after MSBuild reported `0 Error(s)`. In one measured CM, 9 of 15 conventional include names collided across 6 modules.
- **Without isolation, validate turns destructive.** Two modules sharing the default root made `ser validate` list the other collection's files as *"EXTRA ITEM … > Fix will delete file"*, and `ser pull` aborted. One `--fix` would have deleted another site's source.
- **Include names must be unique within a module** (`site`, `site-b`, …). Unique across modules is better still: an **unscoped** op on a CM with shared include names fails at config load.

## Operating discipline

- **Every op is scoped and targeted: `-i "<Module.Namespace>" -n <endpoint>`.** Never run unscoped `ser pull`, `ser validate --fix` or `--force` on a shared repo. An unscoped pull from the wrong default endpoint applied 26 changes from another tenant and reported success (2026-09-26).
- **Predict, then verify by count.** Before a pull or push, write down what you expect to change. `--what-if` first, then explain every `[D]` line before the real run.
- **Live tenant first, then pull.** Write through the authoring API or MCP, then `ser pull` the module, then commit. Do not hand-edit YAML and push it.
- **Pull after the last live write of a unit of work**, then run your schema audit before committing. The audit should parse the serialized templates and renderings for broken bases, missing fields and dangling references, and must fail when it finds zero modules: a flat directory scan that finds none after a folder move passes on an empty set.
- **"0 changes" is not "in sync".** Pull compares by revision; the signature ignores `__Revision`, `__Updated`, `__Owner` and `__Lock`, so a value write that does not bump the revision is invisible. Grep the YAML for the value you just wrote.
- **`ser validate` (read-only) before every commit; `--fix` only after you have read the delete list.** `--fix` deletes local files: it keeps the newest of a duplicate id and drops whole trees it considers not included.
- **After an item's path changes on the tenant (a site or media-folder rename), the include's `.scindex` still maps the old paths.** `ser pull` then reports an item "on disk in more than one place", and `validate --fix` and `pull` undo each other on every run. Move that include's folders and its `.scindex` aside (a move, not a delete) and pull it fresh; a second pull must report 0 changes (measured 2026-10-28).

## Deploy: IAR or database

| Mechanism | `xmcloud.build.json` | Effect |
|---|---|---|
| Items as resources | `deployItems.modules` (omitted = **every** module) | YAML → `.dat` at deploy; read-only, merged at runtime |
| Database push | `postActions.actions.scsModules.modules` | A push into the DB after every deploy, with each include's push policy |

- **An edited IAR item becomes a DB copy that wins forever.** Thumbnail generation does it too. Later git changes to that item never apply, and a rebuild does not clear it. Measure overlays by `__Revision` and by value; a value-only compare missed 9 of 11.
- **`ser push` skips IAR-only items** (90 of 1,026 written in one module). Turning IAR off before materializing them makes them disappear.
- **Removing files only drops the resource copy.** An item that an earlier `ser push` also wrote to the database survives the deployment that drops its YAML: three removed schema folders still listed on the CM afterwards. A scoped `ser push` of the module removes them where the include is `CreateUpdateAndDelete`; its `--what-if` must list exactly the removed subtree roots (measured 2026-10-28). Content includes are `CreateAndUpdate`, so a site goes through the Sites API delete instead.
- **`scsModules` with `CreateUpdateAndDelete` deletes CM-authored dev items** that were never pulled, on every deploy. On a developer CM, prefer manual scoped pushes.
- **Roles do not deploy as IAR**; use `scsModules`. A role or user `pattern` pushed before a pull deletes the matching items on the tenant, because orphans are removed.
- **First deploy of a fresh CM:** a module whose paths do not exist yet fails the build (`source item path … did not exist`). Disable it for the first deploy, create the site, then enable it and pull.

The full push-into-an-IAR-CM procedure (`NonUniquePathException` recovery, the `--trace` blob truncation, the reconciliation of what-if results) is the serialization-overlays reference of `sitecoreai-cli-cloud-workflow`; moving a site to another tenant is its estate-move reference.

## Push failures that look like success

- **A missing template aborts the rest of the push and exits 0.** `Template ID <guid> did not exist` stops at that item; everything after it in tree order is stranded. `continueOnItemFailure: true` does not help. Usual culprit: an empty, unreferenced SXA `<site>/Data/Datasource Content Resolver` item whose base template ships with a foundation the target lacks. Delete it from disk (keep the Headless Variant of the same name), or serialize and push the missing template first. Verify with a second what-if that reports 0.
- **`NonUniquePathException` aborts push and pull** before any evaluation when a DB-only item sits at a git item's path (a generated site thumbnail, a duplicate folder). Recovery order: the overlays reference.
- **Duplicate sibling names** are unsupported by the CLI even under ignored nodes.

## Review checklist for a module change

- [ ] Every include has explicit `scope` and `allowedPushOperations`; nothing authored is `CreateUpdateAndDelete`
- [ ] The site strategy (full record or shell) is deliberate; rules ordered most specific first, none wider than its include
- [ ] No Rendering Host item; the auto-thumbnail folder is capped
- [ ] Module sits in its own folder with `items.path: "."` and a correct `$schema` path; include names unique
- [ ] No path is included by two modules (`ser explain -p <path>` answers which module owns it)
- [ ] `ser info -i <module>` lists the expected subtrees; `ser validate -i <module>` reports no errors
- [ ] The scoped pull applied the predicted count; the YAML contains the values just written
- [ ] The build config's `deployItems` / `scsModules` choice is deliberate for this environment

## Related

- `sitecoreai-cli-cloud-workflow`: login, connect, endpoints, push procedure, overlays, estate move
- `content-sdk-website-build-flow`: when in a build the pulls happen
- `content-sdk-create-component`, `content-sdk-list-component`: the items a module must then carry
- Docs: [SCS configuration reference](https://doc.sitecore.com/sai/en/developers/sitecoreai/sitecore-content-serialization/configuration/sitecore-content-serialization-configuration-reference.html) · [Set up SCS](https://doc.sitecore.com/sai/en/developers/sitecoreai/sitecore-content-serialization/set-up-content-serialization.html) · [Build configuration](https://doc.sitecore.com/sai/en/developers/sitecoreai/deploying-sitecoreai/the-sitecoreai-build-configuration.html) · [Items as resources](https://doc.sitecore.com/sai/en/developers/sitecoreai/development/using-items-as-resources.html)
