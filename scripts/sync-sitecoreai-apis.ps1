<#
.SYNOPSIS
  Deterministic fetch backbone for regenerating SitecoreAI REST API skills
  inside THIS repo (Chris1415/sitecore-skills-pocs).

  Downloads the canonical OpenAPI specs (and Markdown mirrors) for the four
  SitecoreAI REST APIs from api-docs.sitecore.com, hashes them, validates each
  is a plausible OpenAPI document, compares the hash against the value already
  stamped in the corresponding SKILL.md frontmatter, and emits a JSON manifest.

  This script does the I/O + hashing only. A maintainer (or agent) reads the
  manifest + the raw specs and regenerates the skill bodies.

  It NEVER edits a SKILL.md and NEVER commits or pushes.

.NOTES
  PowerShell 5.1 compatible. No ternary / null-coalescing operators.

.PARAMETER SkillsRoot
  Path to the SitecoreAI skills folder.
  Default: <repo>/plugins/sitecore-platform/skills

.PARAMETER OutDir
  Where to write the downloaded specs + manifest.
  Default: <system temp>/sitecoreai-api-specs (outside the repo, so specs are never committed by accident)

.PARAMETER Only
  Optional comma-separated list of api slugs (agent-api,pages-api,publishing-api,sites-api)
  to limit the fetch.
#>
[CmdletBinding()]
param(
  [string]$SkillsRoot,
  [string]$OutDir,
  [string]$Only
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $SkillsRoot -or $SkillsRoot -eq '') {
  $SkillsRoot = Join-Path $repoRoot 'plugins\sitecore-platform\skills'
}
if (-not $OutDir -or $OutDir -eq '') {
  $OutDir = Join-Path ([IO.Path]::GetTempPath()) 'sitecoreai-api-specs'
}

# skill <-> api-docs slug registry. auth + graphql-schemas are intentionally
# absent: auth is cross-cutting (no standalone api-docs entry) and graphql-schemas
# is introspection-derived, not published as an OpenAPI spec.
$registry = @(
  @{ skill = 'sitecoreai-agent';      slug = 'agent-api' },
  @{ skill = 'sitecoreai-pages';      slug = 'pages-api' },
  @{ skill = 'sitecoreai-publishing'; slug = 'publishing-api' },
  @{ skill = 'sitecoreai-sites';      slug = 'sites-api' }
)

