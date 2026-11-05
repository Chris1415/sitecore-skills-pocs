---
name: content-sdk-component-review
description: "Reviews one Content SDK component before promotion: verdict per axis (authorability, editing safety, naming, variants, data, scoping, lists, serialization), static and live read-only. Use before merge. Not planning or debugging."
license: Apache-2.0
compatibility: "Content SDK head apps (App Router default; the axes are router-agnostic) on SitecoreAI with a serialized CM (Sitecore Content Serialization). Bundled scripts need Node 18+ and no dependencies. The live leg needs a client-credentials automation client that can read Authoring GraphQL."
metadata:
  author: Christian Hahn
  version: "0.1.3"
---

# Content SDK — Component Review

The costly defects on this stack **all render correctly**: a component an author cannot edit, a datasource that lands in another site's tree, a list whose rows nobody can add, a template whose base chain resolves to nothing. Build, unit tests and a code review of the diff all pass. This skill is the review pass for the **Sitecore artifact**, not just the code: rendering item, templates, head-app component and serialization, judged together.

It is the counterpart of `content-sdk-feature-planner`: the planner decides before the build, this checks the build against the same axes.

## When to use

- Before merging or promoting a new or changed component (rendering + templates + head-app code + serialization).
- When taking over a component someone else built ("is this actually authorable?").
- As the review step of a delivery loop, per component.

**Not for:** the health of a whole environment or site (`sitecoreai-health-check`), debugging a component that misbehaves (`content-sdk-troubleshooting`), deciding what to build (`content-sdk-feature-planner`).

## Inputs

| Input | Required | Use |
|---|---|---|
| Component name + head-app path | yes | `src/components/<Name>/`, the component map |
| CM path (`<cm>/authoring/items/`) | yes | rendering item, templates, branch, Standard Values as YAML |
| The planner's blueprint | no | when present, review **built vs planned** row by row: every decision row is a check, and a row the build silently changed is a finding |
| Expected tenant + Authoring endpoint | for the live leg | the binding proof below |

Without a blueprint, review against the planner's decision axes; the axis table below follows them.

## Verdicts, not a score

Each axis gets **PASS / FAIL / UNKNOWN**, with a severity **P0–P3** on a FAIL (same scale as `sitecoreai-health-check`):

| Sev | Means |
|---|---|
| P0 | broken for every author or visitor now (component un-editable, renders nothing, base chain empty) |
| P1 | breaks a real author task or the next push (no way to add a row, datasource in the wrong tree, a push that strands items) |
| P2 | degraded or risky (raw `.value` on one field, missing editing escape on a guard, a waiver without a reason) |
| P3 | hygiene (comment walls, icon gaps, density) |

**UNKNOWN never counts as a pass.** A script that could not run, a missing credential or an axis you could not evidence is UNKNOWN, and stays visible in the report. A score would hide the one failing field behind a good average; a verdict per axis cannot.

## The axes

Full checks, evidence sources and default severities: `references/axes.md`.

| # | Axis | Leg | Owning skill |
|---|---|---|---|
| A1 | Authorability: every authored value arrives on `fields` and renders through an SDK field component; exceptions per field, each with a reason | static + human | — (`scripts/audit-component-authorability.mjs`) |
| A2 | Editing safety: renders in Pages edit, preview and the design library; empty fields stay selectable | static + human | `content-sdk-app-router-editing-safe-rendering` |
| A3 | Registration and naming: component map key = `componentName`; only registered `.tsx` under `src/components/<Name>/` | static | `content-sdk-component-naming-traps` |
| A4 | Variant vs sibling: one rendering with variants, or a deliberate sibling; variant file naming | static | `content-sdk-variants-vs-siblings` |
| A5 | Data strategy: plain fields vs resolver vs ComponentQuery; no fetch replacing `fields`; Edge depth budget | static | `content-sdk-resolver-patterns` |
| A6 | Content model and scoping: Datasource Template is a path, Datasource Location is site-relative (no hard GUID pin), params template linked, local datasources under `<Page>/Data`, shared renderings forked not mutated | static + live | `content-sdk-create-component` |
| A7 | List wiring (list components only): the four legs | static + live + human | `content-sdk-list-component` |
| A8 | Template integrity: every project template's base chain resolves in the live engine | **live only** | — (`scripts/check-template-base-chain.mjs`) |
| A9 | Serialization completeness: rendering, templates, branch, placeholder settings and Standard Values all covered; a template is serialized wherever its items are | static | `sitecoreai-serialization` |
| A10 | Comment economy: a comment says WHY in a line or two; walls are a smell | static | — (`scripts/audit-comment-density.mjs`) |
| A11 | Cross-cutting, where relevant: dictionary keys with a literal default, personalization scope, consent gating, cache tags | static | per concern (see `references/axes.md`) |

**Mandatory axes** (an UNKNOWN blocks promotion): A1, A2, A3, A6, A8, A9, and A7 for a list component.

## Procedure

### 1. Scope the unit

