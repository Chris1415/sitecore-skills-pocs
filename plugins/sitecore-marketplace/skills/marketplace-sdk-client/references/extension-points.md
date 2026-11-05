# 7. Extension points

Supporting reference for the `marketplace-sdk-client` skill. Moved out of `SKILL.md` on 2026-09-16 so the entry file stays under the Agent Skills spec's 5,000-token guidance; the heading is kept so `SKILL.md` cross-references still resolve here.

## 7. Extension points

```typescript
enum AllowedExtensionPoints {
  standalone = "standalone",                         // Standalone app (not in iframe)
  xmcFullscreen = "xmc:fullscreen",                 // Full-screen panel in SitecoreAI
  xmcPagesContextPanel = "xmc:pages:contextpanel",  // Pages editor right panel
  xmcPagesCustomField = "xmc:pages:customfield",    // Custom field type in Pages
  xmcDashboardBlocks = "xmc:dashboardblocks",       // Dashboard widget
}
```

For **picking which extension points an app exposes + naming the route URL for each** (including Dashboard widgets, which may have multiple routes), see the `marketplace-sdk-extension-routes` skill. Run that skill interactively after the scaffold completes and before portal registration is finalized.

### Extension point differences

| Extension Point | Available queries | Key constraint |
|----------------|-------------------|---------------|
| `xmc:fullscreen` | All XMC queries + `application.context` + AI skills | No `pages.context` subscription (not in Pages editor). Bound to one tenant. |
| `xmc:pages:contextpanel` | All XMC queries + `pages.context` (subscribable) | Runs in Pages editor sidebar; receives page context updates. Bound to one tenant. |
| `xmc:pages:customfield` | `pages.context` + `getValue`/`setValue` | Field-level; limited viewport. Bound to one tenant. |
| `xmc:dashboardblocks` | Limited to dashboard scope | Small widget area. Bound to one tenant. |
| `standalone` | All base + XMC (no `pages.context`) | **Cloud Portal umbrella surface** — iframed in the portal shell (same `target: window.parent` init), but `application.context.resourceAccess[]` lists *all* installations of this app across the organisation, not just one. Each entry has its own `live` + `preview` `sitecoreContextId`. XMC calls scope to whichever install you pass. Enables one Standalone app to drive many SitecoreAI environments. |

**Key insight 1:** `pages.context` is only available and subscribable in the Pages editor extension points (`contextpanel`, `customfield`). Full-screen apps get `application.context` instead and must navigate to pages via `client.mutate('pages.context', ...)`.

**Key insight 2 — umbrella vs single-tenant surfaces:** Every extension point *except* `standalone` is bound to the single tenant the editor is operating in (one `resourceAccess[]` entry is the whole world). `standalone` is the umbrella — it sees every install of this app across the organisation and can drive any of them by picking the matching `sitecoreContextId`. Design pattern:

```typescript
// Standalone: enumerate installs
const appCtx = (await client.query('application.context')).data;
const installs = appCtx?.resourceAccess ?? [];
// installs[i] => { resourceId, tenantId, tenantName, tenantDisplayName, context: { live, preview }, … }

// Pick one (user dropdown, app logic, or fan-out)
const picked = installs[0];
const contextId = picked.context.live; // or .preview

// All subsequent XMC calls scope to the picked install's environment
const languages = await client.query('xmc.sites.listLanguages', {
  params: { query: { sitecoreContextId: contextId } },
});
```

Do not reach for `experimental_createXMCClient` from Standalone — the iframe bridge works fine; experimental client is only for genuinely non-iframe contexts (cron jobs, microservices, server routes). See the `marketplace-sdk-xmc` skill, § 2c, for the worked multi-install example.
