# Repo checks

The checks that guard this repository. They run in `.github/workflows/validate.yml` on every PR and push to `main`. All of them are plain Node, with no dependencies.

| Command | What it checks | Fails when |
|---|---|---|
| `node tests/run.mjs` | the checks themselves | a check passes a broken fixture or fails a good one |
| `node tools/skill-lint.mjs` | skills + plugin manifests | any ERROR not waived in `tools/skill-lint/baseline.json` |
| `node scripts/gen-agent-manifests.mjs --check` | generated Cursor manifests | they differ from the Claude manifests, or a plugin has no license |
| `node tools/catalog.mjs --check` | `catalog.json` | it is out of date (run `node tools/catalog.mjs`) |
| `node tools/scrub.mjs` | private names in tracked files | a public rule or a private pattern matches |
| `node tools/release-check.mjs --base <ref>` | plugin and skill versions vs the base | files changed but the version did not (installed users would never get the change), or a version went down |
| gitleaks (CI only) | secrets in the full history | a finding not allowed by `.gitleaks.toml` |

## Skill lint rules

| ID | Severity | Rule |
|---|---|---|
| SL000 | error | the tree holds no skills |
| SL001 | error | `SKILL.md` missing or wrongly cased |
| SL002 | error | frontmatter cannot be parsed |
| SL003 | error | `name` missing, or not lowercase `[a-z0-9-]` ≤ 64 |
| SL004 | error | `name` ≠ folder name |
| SL005 | error | `name` lacks the plugin prefix (`marketplace` → `marketplace-sdk-`, otherwise `<plugin>-`) |
| SL006 | error | `description` missing, > 1024 chars, or contains an XML-like tag |
| SL007 | error | `description` > 250 chars (write it as what · when · not, trigger words first) |
| SL008 / SL009 | error | `license` missing / not `Apache-2.0` or `UNLICENSED` |
| SL010 | error | skill license ≠ its plugin's license |
| SL011 | warn | unknown frontmatter key |
| SL012 | error | a `metadata` value is not a string (spec: string → string map) |
| SL013 / SL014 | error / warn | body empty / body > ~5,000 tokens |
| SL015 | error | the body references a `references/…`, `scripts/…` or `assets/…` file that does not exist |
| SL016 / SL017 | error / warn | a reference into another skill is dangling / crosses plugins |
| SL018 | error | a file path in a skill is longer than 140 chars (Windows clones into deep homes) |
| SL019 | error | a skill name is used twice across plugins (`npx skills` drops the duplicate silently, `gh skill` refuses it) |
| MF001–MF005 | error | plugin listed ↔ present; `plugin.json` valid; versions equal; license explicit and equal; `LICENSE` at the root and in each Apache-2.0 plugin |
| BU001 | info | total listing characters vs Claude Code's default budget (8,000); not a gate, since nobody installs every plugin at once |
| BL001 / BL002 | error | a waiver has no reason / a waiver matches nothing |

## Scrub patterns

- Public patterns live in `tools/scrub/rules.json`.
- Private patterns (tenant ids, customer brands, private repositories) are **never committed**. They come from the `SCRUB_PATTERNS` repository secret: a JSON array of `{ "category", "pattern", "flags" }`.
- Locally, pass them with `--values <file outside the repo>`.
- The scanner prints only the category of a private hit, never the match.
- Without private patterns it exits 2, so it cannot report a clean result it did not check. `--public-only` runs the public rules alone: use it locally. CI uses it only for pull requests from forks, which GitHub gives no secrets; pushes to `main` and same-repo PRs always run the private scan.
- `--report` prints counts per category and per plugin.
