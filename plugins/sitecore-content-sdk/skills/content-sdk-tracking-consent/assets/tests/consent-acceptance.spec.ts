// Consent acceptance test: states A-D against a PRODUCTION build (`next build && next start`).
// Env: BASE_URL, SOFT_NAV_PATHS (comma list of in-page link hrefs, >= 2), CONSENT_POLICY_VERSION.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { CONSENT_COOKIE, serializeConsent, ALL } from '../src/lib/consent/consent';

// A headless UA is classified as a bot: no create.json, no VIEW, no sc_cid. A zero under it proves nothing.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
// CONSENT_POLICY_VERSION = the authored PolicyVersion, so a seeded consent does not re-prompt.
const POLICY = process.env.CONSENT_POLICY_VERSION ?? '';
const PATHS = (process.env.SOFT_NAV_PATHS ?? '').split(',').filter(Boolean);
const TRACKING = ['sc_cid', 'sc_cid_personalize'];
const WAIT_MS = 2500;

test.use({ userAgent: CHROME_UA });
// Only B -> A is serial: A's zero is trusted only after B passed. D and C carry their own positive
// control (201s after the grant / the sc_cid precondition), so a D failure no longer hides C.

type Call = { method: string; path: string; type: string | null; status: number };

function tap(page: Page) {
  const calls: Call[] = [];
  let documents = 0;
  page.on('request', (r) => {
    if (r.resourceType() === 'document') documents++;
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!/\/v1\/(events|personalize)\b/.test(u.pathname)) return;
    let type: string | null = null;
    try {
      type = JSON.parse(r.request().postData() ?? '{}').type ?? null;
    } catch {}
    calls.push({ method: r.request().method(), path: u.pathname, type, status: r.status() });
  });
  return { calls, documents: () => documents, reset: () => calls.splice(0) };
}

const created = (c: Call[]) => c.filter((x) => x.path.endsWith('/browser/create.json'));
const views = (c: Call[]) => c.filter((x) => x.method === 'POST' && x.type === 'VIEW');
const trackingCookies = async (ctx: BrowserContext) =>
  (await ctx.cookies()).filter((c) => TRACKING.includes(c.name)).map((c) => `${c.name}@${c.domain}`);

// Seed with the SAME attributes the app writes (Domain=apex), from a same-origin page with no app JS.
// A host-only seed would coexist with the app's Domain cookie and shadow the withdrawal.
async function seedConsent(page: Page) {
  await page.goto(BASE + '/robots.txt');
  await page.evaluate(
    ([name, value]) => {
      const domain = location.hostname.replace(/^www\./, '');
      document.cookie = `${name}=${value}; Path=/; SameSite=Lax; Secure; Domain=${domain}`;
    },
    [CONSENT_COOKIE, serializeConsent(ALL, POLICY)]
  );
}

async function softNav(page: Page, href: string) {
  await page.locator(`a[href="${href}"]`).first().click();
  await page.waitForURL(`**${href}`);
  await page.waitForTimeout(WAIT_MS);
}

test.beforeAll(() => {
  expect(PATHS.length, 'SOFT_NAV_PATHS needs >= 2 in-page link hrefs').toBeGreaterThanOrEqual(2);
  // Git Bash on Windows rewrites "/adventures" into "C:/Program Files/Git/adventures" (set MSYS_NO_PATHCONV=1).
  expect(PATHS.filter((p) => !p.startsWith('/')), 'SOFT_NAV_PATHS must be root-relative hrefs').toEqual([]);
});

test('control: the browser is not classified as a bot', async ({ page }) => {
  expect(await page.evaluate(() => navigator.userAgent)).not.toMatch(/Headless/i);
});

test.describe.serial('positive control, then the zero', () => {
  test('B - consent granted before load: create.json 201 + VIEW 201 per navigation', async ({ page, context }) => {
    await seedConsent(page);
    const t = tap(page);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(WAIT_MS);
    expect(created(t.calls).map((c) => c.status)).toEqual([201]);
    expect(views(t.calls).map((c) => c.status)).toEqual([201]);
    await softNav(page, PATHS[0]);
    expect(views(t.calls).map((c) => c.status)).toEqual([201, 201]);
    expect(await trackingCookies(context)).toContainEqual(expect.stringMatching(/^sc_cid@/));
  });

  test('A - no consent: zero edge-platform calls, no tracking cookie, banner shown', async ({ page, context }) => {
    const t = tap(page);
    const doc = await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    // Bites only on a personalized route (point BASE + "/" at one): with consent the proxy sets sc_cid + sc_cid_personalize there, without it none (measured P7).
    expect((await doc!.headersArray()).filter((h) => /^set-cookie$/i.test(h.name) && /sc_cid/.test(h.value))).toEqual([]);
    await expect(page.locator('[data-consent-banner]')).toBeVisible();
    for (const p of PATHS) await softNav(page, p);
    expect(t.calls).toEqual([]);
    expect(await trackingCookies(context)).toEqual([]);
    // sc_site (routing), sc_bot (bots only), __cf_bm (third-party CDN) and the consent cookie are not SDK tracking.
  });
});

test('D - grant mid-session: tracking starts WITHOUT a reload', async ({ page }) => {
  const t = tap(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(WAIT_MS);
  expect(t.calls).toEqual([]);
  const docsBefore = t.documents();
  await page.locator('[data-consent-action="accept-all"]').click();
  await expect.poll(() => views(t.calls).length, { timeout: 10_000 }).toBe(1);
  expect(created(t.calls).map((c) => c.status)).toEqual([201]);
  expect(views(t.calls)[0].status).toBe(201);
  expect(t.documents(), 'grant must not reload the page').toBe(docsBefore);
  await softNav(page, PATHS[0]);
  expect(views(t.calls).map((c) => c.status)).toEqual([201, 201]);
});

test('C - withdraw: tracking cookies deleted, no further beacons', async ({ page, context }) => {
  await seedConsent(page);
  const t = tap(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(WAIT_MS);
  expect(await trackingCookies(context)).not.toEqual([]); // precondition: there is something to delete
  t.reset();
  await page.locator('[data-consent-action="reopen"]').click();
  await Promise.all([page.waitForEvent('load'), page.locator('[data-consent-action="reject-all"]').click()]);
  await page.waitForTimeout(WAIT_MS);
  expect(await trackingCookies(context)).toEqual([]);
  for (const p of PATHS) await softNav(page, p);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(WAIT_MS);
  expect(t.calls).toEqual([]);
  expect(await trackingCookies(context)).toEqual([]);
});

// Consent cookie expired (180 d) or CONSENT_SCHEMA bumped while sc_cid (400 d) lives on: Reject all
// has no previous consent to "withdraw" from and must still delete it. No network: 0 tenant writes.
test('C2 - reject with a stale sc_cid and no readable consent: cookie deleted', async ({ page, context }) => {
  const host = new URL(BASE).hostname;
  await context.addCookies([
    { name: 'sc_cid', value: '00000000-0000-4000-8000-000000000000', domain: host.replace(/^www\./, ''), path: '/', secure: true, sameSite: 'None' },
  ]);
  const t = tap(page);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.locator('[data-consent-action="reject-all"]').click();
  await page.waitForTimeout(500);
  expect(await trackingCookies(context)).toEqual([]);
  expect(t.calls).toEqual([]);
});
