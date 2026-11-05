# Contributing

Thanks for helping. This is a personal proof of concept with one maintainer, so small, focused changes get reviewed fastest. The most useful contribution is a correction backed by evidence: what you ran, what you expected, what you got, and which versions.

## Run the checks

You need Node 24 (the version CI uses) and no dependencies.

```bash
node tests/run.mjs                                # the checks themselves
node tools/skill-lint.mjs                         # skills and manifests
node scripts/gen-agent-manifests.mjs --check      # generated Cursor manifests
node tools/catalog.mjs --check                    # catalog.json and the guide's catalog
node tools/scrub.mjs --public-only                # private names in tracked files
node tools/release-check.mjs --base origin/main   # versions raised
```

If a manifest or catalog check fails, run the same command without `--check` and commit the result. Never edit `.cursor-plugin/`, `catalog.json` or the guide's `references/catalog.md` by hand: they are generated. [tools/README.md](tools/README.md) lists every check and lint rule.

CI runs the same checks. On a pull request from a fork, the scrub step uses the public rules only, because GitHub gives forks no secrets. The maintainer's runs cover the rest.

On Windows, turn on long paths first: `git config --global core.longpaths true`.

## Version bump rule

Claude Code caches a plugin per version, so a change without a version bump never reaches anyone who installed it. When you change anything under `plugins/<plugin>/`:

1. Raise `metadata.version` in each changed skill's `SKILL.md`.
2. Raise `version` in `plugins/<plugin>/.claude-plugin/plugin.json`, and the same plugin's `version` in `.claude-plugin/marketplace.json`.
3. Raise the top-level `version` in `.claude-plugin/marketplace.json`.
4. Add a line to [CHANGELOG.md](CHANGELOG.md).

## Skill format

A skill is a folder, `plugins/<plugin>/skills/<skill-name>/`, holding a `SKILL.md` and optional `references/`, `scripts/` and `assets/`.

```yaml
---
name: content-sdk-example        # lowercase, equals the folder name, starts with the plugin's prefix
description: "..."               # see below
license: Apache-2.0
compatibility: "..."             # what it needs, and the versions it was measured on
metadata:
  author: Your Name
  version: "0.1.0"
---
```

- **Keep the tree flat.** Claude Code finds `skills/<name>/SKILL.md` and not deeper folders (verified 2026-04-30). Do not add a top-level `skills/` folder: skills.sh finds the plugin folders through a recursive fallback, and a top-level folder stops that and forces `--full-depth`.
- **Keep `SKILL.md` short**, under about 5,000 tokens. Keep procedures in it, and move lookup material to `references/`.
- **A skill only points into its own folder.** To send the reader to another skill, use that skill's name, because the other plugin may not be installed.
- **State your evidence.** Keep the date and the measurement ("measured 2026-08-05 on a site with 35 datasources"). Mark an unconfirmed step `[probe-gated]` and say how to test it.
- **Keep it public.** No customer names, tenant ids, credentials, absolute paths or pointers to private documents.
- **Scripts** use plain Node with no dependencies where possible. A script that reads must not be able to write.

## Description format

The description decides when an agent loads the skill. It is a trigger, not a table of contents. Write it as **what · when · not**, with trigger words first, in at most 250 characters:

> Sitemap and robots.txt in a Content SDK App Router app: route handlers, rewrites, and the trap that an empty RobotsContent field serves 'Disallow: /'. Use when configuring SEO or a live site is not crawled.

- **What** it covers, naming the concrete things a person would ask about.
- **When** to use it: "Use when…".
- **Not** what it covers, when a neighbouring skill is easy to confuse with it: "Not…".

## Pull requests

Fill in the template. One topic per pull request. By contributing you agree that your work is licensed under [Apache-2.0](LICENSE).
