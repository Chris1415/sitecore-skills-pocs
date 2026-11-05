# Audience builder attribute catalogue

Observed in the SitecoreAI UI on 2026-10-06 (from screenshots of the UI): **Performance → Audiences → Build → Add filter**. This is the batch-segment audience builder, a separate surface from the 18 condition templates an embedded page variant uses (`condition-templates.md`). `›` marks an attribute that expands into the listed children; `Stats ›` was not expanded.

**How to use this table**

- It lists every attribute the filter picker offered. Anything not listed (notably event extension data) cannot be filtered on.
- The panel shows attribute names only. The value each attribute holds at the wire (for example, what Page View `Name` contains) is not verified here.
- Read it before designing tracking for a behavioural audience: what you want to segment on must land in a listed attribute.

## Profile

| Attribute | Children |
|---|---|
| Client Ids | |
| Contact › | Address ›, Date Of Birth, Email, First Name, Gender, Language, Last Name, Title |
| Created At | |
| Id | |
| Identifiers | |
| Last Seen At | |
| Modified At | |
| Type | |

## Sessions

| Attribute | Children |
|---|---|
| Channel | |
| Client Device › | Operating System, Operating System Version, Software, Software Version, Type |
| Client Id | |
| Created At | |
| Geolocation › | City, Continent, Country, Region |
| Id | |
| Language | |
| Modified At | |
| Site Id | |
| Stats › | (not expanded) |
| Status | |
| Utm › | Campaign, Content, Medium, Source, Term |

## Events

All event kinds share Channel, Client Id, Created At, Id, Language, Modified At, Name, Site Id. Extra attributes per kind:

| Event kind | Extra attributes |
|---|---|
| Custom | Type |
| Form | Component Instance Id, Form Id, Interaction Type |
| Identity | Contact ›, Currency, Identifiers › |
| Page View | Currency, Page Variant Id |
| Search | Component Id, Component Instance Id, Interaction Type, Keyword, Null Results |

The Page View event rule panel offers **Set Limit** (a count threshold).

## Consequences

- **Event extension data (`extensionData` / `ext`) is not selectable** on any event kind. A behavioural audience can key only on a Custom event's `Type` / `Name`, or a Page View's `Name` (what Page View `Name` holds is open: verify before relying on it).
- **Design custom events so the segmenting value lives in `type` (or `name`)**, never only in `ext`. A value sent only in `ext` reaches the data but no audience can use it.
- **UTM is a session attribute** (`Sessions › Utm ›`), so a campaign audience needs no custom event.
- **Membership is batch-recomputed.** Audiences show a schedule ("Every 6 Hours" / "4 Times Per Day"). The real latency from event to membership is UNVERIFIED; do not promise same-visit targeting from a builder audience. For behaviour in the current session use the embedded `page_view` condition instead: it joined within seconds (3/3, measured 2026-10-07; `condition-templates.md`).
