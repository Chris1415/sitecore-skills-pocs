# Sitecore skills catalog

Generated from `catalog.json` by `tools/catalog.mjs`; do not edit. Marketplace `sitecore-skills-pocs`: 8 plugins, 85 skills. Versions are left out on purpose, so a version bump elsewhere does not change this skill.

## Sitecore Guide - Start here (`sitecore-guide`)

Start here: which Sitecore plugin and skill fits a task, and how to install, update and call them. Install first, next to any other Sitecore plugin.

Install in Claude Code: `/plugin install sitecore-guide@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `sitecore-skills-guide` | Start here for Sitecore skills: which plugin and skill fit a task (Content SDK, SitecoreAI APIs, Marketplace, Blok, setup), and how to install, update or call one. Use when unsure where to begin. Not for doing the task itself. |

## Sitecore Content SDK - Next.js App Router (`sitecore-content-sdk-nextjs-app-router`)

Content SDK skills for Next.js App Router head apps, including Content SDK Atoms (BETA). Install with 'Sitecore Content SDK - Core'.

Install in Claude Code: `/plugin install sitecore-content-sdk-nextjs-app-router@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `content-sdk-app-router-atom-create` | Writes a Content SDK atom (beta.atoms): atom vs component, field schemas and enum tokens, renderer, catalog and registry keys, container slots, lock lifecycle, mock-MMS proof. Use when adding or changing an atom. Not wiring atoms into an app. |
| `content-sdk-app-router-atoms` | Content SDK Atoms (beta.atoms only): catalog, atomsConfig, ComponentRef rendering, lock CI gate, runtime CSS, Content Kit install, null-render traps. Use when wiring atoms or a low-code component renders nothing. Not code components or stable apps. |
| `content-sdk-app-router-cache-components-and-osr` | On-demand revalidation (OSR) for a Content SDK App Router app: template choice, version floor, /api/revalidate contract, cache tags, cacheProfile. Use when content is stale after publish. Not Edge webhook setup. |
| `content-sdk-app-router-component-data-strategy` | How component data flows in a Content SDK App Router app: layout data from getPage, editing data, site and locale from route params, Server vs Client components, BYOC. Use when wiring component props or choosing server vs client. |
| `content-sdk-app-router-component-level-navigation` | Navigation via component-level GraphQL in a Content SDK App Router app: server fetches top levels, client lazy-loads deeper ones via a route handler. Use for main, footer or sidebar nav, or when the SXA nav resolver returns empty. |
| `content-sdk-app-router-component-registration` | Registers components in the generated Content SDK App Router component maps (.sitecore/component-map*.ts, never hand-edited). Use when adding a component, a placeholder shows the raw name, or the editor cannot find a component. |
| `content-sdk-app-router-component-scaffold` | Creates a new Sitecore component in a Content SDK App Router app: file layout, props interface, src/components/ placement, Server vs Client choice. Use when asked to add, create or scaffold a component Sitecore layout renders. |
| `content-sdk-app-router-component-variants` | Component variants in a Content SDK App Router app — one component type with several presentations, selected by rendering variant or data. Use when the user asks for variants, versions, variations or multiple renderings of one component. |
| `content-sdk-app-router-dictionary-and-i18n` | Languages in a Content SDK App Router app: routing.ts locales, LocaleProxy, next-intl messages, dictionary keys, hreflang, per-locale links. Use when adding a locale or translations in the head app. Not CM languages. |
| `content-sdk-app-router-editing-safe-rendering` | Makes Content SDK App Router components work in SitecoreAI Pages editing, preview and design library: draftMode, editing data, chromes, selectable empty fields. Use when a component breaks or differs in the editor. |
| `content-sdk-app-router-graphql-data-fetching` | Fetches page, layout and dictionary data through the Sitecore client in a Content SDK App Router app: getPage, getDictionary, getErrorPage, static params, preview data. Use when fetching page data or the Layout Service. |
| `content-sdk-app-router-multisite-management` | Multisite in a Content SDK App Router app: site resolution, .sitecore/sites.json, hostnames and the src/proxy.ts chain. Use when working with multiple sites, hosts or the proxy. Not personalization or consent logic. |
| `content-sdk-app-router-route-configuration` | Routing and layout in a Content SDK App Router app: the catch-all [site]/[locale]/[[...path]] page, setRequestLocale, placeholders, root layout. Use when changing routes, fixing 404s or the layout. Not the proxy chain. |
| `content-sdk-app-router-route-handler-vs-server-action` | Next.js App Router: Server Action vs Route Handler. Server Actions refresh the router, so using one for reads from a client component wipes state in a loading loop. Use when adding an endpoint a client component calls or debugging refreshes. |
| `content-sdk-app-router-sitemap-robots` | Sitemap and robots.txt in a Content SDK App Router app: route handlers, rewrites, and the trap that an empty RobotsContent field serves 'Disallow: /'. Use when configuring SEO or a live site is not crawled. |
| `content-sdk-app-router-theme-hydration-pattern` | Hydration-safe dark, light and system theme for a Content SDK App Router app on Tailwind v4: preflight script, useSyncExternalStore provider, mounted flag. Use when adding dark mode or on a hydration or theme-flash error. |
| `content-sdk-app-router-troubleshoot-editing` | Troubleshoots SitecoreAI Pages editing, preview and design library in a Content SDK App Router app: draftMode, preview data, locale, component maps. Use when editing or preview is broken, chromes are missing or data is wrong. |

