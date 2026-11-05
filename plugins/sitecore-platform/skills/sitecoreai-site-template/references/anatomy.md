# Anatomy of a site template

Measured on a stock xmcloud-starter-js environment and on two production CMs (2026-10-19). All ids are base-image ids, identical across tenants.

## The items

```
Solution template item                    template {1B2DFD3B-F2F2-4F40-A75C-F6C2490919C4}; item GUID = createSite templateId
  Name, Description, Content (versioned)  dialog title, card subtitle, JSON [{name, content}] → contents{key value}
  Site Modules   {C262443B-…}             Treelist of HeadlessSiteSetupRoot ids run for a NEW SITE
  Tenant Modules {41AC536A-…}             … run when the dialog creates a NEW COLLECTION with this template
  Enabled, Built-in template              Standard Values: Enabled=1, Built-in empty → custom templates are "Custom"
  __Thumbnail, __Sortorder                card image (any media item); dialog order, ascending

<Name> Setup                              HeadlessSiteSetupRoot {BED31D6F-D968-45A9-B54E-12D7F977D861}
  Name (versioned), Dependencies          Dependencies = ids of ACTIONS (not roots) that must run first
  IsSystemModule, IncludeByDefault        leave empty for a template's own root
  <action> AddItem        {3AEA335C-D06D-45B1-841A-CBC8D2D1CE40}  Location (item whose TEMPLATE picks the target), Template (branch), Name
  <action> ExecuteScript  {BC9BB684-36DF-4285-888B-D8B4D87B10DE}  Script = PowerShell Script item id; __Sortorder orders actions
  <action> PostSetupStep  {8FF2FEBF-F6D2-461D-9ED3-8B0CB5D9D86F}  Script; runs after ALL modules' actions

PowerShell Script Module {6D82FCD8-…} / Library "Functions" {AB154D3D-…} / Script {DD22F1B3-…} (field "Script")
```

Discovery: `solutionTemplates` returns every item of the Solution template data template. In a Templates folder, another folder or a module root, all list. A bare item with only `Name` lists. Placement convention: `/sitecore/system/Settings/<Layer>/<module>/Templates/<Name>`.

Dialog contract (Authoring GraphQL): `solutionTemplates{id name description enabled builtInTemplate createdBy updated thumbnailUrl imageBase64 contents{key value} siteCollection{name}}`. Tabs All / Custom (builtIn=false) / Prebuilt / Favorites. `enabled:false` renders greyed out.

## Built-ins on every CM

| Template | Id | Site / Tenant modules | Notes |
|---|---|---|---|
| Empty ("Start from scratch") | `{2867D289-8951-458A-AF19-CE93A67BB494}` | 15 / 11 | `__Sortorder` 0, no thumbnail |
| Basic ("Skatepark" card) | `{5AAE1EEA-EA24-40BF-96F1-1F43DA82C77B}` | 16 / 11 | thumbnail `Feature/JSS Experience Accelerator/Basic Site/template-thumbnail` (alt "Skate Partk") |

Empty's 15 Site Modules are exactly the OOTB site roots with `IncludeByDefault=1`. A custom template = Empty's 15 + its own root, with Empty's 11 Tenant Modules. Basic Site Setup's Dependencies (read them live, don't hard-code) make the own root run after headless variants, the Media and Page Content renderings, and styles.

## createSite → scaffold (SPE `New-JSSSite`)

`createSite(input:{siteName templateId collectionId language hostName})` returns `{job{handle}}`. Poll `job(input:{handle}){done status{jobState exceptions messages}}`. A plain site takes about 20–30 s.

1. Skeleton from the `JSS Site` branch: Home (Base Page), Media, Data, Dictionary, Presentation (Page/Partial Designs, Headless Variants, Available Renderings, Styles), Settings/Site Grouping/`<site>`.
2. `Set-TenantTemplate`: each created item moves to the collection template that derives from its template (`Base Page` → collection `Page`, or whatever derived type the collection already has).
3. Every module's actions run in dependency order. AddItem uses `Location`'s template to find the target, skips when a child with the same Name AND template exists, and replaces `$name` in the branch with the action Name.
4. The Site Grouping item is written (`RenderingHost = "Default"`, StartItem = Home). The root gets `Modules` and `SiteTemplate` = the template id (persisted; read it back to find a site's template).
5. PostSetupSteps run. Exceptions from any script land in `job.status.exceptions`, and the job still ends `FINISHED`.

`createSiteCollection(input:{name})` runs the Empty tenant modules. They create `/sitecore/templates/Project/<collection>/{Page, Headless Site, …}`, and the collection's `Page` owns the `Title` and `Content` fields.

## Head-app binding

The Site Grouping `RenderingHost` is a **name**: a Rendering Host item under `/sitecore/system/Settings/Services/Rendering Hosts` (= the `xmcloud.build.json` `renderingHosts` key). Deploy creates one per editing host, and a `Default` exists too. Component `componentName`s must be registered in that head app's component map (`.sitecore/component-map.ts`).

## Mutations used

`createItem` / `updateItem` / `deleteItem(permanently)` · `uploadMedia` → presigned multipart POST (returns `Id`) · `createSiteCollection` / `createSite` / `removeSite` / `removeSiteCollection` · query `itemTemplate(where:{templateId}){fields}` (includes inherited fields; the `path` form fails for Feature templates).

## Page blueprints

A branch template (`{35E75C72-4985-4E09-88C3-0EAC6CD1E64F}`) in `/sitecore/templates/Branches/Project/<collection>/`. The folder (`Branches Folder` `{2F5F8343-…}`) is created with the collection and deleted with it. The branch holds:
- `$name`: the page, with the collection page template, `Title = $name` and `__Final Renderings` that uses `local:/Data/<x>` datasources;
- `$name/Data` (`Page Data`) with the datasource items.

It is offered by adding the branch id to `__Masters` on the standard values of the page templates it should appear under, and on Home's item-level `__Masters`. Creating a page = `createItem(templateId: <branch id>, parent: <page>)`: every `$name` token (fields and datasources) becomes the page name. The rendering `uid`s are shared by every page from one branch, which is normal.
