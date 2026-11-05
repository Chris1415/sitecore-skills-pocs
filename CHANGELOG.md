# Changelog

Marketplace versions. Each plugin and skill also carries its own version.

## 0.31.0 — 2026-11-05

### Changed

- `content-sdk-app-router-atoms` 0.4.0: Content Kit `Container` atom and its nested-columns defect, the `capabilities` editing config from stamp `20261104121033`, the Create component route to the builder, and a recipe for adding one atom to an existing app.
- `content-sdk-atomic-design-assessment` 0.1.2: Content Kit now has a container atom.

### Fixed

- `content-sdk-app-router-atoms`: an empty `library` log no longer counts as evidence that low-code is off; the editing host log cannot show it.

## 0.30.0 — 2026-11-05

### Fixed

- `sitecoreai-health-check` 0.2.7: the live-template gate reports "Template with id … was not found" as a P2 advisory instead of crashing, and stays inside Edge's complexity budget. The link crawl fails a video, audio or image source on a dev host.

## 0.29.0 — 2026-11-05

### Fixed

- A setup example showed a real organization id; it is now a placeholder, and the scrub tool rejects the shape.

## 0.28.0 — 2026-11-05

### Fixed

- Grammar in skill text and descriptions after the rename to SitecoreAI.

## 0.27.0 — 2026-11-05

### Changed

- CI runs the tests inside the skills, not only the repository's own checks.
- `content-sdk-app-router-atoms`: the Content Kit notes cite dates instead of commits of a private repository.

## 0.26.0 — 2026-11-04

### Added

- `content-sdk-app-router-atom-create` (beta): deciding atom vs component, the schema (field schemas plus enum tokens), the renderer, container slots and the lock lifecycle. Bundles `scripts/mock-edge.mjs`, a mock Edge/MMS, for a tenant-free `next build && next start` proof.
- `content-sdk-atomic-design-assessment`: which existing components could become atoms. Bundles `scripts/scan-atomic-candidates.mjs`, a read-only scanner that rates each component candidate, partial or keep-code, plus a review rubric and a side-by-side migration plan.

### Changed

- `content-sdk-app-router-atoms` 0.3.0: re-measured on `3.0.0-beta.atoms.20261021204512`. Since that stamp the beta is stable 2.4.1 plus atoms. Also covers the bridge changes, Document validation, theme preview and the Content Kit fix-up recipe.
- `content-sdk-upgrade-assistant`: the beta is no longer described as a fork of pre-2.3.
- `content-sdk-app-router-atoms` pins its scaffold to the measured stamp and says that a newer `beta.atoms` stamp exists and is unmeasured. Design Studio claims are marked `[UNVERIFIED]`, with the 2026-11-03 observation that it only opened `library` mode.

## 0.25.0 — 2026-11-04

`sitecoreai-site-template` 0.4.0, from a real brand-template build through the skill (2026-10-24). Each change has an offline test. The generated PowerShell has been read, not executed on a CM.

### Added

- `datasource.children` creates child items under a page, partial or blueprint datasource, and `datasource.insertOptions` writes the datasource's `__Masters`, so a site made from the template is not blank and authors can add rows in Pages. `verify-template` and `build-blueprint --smoke` read both back.
- `dictionary[]` and `settings{}` in the spec. An unknown top-level spec key now warns instead of vanishing.

### Fixed

- A `variant` on a custom rendering lost the component, because only OOTB renderings ship a `Headless Variants/<rendering>` folder. The generated script now creates the folder and the definition.
- PowerShell literals: all five single-quote look-alikes are doubled, and spec values never reach a double-quoted string or a comment.
- `remove-template` refuses while a module root holds items the generator did not create, including under `Templates` and the script library's `Functions` (`--force` overrides, and names the sites it breaks). An invalid spec now exits 2.
- A placeholder is escaped where it reaches a double-quoted PowerShell string, and a placeholder outside letters, digits, `_ { } / -` is a spec error.
- The dictionary item-name pattern lost its backslashes when emitted, so `a/b` stayed `a/b`. Keys that give the same item name are now an error, and duplicates are checked case-insensitively across page types, pages, partials, blueprints and datasources.
- `verify-template --smoke` fails when the scaffold job is gone or timed out, and says when the Edge check was skipped.
- `variant` and `site:` tokens inside a blueprint are spec errors instead of vanishing. `extract-spec --page` warns when a captured page needs them.

## 0.24.1 — 2026-11-04

### Fixed

- `sitecoreai-site-template`: `verify-template --smoke` removes a collection only when this run created it, and `--collection` without `--keep` is refused (exit 2). Before this, smoke cleanup could remove a reused collection with everything in it.
- The same guard for sites: a site name that already exists is refused before anything is created, and `--site-name` requires `--keep`. Generated names keep their stamp when a long module name is cut, and the cleanup log says when a removal failed.

## 0.24.0 — 2026-11-04

Prepared the repository for public use.

### Changed

- The README is rewritten for a first-time reader, with honest limitations and tested-with versions.
- Skills no longer point to private projects or documents. Lessons, measurements and dates stay. Every changed skill and plugin has a higher version.
- `sitecore-marketplace` and `sitecore-setup` manifest descriptions now match what the plugins contain. Scaffolds are in `sitecore-setup`.
- CI: pull requests from forks run the public scrub rules, because GitHub gives forks no secrets. Pushes to `main` and same-repo pull requests still run the private scan, and fail if the secret is missing.
- The scrub tool has more public rules, with tests that plant a hit for each.
- `scripts/sync-sitecoreai-apis.ps1` defaults to `plugins/sitecore-platform/skills`, and writes specs to the system temp folder.

### Fixed

- `content-sdk-playground-pattern` scaffolded with the Pages Router template. It now uses `--template nextjs-app-router`, and it captures the Edge schema by per-type introspection, since Edge has no schema URL.
- `setup-content-sdk` stated the wrong number of App Router skills.
- `marketplace-sdk-client`: a self-link in the response unwrap matrix.
- `sitecoreai-graphql-schemas` pointed into a file of another plugin. It now names the skill.

### Removed

- Research leftovers: `docs/prep/`, `probes/`, one-shot scripts, the install probe workflow and the design notes.

### Added

- `CONTRIBUTING.md`, `SECURITY.md`, this changelog, and issue and pull request templates.

## 0.22.0 — 2026-11-04

### Changed

- **Breaking:** the router plugins now name Next.js: `sitecore-content-sdk-app-router` became `sitecore-content-sdk-nextjs-app-router`, and `sitecore-content-sdk-pages-router` became `sitecore-content-sdk-nextjs-pages-router`. Skill names did not change. Uninstall the old plugin and install the new one.
- **Breaking:** the personal `solo` plugin left this repository. What remains is eight `sitecore-*` plugins. Uninstall `solo` if you had it.
- `content-sdk-app-router-route-handler-vs-server-action` joined `sitecore-content-sdk-nextjs-app-router`.

### Added

- `sitecoreai-brand-voice` in `sitecore-platform`.
