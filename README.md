# Sitecore Skills

Skills that teach AI coding agents how to build on Sitecore: Content SDK head apps, the SitecoreAI platform, Marketplace apps and the Blok design system. Agents often guess at these APIs, and many of the traps do not show up until a site is live, so these skills write down what was measured: exact commands, response shapes and failure modes. **This is a personal proof of concept capturing Sitecore domain knowledge, by Christian Hahn. It is not an official Sitecore product.**

## Quickstart (Claude Code)

```text
/plugin marketplace add Chris1415/sitecore-skills-pocs
/plugin install sitecore-guide@sitecore-skills-pocs
/reload-plugins
Which Sitecore plugins does this project need?
```

The guide looks at your project and names the plugins to install next. For a Content SDK App Router head app, that is:

```text
/plugin install sitecore-content-sdk-nextjs-app-router@sitecore-skills-pocs
/plugin install sitecore-content-sdk@sitecore-skills-pocs
/reload-plugins
```

Skills load on their own when a request matches their description. To force one, name it: "use the `content-sdk-troubleshooting` skill".

## Plugins

| Plugin | Skills | Use it for |
|---|---:|---|
| `sitecore-guide` | 1 | Start here: which plugin and skill fit a task |
| `sitecore-setup` | 4 | Scaffolding a new project: the decision tree, then one scaffold per target |
| `sitecore-content-sdk-nextjs-app-router` | 17 | Content SDK head apps on the Next.js App Router, including Atoms (beta) |
| `sitecore-content-sdk-nextjs-pages-router` | 11 | Content SDK head apps on the Next.js Pages Router |
| `sitecore-content-sdk` | 23 | Router-independent Content SDK work: troubleshooting, component review, layout, lists, personalization, search, consent, upgrades |
| `sitecore-platform` | 17 | The platform itself: auth, Agent, Pages, Publishing and Sites APIs, GraphQL, Edge, CLI, serialization, languages, site templates, health check |
| `sitecore-marketplace` | 7 | Marketplace apps: SDK references, lifecycle, extension routes, testing |
| `sitecore-blok` | 5 | The Blok design system: setup, components, theming, MCP |

That is 85 skills. Install one router plugin, never both. The full list with descriptions is in [`catalog.json`](catalog.json) and in the guide's [catalog](plugins/sitecore-guide/skills/sitecore-skills-guide/references/catalog.md).

## Other agents

All of them read this one repository. The plugin agents use the same marketplace; the skill installers find the same `SKILL.md` files. These commands were last run on 2026-10-13 and 2026-10-21, against this repository while it was private and before the latest plugin rename.

