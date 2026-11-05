# Condition template catalogue (OOTB)

Generated from a live read-only capture on 2026-10-01: Marketer MCP `get_perso_cond_tmpls`, 18 templates, all `type: CONDITION`, `status: PUBLISHED`, `defaultTemplate: true`, `customTemplate: false`. Source digest plus the raw `templateElements` JS (the digest parser dropped declarations whose config held a `values: [...]` list; those rows were re-read from the raw JS).

**How to use this table**

- `conditionTemplateId` / `condition_template_id` takes the **uuid `ref`**, never the friendlyId.
- The refs below were read on one tenant. They look global (default templates), but resolve them live (`get_perso_cond_tmpls`, match on `friendlyId`) before a write.
- **Param keys = the placeholder label** inside the template JS, verbatim, spaces and parentheses included (`compares to`, `UTM value(s)`). Pass every `required` key. Values are strings (read-back types them so). A multi-value param is one comma-separated string. Measured in the transpiled flow (P7): every param is substituted as a JS string literal (`var utmMultiValue = "s1-probe"; … .split(',')`). `is equal to` is **case-sensitive** (`S1-PROBE` does not match `s1-probe`). `utm_value` falls back to `profile.sessions[0].utm` only when `request.params.utm` is **absent**. The SDK proxy always sends a `utm` object (`{}` when empty), so from the proxy it is a pure request-context condition.
- **No Edge-compatibility flag exists in the payload.** The "Edge" column is the doc's classification only. "Request" = the template reads `request.*` (decidable on the first request); "History" = it reads `profile.sessions` (needs prior tracked VIEW events, so consent and history); "Clock" = the org time zone, same for every visitor at a given moment; "Profile traits" = affinities that must be set up first.
- Geo templates read `request.params.geo` first, else the `cf-ipCountry` / `cf-region-code` request headers. Behind a server-side proxy those headers describe the server, not the visitor `[probe-gated: P12]`.

| friendlyId | Name | ref (uuid) | Edge (doc) | Tags |
|---|---|---|---|---|
| `number_of_page_views` | Number of page views | `1757688d-020d-44d8-94d1-826099dca1ca` | no | Interactive, Visit, Web |
| `page_view` | Page view | `6c2051b7-8f2b-48f5-898c-2491c7d18171` | no | Interactive, Visit, Web |
| `first_page` | First page | `96caf70a-74bb-4a84-9166-36d0b6733106` | no | Interactive, Visit, Web |
| `country_region` | Country Region | `e1e138d0-b51a-4750-a1f9-2ef1cd3b9682` | yes | Geo, INTERACTIVE, WEB |
| `organization_date_and_time` | Date and time (organization time zone) | `91ecda49-89c9-4b58-97b1-2617f5ef0f63` | no | Date, INTERACTIVE, Time, TRIGGERED, WEB |
| `organization_time_of_day` | Time of day (organization time zone) | `c36e855f-7eb9-4d72-a530-4271c9811695` | no | Interactive, Time, Triggered, Web |
| `point_of_sale` | Point of sale | `3305e75c-3adf-41cb-b986-ce2d5dfe5c44` | yes | Interactive, Point of Sale, Web |
| `region` | Region | `307e9c3f-ff04-423b-ab0d-9b754fc9f2e2` | no | Geo, Interactive, Web |
| `country` | Country | `a917ad20-f1bd-4a50-ac5c-ab0c3b4975c5` | yes | Geo, Interactive, Web |
| `organization_visit_day_of_month` | Visit day of the month (organization time zone) | `7efe2a21-bbdf-47db-b94c-c8a8345c5077` | no | Date, Interactive, Triggered, Web |
| `organization_day_of_week` | Day of the week (organization time zone) | `43c35425-c5e5-4607-81ba-27a40a3605e1` | no | Date, Interactive, Triggered, Web |
| `organization_month_of_visit` | Month of visit (organization time zone) | `77be5d59-370a-412a-81fe-015ddd318347` | no | Date, Interactive, Triggered, Web |
| `first_referrer` | First referrer | `7d4982b6-b26a-4490-a924-41f4ff2f50fe` | yes | Interactive, User interaction, Web |
| `utm_value` | UTM value | `d62f7a25-7a56-43c9-82f3-a40f94c98a00` | yes | Interactive, User interaction, Web |
| `device` | Device | `39b8c29a-a087-4f10-b809-3d6fda4b9b1e` | yes | Device, Interactive, Web |
| `operating_system` | Operating system | `d0ee6f7b-1dc4-41d1-a403-e728ff4e9cb4` | yes | Device, Interactive, Web |
| `top_affinity` | Top Affinity | `f47ac10b-58cc-4372-a567-0e02b2c3d479` | no | Interactive, User interaction, Web, Triggered |
| `new_or_returning_visitor` | New or returning visitor | `a3d441e4-9f00-423c-b5d9-1a630131dd6e` | no | Interactive, User interaction, Web |

