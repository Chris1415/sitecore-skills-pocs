---
name: sitecoreai-cli-cloud-workflow
description: "Sitecore CLI against a SitecoreAI tenant: login, project and environment lookup, connect, ser pull and push, and their silent traps. Use when pulling, pushing or moving a site between tenants, or on CLI environment errors."
license: Apache-2.0
compatibility: "Requires the Sitecore CLI (`dotnet sitecore`) — `Sitecore.DevEx.Extensibility.*` plugin set declared in `sitecore.json`. Tested with SitecoreAI Cloud Portal device-flow login."
metadata:
  author: Christian Hahn
  version: "0.3.4"
---

# Sitecore CLI — Cloud Workflow

A first-time login + connect + pull against a SitecoreAI Cloud environment touches at least four undocumented traps. This skill captures the canonical order, the exact commands, and the fixes for each trap so the user never has to discover them again.

## When to use

- User asks to "pull items from the tenant," "ser pull," "connect the playground to SitecoreAI," "login to Sitecore CLI," or anything that requires serialization commands against a live Cloud env.
- Setting up a new local project that needs to mirror authoring state from a CM instance.
- Diagnosing "Environment default was not defined" or "Environment is not configured to allow writing data" errors.

## How to perform

Run these in order from the directory containing `sitecore.json`:

1. **Device-flow login.** `dotnet sitecore cloud login`. Prints a URL + device code; user authenticates in a browser. Token persists in `.sitecore/user.json` under endpoint `xmCloud`.
2. **Find the project ID.** `dotnet sitecore cloud project list` — prints every project the user's org can see. There is no `--name` filter; grep by name yourself. Capture `Project Id` (e.g. `<22-character id>`).
3. **List environments for that project.** `dotnet sitecore cloud environment list --project-id <PROJECT_ID>`. `--project-id` is **REQUIRED** — the command errors without it. Capture `Environment Id` and `Environment Name`.
4. **Connect to one environment.** `dotnet sitecore cloud environment connect --environment-id <ENV_ID>`. This appends a new endpoint to `.sitecore/user.json` named after the environment (e.g. `"prod"`). It does **NOT** set this as the default; `defaultEndpoint` remains `"default"`, which doesn't exist.
5. **Patch `user.json`.** Open `.sitecore/user.json` and set `"allowWrite": true` on the new endpoint (otherwise even read commands like `ser pull` are blocked). Optionally set `"defaultEndpoint": "<env-name>"` so subsequent commands work without `-n`.
6. **Pull.** `dotnet sitecore ser pull -n <env-name>` (or omit `-n` if you patched `defaultEndpoint`). Output lists items added/updated/deleted (`[A]`, `[U]`, `[D]`).

## Hard Rules

- **`cloud project list` outputs prose, not JSON.** Use `--json` if you need structured output for piping. There is no name filter — grep yourself.
- **`cloud environment list` requires `--project-id`.** Get it from step 2.
- **`cloud environment connect` does not update `defaultEndpoint`.** Either pass `-n <env-name>` on every subsequent command, or hand-edit `user.json` to set `defaultEndpoint` to the new endpoint key.
- **`allowWrite: false` blocks `ser pull`, not just push.** The CLI treats local filesystem writes as "writes." Set `allowWrite: true` on the endpoint before pulling.
- **The connect command supports `--allow-write` flag at connect time** — pass `-aw` (`--allow-write`) to skip the user.json edit step.
- **Never commit `.sitecore/user.json`.** It contains an access token + refresh token. Verify it is `.gitignore`'d.
- **Endpoint name in user.json matches `Environment Name` from the list output**, not the ID. So if the env is named "PROD" the endpoint key is `"prod"` (lowercased by the CLI in some versions — read the file after `connect` to confirm).

- **Run the repo-local tool, never a global one: `dotnet tool run sitecore …`.** A global `sitecore.cli` (5.2.109) shadowed the repo's pinned local CLI, then refused to load the `Serialization` / `Publishing` plugins at the `sitecore.json` pin (6.0.23) and at the only version `plugin add` offered (7.0.24): *"Plugin is not supported by the current version of the CLI"*. `dotnet tool run sitecore` (6.0.23, from `.config/dotnet-tools.json`) worked (measured 2026-09-28).
- **Never bump one plugin pin in `sitecore.json` on its own.** Plugin versions track the CLI major. Move the CLI in `.config/dotnet-tools.json` and every `Sitecore.DevEx.Extensibility.*` pin together, or not at all.

