# Module schema, an annotated module, and the deploy options

Verified against the SitecoreAI docs on 2026-10-13 unless marked *(measured)* or *(unverified)*.

## `sitecore.json` (project file)

| Key | Meaning |
|---|---|
| `modules` | Globs that find `*.module.json`, e.g. `["authoring/items/*/*.module.json"]`. A glob that misses a module drops it silently from every op |
| `plugins` | `Sitecore.DevEx.Extensibility.*` pins. They move together with the CLI version in `.config/dotnet-tools.json`, never one at a time |
| `serialization.defaultModuleRelativeSerializationPath` | Where YAML lands for a module with no `items.path` (docs default `serialization`, relative to the module file) |
| `serialization.defaultMaxRelativeItemPathLength` | Path-length guard (docs example 120) |
| `serialization.excludedFields` | `[{ fieldId, description }]` excluded from sync for every module |
| `serialization.continueOnItemFailure` | Does **not** rescue a missing-template create failure *(measured)* |
| `removeOrphansForUsers` | Remove users that match a predicate but are not serialized |

## `*.module.json`

| Key | Required | Meaning |
|---|---|---|
| `namespace` | yes | Unique module id; what `-i` and `deployItems` / `scsModules` name |
| `references` | no | Modules to deserialize first (wildcards allowed, e.g. `Foundation.*`) |
| `items.path` | no | Serialization root for this module, relative to the manifest. Use `"."` with one manifest per folder |
| `items.includes[]` | no | The subtrees (below) |
| `items.excludedFields` | no | Excluded fields for this module only |
| `roles[]`, `users[]` | no | `{ domain, pattern }` predicates (regex). Orphans that match are **deleted** on push |

### Include

| Property | Required | Values | Default |
|---|---|---|---|
| `name` | yes | string; also the on-disk folder name | — |
| `path` | yes | item path (`core:` prefix for another DB in `ser info` output) | — |
| `scope` | no | SingleItem, ItemAndChildren, ItemAndDescendants, DescendantsOnly | **ItemAndDescendants** |
| `database` | no | master | master |
| `maxRelativePathLength` | no | number | 130 |
| `allowedPushOperations` | no | CreateOnly, CreateAndUpdate, CreateUpdateAndDelete | **CreateUpdateAndDelete** |
| `rules[]` | no | below | — |

`Ignored` is valid **only in rules**, not as an include scope.

### Rule

| Property | Required | Values |
|---|---|---|
| `path` | yes | relative to the include path; `"*"` = everything not matched yet |
| `scope` | yes | Ignored, SingleItem, ItemAndChildren, ItemAndDescendants |
| `alias` | no | replaces the include `name` (folder) for this rule; ignored when scope is Ignored |
| `allowedPushOperations` | no | inherits from the include |

First match wins. Put the most specific rule first, never let a rule be wider than its include's scope, and remember that a parent path's rule overrides its children's.

### Push operations

| On disk? | In the CM? | CreateOnly | CreateAndUpdate | CreateUpdateAndDelete |
|---|---|---|---|---|
| yes | no | create | create | create |
| yes | yes | ignore | update | update |
| no | yes | ignore | ignore | **delete** |

## An annotated collection module (full-record strategy)

One file per site collection, in its own folder (`authoring/items/<collection>/<collection>.module.json`). Placeholders in `<>`. JSON has no comments: real modules carry their reasons in `"//…"` keys, which the CLI ignores.

