# Sync SitecoreAI REST API skills from live OpenAPI specs

Fetch backbone (I/O + hash only — does not edit `SKILL.md`):

```powershell
pwsh ./scripts/sync-sitecoreai-apis.ps1
# optional: -Only agent-api,pages-api
# optional: -SkillsRoot <dir>  -OutDir <dir>
```

Defaults:
- **SkillsRoot:** `plugins/sitecore-platform/skills`
- **OutDir:** `sitecoreai-api-specs` in the system temp folder (created if missing)

After the fetch, regenerate the four `sitecoreai-{agent,pages,publishing,sites}/SKILL.md` bodies from the YAML + preserve any `<!-- CURATED:… -->` block. Do not rewrite `sitecoreai-auth` or `sitecoreai-graphql-schemas`.