## A pull that finds 0 changes is not proof the tree is in sync

`ser pull` diffs by **revision**, not by value. A live write that does not bump `__Shared revision` / `__Revision` is invisible to the pull, which reports *"Discovered 0 changes"* while the tenant and `cm/` disagree. Measured twice in one build (2026-09-27 → 28): a rendering registered live but missing from the serialized `Renderings` field, and three renderings newline-joined into it, both with disk and live revisions identical.

- **After a raw live write, grep the pulled YAML for the new value.** A "0 changes" result proves nothing about a field you just wrote.
- **To force it through, re-write the field with a normal `updateItem`** (a real value change, such as normalising a GUID's format). That bumps the revision, and the next pull applies it.
- **Re-pull after the LAST live write of a unit of work,** not just after the write that prompted the pull. A fix applied after the pull stays live-only until the next one.

## Pushing into a CM that builds from the repo (items as resources)

A repo-deployed CM serves serialized items as read-only resources; a CM edit makes a DB copy that silently wins over git forever after. Before any push to such a CM, read `references/serialization-overlays.md`. The short form:
- `ser push` skips items that exist only as resources (90 of 1,026 written in one module), so it is not a way to materialize a module into the DB.
- A DB-only item at a git item's path (a CM-generated site thumbnail, a duplicate template folder) aborts push AND pull with `NonUniquePathException`; clear it first, in the order the reference gives.
- Measure overlays by `__Revision` as well as values; `--trace` truncates long values, so a "byte-identical" blob may be a prefix compare.
- `-n <endpoint>` and `-i <module>` on every op, the endpoint host asserted, `--what-if --trace` first, every `[D]` explained.

Moving a site's delivery to another tenant (probe → clean → push → publish → parity → repoint → revert): `references/estate-move.md`.

## Adjacent: reading an environment's git link from the Deploy API

`GET /api/environments/v1/{id}` carries **no** `repositoryDetails`. Read the link (`repositoryDetails`, `repositoryBranch`, `deployOnCommit`) from **`GET /api/environments/v2/{id}`**. A v1 read reports every environment as unlinked.

## Stop Conditions

- **Stop and ask** if `cloud project list` returns multiple projects whose names look plausible — never guess. The org may have 10+ projects.
- **Stop and ask** if the environment list shows multiple envs (e.g., `PROD` + `solo-website` + ...). The right env is the one whose `Environment Host` matches the host in the existing layout response (or the host in `.env.local`'s `SITECORE_API_HOST` if set).
- **Do not enable push** (`--allow-write` on connect, or hand-toggling endpoint to allowWrite=true with intent to push) without explicit user approval. Pulls are recoverable; pushes overwrite tenant state.
- **Do not delete `.sitecore/user.json`** to "reset" — it carries the live token. Re-login from scratch if reset is needed.

## Verification

- After step 6, the pull output should end with `[<env>] Changes have been applied to serialized items (N subtrees).` and a `[roles]` + `[users]` summary. If you see `[<env>] Discovered 0 changes after evaluating N total items.` and no errors, nothing with a **newer revision** exists on the tenant. That is not the same as "in sync" (§ A pull that finds 0 changes).
- The CLI updates `.sitecore/user.json` with `"lastUpdated"` and a fresh `accessToken` on each command — that's expected.

## Related

- `sitecoreai-serialization` — module DESIGN: what to serialize, include scope and push policy, one module per collection in its own folder, items-as-resources vs `scsModules`, the push that stops at a missing template. Read it before creating or changing a `*.module.json`.
- `setup-content-sdk` — canonical scaffold; CLI must be installed before this skill applies.
- `content-sdk-debug-layout-probe` — useful after pull to compare local YAML vs live layout response.

## References

- [Sitecore CLI overview](https://doc.sitecore.com/xmc/en/developers/xm-cloud/sitecore-command-line-interface.html)
- [`Sitecore.DevEx.Extensibility.XMCloud` plugin docs](https://doc.sitecore.com/xmc/en/developers/xm-cloud/serialization-with-the-sitecore-cli.html)