## Sitecore Content SDK - Next.js Pages Router (`sitecore-content-sdk-nextjs-pages-router`)

Content SDK skills for Next.js Pages Router head apps. Install with 'Sitecore Content SDK - Core'.

Install in Claude Code: `/plugin install sitecore-content-sdk-nextjs-pages-router@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `content-sdk-pages-router-component-data-strategy` | Component data in a Content SDK Pages Router app: getComponentData after getPage resolves component props for the layout. Use when wiring component data or BYOC in a Pages Router app. Not App Router. |
| `content-sdk-pages-router-component-registration` | Registers components in the generated .sitecore/component-map.ts of a Content SDK Pages Router app (regenerate, never hand-edit). Use when adding a component or layout or the editor cannot find one. Not App Router. |
| `content-sdk-pages-router-component-scaffold` | Creates a new Sitecore component in a Content SDK Pages Router app: file layout, props interface, src/components/ placement, generated component map. Use when adding or scaffolding a component. Not App Router. |
| `content-sdk-pages-router-component-variants` | Implements component variants: different renderings or data-driven variants of the same component type. Pages Router: register in .sitecore/component-map.ts; getComponentData resolves props. Use when one component has multiple presentations. |
| `content-sdk-pages-router-dictionary-and-i18n` | Dictionary and i18n in a Content SDK Pages Router app: next.config i18n locales, context.locale, getDictionary after getPage. Use when adding translated content or changing locale behaviour. Not App Router. |
| `content-sdk-pages-router-editing-safe-rendering` | Makes Content SDK Pages Router components work in SitecoreAI editing and preview: context.preview, previewData, getPreview, design library data. Use when fixing editor or preview behaviour. Not App Router. |
| `content-sdk-pages-router-graphql-data-fetching` | Fetches page, dictionary and component data in a Content SDK Pages Router app: getPage, getDictionary, getComponentData, getPagePaths for SSG. Use when fetching page or dictionary content. Not App Router. |
| `content-sdk-pages-router-multisite-management` | Handles multisite: site resolution, .sitecore/sites.json, and proxy in src/proxy.ts. Pages Router proxy order is fixed: MultisiteProxy → RedirectsProxy → PersonalizeProxy. Use when working with multiple sites or hostnames. |
| `content-sdk-pages-router-route-configuration` | Routing and layout in a Content SDK Pages Router app: catch-all src/pages/[[...path]].tsx, extractPath, locale, data via getStaticProps to Layout. Use when changing routing, placeholders or layout. Not App Router. |
| `content-sdk-pages-router-sitemap-robots` | Sitemap and robots.txt in a Content SDK Pages Router app: API routes, rewrites, and the trap that an empty RobotsContent field serves 'Disallow: /'. Use when configuring SEO or a live site is not crawled. Not App Router. |
| `content-sdk-pages-router-troubleshoot-editing` | Troubleshoots SitecoreAI editing, preview, and design library for Pages Router. Check context.preview, context.previewData, and editing API routes (config, render, feaas/render). Use when editing or preview does not behave as expected. |

## Sitecore Content SDK - Core (`sitecore-content-sdk`)

Router-agnostic Content SDK essentials plus the Sitecore side of a component: troubleshooting hub, feature planner, component review, create a rendering, list and navigation components, collection data models, icons, layout composition, field usage, resolvers, personalization, search, consent, upgrades. Install with a router plugin.

Install in Claude Code: `/plugin install sitecore-content-sdk@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `content-sdk-analytics-events` | Sends Content SDK analytics events: analytics and events plugins, pageView, event, form, identity, field limits, client vs server, bot and editing suppression. Use when adding or debugging tracking calls. Not consent or personalization. |
| `content-sdk-atomic-design-assessment` | Assesses a Content SDK head app for Atomic Design: scan src/components, rate each low-code candidate / partial / keep-code, derive the atom set, plan a side-by-side migration. Use when asked which components could become atoms. Not writing atoms. |
| `content-sdk-collection-data-model` | Picks the data model for a component that shows many items: owned rows, derived view, curated list or shared library, and how each is delivered. Use when migrating a tree-walking list or a list is not editable in Pages. Not row templates. |
| `content-sdk-component-naming-traps` | Traps when adding or renaming Content SDK components: everything in src/components/ becomes a rendering, map keys are SDK-version sensitive, parameter names collide with template fields. Use when scaffolding, refactoring src/ or upgrading. |
| `content-sdk-component-review` | Reviews one Content SDK component before promotion: verdict per axis (authorability, editing safety, naming, variants, data, scoping, lists, serialization), static and live read-only. Use before merge. Not planning or debugging. |
| `content-sdk-create-component` | Creates a component (rendering) on a SitecoreAI tenant via Authoring GraphQL, by cloning an out-of-the-box component and customising templates and available renderings. Use when asked to create, clone or scaffold a rendering. |
| `content-sdk-debug-layout-probe` | Diagnostic toolkit for live Content SDK layout responses: a temporary layout-debug route, a resolver probe and an instrumented frame. Use when a component renders empty or wrong, a resolver's field shape is unknown, or Edge and Preview differ. |
| `content-sdk-feature-planner` | Turns a feature ask for a Content SDK head app into a Sitecore blueprint before code: page, component, setting or dictionary; content model; rendering; data; authorability. Use when a feature must become templates and files. Not implementation. |
| `content-sdk-field-usage-image-link-text` | Renders Sitecore fields with the Content SDK field components (Text, RichText, Image, Link) with guards and fallbacks. Use when rendering a title, body, image or link, or fixing empty or broken images and links. |
| `content-sdk-icon-chooser` | Picks a Sitecore icon for a rendering by name and purpose, probes it against the live icon server, then sets __Icon via Authoring GraphQL; blocks look-alike names that render blank. Use when scaffolding renderings or fixing blank icons. |
| `content-sdk-layout-composition` | Authored page layout in a Content SDK head app: Container, row and column splitters, grid params, dynamic placeholders, layout policy, container-query fit tiers. Use for columns or nested layout, or a splitter renders stacked. Not variants. |
| `content-sdk-list-component` | Decides whether a rendering is a list component and builds it so an author can add rows: datasource grouping, insert options, branch template, children-aware delivery. Use for repeating rows such as nav links, cards, stats, accordions or tabs. |
| `content-sdk-navigation-component` | Decides how to build navigation on a Sitecore head app: derived from the content tree vs an authored link list, plus the traps that make nav fail silently. Use when adding a site nav, jump bar, footer links or breadcrumb. |
| `content-sdk-personalization` | Personalization in a Content SDK head app: PersonalizeProxy page and component variants, scope, variant rewrite, editing, calling personalize() yourself. Use when a variant does not show. Not creating variants in SitecoreAI. |
| `content-sdk-playground-pattern` | Workspace layout for learning a Content SDK or SXA feature in isolation: a playground with an SCS solution, a scaffolded head app and an Edge snapshot. Use when exploring a feature or testing an assumption without touching a real product. |
| `content-sdk-resolver-patterns` | Catalog of Content SDK data-delivery patterns and the exact fields payload each returns: SXA content resolvers, resolver GUIDs, item references, empty states. Use when planning a component for an unknown rendering or choosing a resolver. |
| `content-sdk-search` | SitecoreAI integrated search in a Content SDK head app: search hooks vs server SearchService, client-only rule, facets and sorting, starter port, consent-gated events. Use when adding search UI. Not Sitecore Search (rfk) or source setup. |
| `content-sdk-site-setup-and-env` | Site and environment configuration for a Content SDK app: sitecore.config.ts, environment variables, default site and language, personalize and analytics settings. Use when configuring the app or env vars. Not proxy or tracking code. |
| `content-sdk-tracking-consent` | Consent-gated tracking for a Content SDK App Router app: authorable banner, consent categories mapped to SDK switches, gated tracking, cookie wipe on withdrawal. Use when shipping a head app or touching tracking. Not third-party CMPs. |
| `content-sdk-troubleshooting` | Triage for a misbehaving Content SDK head app: symptom to layer (browser, server, editing host, Edge, publishing, CM, build, hosting) to its logs and the right skill. Use for blank pages, preview vs live gaps or stale content. Not a health audit. |
| `content-sdk-upgrade-assistant` | Upgrades @sitecore-content-sdk packages by cross-checking release notes, the what's-new matrix and a diff of clean reference apps against this app. Use when moving to a newer SDK version or verifying an upgrade. Not first-time scaffolding. |
| `content-sdk-variants-vs-siblings` | Decides whether a new presentation is a variant of an existing rendering or a sibling component: FieldNames resolution, file convention, variant items, failure modes. Use when adding a visual treatment or a new variant renders MissingComponent. |
| `content-sdk-website-build-flow` | Building a Content SDK website: CMS and head-app sync, content-model direction, CM before editing-host deploy, page and partial designs via Authoring GraphQL, porting props to SDK fields, preview gating. Use when building or provisioning a site. |

