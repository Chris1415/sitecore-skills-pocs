---
name: content-sdk-atomic-design-assessment
description: "Assesses a Content SDK head app for Atomic Design: scan src/components, rate each low-code candidate / partial / keep-code, derive the atom set, plan a side-by-side migration. Use when asked which components could become atoms. Not writing atoms."
license: Apache-2.0
compatibility: "Any Content SDK Next.js head app (the scan is read-only, Node 18+). Migrating needs @sitecore-content-sdk/nextjs beta.atoms; see content-sdk-app-router-atoms."
metadata:
  author: Christian Hahn
  version: "0.1.2"
  status: beta
  verified: "2026-10-29: scanner run on a carefully authored production app (15 files), Sitecore kit-nextjs-skate-park (13) and kit-nextjs-article-starter (98), 9 verdicts spot-checked by reading source"
---

# Atomic Design assessment for an existing head app

Answers one customer question: **which of our components would be better as atoms + composed Documents, and what would moving them cost?** The output is a report with a verdict per component, a proposed atom set and a migration plan. Nothing is changed.

## 0. Frame it honestly first

Say these before any scan, because they decide whether the assessment is worth doing:
- **Atoms are beta** (`beta.atoms` dist-tag only, exact pins, React only). Check `content-sdk-app-router-atoms` § 1 for the current stamp.
- **The payoff is marketer autonomy**: new section layouts composed in Design Studio without a deploy. A team that ships few new section types gains little.
- **Design Studio low-code access on the customer's tenant is `[UNVERIFIED]`** (gating unknown). Without it a Document can be rendered only from a mock MMS: no way to write one to a tenant is known, so there is nothing to migrate to.
- **Page structure stays code.** Placeholders, splitters, containers, partial designs, navigation, search, forms and personalization are not atom territory.

## 1. Scan

```sh
node scripts/scan-atomic-candidates.mjs --app <head-app-dir> --md > atomic-scan.md
node scripts/scan-atomic-candidates.mjs --app <head-app-dir> --json atomic-scan.json
```

It reads `src/components/**`, honours the app's `componentMap.exclude`, follows local imports one level, and prints per file: verdict, leaf primitives used, variants, fields and the reasons (signal + line). Then it prints the atom inventory ranked by coverage and what Content Kit lacks.

| Verdict | Meaning | Typical members |
|---|---|---|
| `low-code-candidate` | Only authored fields + static markup + param/variant styling | Content block, rich text, promo without logic, simple CTA, quote, stat |
| `partial` | Composable core with something a Document cannot do: a list over datasource children, route-context fields, structured data, editing-only branches, size | Card lists, title with route fallback, promo with JSON-LD |
| `keep-code` | Data fetching, client state, event handlers, forms, placeholders, personalization | Navigation, search, forms, splitters, containers, header/footer |