## Parameters and output sentence per template

### `number_of_page_views` — Number of page views

Reads: History. Output: _The visitor [[has]] visited [[page]] within the past [[x]] days and the total number of page views [[compares to]][[IF|{field:compares to, value:is between}]] [[number of views]] and [[second number]][[ELSE]] [[number of views]][[/IF]]_

| Param key | Type | Default | Req |
|---|---|---|---|
| `has` | enum(has / has not) | has | required |
| `page` | string | — | required |
| `compares to` | enum(is equal to / is greater than / is less than / is greater than or equal to / is less than or equal to / is between) | — | required |
| `x` | number | — | required |
| `number of views` | number | — | required |
| `second number` | number | 0 | required |

### `page_view` — Page view

Reads: History. Output: _The visitor [[has]] visited [[page name(s)]] during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `has` | enum(has / has not) | has | required |
| `page name(s)` | multiselect() | — | required |

Measured 2026-10-07 (Content SDK 2.4 App Router head app, LIVE):

- **Param shape:** `{has: "has", "page name(s)": "<page>"}` as a **string**. An array (`["<page>"]`) → 400 `Attempt to decode JSON with unexpected mimetype`. The value is the page name the VIEW event carries (the item name the head app's `CdpPageView` sends), not a path.
- **Latency: seconds.** 3/3 fresh consented visitors (banner grant → view page X → Home) got the variant on the first read, about 25-40 s after the trigger including the browser steps. It evaluates from the current visit, unlike a builder audience (UI-only, batch-scheduled every few hours).
- **Test method.** An earlier run polled for > 15 min with no join; that was an artifact of its throwaway script, not platform latency. Grant consent through the **real banner**, trigger the **real page VIEW** in the same browser, warm the target route once (cold-cache default, `content-sdk-personalization`), then read.

### `first_page` — First page

Reads: History. Output: _The visit [[has]] started on a page that [[compares to]] [[page]] during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `has` | enum(has / has not) | has | required |
| `compares to` | enum(is equal to / contains / starts with / ends with) | — | required |
| `page` | string | — | required |

### `country_region` — Country Region

Reads: Request, falls back to history. Output: _The visitor is in [[country]] where region [[is]] [[region(s)]] during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `country` | multienum(United States) | — | required |
| `region(s)` | multienum(50 values, e.g. Alabama, Alaska, Arizona, …) | — | required |

### `organization_date_and_time` — Date and time (organization time zone)

Reads: Clock (org time zone). Output: _The visit [[is]] [[before or after]] [[date and time]], based on your organization's time zone_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `before or after` | enum(before / after) | — | required |
| `date and time` | datetime | — | required |

### `organization_time_of_day` — Time of day (organization time zone)

Reads: Clock (org time zone). Output: _The visit [[is]] [[before or after]] [[time]], based on your organization's time zone_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `before or after` | enum(before / after) | — | required |
| `time` | time | — | required |

### `point_of_sale` — Point of sale

Reads: Request. Output: _The visit [[is]] to [[point(s) of sale]]_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `point(s) of sale` | pointofsale | — | required |

### `region` — Region

Reads: History. Output: _The visitor [[is]] in [[region(s)]] during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `region(s)` | multienum(Africa / North America / Oceania / Asia / Europe / South America) | — | required |

### `country` — Country

Reads: Request, falls back to history. Output: _The visitor [[is]] in [[country(s)]] during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `country(s)` | multienum(256 values, e.g. Afghanistan, Albania, Algeria, …) | — | required |

### `organization_visit_day_of_month` — Visit day of the month (organization time zone)

Reads: Clock (org time zone). Output: _The visit [[is]] on a day of the month that [[compares to]] [[IF|{field:compares to, value:is between}]][[number]] and [[until day]][[ELSE]][[number]][[/IF]] based on your organization's time zone_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `compares to` | enum(is equal to / is greater than / is less than / is greater than or equal to / is less than or equal to / is between) | — | required |
| `number` | number | — | required |
| `until day` | number | — | required |

### `organization_day_of_week` — Day of the week (organization time zone)

Reads: Clock (org time zone). Output: _The visit [[is]] on a [[day(s) of the week]], based on your organization's time zone_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `day(s) of the week` | multienum(Monday / Tuesday / Wednesday / Thursday / Friday / Saturday / Sunday) | — | required |

### `organization_month_of_visit` — Month of visit (organization time zone)

Reads: Clock (org time zone). Output: _The visit [[is]] in [[month(s)]], based on your organization's time zone_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `month(s)` | multienum(January / February / March / April / May / June / July / August / September / October / November / December) | — | required |

### `first_referrer` — First referrer

Reads: Request, falls back to history. Output: _The visitor comes from a URL that [[compares to]][[IF | {field:compares to, value:includes any of}]] [[referrer(s)]] [[ELSE]][[IF | {field:compares to, value:is null}]][[ELSE]] [[referrer]] [[/IF]] [[/IF]]in the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `compares to` | enum(is equal to / includes any of / contains / starts with / ends with / is null) | — | required |
| `referrer` | string | — | required |
| `referrer(s)` | multiselect() | — | required |

### `utm_value` — UTM value

Reads: Request, falls back to history. Output: _The visit includes a UTM [[type]] that [[compares to]][[IF | {field:compares to, value:includes any of}]] [[UTM value(s)]] [[ELSE]][[IF | {field:compares to, value:is null}]] [[ELSE]] [[UTM value]] [[/IF]][[/IF]]_

| Param key | Type | Default | Req |
|---|---|---|---|
| `compares to` | enum(is equal to / includes any of / contains / starts with / ends with / is null) | — | required |
| `type` | enum(campaign / source / medium / content) | — | required |
| `UTM value` | string | — | required |
| `UTM value(s)` | multiselect() | — | required |

### `device` — Device

Reads: Request. Output: _The visitor [[is]] using a [[device type(s)]] device during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `device type(s)` | multienum(mobile / tablet / desktop / other) | — | required |

### `operating_system` — Operating system

Reads: Request. Output: _The visitor [[is]] using [[operating system(s)]] during the current visit_

| Param key | Type | Default | Req |
|---|---|---|---|
| `is` | enum(is / is not) | is | required |
| `operating system(s)` | multienum(macOS / Windows / Android / Linux / iOS / other) | — | required |

### `top_affinity` — Top Affinity

Reads: Profile traits (affinities). Output: _Checks whether the [[affinity value]] for the selected [[affinity name]] is the visitor's highest-scoring interest_

| Param key | Type | Default | Req |
|---|---|---|---|
| `affinity value` | multiselect() | — | required |
| `affinity name` | string | — | optional |

### `new_or_returning_visitor` — New or returning visitor

Reads: History. Output: _The visitor is [[type]] to your site_

| Param key | Type | Default | Req |
|---|---|---|---|
| `type` | enum(new / returning) | — | required |

## Worked param objects (shape only)

```json
{ "conditionTemplateId": "<utm_value ref>",
  "conditionParams": { "type": "campaign", "compares to": "is equal to",
                       "UTM value": "spring-sale", "UTM value(s)": "spring-sale" } }
```

- `utm_value`: **both** `UTM value` and `UTM value(s)` are `required: true`, even though only one is read per comparator. Send the same value in both.
- `device`: `{ "is": "is", "device type(s)": "mobile" }`.
- `country`: `{ "is": "is", "country(s)": "Germany" }` (names from the enum; the template maps them to codes).

Params are typed as strings on read-back (`traffic.splits[].conditionGroups[].conditions[].params`).
