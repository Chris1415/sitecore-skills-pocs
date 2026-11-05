---
name: content-sdk-icon-chooser
description: "Picks a Sitecore icon for a rendering by name and purpose, probes it against the live icon server, then sets __Icon via Authoring GraphQL; blocks look-alike names that render blank. Use when scaffolding renderings or fixing blank icons."
license: Apache-2.0
compatibility: "SitecoreAI Authoring GraphQL v1. Icon paths from the office/16x16 set. SitecoreAI ships a REDUCED set — the catalog is a shortlist, not a guarantee; probe before writing (§ 0). All 102 catalogued paths re-probed green against a live tenant 2026-08-28."
metadata:
  author: Christian Hahn
  version: "2.5.2"
---

# Sitecore Icon Chooser

Picks the best matching icon from the Sitecore `office/16x16/` icon set for a rendering/component based on its name and purpose, then applies it via the Authoring GraphQL `updateItem` mutation.

## When to load

- Scaffolding a new rendering item in Sitecore (right after `createItem`)
- **As a mandatory step of the component-creation Definition-of-Done** (`content-sdk-create-component` § Icons) — every new rendering + datasource + folder + params template gets an `__Icon`
- Auditing renderings that have blank or wrong icons
- Bulk-assigning icons after a `dotnet sitecore ser push`
- Any time you need to set the `__Icon` standard field on a rendering

---

## 0. PROBE BEFORE YOU WRITE — the catalog is a shortlist, not a guarantee

**An icon in this catalog can still 404 on your tenant, and nothing downstream will tell you.**
A dead `__Icon` is not an error: the mutation succeeds, the field reads back exactly what you
wrote, serialization is clean, and `audit-sitecore-schema.mjs` reports the item as icon-clean —
because that audit is read-only and unauthenticated, so it can only check the field is
**non-empty**. The only symptom is a blank/default document icon in the content tree, which
nobody sees until an author opens it.

SitecoreAI ships a **reduced** icon set. On a live sweep against one SitecoreAI tenant on
**2026-08-08, 32 of 86 icons were dead** — every one a plausible, correctly-spelled name straight
from the Sitecore Icon Search tool. Those 32 were replaced with probed alternatives, and the
resulting catalog was **re-probed in full on 2026-08-28: all 102 paths resolve.** But **your
tenant's set may differ again**: the evidence is from one tenant, and whether the reduction is
uniform across SitecoreAI is unverified.

So, every time, before `updateItem`:

```bash
curl -sL -o /dev/null -w "%{http_code} %{content_type}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "https://<cm-host>/~/icon/office/16x16/<name>.png"
# 200 image/png = real.  404 text/html = dead, pick another.
```

Or run the bundled script, which asserts both § 0a controls first and exits 2 rather than judge anything when either misbehaves:

```bash
SITECORE_CM_TOKEN=… node scripts/probe-icon.mjs --host https://<cm-host> office/16x16/star.png office/16x16/tag.png
# exit 0 all resolve · 1 some dead · 2 harness untrusted (controls failed)
# --apply <itemId> additionally sets __Icon via § 5c and asserts the read-back
```

### 0a. Probe BOTH controls — a known-bad AND a known-good

Assert two controls in the same run, and abort the sweep if either misbehaves:

| Control | Expected | Catches |
|---------|----------|---------|
| `office/16x16/__control_not_real__.png` | `404` + `text/html` | An auth redirect being read as success — an **unauthenticated** GET returns 302→200 for *every* path |
| `office/16x16/window.png` | `200` + `image/png` | An **expired or unscoped token**, which makes every real icon look dead |

**The known-good control is the half that is usually missing, and it is the one that bites.**
Measured **2026-08-28** on one shared CM: a sweep reported **38 of 38 icons dead**, including
`star`, `tag`, `table` and `document_text` — all of which are real. The token in
`.sitecore/user.json` had expired two days earlier, so every request followed a redirect to the
Cloud Portal login page and came back **`200 text/html`, 2813 bytes**. The check `status === 200
&& content-type startsWith('image/')` did exactly what it was written to do and still produced a
100%-wrong answer, because a uniform failure is indistinguishable from a uniform absence without
a positive control. Re-run with a fresh token: **10 dead, 28 fine.**

A sweep where *everything* fails is a claim about your credentials, not about the tenant. Treat a
0%-pass rate as a broken harness until a known-good control says otherwise.

**The credential store is shared mutable state.** `.sitecore/user.json` is rewritten by any
`dotnet sitecore` command in any concurrent session, and it holds several endpoints (`default`,
`cm`, `xmCloud`, per-org) that do **not** all carry a token or point at the same host — picking
`Object.values(endpoints)[0]` can silently aim your probe at the Deploy API. Observed on the same
day: the file changed underneath a running investigation, so two sweeps minutes apart used
different credentials. Re-assert the controls on every run, not once per session.