| Agent | Installs | Command |
|---|---|---|
| GitHub Copilot CLI | plugin | `copilot plugin marketplace add Chris1415/sitecore-skills-pocs`, then `copilot plugin install sitecore-content-sdk@sitecore-skills-pocs` |
| OpenAI Codex CLI | plugin | `codex plugin marketplace add Chris1415/sitecore-skills-pocs`, then `codex plugin add sitecore-content-sdk@sitecore-skills-pocs` |
| GitHub CLI (`gh skill`) | skill | `gh skill install Chris1415/sitecore-skills-pocs content-sdk-search --agent <agent>` |
| Gemini CLI | plugin's skills | `gemini skills install https://github.com/Chris1415/sitecore-skills-pocs.git --path plugins/sitecore-content-sdk/skills` |
| [skills.sh](https://github.com/vercel-labs/skills) | skill | `npx skills add Chris1415/sitecore-skills-pocs --list`, then `npx skills add Chris1415/sitecore-skills-pocs --skill content-sdk-search` |
| Cursor | plugin | `/add-plugin`, from the marketplace in `.cursor-plugin/`. **Unverified:** not yet tried in a Cursor session |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Filename too long` on Windows (seen with `git clone` and Codex) | Git long paths are off. The longest path in this repository is about 133 characters, on top of the tool's own install folder | `git config --global core.longpaths true`, then install again |
| Claude Code on Windows: `EPERM: operation not permitted, rename … ..clone` | Probably a Windows file lock, such as antivirus (2 of 11 runs) | Run the command again; a retry always worked |
| A skill is installed but never loads | Too many skills are installed, and the ones listed last lose their descriptions | Uninstall the plugins this project does not need, or name the skill in your request |
| An update changes nothing | Claude Code caches a plugin per version | `claude plugin marketplace update sitecore-skills-pocs`, then `claude plugin update <plugin>@sitecore-skills-pocs`, then restart |

## What this is and is not

This is one person's field notes, turned into skills. Use them as a well-informed starting point.

- **One maintainer.** Issues and corrections are welcome. There is no support commitment and no release schedule.
- **Not official.** Sitecore does not maintain or support this repository. Where a skill and [Sitecore's documentation](https://doc.sitecore.com) disagree, check both against your own system.
- **Agents should verify.** Platforms change and skills go stale. Most skills say what they were measured against, and a claim is only as current as its date. Ask your agent to check the installed package types and a real response before relying on a shape.
- **"Live-verified" means on the author's own tenants.** It does not mean every tier, region or tenant configuration.
- **Probe-gated steps.** A step marked `[probe-gated]` or `[UNVERIFIED]` has not been confirmed: treat it as a question to test, not a fact.
- **Installing everything does not work well.** All eight plugins list about 21,900 characters of descriptions, against Claude Code's default budget of about 8,000. Install only what the project needs.
- **Some skills need more than a repository:** tenant credentials (an automation client, an Edge context id), the Marketer MCP, Node (18+ for most scripts, higher for some), the Sitecore CLI, or Playwright. Each skill's `compatibility` field says what it needs.

**Tested with**, from the skills' `compatibility` fields:

| Area | Versions |
|---|---|
| Content SDK | Mostly `@sitecore-content-sdk/nextjs` 2.4.x (2.4.0 and 2.4.1), on Next.js 16. Older skills state 2.x or Next.js 13+ as a floor. Working item-level on-demand revalidation needs the 2.5.0 line |
| Content SDK Atoms (beta) | Exact pins only: `@sitecore-content-sdk/nextjs` `3.0.0-beta.atoms.20260930142740` and `create-content-sdk-app` `2.3.0-beta.atoms.20260930142740`, with Next 16.2+, React 19.2+ and Zod 4 |
| Sitecore CLI | 4.0+ for serialization roles and excluded fields |
| GraphQL schemas | Captured 2026-05-05 by introspecting one SitecoreAI tenant |

**Individual skills to treat with care:**

- `content-sdk-app-router-atoms` is **beta**, and tied to the beta package above. Do not use it with a stable SDK.
- `sitecoreai-personalization` is marked **draft** in its metadata. The write chain was run end to end, but one create path is still open.
- `sitecoreai-brand-voice` is **not field-tested** as a standalone skill.
- The **Pages Router** skills are mostly taken from upstream, with less independent verification than the App Router ones. The same upstream skills ship in the Content SDK template's `.agents/skills` folder.

## Naming and format

Plugins are named `sitecore-<area>`. Skill names carry their product as a prefix (`content-sdk-`, `content-sdk-app-router-`, `content-sdk-pages-router-`, `sitecoreai-`, `marketplace-sdk-`, `blok-`, `setup-`), so they stay readable in tools that show no plugin name. Names are unique across the repository. In Claude Code a skill also shows as `plugin:skill`, for example `sitecore-content-sdk:content-sdk-search`.

Each skill follows the [Agent Skills specification](https://agentskills.io/specification): a folder with a `SKILL.md` (YAML frontmatter plus Markdown), and optional `references/`, `scripts/` and `assets/` folders loaded on demand.

Provenance is in the frontmatter. `metadata.author` names who wrote the skill, and `metadata.upstream` names the Sitecore source of a skill that was taken or derived from one.

## Contributing

Corrections are the most useful contribution, especially a measurement that contradicts a skill. See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately: see [SECURITY.md](SECURITY.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution and trademarks.
