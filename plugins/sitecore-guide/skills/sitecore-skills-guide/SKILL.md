---
name: sitecore-skills-guide
description: "Start here for Sitecore skills: which plugin and skill fit a task (Content SDK, SitecoreAI APIs, Marketplace, Blok, setup), and how to install, update or call one. Use when unsure where to begin. Not for doing the task itself."
license: Apache-2.0
metadata:
  author: Christian Hahn
  version: "0.1.7"
---

# Sitecore skills: start here

Use this skill to orient someone in the Sitecore skills: what exists, what to install, and which skill to use next. Then hand over to that skill. Don't do the task from here.

The full list of plugins and skills, generated from the shipped catalog, is in `references/catalog.md`. Read it when you need a skill name or description. Never guess a skill name: if it is not in that file, it does not exist.

## 1. Find the project type, then the plugins

Look at the project before answering: `package.json`, the folder layout, and any `sitecore.config.*`.

| The project is… | Signal | Install |
|---|---|---|
| A new Sitecore project (nothing scaffolded yet) | empty folder, or the user says "new" | `sitecore-setup`, then the plugin for what gets scaffolded |
| A Content SDK head app on the Next.js **App Router** | `src/app/` exists, `@sitecore-content-sdk/nextjs` in `package.json` | `sitecore-content-sdk-nextjs-app-router` + `sitecore-content-sdk` |
| A Content SDK head app on the Next.js **Pages Router** | `src/pages/`, no `src/app/` | `sitecore-content-sdk-nextjs-pages-router` + `sitecore-content-sdk` |
| Work on the SitecoreAI platform itself (APIs, CLI, serialization, publishing, Edge, languages, site templates) | Sitecore CLI, `sitecore.json`, REST/GraphQL calls to the tenant | `sitecore-platform` |
| A Marketplace app (extension inside SitecoreAI) | `@sitecore-marketplace-sdk/*` | `sitecore-marketplace` (+ `sitecore-blok` for the UI) |
| UI built with the Blok design system | `@sitecore/blok` or Blok components | `sitecore-blok` |

- **Never install both router plugins.** They cover the same topics for different routers, and the wrong one gives wrong code.
- **Install only what the project needs.** Every installed skill costs listing space, and in a large install the skills listed last lose their descriptions (they can still be called by name).

## 2. Install, update and call a skill

- **Claude Code:**
  1. Add the marketplace once with `/plugin marketplace add <owner>/<repo>`.
  2. Install with `/plugin install <plugin>@<marketplace>`. The exact command for each plugin is in `references/catalog.md`.
  3. Update with `claude plugin update <plugin>@<marketplace>`, then restart. Changes arrive only when the plugin version went up.
- **Other tools** (Copilot CLI, Codex, Gemini CLI, `gh skill`, `npx skills`): they read the same repository. The repository README has the command for each tool.
- **Calling a skill:** skills load on their own when the request matches their description. To force one, name it: "use the `content-sdk-troubleshooting` skill", or `/<skill-name>` in Claude Code.

## 3. Route the request

Hand over to the entry skill. Each one routes further.

| The user wants to… | Start with |
|---|---|
| Start a new project | `setup-scaffold` |
| Fix something broken in a head app (empty fields, 404, editing, build errors) | `content-sdk-troubleshooting` |
| Plan a feature or a set of components | `content-sdk-feature-planner` |
| Build a new component (code plus the rendering in Sitecore) | `content-sdk-app-router-component-scaffold` (or `content-sdk-pages-router-component-scaffold`), then `content-sdk-create-component` |
| Check a finished component | `content-sdk-component-review` |
| Upgrade the Content SDK | `content-sdk-upgrade-assistant` |
| Call a SitecoreAI API (auth first) | `sitecoreai-auth`, then the API skill |
| Build or debug a Marketplace app | `marketplace-sdk-client` |
| Use Blok components | `blok-setup` |

If no row fits, search `references/catalog.md` for the topic and pick the skill whose description matches. When several match, prefer the router-specific skill (`content-sdk-app-router-*` or `content-sdk-pages-router-*`) over the core one.

## 4. When a skill is not used

| Symptom | Cause | Fix |
|---|---|---|
| The agent reads code instead of using a skill | the project's `AGENTS.md` or `CLAUDE.md` tells it to read code first | name the skill in the request, or add a line to `AGENTS.md` that names the skills |
| A fix you expected is missing | the installed plugin is outdated | update the plugin and restart |
| A skill exists but never loads | it lost its description in a large install, or the plugin is not installed | call it by name; uninstall clusters the project doesn't need |
| Two skills with the same name | a copy from another source (for example a template's `.agents/skills`) | use the plugin's copy; delete or ignore the other |

## Not for

- Doing the actual work. Hand over to the skill from section 3.
- Product questions that no skill covers. Say so, and point to the Sitecore documentation.