**Prefer a non-expiring credential.** The Sitecore CLI's `accessToken` in `.sitecore/user.json`
lasts ~24 h and needs a human at a browser; a **client-credentials** token from the CM automation
client authorizes `/~/icon/` just as well and mints unattended. Assert the token's own
`tenant_name` claim, so the host and the credential cannot disagree.

**There is no substitution rule to infer from.** `Business/32x32/key.png` is dead where
`Office/32x32/key.png` serves — so the folder can be the problem. But `document.png` and
`flag.png` resolve under **no** folder, at **either** size, in **any** casing — so the name can
be the problem too. Do not reason from stock Sitecore, from another tenant, or from training
data. Probe.

**Reference implementation:** a CM-side `verify-icons.mjs` (the same shape as `scripts/probe-icon.mjs`, run over every module) sweeps every
`__Icon` in a serialized module and exits 1 on any that does not resolve
(`--brand <slug>` / `--all` / `--probe <icon>`). It mints its own client-credentials token and
asserts both controls from § 0a before reporting — it did neither until 2026-08-28, which is how
it produced the 38-of-38 false sweep described above.

---

## 1. Icon path format

The Sitecore `__Icon` standard field holds a relative path from the icon server root:

```
<folder>/<size>/<name>.<ext>
```

**Primary set (this skill):** `office/16x16/<name>.png`

The icon search tool shows paths as `~/-/icon/office/16x16/<name>.png` — **strip the `~/-/icon/` prefix** for the field value.

| Tool path (URL) | `__Icon` field value |
|-----------------|---------------------|
| `~/-/icon/office/16x16/document_text.png` | `office/16x16/document_text.png` |
| `~/-/icon/office/16x16/navigate_right.png` | `office/16x16/navigate_right.png` |

**SXA_MDI set:** `SXA_MDI/16x16/<name>.png` — used by SXA-native renderings (see § 4).

⚠️ **Paths are case-sensitive.** `office/16x16/Shopping_Cart.png` fails if the file is named `shopping_cart.png`. Use the exact casing from the catalog in `references/icon-catalog.md` § 3/§ 8.

⚠️ **A path is not a name.** Many icons are `<word>_<qualifier>.png` and the bare `<word>.png` does
not exist — `document_text` yes / `document` no, `find_text` yes / `find` no. Copy the value; do
not compose it. Full list: § 3a.

---

## 2. Decision algorithm

```
Given: renderingName (required), description (optional)

Step 1 — tokenize renderingName
  Split on: PascalCase, camelCase, hyphens, underscores, spaces
  Lowercase all tokens
  Examples:
    "DesignManifesto"     → ["design", "manifesto"]
    "NavigationBar"       → ["navigation", "bar"]
    "HeroImageBanner"     → ["hero", "image", "banner"]
    "ContactDetailsFolder"→ ["contact", "details", "folder"]
    "ProductCardItem"     → ["product", "card", "item"]

Step 2 — score tokens against keyword table (`references/icon-catalog.md` § 3)
  For each token, look up the keyword column
  Accumulate score per category (1 point per keyword match)

Step 3 — pick winner
  Highest-scoring category → use its Primary icon
  Tie → use whichever has the higher-priority token (navigation > container)
  No match → use `office/16x16/window.png` (generic container)

Step 4 — folder-type override
  If renderingName ends in "Folder", "Container", "Group" → `office/16x16/folder.png`
  If renderingName ends in "Item" only (no other category match) → `office/16x16/document_text.png`

Step 5 — SXA override (§ 4)
  If rendering is under /sitecore/layout/Renderings/Feature/Experience Accelerator/
  AND an SXA_MDI icon exists for this component type → prefer SXA_MDI
```

---

## 3. Semantic catalog

The keyword → path table per semantic category (navigation, content, media, layout, hero, cards, search, forms, social, people, e-commerce, blog, charts, map, settings, email, travel) lives in **`references/icon-catalog.md` § 3**. Read it when step 2 of the decision algorithm needs a category lookup; every path in it was probed green on 2026-08-28, but § 0 still applies — probe before you write.

## 3a. ⛔ Dead lookalikes — names that are NOT paths

**This is the single most productive defect in this skill's history.** The § 8 table has two
columns — a *semantic name* on the left and the *actual path* on the right — and for many entries
they differ. Reading the left column as a filename produces a plausible, correctly-spelled,
completely dead icon path.

Measured on one shared CM **2026-08-28**: one brand module carried **75 items across
10 dead icon values**, and **7 of the 10 are exactly this mistake**. Every other brand in the same
CM was clean apart from one other brand (9 items, 2 values).

