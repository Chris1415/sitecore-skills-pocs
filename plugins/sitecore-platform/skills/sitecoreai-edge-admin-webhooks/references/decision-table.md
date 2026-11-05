# Which webhook for which job

## The families

| # | Family | Fires on | Created via | Notes |
|---|---|---|---|---|
| A | **Edge webhook** | End of the Edge publish, after the Edge cache clear | Edge Admin REST API only | Content is live when it fires. The OSR / search hook |
| B | CM Webhook Event Handler (`/sitecore/system/Webhooks`) | `item:*` events, `publish:begin` / `publish:end` / `publish:fail` | Content Editor, or as an item (Authoring GraphQL / serialization) | No Rule possible on publish events. Without a Rule, item events fire for **every** item. `item:saved` fires several times per UI action |
| C | Workflow Submit Action | An item enters a state, or a command runs | An item under the workflow state/command | Carries user name, comments, state |
| D | Workflow Validation Action | A command runs; **blocks** until the receiver replies | An item under the command | Reply `{"IsValid":bool,"Message":""}` within `Sitecore.HttpClientTimeout` (3000 ms default, 10000 ms max) |
| E | Cloud Portal Common Audit Log | Audit events (CDP, Connect, Personalize, Portal) | Mesh management API `…/api/v1/eventConfigurations` | **Does not cover SitecoreAI content.** 15-min Portal bearer, Org Admin/Owner |
| F | SitecoreAI Forms | A form is submitted | Forms UI | Test submits carry `test: true` |
| G | Marketplace `subscribe` | Pages field and layout edits | Client SDK | An iframe postMessage stream, **not a server webhook** |
| — | Publishing API / Deploy API | — | — | No callback. Poll |

CM webhooks (B-D) authenticate through **authorization items** under `/sitecore/System/Settings/Webhooks/Authorizations` (Basic, Digest, API key, OAuth2 client credentials, OAuth2 password). These items hold secrets in plain fields: **keep them out of serialization**. CM webhooks have a 10 s budget to send all webhooks of one request and no resend on error.

## Decision table

| Job | Use | Config | Why not the others |
|---|---|---|---|
| **Revalidate a Content SDK head app after publish** | **A, OnUpdate** → `POST https://<production-domain>/api/revalidate` | `headers: { x-revalidate-secret, x-vercel-protection-bypass? }` | Fires after the Edge cache clear. CM `publish:end` races Edge. OnEnd has no rows |
| Purge a whole site | The pipeline after an Edge read-back → a custom purge route (`revalidatePath('/', 'layout')`) | Own secret | Covers datasource / partial-design gaps. **Not OnEnd:** it fired three times per publish, two before Edge had the content (live), so the purge re-caches old content. Do not rely on `tags[]` (gone in Content SDK 2.5) |
| Trigger an SSG rebuild | The pipeline (or A, OnEnd, accepting early and repeated triggers) → Vercel Deploy Hook | `POST`, no body | 60 triggers/h per project, a repeat cancels the previous build; an early OnEnd build reads old content. Prefer OSR |
| Sync external search | A, OnUpdate. Filter `LayoutData`, strip `-layout`, re-read from Edge, upsert; group by `invocation_id` | Snapshot publishing | Data is guaranteed to be on Edge |
| Slack "content approved" | C → a relay | Authorization item | Workflow semantics; `item:saved` is too noisy |
| Block approval on an external check | D | Reply within 3 s by default | The only blocking hook |
| Alert on a failed publish / audit who published | B, `publish:fail` / `publish:end` | No Rule possible | Edge has no failure signal |
| React to authoring before publish | B with a Rule on `item:saved` / `item:versionAdded` / `item:added` | A Rule is mandatory | Edge sees only published content |
| Know when *your* Publishing API job is done | Poll `GET /jobs/{id}` (`sitecoreai-publishing`); A says when it is live | — | No callback exists |
| SIEM forwarding | E | `X-Secret` | Does not cover content |

## Traps

- **Never point a CM webhook at `/api/revalidate`.** No `updates`, different id casing: a 400 or a false 200. `publish:end` also fires before Edge is live, so a revalidation re-caches stale content (community reports 10 s to 15 min lag).
- A CM event handler without a Rule on item events floods the receiver.
- A Validation Action that answers slowly blocks authors.
- Edge webhooks cannot be scoped by site: every webhook gets every site's publishes.
- Vercel Deployment Protection returns a `302` to SSO unless the bypass header is set; Edge may log that as success.
