---
name: content-sdk-playground-pattern
description: "Workspace layout for learning a Content SDK or SXA feature in isolation: a playground with an SCS solution, a scaffolded head app and an Edge snapshot. Use when exploring a feature or testing an assumption without touching a real product."
license: Apache-2.0
compatibility: "Requires the Sitecore CLI (`dotnet sitecore`) + Node 22+. Each playground gets its own Cloud Portal SitecoreAI environment; mixing tenants in one playground breaks SCS pull determinism."
metadata:
  author: Christian Hahn
  version: "0.2.0"
---

# Content SDK — Playground Pattern

A throwaway learning workspace, kept apart from production code. It lets you and an agent explore patterns (resolvers, integrated GraphQL, SCS shapes, multisite, editing) against a real SitecoreAI tenant without touching a real project.

## When to use

- The user asks to "learn X," "play with Y," "try Z," or to investigate a Sitecore feature against a real tenant without committing to a project.
- Validating an assumption about layout response shapes, resolver behavior, or SDK contracts before scaffolding a real Marketplace app or head app.
- Capturing real-tenant fixtures (introspection JSON, layout captures) that real projects can reuse.
- Onboarding the agent on a new Sitecore subsystem (for example, the first time you use a feature you've never built against).

## How to perform

1. **Choose a topic-scoped folder**, outside any real project, for example `playground-navigation/` or `playground-redirects/`. Keep it out of real project folders so their tooling and CI never pick it up.
2. **Scaffold the SCS solution side** with `dotnet sitecore plugin add Sitecore.DevEx.Extensibility.XMCloud@<v>`, then `dotnet sitecore init`, then declare modules in `authoring/items/<module>.module.json`. Connect to a Cloud environment per the `sitecoreai-cli-cloud-workflow` skill.
3. **Scaffold the head app side** inside `sites/<topic>/` with `npx --yes create-content-sdk-app@latest --yes --template nextjs-app-router --destination sites/<topic>` (per the `setup-content-sdk` skill, which also covers the Pages Router template). Treat this as a regular Content SDK head app — `src/`, `.sitecore/`, etc.
4. **Wire `xmcloud.build.json`** at the playground root to point `renderingHosts.<host>.path` at `./sites/<topic>`.
5. **Capture an Edge snapshot at the start.** Create `edge-snapshot/` and save (`capture-edge.mjs` in the `sitecoreai-edge-graphql-capture` skill does this; Edge rejects a full introspection query, so it introspects per type):
   - `sites.json`, `routes.json` — sites and routes query responses
   - `type-<T>.json` — one per relevant root type (Item, ItemField, LayoutData, RoutesResult, SiteData, SiteInfo)
   - `layouts/<page-or-pattern>.json` — layout response per page that demonstrates a pattern
6. **Write findings down** in a notes file in the playground, or wherever your agent keeps long-lived notes, with the playground path. Future sessions then know where to look.
7. **Install the `content-sdk-debug-layout-probe` toolkit** in the head app on day one — it pays for itself within an hour.

## Hard Rules

- **The playground lives outside real projects.** Putting it inside one makes that project's tooling treat throwaway code as real.
- **Each playground owns exactly one tenant + one rendering host config.** Switching tenants mid-playground invalidates the captured Edge snapshot.
- **Keep `authoring/` in source control with serialized items committed.** That's how the agent can reason about templates, renderings and parameters without a live tenant.
- **`edge-snapshot/` is captured, not regenerated on every change.** Re-pull intentionally when the schema changes (new templates, breaking renderings).
- **The head app under `sites/<topic>/` follows all the rules of a real head app** — same `AGENTS.md`, same Tailwind/Next config, same component map. Treat it as production-quality even if it's "just a playground."
- **Don't ship playground code to production.** It's a learning artifact; reference patterns, copy with attribution, don't deploy.

## Stop Conditions

- **Stop and ask** if the user is unsure whether the new work is a real project or a playground. A real project has a roadmap and owners; a playground is exploratory and disposable.
- **Don't merge multiple Sitecore features into one playground** — keep one topic per playground so the captured artifacts stay legible.
- **Don't reuse a real project's Cloud environment for a playground.** Authoring changes in the playground will pollute the project.

## What lives where

```
playground-<topic>/
  sitecore.json                # SCS root config (modules glob)
  xmcloud.build.json           # rendering host config (points at ./sites/<topic>)
  .sitecore/                   # CLI-provisioned schemas + user.json (gitignored)
  authoring/
    <topic>.sln                # full .NET SCS solution
    items/<topic>.module.json
    items/items/               # serialized YAML
  sites/<topic>/               # scaffolded Content SDK head app (Next.js App Router)
    src/, .sitecore/, etc.
  edge-snapshot/               # per-type introspection + per-pattern layout captures
    sites.json, routes.json
    layouts/<pattern>.json
    type-<T>.json
```

## Verification

- `dotnet sitecore ser pull -n <env>` from the playground root succeeds and updates `authoring/items/items/...` deterministically.
- `npm run dev` in `sites/<topic>/` boots and renders pages from the tenant.
- The Edge snapshot can be diffed across pulls to detect tenant-side drift.

## Related

- `setup-content-sdk` — the scaffold for `sites/<topic>/`.
- `sitecoreai-cli-cloud-workflow` — for the `authoring/` side.
- `sitecoreai-edge-graphql-capture` — for `edge-snapshot/`.
- `content-sdk-debug-layout-probe` — install this in `sites/<topic>/` on day one.
- `content-sdk-resolver-patterns` — the catalog of patterns a playground exists to learn.

## References

- [SCS structural overview](https://doc.sitecore.com/xmc/en/developers/xm-cloud/sitecore-content-serialization-structural-overview.html)
- [xmcloud-starter-js repo](https://github.com/Sitecore/xmcloud-starter-js) — reference SCS layouts