**Every name in this table 404s. Never write one as an `__Icon` value:**

| ⛔ Dead name you will reach for | ✅ The path that actually exists | items hit (one brand) |
|---|---|---|
| `office/16x16/document.png` | `office/16x16/document_text.png` | 23 |
| `office/16x16/navigate.png` | `office/16x16/navigate_right.png` | 16 |
| `office/16x16/flag.png` | `office/16x16/bookmark.png` (or `megaphone.png` for campaigns) | 9 |
| `office/16x16/find.png` | `office/16x16/find_text.png` | 8 |
| `office/16x16/image.png` | `office/16x16/photo_landscape.png` | 7 |
| `office/16x16/settings.png` | `office/16x16/gearwheel.png` | 2 |
| `office/16x16/database.png` | `office/16x16/server.png` | 2 |
| `office/16x16/table_list.png` | `office/16x16/table.png` / `text_align_left.png` | 3 |
| `office/16x16/document_check.png` | `office/16x16/document_selection.png` / `clipboard.png` | 3 |
| `office/16x16/weather_sunny.png` | `office/16x16/sun.png` | 2 |
| `office/16x16/palette.png` | `office/16x16/photo_landscape.png` | 7 |
| `office/16x16/color_swatch.png` | `office/16x16/photo_landscape.png` | 2 |

Also confirmed dead on the same tenant, and all tempting: `list`, `list_bullets`, `checklist`,
`search`, `nav`, `form`, `picture`, `photo`, `gallery`, `images`, `view`, `magnifier`, `plane`,
`flight`, `luggage`, `route`, `direction`, `play`, `cog`, `sliders`, `check`*, `checkmark`,
`accept`, `apply`, `translate`, `language`, `weather`, `weather_cloudy`, `rain`, `snow`, `wind`,
`umbrella`, `speaker`, `bullhorn`, `binoculars`, `image_landscape`.

<sub>* `check.png` **does** resolve; `checkmark`/`accept`/`apply` do not. This is the point — there
is no rule, only the probe.</sub>

**The guard:** the value you write must be copied from the right-hand column of § 3 or § 8, never
retyped from the component's own vocabulary. Then probe it (§ 0).

---

## 4. SXA_MDI icon set (SXA-native renderings only)

For renderings under `/sitecore/layout/Renderings/Feature/Experience Accelerator/`, prefer SXA_MDI icons for visual consistency with SXA's own content tree.

| SXA rendering family | Icon path |
|---------------------|----------|
| Promo | `SXA_MDI/16x16/Promo.png` |
| Navigation | `SXA_MDI/16x16/Navigation.png` |
| Rich Text | `SXA_MDI/16x16/RichText.png` |
| Image | `SXA_MDI/16x16/Image.png` |
| Carousel | `SXA_MDI/16x16/Carousel.png` |
| Page Content | `SXA_MDI/16x16/PageContent.png` |
| Container | `SXA_MDI/16x16/Container.png` |
| Search Box | `SXA_MDI/16x16/SearchBox.png` |
| Search Results | `SXA_MDI/16x16/SearchResults.png` |
| Page List | `SXA_MDI/16x16/PageList.png` |
| Title | `SXA_MDI/16x16/Title.png` |

For **custom renderings in non-SXA projects**, always use the `office/16x16/` set.

---

## 5. GraphQL recipes

The four copy-ready Authoring GraphQL recipes — find a rendering by path (5a), browse a folder for a bulk audit (5b), update one icon (5c), batch-update (5d) — are in `references/graphql-recipes.md`. § 0 (probe both controls) still gates every write.

## 6. Complete worked example

**Goal:** Assign meaningful icons to all custom renderings under `/sitecore/layout/Renderings/Project/acme/`.

**Step 1 — Browse renderings:**

```graphql
query {
  item(where: { path: "/sitecore/layout/Renderings/Project/acme", language: "en" }) {
    children {
      nodes {
        itemId(format: D)
        name
        field(name: "__Icon") { value }
        template { name }
      }
    }
  }
}
```

**Step 2 — Apply the decision algorithm to each rendering:**

| Rendering name | Tokens | Matched category | Chosen icon |
|----------------|--------|-----------------|-------------|
| DesignManifesto | design, manifesto | Content (design+manifest) | `office/16x16/document_text.png` |
| ContactDetailItem | contact, detail, item | People/Contact (contact wins) | `office/16x16/telephone.png` |
| ContactDetailsFolder | contact, details, folder | Folder override (ends in Folder) | `office/16x16/folder.png` |
| ContactForm | contact, form | Forms (form wins over contact) | `office/16x16/checkbox_group.png` |
| DestinationCard | destination, card | Map/Location (destination wins) | `office/16x16/map.png` |
| DestinationsGridFolder | destinations, grid, folder | Folder override | `office/16x16/folder.png` |
| ExperienceItem | experience, item | Navigation (experience → journey) | `office/16x16/navigate_right.png` |
| ExperienceShowcase | experience, showcase | Hero/Promo (showcase → spotlight) | `office/16x16/sun.png` |

