// Emits the two SPE scripts a template's Setup root runs at site creation. Pure: spec + resolved ids in, PowerShell text out.
// Site setup (ExecuteScript, Invoke-ModuleScriptBody) and rendering-host binding (PostSetupStep, Invoke-Step).
import { createHash } from 'node:crypto';
import { CONTAINER, DICT_NAME_INVALID } from './spec.mjs';
import { buildLayoutXml } from './layout.mjs';
import { isGuid, braced } from './children.mjs';

/** Deterministic braced GUID from a seed (stable rendering uids inside generated blueprints). */
export const seededGuid = seed => { const h = createHash('md5').update(seed).digest('hex'); return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}}`.toUpperCase(); };

export const IDS = {
  template: '{AB86861A-6030-46C5-B394-E8F99E8B87DB}',
  pageData: '{1C82E550-EBCD-4E5D-8ABD-D50D0809541E}',
  partialDesign: '{FD2059FD-6043-4DFE-8C04-E2437CE87634}',
  pageDesign: '{1105B8F8-1E00-426B-BF1F-C840742D827B}',
  gridDefault: '{7465D855-992E-4DC2-9855-A03250DFA74B}',
  branch: '{35E75C72-4985-4E09-88C3-0EAC6CD1E64F}',
};

// PowerShell ends a '...' literal at ANY of U+0027 U+2018 U+2019 U+201A U+201B and a doubled one is the escape, so double all five.
export const psq = s => `'${String(s).replace(/['‘’‚‛]/g, m => m + m)}'`;
// Inside "..." PowerShell interpolates $ and `, and ends the string at " or a curly double quote; a backtick makes each one literal.
export const psdq = s => String(s).replace(/[`$"\u201C\u201D\u201E]/g, m => '`' + m);
// A value written into a # comment must not carry a line break out of it.
const oneLine = s => String(s).split(/[\r\n]+/).join(' ');
const psHash = obj => `@{ ${Object.entries(obj).map(([k, v]) => `${psq(k)} = ${psq(v)}`).join('; ')} }`;
// A template reference (path or id) in children/insertOptions becomes the id the lint resolved; scripts never see paths (trap 0).
const tplRef = (resolved, ref) => {
  if (isGuid(ref)) return braced(ref);
  const id = resolved.templateIds?.[ref];
  if (!id) throw new Error(`no template id resolved for ${ref}`);
  return id;
};
const psChildren = (list, resolved) => `@(${(list || []).map(ch => `@{ 'Name' = ${psq(ch.name)}; 'Template' = ${psq(tplRef(resolved, ch.template))}; 'Fields' = ${psHash(ch.fields)}; 'Children' = ${psChildren(ch.children, resolved)} }`).join(', ')})`;
const psMasters = (ds, resolved) => `@(${(ds.insertOptions || []).map(r => psq(tplRef(resolved, r))).join(', ')})`;
const hasExtras = ds => !!(ds.children?.length || ds.insertOptions?.length);
const pageVar = path => `$pages[${psq(path)}]`;

const HELPERS = String.raw`
        function Ensure-PageType([string]$name, [string]$moduleTemplateId, [string]$icon) {
            $path = "$templatesRoot/$name"
            if (Test-Path -Path $path) {
                $t = Get-Item -Path $path
                if ($t."__Base template" -notlike "*$moduleTemplateId*") {
                    throw "Collection '$($collection.Name)' already has a page type '$name' from another site template. Create this site in a new collection."
                }
                return $t
            }
            $t = New-Item -Path $templatesRoot -Name $name -ItemType '__TEMPLATE__'
            $sv = New-Item -Parent $t -Name '__Standard Values' -ItemType $t.ID
            $t.Editing.BeginEdit()
            # Inherit the module type AND the collection's own Page (which owns Title + Content).
            $t["__Base template"] = "$moduleTemplateId|$((Get-Item -Path "$templatesRoot/Page").ID)"
            $t["__Standard values"] = $sv.ID.ToString()
            if ($icon) { $t["__Icon"] = $icon }
            $t.Editing.EndEdit() | Out-Null
            Get-Item -Path "master:" -ID $t.ID
        }
        function Set-Masters($item, [string[]]$ids) {
            $target = $item
            if ($item.TemplateID -eq [Sitecore.TemplateIDs]::Template) { $target = $item.Children['__Standard Values'] }
            $target.Editing.BeginEdit()
            $target["__Masters"] = ($ids -join '|')
            $target.Editing.EndEdit() | Out-Null
        }
        function Set-Fields($item, [hashtable]$values) {
            $item.Fields.ReadAll()
            foreach ($k in $values.Keys) {
                if ($null -eq $item.Fields[$k]) { throw "Field '$k' does not exist on $($item.Paths.Path) [$($item.TemplateName)]" }
            }
            $item.Editing.BeginEdit()
            foreach ($k in $values.Keys) { $item[$k] = $values[$k] }
            $item.Editing.EndEdit() | Out-Null
        }
        function Ensure-Child($parent, [string]$name, [string]$type) {
            $path = "master:$($parent.Paths.FullPath)/$name"
            if (Test-Path -Path $path) { return Get-Item -Path $path -Language $lang }
            New-Item -Path "master:$($parent.Paths.FullPath)" -Name $name -ItemType $type -Language $lang
        }
        function Ensure-Page($parent, [string]$name, $type) {
            $page = Ensure-Child $parent $name $type.ID.ToString()
            Ensure-Child $page 'Data' '__PAGEDATA__' | Out-Null
            $page
        }
        # Child rows under a datasource (list items, gallery frames). A failing child is collected, not thrown: the rest still lands.
        function Ensure-Children($parent, [object[]]$children) {
            foreach ($ch in $children) {
                try {
                    $item = Ensure-Child $parent $ch.Name $ch.Template
                    Set-Fields $item $ch.Fields
                    if ($ch.Children.Count -gt 0) { Ensure-Children $item $ch.Children | Out-Null }
                } catch {
                    [void]$failures.Add("$($parent.Paths.Path)/$($ch.Name): $($_.Exception.Message)")
                }
            }
        }
        function Ensure-Datasource($owner, [string]$name, [string]$templatePath, [hashtable]$values, [object[]]$children = @(), [string[]]$masters = @()) {
            $data = Ensure-Child $owner 'Data' '__PAGEDATA__'
            $ds = Ensure-Child $data $name $templatePath
            if ($values.Count -gt 0) { Set-Fields $ds $values }
            if ($masters.Count -gt 0) { Set-Masters $ds $masters }
            if ($children.Count -gt 0) { Ensure-Children $ds $children | Out-Null }
            "local:/Data/$name"
        }
        # site:<path relative to the site root> tokens (captured Styles, NavigationRoot …) resolve to this site's item ids.
        function Resolve-SiteRefs([string]$value) {
            $ids = foreach ($part in ($value -split '\|')) {
                if ($part -like 'site:*') {
                    $target = "$sitePath/$($part.Substring(5))"
                    if (Test-Path -Path $target) { (Get-Item -Path $target).ID.ToString() } else { Write-Log "Skipped missing $target" -Log "WARN" }
                } else { $part }
            }
            ($ids | Where-Object { $_ }) -join '|'
        }
        $dynIds = @{}
        $failures = New-Object System.Collections.ArrayList
        # A variant is a named item beside the rendering's Default variant; create it when the site does not have it yet.
        function Ensure-Variant($rendering, [string]$variant) {
            $root = "$sitePath/Presentation/Headless Variants"
            $folder = "$root/$($rendering.Name)"
            if (-not (Test-Path -Path $folder)) {
                # Only the OOTB renderings ship a variants folder; a custom rendering's folder is created beside them (same folder template).
                $anyFolder = Get-ChildItem -Path $root | Select-Object -First 1
                if (-not $anyFolder) { throw "no Headless Variants content under $root; cannot create the variants folder for $($rendering.Name)" }
                Write-Log "Created variants folder '$($rendering.Name)'" -Log "INFO"
                New-Item -Path $root -Name $rendering.Name -ItemType $anyFolder.TemplateID.ToString() -Language $lang | Out-Null
            }
            $existing = Get-ChildItem -Path $folder | Where-Object { $_.Name -eq $variant } | Select-Object -First 1
            if ($existing) { return $existing }
            $sibling = Get-ChildItem -Path $folder | Select-Object -First 1
            if (-not $sibling) {
                foreach ($f in (Get-ChildItem -Path $root)) { $sibling = Get-ChildItem -Path "master:$($f.Paths.FullPath)" | Select-Object -First 1; if ($sibling) { break } }
            }
            if (-not $sibling) { throw "no existing Variant Definition to take the template from; cannot create variant '$variant'" }
            Write-Log "Created variant '$variant' of $($rendering.Name)" -Log "INFO"
            New-Item -Path $folder -Name $variant -ItemType $sibling.TemplateID.ToString() -Language $lang
        }
        # One failing component must not drop the rest: failures are collected and raised once at the end.
        function Add-Component($owner, [string]$renderingPath, [string]$placeholder, [string]$datasource, [string]$variant, [hashtable]$params, [bool]$shared) {
            $key = $owner.ID.ToString()
            $dynIds[$key] = 1 + [int]$dynIds[$key]
            try {
                $rendering = Get-Item -Path $renderingPath
                $p = @{ 'GridParameters' = '__GRID__'; 'DynamicPlaceholderId' = "$($dynIds[$key])" }
                foreach ($k in $params.Keys) { $p[$k] = Resolve-SiteRefs $params[$k] }
                if ($variant) { $p['FieldNames'] = (Ensure-Variant $rendering $variant).ID.ToString() }
                $splat = @{ Item = $owner; PlaceHolder = $placeholder; Instance = ($rendering | New-Rendering); Parameter = $p }
                if ($datasource) { $splat['DataSource'] = $datasource }
                if ($shared) { Add-Rendering @splat | Out-Null } else { Add-Rendering @splat -FinalLayout | Out-Null }
            } catch {
                [void]$failures.Add("$($owner.Paths.Path) $($renderingPath): $($_.Exception.Message)")
            }
            $dynIds[$key]
        }
`.replace(/__TEMPLATE__/g, IDS.template).replace(/__PAGEDATA__/g, IDS.pageData).replace(/__GRID__/g, IDS.gridDefault);

/** Emit Add-Component calls. A Container with children captures its dynamic id in $dynN and its children
 *  go to "<container placeholder>/container-$dynN" (the SXA dynamic-placeholder key). */
function emitComponents(lines, ownerExpr, components, resolved, shared, indent, depth = 1, phExpr = null) {
  for (const c of components) {
    const ph = phExpr ?? psq(c.placeholder);
    let ds = "''";
    if (typeof c.datasource === 'string') ds = psq(c.datasource);
    else if (c.datasource) {
      const tpl = c.datasourceTemplatePath || resolved.datasourceTemplates[c.renderingPath];
      if (!tpl) throw new Error(`no datasource template resolved for ${c.renderingPath}`);
      const extra = hasExtras(c.datasource) ? ` ${psChildren(c.datasource.children, resolved)} ${psMasters(c.datasource, resolved)}` : '';
      ds = `(Ensure-Datasource ${ownerExpr} ${psq(c.datasource.name)} ${psq(tpl)} ${psHash(c.datasource.fields)}${extra})`;
    }
    const call = `Add-Component ${ownerExpr} ${psq('master:' + c.renderingPath)} ${ph} ${ds} ${psq(c.variant || '')} ${psHash(c.params)} $${shared}`;
    if (c.renderingPath === CONTAINER && c.children?.length) {
      lines.push(`${indent}$dyn${depth} = ${call}`);
      const base = phExpr ? phExpr.slice(1, -1) : psdq('/' + c.placeholder.replace(/^\//, ''));
      emitComponents(lines, ownerExpr, c.children, resolved, shared, indent, depth + 1, `"${base}/container-$dyn${depth}"`);
    } else lines.push(`${indent}${call} | Out-Null`);
  }
}

export function emitSiteSetup(spec, resolved) {
  const L = [];
  const I = '        ';
  L.push('function Invoke-ModuleScriptBody {', '    [CmdletBinding()]', '    param(',
    '        [Parameter(Mandatory = $true, Position = 0)]', '        [Item]$Site,',
    '        [Parameter(Mandatory = $true, Position = 1)]', '        [Item[]]$TenantTemplates', '    )', '    process {',
    `${I}# Generated by sitecoreai-site-template from spec "${oneLine(spec.module)}". Edit the spec and rebuild, not this script.`,
    `${I}$ErrorActionPreference = 'Stop'`, `${I}# Every path is pinned to master: — the Create Site dialog runs this job with a non-master context database.`, `${I}$sitePath = "master:$($Site.Paths.Path)"`, `${I}$lang = $Site.Language`,
    `${I}$collection = $Site.Parent`, `${I}$templatesRoot = "master:/sitecore/templates/Project/$($collection.Name)"`,
    `${I}Write-Log (${psq(spec.name + ' site setup: ')} + $sitePath) -Log "INFO"`);
  L.push(HELPERS);

  L.push(`${I}# Page types: collection-level templates inheriting this template's module page types`, `${I}$types = @{}`);
  for (const t of spec.pageTypes) L.push(`${I}$types[${psq(t.name)}] = Ensure-PageType ${psq(t.name)} ${psq(resolved.pageTypeIds[t.name])} ${psq(t.icon || '')}`);
  L.push(`${I}$bpIds = @()`);
  if (spec.blueprints?.length) {
    L.push(`${I}# Page blueprints: branch templates in the collection's Branches folder, offered via insert options`,
      `${I}$bpRoot = Get-Item -Path "master:/sitecore/templates/Branches/Project/$($collection.Name)"`);
    for (const bp of spec.blueprints) {
      const { xml, datasources } = buildLayoutXml(bp.components, resolved.renderingIds, n => seededGuid(`${spec.module}/${bp.name}/${n}`));
      L.push(`${I}$bp = Ensure-Child $bpRoot ${psq(bp.name)} '${IDS.branch}'`,
        `${I}$bpPage = Ensure-Child $bp '$name' $types[${psq(bp.type)}].ID.ToString()`,
        `${I}Set-Fields $bpPage ${psHash({ Title: '$name', ...bp.fields, '__Final Renderings': xml })}`,
        `${I}$bpData = Ensure-Child $bpPage 'Data' '${IDS.pageData}'`);
      for (const d of datasources) {
        const tpl = d.template || resolved.datasourceTemplates[d.renderingPath];
        if (!tpl) throw new Error(`no datasource template resolved for ${d.renderingPath}`);
        if (!hasExtras(d)) { L.push(`${I}Set-Fields (Ensure-Child $bpData ${psq(d.name)} ${psq(tpl)}) ${psHash(d.fields)}`); continue; }
        L.push(`${I}$bpDs = Ensure-Child $bpData ${psq(d.name)} ${psq(tpl)}`, `${I}Set-Fields $bpDs ${psHash(d.fields)}`);
        if (d.insertOptions?.length) L.push(`${I}Set-Masters $bpDs ${psMasters(d, resolved)}`);
        if (d.children?.length) L.push(`${I}Ensure-Children $bpDs ${psChildren(d.children, resolved)} | Out-Null`);
      }
      L.push(`${I}$bpIds += $bp.ID.ToString()`);
    }
  }
  const allTypes = spec.pageTypes.map(x => `$types[${psq(x.name)}].ID.ToString()`);
  for (const t of spec.pageTypes) {
    const io = (t.insertOptions ? t.insertOptions.map(n => `$types[${psq(n)}].ID.ToString()`) : allTypes).join(', ');
    L.push(`${I}Set-Masters $types[${psq(t.name)}] (@(${io}) + $bpIds)`);
  }

  L.push(`${I}# Pages (parents first)`, `${I}$pages = @{}`, `${I}$pages[''] = Get-Item -Path "$sitePath/Home" -Language $lang`);
  if (spec.homeType) {
    L.push(`${I}if ($pages[''].TemplateID -ne $types[${psq(spec.homeType)}].ID) {`,
      `${I}    $pages[''].ChangeTemplate([Sitecore.Data.Items.TemplateItem]$types[${psq(spec.homeType)}])`,
      `${I}    $pages[''] = Get-Item -Path "$sitePath/Home" -Language $lang`, `${I}}`);
  }
  if (spec.pageTypes.length) {
    // The JSS Site skeleton gives Home an item-level __Masters (Base Page) that overrides the page type's standard values.
    L.push(`${I}Set-Masters $pages[''] (@(${spec.pageTypes.map(t => `$types[${psq(t.name)}].ID.ToString()`).join(', ')}) + $bpIds)`);
  }
  for (const p of spec.pages.filter(p => p.path)) {
    const parent = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : '';
    const name = p.path.split('/').pop();
    L.push(`${I}${pageVar(p.path)} = Ensure-Page ${pageVar(parent)} ${psq(name)} $types[${psq(p.type)}]`);
  }
  for (const p of spec.pages) if (Object.keys(p.fields).length) L.push(`${I}Set-Fields ${pageVar(p.path)} ${psHash(p.fields)}`);

  L.push(`${I}# Components`);
  for (const p of spec.pages) if (p.components.length) emitComponents(L, pageVar(p.path), p.components, resolved, false, I);

  if (spec.partials.length) {
    L.push(`${I}# Partial designs + Default page design`, `${I}$partialsRoot = Get-Item -Path "$sitePath/Presentation/Partial Designs"`, `${I}$partials = @()`);
    for (const pd of spec.partials) {
      L.push(`${I}$pd = Ensure-Child $partialsRoot ${psq(pd.name)} '${IDS.partialDesign}'`, `${I}$partials += $pd.ID.ToString()`);
      emitComponents(L, '$pd', pd.components, resolved, true, I);
    }
    L.push(`${I}$design = Ensure-Child (Get-Item -Path "$sitePath/Presentation/Page Designs") 'Default' '${IDS.pageDesign}'`,
      `${I}$design.Editing.BeginEdit()`, `${I}$design["PartialDesigns"] = ($partials -join '|')`, `${I}$design.Editing.EndEdit() | Out-Null`,
      `${I}$map = [Sitecore.Text.UrlString]::new()`,
      `${I}$map[(Get-Item -Path "$templatesRoot/Page").ID.ToString()] = $design.ID.ToString()`);
    for (const t of spec.pageTypes) L.push(`${I}$map[$types[${psq(t.name)}].ID.ToString()] = $design.ID.ToString()`);
    L.push(`${I}$designs = Get-Item -Path "$sitePath/Presentation/Page Designs" -Language $lang`,
      `${I}$designs.Editing.BeginEdit()`, `${I}$designs["TemplatesMapping"] = [System.Web.HttpUtility]::UrlEncode($map.ToString())`, `${I}$designs.Editing.EndEdit() | Out-Null`);
  }

  if (spec.availableRenderings.length) {
    L.push(`${I}# Available Renderings groups (custom renderings in the Pages component gallery)`,
      `${I}$arRoot = Get-Item -Path "$sitePath/Presentation/Available Renderings"`,
      `${I}$arTemplate = ($arRoot.Children | Select-Object -First 1).TemplateID.ToString()`);
    for (const ar of spec.availableRenderings) {
      const ids = ar.renderings.map(r => `(Get-Item -Path ${psq('master:' + r)}).ID.ToString()`).join(', ');
      L.push(`${I}$ar = Ensure-Child $arRoot ${psq(ar.name)} $arTemplate`, `${I}$ar.Editing.BeginEdit()`, `${I}$ar["Renderings"] = (@(${ids}) -join '|')`, `${I}$ar.Editing.EndEdit() | Out-Null`);
    }
  }
  if (spec.settings && Object.keys(spec.settings).length) {
    L.push(`${I}# Site settings (the JSS Settings item), e.g. RobotsContent`, `${I}Set-Fields (Get-Item -Path "$sitePath/Settings" -Language $lang) ${psHash(spec.settings)}`);
  }
  if (spec.dictionary?.length) {
    L.push(`${I}# Dictionary entries under the site's Dictionary domain`, `${I}$dict = Get-Item -Path "$sitePath/Dictionary" -Language $lang`);
    for (const d of spec.dictionary) {
      L.push(`${I}$de = Ensure-Child $dict (${psq(d.key)} -replace ${psq(DICT_NAME_INVALID.source)}, '-') '{6D1CD897-1936-4A3A-A511-289A94C2A7B1}'`,
        `${I}Set-Fields $de ${psHash({ Key: d.key, Phrase: d.phrase })}`);
    }
  }
  L.push(`${I}if ($failures.Count -gt 0) { throw ("Site setup finished with " + $failures.Count + " failed component(s): " + ($failures -join ' || ')) }`);
  L.push(`${I}Write-Log ${psq(spec.name + ' site setup done')} -Log "INFO"`, '    }', '}');
  return L.join('\n');
}

export function emitConfigureHost(spec) {
  return [
    'function Invoke-Step {', '    [CmdletBinding()]', '    param(', '        [Parameter(Mandatory = $true, Position = 0)]',
    '        [Sitecore.XA.JSS.Foundation.Scaffolding.Models.CreateNewJSSSiteModel]$Model', '    )', '    process {',
    `        # Generated by sitecoreai-site-template: binds the new site to rendering host "${oneLine(spec.renderingHost)}".`,
    '        [Item]$SiteLocation = $Model.SiteLocation',
    '        $sitePath = "master:$($SiteLocation.Paths.Path)/$($Model.SiteName)"',
    `        if (-not (Test-Path -Path ${psq('master:/sitecore/system/Settings/Services/Rendering Hosts/' + spec.renderingHost)})) {`,
    `            Write-Log ${psq(`Rendering host "${spec.renderingHost}" does not exist on this CM; the site will have no editing host`)} -Log "WARN"`,
    '        }',
    '        $siteGrouping = Get-Item -Path "$sitePath/Settings/Site Grouping/$($Model.SiteName)"',
    `        $siteGrouping.RenderingHost = ${psq(spec.renderingHost)}`,
    '        $siteGrouping.StartItem = (Get-Item -Path "$sitePath/Home").ID',
    '    }', '}'].join('\n');
}
