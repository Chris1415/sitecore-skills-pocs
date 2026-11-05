# Review output format

One review per component. Markdown for people; the same fields as JSON when a pipeline consumes it.

## Layout

```markdown
# Component review — <ComponentName>

- **Scope:** <head-app path> · <cm path> · rendering <item path>
- **Blueprint:** <path, or "none — reviewed against the planner's axes">
- **Live leg:** <tenant name, endpoint host, controls: good ✔ / bad ✔> — or "not run: <reason>"
- **Human check:** <who, when, what was edited> — or "not done"
- **Verdict:** PROMOTABLE | NOT PROMOTABLE (<the rule that decided it>)

## Axes

| Axis | Verdict | Sev | Evidence | Owner |
|---|---|---|---|---|
| A1 Authorability | PASS (static) | — | authorability script: 0 defects for <Name> | code |
| A6 Content model and scoping | FAIL | P1 | `Datasource Location` = `{GUID}` (rendering YAML, line 14) | cms |
| A8 Template integrity | UNKNOWN | — | live leg not run: no credentials | — |
| … | | | | |

## Findings

### F1 — <one line> (P1, cms)
- **Evidence:** <file:line, item path, query + response excerpt>
- **Remediation:** <the change, and the skill that carries the procedure>
- **Built vs planned:** <MATCH / DRIFT with blueprint row, if a blueprint exists>

## Waivers in scope

| File | Entry | Reason | Holds up? |
|---|---|---|---|

## Out of scope, noticed

<findings on other components the scripts reported; listed, not judged>
```

## Finding schema (JSON)

```json
{
  "axis": "A6",
  "verdict": "FAIL",
  "severity": "P1",
  "title": "Datasource Location pinned to one site",
  "evidence": [{ "kind": "file", "ref": "authoring/items/…/Rendering.yml:14" }],
  "remediation": "Replace with a site-relative query; see content-sdk-create-component",
  "owner": "cms",
  "blueprint": { "row": "2", "status": "DRIFT" }
}
```

`verdict` ∈ `PASS` · `FAIL` · `UNKNOWN`. `severity` only on `FAIL`. `owner` ∈ `code` · `cms`. Every `UNKNOWN` carries its reason (script exit 2, no credential, part not found).

## Gate rule

**Not promotable** when any of:

1. a FAIL at P0 or P1 on any axis;
2. an UNKNOWN on a mandatory axis: A1, A2, A3, A6, A8, A9, and A7 for a list component;
3. a waiver in scope without a reason, or with a reason that does not hold up.

P2 and P3 FAILs are recorded and tracked but do not block. A1, A2 and A7 without the human check are recorded as `PASS (static)`; the gate accepts them, and the output never upgrades them to a plain PASS.

## Reading rules

- Compare counts: a script that reports 0 findings over 0 components audited a different path. Name what was audited.
- A clean result from the whole-app scripts is not a verdict for this component until filtered to it.
- Keep evidence reproducible: the command, the path, the query. "Looked fine" is not evidence.