**Step 3 — Fire batch mutation:**

```graphql
mutation {
  r1: updateItem(input: { itemId: "aaa-guid", fields: [{ name: "__Icon", value: "office/16x16/document_text.png" }] }) {
    item { name field(name: "__Icon") { value } }
  }
  r2: updateItem(input: { itemId: "bbb-guid", fields: [{ name: "__Icon", value: "office/16x16/telephone.png" }] }) {
    item { name field(name: "__Icon") { value } }
  }
  r3: updateItem(input: { itemId: "ccc-guid", fields: [{ name: "__Icon", value: "office/16x16/folder.png" }] }) {
    item { name field(name: "__Icon") { value } }
  }
  r4: updateItem(input: { itemId: "ddd-guid", fields: [{ name: "__Icon", value: "office/16x16/checkbox_group.png" }] }) {
    item { name field(name: "__Icon") { value } }
  }
  r5: updateItem(input: { itemId: "eee-guid", fields: [{ name: "__Icon", value: "office/16x16/map.png" }] }) {
    item { name field(name: "__Icon") { value } }
  }
}
```

**Step 4 — Verify:** Re-run the Browse query (Step 1) and confirm all `field.value` entries are populated. Visually confirm in Sitecore Content Editor (requires page reload).

---

## 7. Pitfalls

| Pitfall | What happens | Fix |
|---------|-------------|-----|
| **Writing the semantic NAME as the path** | **The highest-volume failure.** `office/16x16/document.png`, `.../image.png`, `.../find.png`, `.../navigate.png` are all plausible, all spelled right, all dead. One brand shipped **75 blank items across 10 values** this way; 7 of the 10 were § 8 left-column keys used as filenames | Copy the middle column of § 3/§ 8 verbatim. Never compose a path from the component's vocabulary. Blocklist: § 3a |
| **Trusting the catalog without probing** | `updateItem` succeeds, the field reads back correctly, serialization is clean, the schema audit reports the item icon-clean — and the tree shows a blank default icon. Silent until an author opens it | Probe every icon before writing it (§ 0). 32 of this catalog's 86 icons were dead on a live SitecoreAI tenant |
| Probing without a known-bad control | An **unauthenticated** GET returns **302 for every path**, real or not, so "not 404" reads as success and every icon looks alive | Send the bearer token, follow redirects, and assert `200` **and** `content-type: image/*`. Probe a deliberately fake name in the same run |
| **Probing without a known-GOOD control** | An expired token redirects every request to the login page, which answers `200 text/html`. Every real icon reports dead and you "discover" a catastrophe that isn't there — measured 2026-08-28 as **38 of 38 false positives** | Assert `office/16x16/window.png` returns `200 image/png` before believing any result. A 0%-pass sweep is a credential problem (§ 0a) |
| Sweeping with the CLI's `user.json` token | It expires in ~24 h, so the sweep silently degrades into the false-positive case above overnight | Mint a client-credentials token instead (`clientFor('<org>')`), which also asserts the tenant claim |
| Assuming a folder or size substitution | `Office/32x32/key.png` serves where `Business/32x32/key.png` 404s, so folder matters — but `document.png` and `flag.png` are absent under every folder and size, so name matters too | No inference rule exists. Probe each candidate |
| Wrong case in icon path | Icon not found → blank/broken icon in CM | Use exact casing from § 9 catalog |
| Including `~/-/icon/` prefix | Field stores the full URL, resolves to double-path | Strip prefix; use `office/16x16/person.png` only |
| Updating a read-only or locked item | GraphQL returns error | Unlock item first via Content Editor or `unlockItem` mutation |
| Setting `__Icon` on a rendering item inside a folder template | Works but the folder's icon also changes | If you only want the rendering icon, target the rendering item's GUID specifically |
| Empty string value | Falls back to template default icon — may look fine but `field.value` = `""` | Set to explicit icon path rather than clearing |
| SXA_MDI icon on a non-SXA rendering | May not resolve visually | Only use SXA_MDI for SXA renderings; use `office/` for custom ones |

---

## 8. Icon catalog quick reference

The flat 102-path quick reference (plus the 2026-08-28 additions) is in **`references/icon-catalog.md` § 8**. Copy paths from its middle column verbatim — never compose one from the component's vocabulary (§ 3a).