## Sitecore Platform (SitecoreAI) (`sitecore-platform`)

Working on the SitecoreAI platform itself: OAuth auth, Agent, Pages, Publishing and Sites APIs, GraphQL schemas, Edge (admin webhooks, GraphQL capture), Sitecore CLI and serialization, search sources, languages, personalization, site templates, Marketer MCP page composition, brand voice and a read-only health check.

Install in Claude Code: `/plugin install sitecore-platform@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `sitecoreai-agent` | SitecoreAI Agent API: high-level REST actions such as create page with components, create personalization version and generate brief. Use as the default entry point for apps, MCP servers or automations. It powers the Marketer MCP. |
| `sitecoreai-auth` | OAuth client-credentials auth for the SitecoreAI APIs (Agent, Pages, Publishing, Sites): automation client, token endpoint, scopes, env vars, caching, 401s. Load before the first API call. Not head-app Edge context ids. |
| `sitecoreai-brand-voice` | Writes Sitecore page content in a brand's voice and identity, taken from the PRD or spec or a Sitecore brand kit, never guessed. Sets register (brand, marketing, technical-neutral). Use for copy on a brand or client site. Not page structure. |
| `sitecoreai-cli-cloud-workflow` | Sitecore CLI against a SitecoreAI tenant: login, project and environment lookup, connect, ser pull and push, and their silent traps. Use when pulling, pushing or moving a site between tenants, or on CLI environment errors. |
| `sitecoreai-content-composition` | Inventory-first page composition via the Marketer MCP: inventory the site's real components, then compose a page by choosing and ordering them, with the verified add-component recipe. Use when authoring or extending a page, not a single field. |
| `sitecoreai-edge-admin-webhooks` | Experience Edge Admin API: admin client, token, webhook CRUD (OnEnd vs OnUpdate), settings, cache clear, which webhook fits which job. Use when registering, testing or debugging a publish webhook. Not head-app revalidation code. |
| `sitecoreai-edge-graphql-capture` | curl recipes for Experience Edge GraphQL: endpoint, introspection depth trap, complexity vs pagination, ComponentQuery budget, site, route and layout queries. Use to capture a snapshot, probe live data without the SDK or debug Edge queries. |
| `sitecoreai-graphql-schemas` | Introspection-verified reference for the SitecoreAI GraphQL endpoints (Authoring; Edge, Preview, Live): root queries, item, field and template shapes, mutations, pitfalls. Load before writing a GraphQL query, so shapes are cited. |
| `sitecoreai-health-check` | Read-only health check of a SitecoreAI environment and its sites: tenant binding, Edge routes, broken links, missing templates, logs, delivery, P0-P3 report. Use for 'is this site healthy?'. Not fixes, publishing or writes. |
| `sitecoreai-localization` | Languages on a SitecoreAI tenant: add a language, enable it per site, create or AI-translate versions, dictionary, fallback, publish per locale, verify on Edge. Use when a site gains a language. Not head-app next-intl. |
| `sitecoreai-pages` | Low-level SitecoreAI Pages REST API — page CRUD, versions, variants, layout and field updates, duplicate, rename, translate, blueprint pages. Use when you need precise control beyond the Agent API's composite actions. |
| `sitecoreai-personalization` | Sets up SitecoreAI embedded personalization: page variants, audiences from condition templates, copy, swap or hide a component, publish, verify, undo; Marketer MCP first. Use to personalize a page for an audience. Not head-app wiring. |
| `sitecoreai-publishing` | SitecoreAI Publishing REST API — create, list, monitor and cancel SitecoreAI publishing jobs, summary statistics. Use for build-time publishes, scheduled republishes, publish dashboards or anything that reacts to publish state. |
| `sitecoreai-search-sources` | SitecoreAI integrated search backend: content, site and push sources, searchable and filterable fields, reindex and push limits, per-environment configuration. Use when setting up or feeding a search index. Not head-app search UI or CM Solr. |
| `sitecoreai-serialization` | Designs Sitecore Content Serialization modules for SitecoreAI: sitecore.json, module includes, scope, push operations, module grain, deploy modes, and traps that delete items. Use when creating or changing a module. Not CLI login. |
| `sitecoreai-site-template` | Builds SitecoreAI site templates for the Create Site dialog or page blueprints from a spec, or captures an existing site or page as one; smoke-tested live. Use for reusable sites or campaign pages. Not one-off sites or serialization design. |
| `sitecoreai-sites` | SitecoreAI Sites REST API — sites, site collections, languages, hosts, editor profiles, sitemap, page hierarchy, background jobs. Use for any CRUD on the site tree, site-level config, multi-language setup or hierarchical page navigation. |

## Sitecore Marketplace (`sitecore-marketplace`)

Sitecore Marketplace SDK: client, xmc and ai references, app lifecycle, extension routes, testing and debugging, host-frame visual testing. Scaffolds are in sitecore-setup.

Install in Claude Code: `/plugin install sitecore-marketplace@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `marketplace-sdk-ai` | API reference for @sitecore-marketplace-sdk/ai: module vs experimental client, generateBrandReview, payload traps, file inputs. Load when a Marketplace app calls AI skills such as brand review or content compliance. |
| `marketplace-sdk-client` | API reference for @sitecore-marketplace-sdk/client: ClientSDK.init, provider patterns, query, mutate, subscribe, extension points, custom-field values, errors, test stubs. Entry point for any Marketplace app talking to the Cloud Portal. |
| `marketplace-sdk-extension-routes` | Post-scaffold step for a Marketplace app: pick Cloud Portal extension points, generate a Next.js App Router route for each, and produce the App Studio values. Use right after scaffolding or when adding an extension point. |
| `marketplace-sdk-host-frame-testing` | Visual testing of a Marketplace app inside its real host (Cloud Portal, Pages, Dashboard): find the app iframe, clip it, compare against the design. Use for visual or regression tests; a standalone localhost render is not enough. |
| `marketplace-sdk-lifecycle` | Lifecycle of a Sitecore Marketplace app: custom vs public, Cloud Portal registration, client-side vs full-stack vs server-to-server architecture, Auth0, hosting, Blok, submission. Load before any code when planning a Marketplace app. |
| `marketplace-sdk-testing-debug` | Local dev loop for a Marketplace app: HTTPS with mkcert, test-app registration, Chrome Local Network Access, context ids, iframe sandbox limits, handshake and cookie debugging. Load during development and QA. |
| `marketplace-sdk-xmc` | API reference for @sitecore-marketplace-sdk/xmc: SitecoreAI endpoints (sites, pages, agent, authoring, preview, live, search), client modes, context id rules, response unwrapping. Load when a Marketplace app reads or writes SitecoreAI data. |

