---
name: marketplace-sdk-host-frame-testing
description: "Visual testing of a Marketplace app inside its real host (Cloud Portal, Pages, Dashboard): find the app iframe, clip it, compare against the design. Use for visual or regression tests; a standalone localhost render is not enough."
license: Apache-2.0
compatibility: "Requires Playwright MCP browser, access to a live Sitecore Cloud Portal host URL, and interactive (user-supplied) auth — no scripted SSO."
metadata:
  author: Christian Hahn
  version: "0.4.2"
---

# Marketplace App — Host-Frame Visual Testing

## When to use

- A test phase runs and the project is a Marketplace app.
- You need a screenshot of "just the app" extracted from the surrounding Sitecore portal chrome.
- You need to verify the implementation under realistic host conditions (real iframe sandbox, real Blok tokens applied by host, real viewport size). If a POC clickdummy exists for the design, this skill also covers comparing the host-frame render to that POC as a visual ground truth (§ 6 — skip if you don't have a POC).

A standalone `localhost:3000` hit is **not** an acceptable substitute. Marketplace apps depend on `XMC.host`, `XMC.context`, theme, locale, and auth coming from the parent frame — they render blank or in error state outside of the host.

---

## 1. The contract — what the user supplies, what the agent does

### User supplies (mandatory inputs before this skill can run)

| Input | Example | Purpose |
|-------|---------|---------|
| **Host URL** | `https://xmcloud.sitecore.com/.../pages?context=...` | The deep link into the Sitecore surface that embeds the app. |
| **App origin** | `https://localhost:3000` (dev) or the registered Marketplace app URL | Used as the iframe locator pattern (`iframe[src*="<origin>"]`). |
| **Auth confirmation** | "I'm logged in" / "I'll log in when the browser opens" | Agent stays interactive; never tries to script SSO. |

If any of the three is missing, **ask for it and stop** — do not proceed with a fake or guessed host URL.

### Agent does

1. Opens host URL in Playwright MCP browser.
2. Pauses for interactive SSO if the user says they need to log in.
3. Locates the app's iframe by origin match.
4. Captures a **clipped screenshot** of just the iframe's bounding box.
5. Drives the app through PRD acceptance states; clip-screenshots each.
6. **If a POC clickdummy exists**, compares each clipped screenshot against it as the visual ground truth (§ 6). Otherwise records the clipped states as the run's evidence baseline.
7. Records findings in the test report with side-by-side embedded images (POC comparison) or single-image tables (no POC).

---

## 2. Auth handling — interactive only

**Do not** attempt to script Sitecore SSO. Do not try to inject cookies, tokens, or storage state. The agent's contract:

1. Open the host URL with Playwright MCP.
2. Output to the user: *"The browser is open at the host URL. Log in if prompted, then reply READY."*
3. **Stop and wait** for `READY` (or equivalent confirmation) before continuing.
4. After `READY`, run a probe — `browser_snapshot` — and verify the page is **not** the Sitecore login screen by checking for the host's authenticated chrome (e.g., portal navigation, app launcher). If it still looks like a login page, ask the user to confirm again.

**No persisted storage state.** Each test run starts a fresh browser session and goes through interactive login. This is by explicit preference — do not introduce a "remember me" optimization without asking.

---

## 3. Locating the iframe

Marketplace apps are always iframed by their extension point. The locator pattern is:

```
iframe[src*="<app-origin>"]
```

### Step-by-step (Playwright MCP)

Use Playwright's locator API — never reach into iframe DOM via raw JS evaluation against an unknown origin.

1. Use `browser_snapshot` to get an accessibility tree of the host page; verify the iframe is visible.
2. Use a locator like `page.locator('iframe').filter({ has: ... })` or directly inspect frames via `page.frames()`. Each frame exposes `.url()`; pick the one whose URL contains the app origin.
3. If no frame matches, the app is not currently mounted into this host context.

**Common locator failures and how to recover:**

| Symptom | Likely cause | Recovery |
|---------|-------------|----------|
| Zero iframes match | App not loaded into this host context yet | Ask user to navigate to the page/panel where the app appears, then retry |
| Multiple iframes match same origin | App is a Page extension AND a ContextPanel extension and both mounted | Pick by extension-point hint in the URL query (e.g. `?placement=context-panel`) — ask the user which one to test |
| Iframe `src` is blank or `about:blank` | Lazy mount; iframe exists but app hasn't booted | `browser_wait_for` until the src becomes the app origin (timeout 30s) |
| Iframe is `chrome-error://chromewebdata/` | Self-signed cert rejected (see the `marketplace-sdk-testing-debug` skill's `references/https-traps.md` § 2) | Stop and tell the user — this is a local-cert problem, not a test failure |

---

## 4. Clipping the screenshot to just the app

Once the iframe is located, get its bounding box in the parent page's coordinate space and pass it as the `clip` rectangle to `browser_take_screenshot`.

```js
// Use a Playwright locator (not raw page.evaluate) so this works cross-origin.
// boundingBox() returns the iframe's position in the top-level document — exactly
// what we need for screenshot clipping, regardless of the iframe's content origin.
const iframeLocator = page.locator(`iframe[src*="${APP_ORIGIN}"]`).first();
const box = await iframeLocator.boundingBox();
if (!box || box.width === 0 || box.height === 0) {
  // App iframe is mounted but invisible (display:none / collapsed) or not present.
  // See § 8b for triage.
  throw new Error('App iframe has no visible bounding box');
}

await page.screenshot({
  path: 'test-evidence/state-<name>.png',
  clip: {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  },
});
```

**Why this works:** screenshot clipping operates on the **parent page's pixels** — it does not require entering the iframe's content document, so it works equally well for same-origin and cross-origin iframes. This is the core reason this approach holds up even when the app is at `localhost:3000` and the host is `xmcloud.sitecore.com`.

**Evidence file naming:** `test-evidence/<state-name>-<timestamp>.png` under the product folder. Embed in the test report via relative markdown image links.

---

## 5. Driving the app through states

Once you've captured the empty / loaded state, drive the app through PRD acceptance criteria.

### Cross-origin iframe (normal Marketplace case)

Raw JS evaluation cannot reach into the frame's DOM, but Playwright **does** support cross-origin frame interaction via locators. Use `page.frameLocator('iframe[src*="<origin>"]')`:

```js
const appFrame = page.frameLocator(`iframe[src*="${APP_ORIGIN}"]`);

await appFrame.getByRole('button', { name: 'Copy Live URL' }).click();
await appFrame.getByRole('status').waitFor({ state: 'visible' });
// ... then re-clip the iframe (§ 4) to capture the new visual state
```

**What does NOT work cross-origin:**
- Raw script execution against the frame's `document` from the parent
- Reading the frame's `document` from the parent context
- Direct DOM querying via parent-context script reaching into `iframe.contentDocument`

**What DOES work:**
- Locator-based interaction (`getByRole`, `getByText`, `getByTestId`, `locator(selector)`)
- Clicks, fills, hovers, keyboard input via locators
- Waiting for visibility / attached / detached states via locators
- Screenshot clipping (operates on parent pixels — origin doesn't matter)

For state coverage that genuinely requires DOM read access (e.g., "verify computed background color of element X"), fall back to **visual diff against the POC** instead — that is the canonical truth path for this skill.

---

## 6. Visual comparison — POC clickdummy as ground truth (optional)

**This section applies only if your project produced a POC clickdummy** during design (typically at `pocs/poc-vN/index.html` under the project root). If your workflow does not use POC clickdummies, **skip this section** — the clipped iframe screenshots from § 4–5 are themselves the run's evidence; record them in the test report and judge against the PRD's acceptance criteria directly.

The **winning POC clickdummy** is the visual baseline for first-run testing when it exists. The five-axis comparison below grounds visual judgment in something explicit instead of leaving "looks right" to memory.

### Comparison protocol

1. **Open the POC** in a second Playwright tab at the same viewport size as the iframe's bounding box (so the POC's rendered width matches the host-frame clip width).
2. **Take a screenshot of the POC** at the same logical state (e.g., "default", "after copy", "error state"). The POC must support these states — that's why architecture mandates state coverage.
3. **Place the two images side-by-side** in the test report (`| Host clip | POC reference |` table row per state).
4. **Compare on five axes**, scoring PASS / WARN / FAIL with a one-line note each:
   - **Layout & spacing** — proportions, gutters, alignment grid
   - **Typography** — family, weight, size scale, leading
   - **Color & contrast** — semantic Blok tokens applied correctly (the host applies real Blok theme; the POC pulls Blok theme CSS or copied tokens — they should match)
   - **Component anatomy** — Buttons, Cards, Sidebars use real `@blok/*` shapes (no fabricated approximations)
   - **State fidelity** — hover, focus, active, error, empty, loading match the POC's documented states
   - **Long-list relationship visibility** — when the surface contains paired or related lists (rendering rows + datasource rows, files + owners, items + assignees), zoom out / paste a 20+-item fixture and confirm cross-row hover affinity, color-tag matching, and cross-list visual link still work. Small-tenant fidelity won't catch this. If the design relies on the lists being visually connected, this axis is **mandatory**, not optional.

5. **Threshold for FAIL:** any axis where the host clip and the POC diverge in a way that a Sitecore user would perceive as "not Blok" or "not the agreed design." Subjective judgment is fine — the QA reviewer names what they see.

### After first run

The POC stays as ground truth across subsequent runs **unless** the design is intentionally changed. If the user asks for a design change post-implementation:
1. Re-run the architecture/POC step to update the POC, OR
2. Update the POC clickdummy directly and note the refresh in your project's design log so it isn't mistaken for drift on the next run.

Do **not** silently promote a host-frame screenshot to "new baseline" without an explicit POC update — that defeats the design-discipline purpose of the POC.

---

## 7. Output — test-evidence section in the test report

Embed in your project's test report (e.g. `<project>/plans/test-report-<timestamp>.md`, or wherever your workflow tracks test evidence):

```markdown
## Visual Testing — Host-Frame (Marketplace)

**Host URL:** `<URL the user supplied>`
**App origin:** `<origin>`
**POC reference:** `pocs/poc-vN/index.html` (winning variant)
**Auth:** interactive (user logged in at <time>)
**Browser viewport:** <width>x<height>
**Iframe clip box:** x=<x> y=<y> w=<w> h=<h>

### State coverage

| State | Host clip | POC reference | Layout | Typography | Color | Anatomy | State | Verdict |
|-------|-----------|---------------|--------|------------|-------|---------|-------|---------|
| Default | ![](test-evidence/default-host.png) | ![](test-evidence/default-poc.png) | PASS | PASS | PASS | PASS | PASS | PASS |
| After copy | ![](test-evidence/copied-host.png) | ![](test-evidence/copied-poc.png) | PASS | PASS | WARN — chip color slightly off | PASS | PASS | WARN |
| Error | ![](test-evidence/error-host.png) | ![](test-evidence/error-poc.png) | PASS | PASS | PASS | PASS | FAIL — error ring not red | FAIL |

### Findings carried into the report

- (one row per FAIL or WARN, with severity and a proposed fix)
```

---

## 8. Pitfalls

### 8a. Host URL points to a context where the app isn't installed

The user gives a URL into a Sitecore surface that doesn't yet have the test app registered → no iframe matches the origin. Symptom is identical to "app crashed." Always check the `marketplace-sdk-testing-debug` skill, § 2, first — is the test app actually installed in this environment?

### 8b. Iframe is mounted but invisible (display:none / collapsed)

Bounding box has zero width or height. Clip rectangle would be invalid. Check `width > 0 && height > 0` before screenshotting; if zero, the app's extension point is registered but not currently displayed — ask the user to navigate to the surface where it appears.

### 8c. POC at different viewport from host clip

The host iframe might be 320x600 (Context Panel) while the POC was authored at desktop 1280x800. Open the POC at the **iframe's clip dimensions** when comparing — otherwise spacing and breakpoints will diverge for cosmetic reasons unrelated to implementation quality.

### 8d. Theme drift — host applies dark mode, POC was authored light

Read the host's applied theme (visible in the host's portal chrome) and toggle the POC to match before comparison. Both POC and host should expose a theme toggle (per architecture's Blok requirements).

### 8e. Sandbox-restricted features

Some Marketplace iframe features (downloads, popups, clipboard) are subject to the iframe sandbox attribute (see the `marketplace-sdk-testing-debug` skill, § 7a). If a state can't be reached because the sandbox blocks it, that's an environmental finding — record it as a sandbox observation, not as a failed test.

---

## 9. Agent guidance

**When testing a Marketplace app:** the canonical visual test target is the **clipped iframe inside the host**, not a standalone localhost render. Standalone-render testing is acceptable only as a smoke-level sanity check (does the app boot at all?) — it never substitutes for host-frame testing. The winning POC clickdummy is the first-run ground truth; do not promote host-frame screenshots to baselines silently.

**When fixing host-frame findings:** re-run the same host-frame check (not a localhost re-render) to verify the fix. The user does not need to re-supply the host URL within a single test session — reuse it.

**When orchestrating visual testing:** before starting, ask the user for the host URL and app origin if the project is a Marketplace app. Do not proceed with visual testing if either is missing. Auth is always interactive — do not persist storage state.