```json
{
  "//push-policy": "Dev items CreateUpdateAndDelete; content and media CreateAndUpdate; Site Grouping CreateOnly.",
  "//no-rendering-host": "Never include a Rendering Host item: tenant-specific URLs.",
  "$schema": "../../../.sitecore/schemas/ModuleFile.schema.json",
  "namespace": "Project.<Collection>",
  "items": {
    "path": ".",
    "includes": [
      { "name": "<c>-module",       "path": "/sitecore/system/Settings/Project/<Collection>",             "scope": "ItemAndDescendants", "allowedPushOperations": "CreateUpdateAndDelete" },
      { "name": "<c>-templates",    "path": "/sitecore/templates/Project/<Collection>",                   "scope": "ItemAndDescendants", "allowedPushOperations": "CreateUpdateAndDelete" },
      { "name": "<c>-branches",     "path": "/sitecore/templates/Branches/Project/<Collection>",          "scope": "ItemAndDescendants", "allowedPushOperations": "CreateUpdateAndDelete" },
      { "name": "<c>-renderings",   "path": "/sitecore/Layout/Renderings/Project/<Collection>",           "scope": "ItemAndDescendants", "allowedPushOperations": "CreateUpdateAndDelete" },
      { "name": "<c>-placeholders", "path": "/sitecore/Layout/Placeholder Settings/Project/<Collection>", "scope": "ItemAndDescendants", "allowedPushOperations": "CreateUpdateAndDelete" },
      { "name": "<c>-media", "path": "/sitecore/Media Library/Project/<Collection>", "scope": "ItemAndDescendants", "allowedPushOperations": "CreateAndUpdate",
        "rules": [ { "path": "/<site-a>/System", "scope": "ItemAndChildren" } ] },
      { "name": "<c>-tenant", "path": "/sitecore/content/<Collection>", "scope": "SingleItem", "allowedPushOperations": "CreateAndUpdate" },
      { "name": "<c>-site-a", "path": "/sitecore/content/<Collection>/<site-a>", "scope": "ItemAndDescendants", "allowedPushOperations": "CreateAndUpdate",
        "rules": [
          { "path": "/Presentation",           "scope": "ItemAndDescendants", "allowedPushOperations": "CreateUpdateAndDelete" },
          { "path": "/Settings/Site Grouping", "scope": "ItemAndDescendants", "allowedPushOperations": "CreateOnly" }
        ] }
    ]
  }
}
```

- `"items.path": "."` with the manifest in its own folder: YAML lands next to the manifest and no sibling module shares the root or the include-name folders.
- The `/System` rule caps auto-captured thumbnails at `ItemAndChildren`, so a dashboard thumbnail set on purpose stays and the per-page captures do not.
- A second site in the collection adds one more `"<c>-site-b"` include (and its media rule), never a second module.
- Paths no rule matches fall back to the include, so a subtree an author adds later is serialized by default.

**Shell-only variant** (Sitecore's Accelerate `template.module.json`): the site include lists `/Home` SingleItem CreateOnly, `/Media` SingleItem, `/Data` and `/Settings` ItemAndChildren, `/Dictionary` CreateOnly, `/Presentation` CreateUpdateAndDelete, `/Settings/Site Grouping` CreateOnly, then `{ "path": "*", "scope": "Ignored" }`. Use it only when git must never hold pages.

## `xmcloud.build.json` options that touch serialization

| Key | Effect |
|---|---|
| `deployItems.modules` | Modules converted to items as resources (`.dat`) at deploy. **Omitted = every module in `sitecore.json`.** Roles not supported |
| `postActions.actions.scsModules.modules` | Modules pushed into the DB after the deploy stage, with each include's push policy |
| `postActions.actions.publish` | Runs after `scsModules` (actions run in file order; keep the documented order) |
| `authoringPath` | Keeps an authoring change from redeploying the editing host and vice versa |

IAR items cannot be deleted in the CM: remove the `.yml` and redeploy. Deleting a DB override returns the item to its resource state.

## CLI subcommands for module work

| Command | Use |
|---|---|
| `ser info -i <module> [-t]` | Subtrees, roles and users a module resolves to |
| `ser explain` | Says whether a path is included and why: `-p <path>`, `-d <database>` (default master), `-c <sitecore.json dir>`, `-v` *(measured: CLI help, 2026-10-13)* |
| `ser validate -i <module>` | Read-only checks: invalid path, orphaned parent, non-included item, empty folder, duplicate id, non-unique path |
| `ser validate --fix` | **Deletes local files**: keeps the newest of a duplicate id |
| `ser pull -i <m> -n <env> [-w]` | `-w` = what-if; `--force` (`-fr`) skips failing items with a warning; `--use-debug-signatures` diagnoses hash mismatches |
| `ser push -i <m> -n <env> -w` | What-if before every real push |
| `ser diff -s <a> -d <b> [-i <m>]` | Compares two instances (both logged in); `--push` applies the differences |
| `itemres` | Is an item overridden? Return it to its resource state |

Docs: [CLI serialization command](https://doc.sitecore.com/sai/en/developers/sitecoreai/sitecore-command-line-interface/sitecore-cli-command-reference/the-cli-serialization-command.html) · [Create a module](https://doc.sitecore.com/sai/en/developers/sitecoreai/sitecore-content-serialization/create-a-sitecore-content-serialization-module.html) · [Excluded fields](https://doc.sitecore.com/sai/en/developers/sitecoreai/sitecore-content-serialization/configuration/excluded-fields.html) · [Roles](https://doc.sitecore.com/sai/en/developers/sitecoreai/sitecore-content-serialization/serializing-roles-and-users/configure-role-serialization.html) · [Accelerate: template.module.json](https://developers.sitecore.com/learn/accelerate/sitecoreai/appendix-ii/example-code/template-module-json)