**It is a triage aid, not a decision.** Measured blind spots (2026-10-29): regex not a TS parse; logic two imports deep is invisible; a shared helper with `useState` taints every importer (Sitecore's starter `Icon.tsx` turned every icon button into keep-code); conditional wrapping (link around an image only outside editing) is not seen; variant files (`Hero.Split.tsx`) count as separate components.

## 2. Read every non-keep-code verdict

For each `low-code-candidate` and `partial`, open the source and answer:

1. **Leaves.** Is every authored value a Text / RichText / Image / Link / Date field? Anything else (number display, checkbox-driven logic, multilist) needs a custom atom or stays code.
2. **Lists.** Does it render datasource children or a multilist? Treat as `partial`: whether a Document can iterate a list is `[UNVERIFIED]`. Plan a code container whose items are low-code, or keep it.
3. **Variants.** How many presentations exist (`FieldNames` / named exports / variant files)? Many presentations over the same fields is the strongest signal FOR atoms: each becomes a Document, not a code variant.
4. **Editing behaviour.** Does it branch on `page.mode.isEditing` to show empty-field placeholders? A Document cannot. Inline editing inside atoms is `[UNVERIFIED]`, so a component whose authors rely on inline editing pays a real authoring cost.
5. **Dictionary / i18n labels.** Fixed microcopy from the Sitecore Dictionary or `next-intl` has no binding in a Document. Move it to a field or keep code.
6. **Change frequency.** How often does marketing ask for a new look of this? Low demand → low value, whatever the verdict.

Upgrade or downgrade the scanner's verdict and record why. Measured spread: a carefully authored production app (15 components) came out 0 / 12 / 3, because every component carries editing branches and dictionary labels; Sitecore's article starter 14 / 7 / 77.

## 3. Derive the atom set

From the confirmed candidates, decompose each into elements and collect:

- **Leaf atoms** = the primitives in the scan's inventory (Heading, Paragraph, Image, Button/Link usually cover 70–80%). Start from Content Kit's leaf atoms and add only what the inventory demands (Date, Quote, Icon, Badge, List item).
- **Container atoms** = recurring wrappers (`flex` / `grid` / card shells). Content Kit's `Container` is a generic flex wrapper with free CSS values; a governed token Stack comes first when composers should only pick from a scale, Grid second.
- **Tokens, not classes.** Every repeated design decision in the existing components (spacing steps, tones, heading sizes, radii) becomes an enum prop on an atom. If the existing code uses arbitrary values, that inconsistency surfaces here; resolve it with the design owner before writing atoms.
- **Target 8–15 atoms.** More means the atoms have become components; fewer means composers fall back to `className`.

Write each atom with `content-sdk-app-router-atom-create`.

## 4. Plan the migration (side-by-side, never in place)

Per candidate component:
1. **Keep the datasource template and its field names.** A Document binds `{"$state": "/fields/<Name>"}`, so existing datasource items render unchanged once the field names match. That is the cheapest path and avoids a content migration.
2. **New rendering, same datasource.** Create a rendering on the CM's Hosted JSON Rendering template with its `ComponentRef` pointing at the Document path; keep the old code rendering available.
3. **Compose the Document** in Design Studio (by hand only against a mock MMS) reproducing the current look; variants become further Documents (`<default>|<Variant>` refs).
4. **Swap per page**, compare visually against the code version, then retire the code rendering when no page uses it.

Order the work in waves:
- **Wave 0, probe (mandatory).** First gate: **does Design Studio open `library-low-code` on this tenant?** Read the editing host's runtime log for the mode. On one test environment on 2026-11-03 (stamp `20261021204512`, six atoms, lock passing, site bound to a running editing host) the editing host's log showed 30 Design Library sessions, all mode `library`, none `library-low-code`, and a Design Studio draft component opened with no `ComponentRef`, so it rendered as an unknown component. If it does not, stop here. Then one simple candidate end to end on a non-production tenant: Document storage, ComponentRef delivery on preview **and** live, runtime CSS on the real host, editor experience. Most `[UNVERIFIED]` items in the atoms skill resolve here or kill the plan.
- **Wave 1.** Atoms + the highest-variant candidates.
- **Wave 2.** `partial` components as hybrids (code container, low-code items).
- **Never.** `keep-code`.

## 5. Report

Write `atomic-design-assessment.md` with:
1. **Context:** app, SDK version, router, component count, the § 0 framing and whether Design Studio low-code is available.
2. **Verdict table:** component, scanner verdict, final verdict, reason, variants, monthly change demand (if known).
3. **Proposed atom set:** atom, kind (leaf / container), props (fields + enums), covers which components, Content Kit or custom.
4. **Token decisions** the atoms freeze (spacing, tone, type scale), with open questions for the design owner.
5. **Migration waves**, with Wave 0's probe questions explicit.
6. **Costs and risks:** beta pins on the whole app, authoring changes (inline editing, empty-field placeholders), CI lock gate, runtime CSS on the host, the cache-components incompatibility, team skills (atoms are code; composition becomes a content task needing governance).
7. **Recommendation:** go / pilot / not now, in one paragraph.

## 6. Stop conditions

- The app is Pages Router, cache-components, Angular or .NET: report it. Atoms there are unstyled, return 500, or do not exist.
- Fewer than ~5 confirmed candidates: recommend **not now**. The fixed cost (beta upgrade, CI, governance) needs volume.
- The customer cannot get Design Studio low-code on a tenant: recommend **pilot only after access is confirmed**.