Name the component and collect its parts: `src/components/<Name>/*`, the map entry, the rendering item, its datasource template(s), params template, branch (list components), Standard Values, and the module include that should cover them. A part you cannot locate is already a finding (A9 or A6).

### 2. Static leg: run the bundled scripts

```sh
node scripts/audit-component-authorability.mjs --app <head-app> --json   # A1, A2 (guards), A11 (literal microcopy)
node scripts/audit-sitecore-schema.mjs --cm <cm> [--brand <b>] --json      # A6, A7 (grouping base), A9 hints, icons
node scripts/audit-comment-density.mjs --path <head-app>/src/components/<Name> --json   # A10
```

Exit codes: 0 clean, 1 findings, 2 harness or waiver-file error (treat 2 as UNKNOWN on the axes that script owns). Filter the output to the component under review; the scripts audit the whole app or CM. A clean run on a brand with zero renderings is not a pass: the schema audit fails that case by design.

Then read the code and YAML for what no script sees: A3 map key vs `componentName`, A4 variant naming, A5 data shape, A9 module coverage (`ser explain -p <path>` names the owning module), A11.

### 3. Live leg: read-only, bound to one tenant

Run only when the component exists on a tenant. **Prove which tenant you read before you trust any answer:**

- Pass the expected tenant explicitly; never infer it from a hostname or a default profile.
- `scripts/check-template-base-chain.mjs` refuses to run (exit 2) unless the token's tenant claim matches `--expect-tenant`.
- Use a **known-good and a known-bad control**: one item you know exists must come back, one path you know does not must come back null. An instrument that cannot return "missing" proves nothing.
- **Never write.** No mutation, no publish, no `ser push`. A fix is a separate step with its own owner.

```sh
SITECORE_CLIENT_ID=… SITECORE_CLIENT_SECRET=… \
node scripts/check-template-base-chain.mjs --cm <cm> --expect-tenant <tenant-name> --brand <b> --json   # A8
```

Credentials may also come from `--env-file <file>`. `--endpoint` overrides the Authoring GraphQL URL, which otherwise derives from the bound tenant (`https://xmc-<tenant>.sitecorecloud.io/…`). Exit 2 means *could not check* (no templates found, refused binding, query error), never a broken chain: measured 2026-10-13, the wrong tenant was refused and the right one checked 90 templates with 0 broken.

Credentials: a client-credentials automation client (`sitecoreai-auth`). Then read the rendering item, Standard Values and list legs with the queries in `references/live-recipes.md` (A6, A7). Why A8 must be live: Content Serialization writes `__Base template` one GUID per line either way, so a correct and a broken live value serialize to identical YAML.

### 4. The human check

**Acceptance line: an author can find and change every value.** A static PASS on A1, A2 or A7 is necessary, not sufficient. For a new component, one person opens it in Pages, selects each field and edits it, and for a list adds a row. Record the result as evidence; without it A1/A2/A7 cap at PASS (static) and the report says so.

### 5. Built vs planned (blueprint present)

Walk the blueprint's decision table. For each row: what was decided, what was built, MATCH / DRIFT. A drift with a recorded reason is fine; a silent drift is a P2 finding (P1 when it moves a datasource, the list legs or the module).

### 6. Report and gate

Write the report in the shape of `references/output-format.md`. **Gate:** any P0 or P1 FAIL, or any UNKNOWN on a mandatory axis, means **not promotable**. Each finding names an owner: `code` (head app) or `cms` (items, templates, serialization).

## Waivers

Each script reads a waiver file beside its target, and every entry needs its **own reason**:

| Script | File | Where |
|---|---|---|
| authorability | `.authorability-ignore.json` | head-app root; `components` and per-field `fields` (`"<Component>.<Field>"`) |
| schema | `.schema-audit-ignore.json` | CM root; loose datasources carry their own `reason` |
| comment density | `.comment-density-ignore.json` | the audited path |

An entry without a reason makes the script exit 2. A waiver that no longer matches anything is reported as stale: remove it. In the review, list every waiver that touches the component; a waiver whose reason does not hold up is a finding, not a pass.

## Gotchas

- **The scripts audit the whole app or CM.** A component can look clean while its neighbour fails; filter by component, and report findings outside the scope separately rather than dropping them.
- **A1 cannot prove the right fields are rendered**, only that field components are used. It also cannot prove inline editing works on the canvas: that is the human check.
- **Do not "fix" the schema audit's lenient `__Base template` parser.** It must accept both separators, or every correctly serialized brand fails; the live A8 check is where a broken chain shows.
- **Preview is permissive.** A component that renders on preview has proved nothing about live delivery; that is `content-sdk-troubleshooting` territory, not a review verdict.

## References

- `references/axes.md`: per axis, what to check, evidence, default severity, script or skill.
- `references/live-recipes.md`: read-only Authoring GraphQL queries for A6–A8.
- `references/output-format.md`: output layout, finding schema, gate rule.
- Related: `content-sdk-feature-planner` (blueprint), `sitecoreai-health-check` (environment doctor), `content-sdk-troubleshooting` (symptoms), `sitecoreai-graphql-schemas` (shapes).