$onlySet = $null
if ($Only -and $Only -ne '') {
  $onlySet = @{}
  foreach ($s in ($Only -split ',')) { $onlySet[$s.Trim()] = $true }
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

# _bundle = the fully-dereferenced single-file spec the docs expose as the
# official "Download OpenAPI description" link. Most APIs resolve at the plain
# slug path; some are version-pinned (e.g. agent-api/@v2.0/) and 404 otherwise,
# so the fetch falls back to scraping the authoritative link out of the .md mirror.
$specBase = 'https://api-docs.sitecore.com/_bundle/sai'
$mdBase   = 'https://api-docs.sitecore.com/sai'
$ua       = 'sitecore-skills-pocs sync-sitecoreai-apis'

function Get-StampedHash([string]$skillMd) {
  if (-not (Test-Path $skillMd)) { return $null }
  $head = Get-Content -LiteralPath $skillMd -TotalCount 40 -ErrorAction SilentlyContinue
  foreach ($line in $head) {
    $m = [regex]::Match($line, 'spec_sha256:\s*["'']?([0-9a-fA-F]{64})')
    if ($m.Success) { return $m.Groups[1].Value.ToLower() }
  }
  return $null
}

$results = @()

foreach ($entry in $registry) {
  if ($onlySet -ne $null -and -not $onlySet.ContainsKey($entry.slug)) { continue }

  $slug    = $entry.slug
  $specUrl = "$specBase/$slug/index.yaml"
  $mdUrl   = "$mdBase/$slug.md"
  $specOut = Join-Path $OutDir "$slug.yaml"
  $mdOut   = Join-Path $OutDir "$slug.md"
  $skillMd = Join-Path $SkillsRoot (Join-Path $entry.skill 'SKILL.md')

  $row = [ordered]@{
    skill             = $entry.skill
    slug              = $slug
    spec_url          = $specUrl
    resolved_spec_url = $specUrl
    md_url            = $mdUrl
    spec_path         = $specOut
    md_path           = $mdOut
    skill_path        = $skillMd
    skill_exists      = (Test-Path $skillMd)
    http_status       = $null
    bytes             = 0
    sha256            = $null
    spec_version      = $null
    is_openapi        = $false
    md_ok             = $false
    prev_sha256       = (Get-StampedHash $skillMd)
    changed           = $true
    error             = $null
  }

  $fetched = $false
  try {
    $resp = Invoke-WebRequest -Uri $specUrl -OutFile $specOut -UseBasicParsing -Headers @{ 'User-Agent' = $ua } -PassThru
    $row.http_status = [int]$resp.StatusCode
    $fetched = $true
  } catch {
    # Default (un-versioned) path 404'd — recover via the md mirror's "Download
    # OpenAPI description" link, which encodes any version segment (e.g. @v2.0).
    try {
      $md = Invoke-WebRequest -Uri $mdUrl -UseBasicParsing -Headers @{ 'User-Agent' = $ua }
      $m = [regex]::Match($md.Content, 'https://api-docs\.sitecore\.com/_(?:bundle|spec)/sai/[^\s)"''<>]+index\.yaml')
      if ($m.Success) {
        $row.resolved_spec_url = $m.Value
        $resp = Invoke-WebRequest -Uri $m.Value -OutFile $specOut -UseBasicParsing -Headers @{ 'User-Agent' = $ua } -PassThru
        $row.http_status = [int]$resp.StatusCode
        $fetched = $true
      }
    } catch {}
  }

  if (-not $fetched) {
    if ($null -eq $row.http_status) { $row.http_status = 404 }
    $row.error = "spec fetch failed (default + md-link fallback): $specUrl"
    $results += ,([pscustomobject]$row)
    continue
  }

  $fi = Get-Item -LiteralPath $specOut
  $row.bytes = [int]$fi.Length
  $row.sha256 = (Get-FileHash -LiteralPath $specOut -Algorithm SHA256).Hash.ToLower()

  $specText = Get-Content -LiteralPath $specOut -Raw
  $row.is_openapi = ($specText -match '(?m)^\s*openapi\s*:') -and ($specText -match '(?m)^\s*paths\s*:')
  $vm = [regex]::Match($specText, '(?ms)^info:\s*$.*?^\s+version:\s*["'']?([^\s"''#]+)')
  if ($vm.Success) { $row.spec_version = $vm.Groups[1].Value }

  if ($row.prev_sha256 -and ($row.prev_sha256 -eq $row.sha256)) { $row.changed = $false }

  # Markdown mirror is best-effort (used for prose cross-reference, not the source of truth).
  try {
    Invoke-WebRequest -Uri $mdUrl -OutFile $mdOut -UseBasicParsing -Headers @{ 'User-Agent' = $ua } | Out-Null
    $row.md_ok = $true
  } catch {
    $row.md_ok = $false
  }

  $results += ,([pscustomobject]$row)
}

$manifest = [ordered]@{
  generated_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  source       = 'https://api-docs.sitecore.com/?product=SitecoreAI'
  skills_root  = $SkillsRoot
  out_dir      = $OutDir
  apis         = $results
}

$manifestPath = Join-Path $OutDir 'fetch-manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Out-File -LiteralPath $manifestPath -Encoding utf8

Write-Host ''
Write-Host "Fetched SitecoreAI API specs -> $OutDir"
Write-Host ('{0,-22} {1,-7} {2,-9} {3,-8} {4,-9} {5}' -f 'skill','status','bytes','openapi','changed','sha256(12)')
foreach ($r in $results) {
  $sha = ''
  if ($r.sha256) { $sha = $r.sha256.Substring(0,12) }
  Write-Host ('{0,-22} {1,-7} {2,-9} {3,-8} {4,-9} {5}' -f $r.skill, $r.http_status, $r.bytes, $r.is_openapi, $r.changed, $sha)
  if ($r.error) { Write-Host ("    ! " + $r.error) }
}
Write-Host ''
Write-Host "Manifest: $manifestPath"
Write-Host "Skills root: $SkillsRoot"