## Sitecore Blok (`sitecore-blok`)

Blok design system — catalog, setup, theming, MCP, and Marketplace integration.

Install in Claude Code: `/plugin install sitecore-blok@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `blok-components` | Catalog of Blok primitives (65+) and composite bloks with registry URLs and the Marketplace quickstart inventory. Use to pick the right Sitecore-styled building block before writing custom markup in a Marketplace app or any Sitecore-styled UI. |
| `blok-marketplace-integration` | How Blok works inside a Marketplace app: iframe size limits per extension point, which Bloks fit where, shell patterns, theming in iframes, public-app submission checklist. Load when building a Marketplace app with Blok UI. |
| `blok-mcp` | Configures the Blok MCP (via the shadcn MCP server) for Claude Code, Cursor or VS Code, so agents can list, add and compose Blok components. Use for AI-assisted UI in a Sitecore-styled project; needs blok-setup first. |
| `blok-setup` | Exact commands to add Blok to a project: shadcn init, Blok theme, registry aliases, first component, Tailwind v4 notes. Use when scaffolding a Sitecore-styled UI or asked for the Sitecore design language. Never Chakra or legacy blok-theme. |
| `blok-theming` | Blok theming tokens (colors, typography, spacing, radius, shadows, breakpoints) and how to customise while staying on brand: dark mode, RTL, iframe limits. Load before overriding any visual style in a Blok-based app. |

## Sitecore Setup - Project scaffolding (`sitecore-setup`)

The scaffold decision tree plus the per-target scaffolds for Content SDK head apps and both Marketplace app shapes. Cross-domain by design.

Install in Claude Code: `/plugin install sitecore-setup@sitecore-skills-pocs`

| Skill | What it covers and when to use it |
|---|---|
| `setup-content-sdk` | Scaffolds a Content SDK head app with npx create-content-sdk-app: pick the template by router first (nextjs-app-router, cache-components variant, or nextjs = Pages Router), failure policy, env setup. Use after setup-scaffold picked Content SDK. |
| `setup-marketplace-client-side` | Scaffolds a Sitecore Marketplace client-side app: shadcn quickstart, layout flatten, lint fixes, Vitest, store template, Local Network Access headers, optional OAuth proxy for REST calls. Use after setup-scaffold picked client-side. |
| `setup-marketplace-full-stack` | Scaffolds a Sitecore Marketplace full-stack app with Auth0 PKCE: API routes, SSR, server-side SDK calls for the logged-in user, HTTPS, CSP and env vars. Use after setup-scaffold picked full-stack. Not server-to-server proxies. |
| `setup-scaffold` | Decision tree for a new Sitecore app: Content SDK head app, Marketplace client-side (optional OAuth proxy) or Marketplace full-stack, SDK-first. Use for any new Content SDK, SitecoreAI or Marketplace project. Never in an existing project. |
