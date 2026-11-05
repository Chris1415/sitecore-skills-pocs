---
name: blok-mcp
description: "Configures the Blok MCP (via the shadcn MCP server) for Claude Code, Cursor or VS Code, so agents can list, add and compose Blok components. Use for AI-assisted UI in a Sitecore-styled project; needs blok-setup first."
license: Apache-2.0
compatibility: "Requires the shadcn MCP server (npx shadcn@latest mcp) configured in the consuming agent (Claude Code / Cursor / Copilot) and access to https://blok.sitecore.com."
metadata:
  author: Christian Hahn
  version: "0.4.2"
---

# Blok MCP Server

Blok exposes its registry over the **shadcn MCP server**. Once configured, AI assistants can list available components, add them, and scaffold layouts entirely from prompts — no manual lookup of registry URLs.

## When to use

- User wants AI-assisted UI generation inside a Sitecore-styled project
- A Marketplace app is being built and the user wants Claude/Cursor/Copilot to pick Blok components automatically
- An agent needs to query "what Bloks exist?" without opening the `blok-components` skill

Prerequisite: Blok is already set up in the project — see the `blok-setup` skill. The MCP reads from `components.json` to know which registries to query.

---

## 1. Quick setup — Claude Code

Run at the project root:

```bash
npx shadcn@latest mcp init --client claude
```

This adds the shadcn MCP server to the project's Claude Code configuration. Verify by listing active MCP servers inside a Claude Code session — `shadcn` should appear.

---

## 2. Cursor setup

Add to `.cursor/mcp.json` at the project root:

```json
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["-y", "shadcn@latest", "mcp"]
    }
  }
}
```

Then enable `shadcn` under Cursor Settings → MCP.

---

## 3. VS Code / GitHub Copilot

Use the same `mcp` command pattern in the Copilot MCP config. Blok's docs defer to the shadcn MCP docs for the exact schema — if it changes, re-check <https://blok.sitecore.com/mcp>.

---

## 4. Prerequisite — Blok registry in components.json

For the MCP to see Blok components (not just shadcn's core registry), `components.json` must declare the `@blok` registry:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "registries": {
    "@blok": "https://blok.sitecore.com/r/{name}.json"
  }
}
```

Without this line the MCP will only surface stock shadcn components.

---

## 5. Prompt patterns (canonical examples from Blok docs)

Ask any of these once the MCP is running:

```text
Show me all available components in the blok registry.
What components are available from blok?
Find me a hero section from the blok registry.
Install @blok/button.
Add button, card and alert from the Blok registry.
Build a dashboard layout using blok components.
Create a contact form using components from the shadcn registry.
```

For agent-authored prompts, be explicit about **which registry** — `blok` — to avoid the MCP falling back to stock shadcn components that don't match Sitecore styling.

---

## 6. Agent guidance

| When you are… | How to use the Blok MCP |
|-------|------------------------|
| Designing UI | Query "what components exist?" during divergent proposals. Reference real component names in the UI design artifact. |
| Planning implementation | Use it to confirm a proposed component exists and to pull the current registry URL into the implementation plan. |
| Implementing | Use prompts like `Add @blok/topbar, @blok/sidebar-rhs` to install everything the plan lists in one pass. |

---

## 7. Pitfalls

- **MCP added but no Blok in results** → `components.json` missing the `@blok` registry line (see § 4)
- **Prompt returns shadcn components instead of Blok** → prompt didn't name the registry; prefix requests with `from the blok registry` or `@blok/*`
- **MCP init silently updates files** → commit `components.json` and any MCP config changes after running `shadcn mcp init` so the team's setup stays reproducible
- **Blok docs change the exact command** → always cross-check <https://blok.sitecore.com/mcp> before documenting a final install step for a client-facing project
