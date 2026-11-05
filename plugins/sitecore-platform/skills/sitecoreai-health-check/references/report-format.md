# Report format

`doctor.mjs` writes `doctor-report-<YYYY-MM-DD>.md` and a `.json` twin into `--out` (a `-2`, `-3` suffix when the name exists).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | clean: no finding at P1 or above and no UNKNOWN check (P2/P3 findings and SKIPPED checks allowed) |
| 1 | at least one finding at P1 or above, or at least one UNKNOWN check (an instrument error is never clean) |
| 2 | harness error: bad arguments, X0 binding failed, or a crash. The report is still written when possible |

The four gate scripts use their own mapping: 0 pass, 1 fail (a blocker finding), 2 unknown.

## Check statuses

| Status | Meaning |
|---|---|
| pass | ran and found nothing (notes say what was covered) |
| findings | ran and found at least one finding |
| unknown | the instrument failed (HTTP error, GraphQL error, truncation, transport). **Never read as clean** |
| skipped | did not run: missing credential, out of scope, not implemented, or needs a local checkout. The reason is printed |
| degraded (flag) | ran with less fidelity than the contract asks, e.g. a crawl without a browser |

## Finding (JSON)

```json
{
  "check": "L4", "severity": "P1", "title": "Rendering datasource (s:ds) is missing",
  "item": "/sitecore/content/<collection>/<site>/Home/page", "itemId": "{GUID}", "target": "{GUID}",
  "url": null, "items": null, "evidence": "field __Renderings; target {GUID}",
  "remediation": "Repoint or clear the field on master, verify on preview, then publish the item.",
  "fix_owner": "cms | code | ops", "may_be_intentional": false, "blocker": false, "reverse_drift": false,
  "fingerprint": "10-hex sha1 of check|title|item|url|target",
  "links": { "pages": "https://pages.sitecorecloud.io/editor?…&sc_itemid=…", "contentEditor": "<cm>/sitecore/shell/Applications/Content%20Editor.aspx?fo={GUID}&la=en" }
}
```

- `items[]` groups one cause across many items (for example 39 items whose template is gone) instead of 39 findings.
- `blocker: true` marks what fails a go-live gate. The doctor reports it as an ordinary finding at its severity.
- `links` appear when an item id exists. The Pages link format is the one Pages itself uses; the Content Editor link is the classic shell URL and is unverified on every tenant.

## Markdown layout

1. Title, version, exit code and its meaning (plus the harness error, if any).
2. **Target**: scope, CM env, CM host, site, root, page, language, URL, visibility, check filter.
3. **Summary**: P0 / P1 / P2 / P3 / UNKNOWN / SKIPPED / passed / degraded counts.
4. **Do not republish** banner when any finding has `reverse_drift`.
5. **Findings** by severity: title, layer/surface/owner/fingerprint line, item or URL, affected list, evidence block, remediation, deep links.
6. **UNKNOWN** table, **SKIPPED** table, **Degraded** table, **Passed** table with coverage notes.
7. **Instruments** (what truth each one saw), **Credential matrix** (names, never values), **Run cost** (calls per host, bytes, wall time, 429s, guard refusals).

## Redaction

Always: tokens, client ids/secrets, cookies, context ids, JWTs and the editing-debug `sent/expected` pair. With `--redact` (for copies shared outside the team): the CM host, every `xmc-*.sitecorecloud.io` host, the Edge media tenant segment, env/org/project ids and the tenant name.
