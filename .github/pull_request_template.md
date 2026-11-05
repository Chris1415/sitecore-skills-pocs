## What and why

## Evidence

For a skill change: what you ran, the output, the versions and the date.

## Checks

- [ ] `node tests/run.mjs`
- [ ] `node tools/skill-lint.mjs`
- [ ] `node scripts/gen-agent-manifests.mjs --check`
- [ ] `node tools/catalog.mjs --check`
- [ ] `node tools/scrub.mjs --public-only`
- [ ] `node tools/release-check.mjs --base origin/main`
- [ ] Versions raised for each changed skill and plugin, and the marketplace
- [ ] `CHANGELOG.md` updated
- [ ] No credentials, tenant ids, customer names or absolute paths
