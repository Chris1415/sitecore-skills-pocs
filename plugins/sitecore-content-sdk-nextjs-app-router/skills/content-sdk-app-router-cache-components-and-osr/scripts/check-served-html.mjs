#!/usr/bin/env node
// check-served-html.mjs — served-HTML guard for a DEPLOYED Cache Components (PPR) head app.
// A page whose PPR resume fails on Vercel is served as the bare static shell: HTTP 200, no `</html>`,
// no flight data, and the browser logs "Connection closed." `next build` and `next start` pass in that
// state, so only a request to the deployed origin sees it. Dependency-free (Node 18+ global fetch).
// Never prints the bypass secret; never follows redirects (an SSO 302 is not a page).

const HELP = `Usage: node check-served-html.mjs [options] <origin> [path ...]

  <origin>              The deployment to check: a Preview URL or the production deployment URL
  [path ...]            Real pages that must answer 200 with a complete document (default: /).
                        Pass one page per page type, in every locale.
  --expect-404 <a,b>    Paths that must answer 404 with a complete document (also --expect-404=a,b).
                        Pass the authored 404 and an unknown path in every locale: a 500 error page
                        is a complete-looking document, so the status is the only thing that tells.
  --min-bytes=<N>       Size floor for the 200 pages (default ${30_000}; 0 disables). 404 pages use
                        min(N, ${5_000}).
  --bypass-env <NAME>   Env var holding the Vercel protection-bypass secret, sent as
                        x-vercel-protection-bypass (default: VERCEL_PROTECTION_BYPASS, then
                        VERCEL_AUTOMATION_BYPASS_SECRET; optional)
  --self-test           Run the built-in RED/GREEN fixture tests and exit

Each path is requested twice: the first may be a cold resume, the second a cache HIT; both must be complete.
Git Bash rewrites a leading-slash argument into a Windows path: run with MSYS_NO_PATHCONV=1 there.
Exit code: 0 every request complete, 1 a request failed, 2 usage error.`;

export const DEFAULT_PATHS = ['/'];
// A complete content page measures tens of KB; the cut shell measured ~21 KB. Lower it for a small page.
export const MIN_BYTES = 30_000;
// A 404 body is small (a coded fallback measured ~14 KB); the cut shell is caught by the </html> and flight checks.
export const MIN_BYTES_404 = 5_000;

/** @returns {string[]} what is wrong with one served document, empty when it is complete */
export function assessHtml({ status, body }, minBytes = MIN_BYTES, expectedStatus = 200) {
  const problems = [];
  if (status !== expectedStatus) problems.push(`status ${status}, expected ${expectedStatus}`);
  if (!/<\/html>\s*$/i.test(body.trimEnd())) problems.push('does not end with </html> (stream cut after the static shell)');
  if (!body.includes('self.__next_f.push')) problems.push('no self.__next_f.push flight chunks (the page cannot hydrate: "Connection closed.")');
  if (body.length < minBytes) problems.push(`only ${body.length} bytes, expected at least ${minBytes}`);
  return problems;
}

/** @returns {Promise<string[]>} one line per failed request, empty when every request was complete */
export async function checkServedHtml({ origin, paths = DEFAULT_PATHS, notFoundPaths = [], minBytes = MIN_BYTES, bypass, fetchImpl = fetch, log = console.log }) {
  const failures = [];
  const headers = { 'user-agent': 'Mozilla/5.0 served-html-guard', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
  const targets = [
    ...paths.map((path) => ({ path, expectedStatus: 200, floor: minBytes })),
    ...notFoundPaths.map((path) => ({ path, expectedStatus: 404, floor: Math.min(minBytes, MIN_BYTES_404) })),
  ];
  for (const { path, expectedStatus, floor } of targets) {
    for (const attempt of ['first', 'second']) {
      let res;
      let body;
      try {
        res = await fetchImpl(new URL(path, origin), { headers, redirect: 'manual' });
        body = await res.text();
      } catch (err) {
        // Reported without the request headers: the bypass secret lives there.
        failures.push(`${path} (${attempt}): request failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const problems = assessHtml({ status: res.status, body }, floor, expectedStatus);
      const tag = `${path} (${attempt}, x-vercel-cache=${res.headers.get('x-vercel-cache') ?? '-'}, ${body.length} B)`;
      if (problems.length) failures.push(`${tag}: ${problems.join('; ')}`);
      else log(`ok   ${tag}`);
    }
  }
  return failures;
}

/** @returns {{ origin?: string, paths: string[], notFoundPaths: string[], minBytes: number, bypassEnv?: string, selfTest?: boolean, help?: boolean, error?: string }} */
export function parseArgs(argv) {
  const a = { paths: [], notFoundPaths: [], minBytes: MIN_BYTES };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--expect-404' || k.startsWith('--expect-404=')) {
      const value = k === '--expect-404' ? argv[++i] : k.slice('--expect-404='.length);
      if (!value) return { ...a, error: '--expect-404 needs a comma-separated path list' };
      a.notFoundPaths.push(...value.split(',').filter(Boolean));
    } else if (k.startsWith('--min-bytes=')) {
      a.minBytes = Number(k.slice('--min-bytes='.length));
      if (!Number.isFinite(a.minBytes) || a.minBytes < 0) return { ...a, error: `bad --min-bytes: ${k}` };
    } else if (k === '--bypass-env') {
      a.bypassEnv = argv[++i];
      if (!a.bypassEnv) return { ...a, error: '--bypass-env needs a variable name' };
    } else if (k === '--self-test') a.selfTest = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else if (k.startsWith('--')) return { ...a, error: `unknown argument: ${k}` };
    else rest.push(k);
  }
  [a.origin, ...a.paths] = rest;
  if (!a.paths.length) a.paths = DEFAULT_PATHS;
  return a;
}

function response(status, body, cache = 'MISS') {
  return { status, headers: { get: (h) => (h === 'x-vercel-cache' ? cache : null) }, text: async () => body };
}

/** RED/GREEN fixtures: every check must be able to fail on its own (a check that cannot fail proves nothing). */
export async function selfTest() {
  const flight = '<script>self.__next_f.push([1,"x"])</script>';
  const complete = `<!DOCTYPE html><html><body>${'x'.repeat(40_000)}${flight}</body></html>`;
  const cutShell = `<!DOCTYPE html><html><body>${'x'.repeat(21_000)}`; // the measured incident shape
  const errorShell = `<!DOCTYPE html><html><body>${'x'.repeat(6_000)}${flight}</body></html>`; // a complete 500 page
  const SECRET = 'self-test-bypass-value';
  const cases = [
    ['complete page passes', () => assessHtml({ status: 200, body: complete }).length === 0],
    ['cut shell fails on </html>', () => assessHtml({ status: 200, body: cutShell }).some((p) => p.includes('</html>'))],
    ['cut shell fails on flight data', () => assessHtml({ status: 200, body: cutShell }).some((p) => p.includes('__next_f'))],
    ['small page fails the floor', () => assessHtml({ status: 200, body: errorShell }).some((p) => p.includes('bytes'))],
    ['complete 500 fails an expected 404 on status alone', () => {
      const p = assessHtml({ status: 500, body: errorShell }, MIN_BYTES_404, 404);
      return p.length === 1 && p[0].includes('status 500');
    }],
    ['complete 404 passes an expected 404', () => assessHtml({ status: 404, body: errorShell }, MIN_BYTES_404, 404).length === 0],
    ['--expect-404 both forms parse', () => {
      const a = parseArgs(['https://x', '--expect-404', '/404,/de/zz', '--expect-404=/zz']);
      return a.notFoundPaths.join() === '/404,/de/zz,/zz' && a.paths.join() === '/';
    }],
    ['empty --expect-404 is a usage error', () => Boolean(parseArgs(['https://x', '--expect-404=']).error)],
    ['bypass is sent and never reported', async () => {
      let sent;
      const failures = await checkServedHtml({ origin: 'https://x', paths: ['/'], bypass: SECRET, log: () => {},
        fetchImpl: async (_u, init) => { sent = init.headers['x-vercel-protection-bypass']; throw new Error('boom'); } });
      return sent === SECRET && failures.length === 2 && !failures.join().includes(SECRET);
    }],
    ['redirect is not followed and fails', async () => {
      const failures = await checkServedHtml({ origin: 'https://x', paths: ['/'], log: () => {}, fetchImpl: async (_u, init) => (init.redirect === 'manual' ? response(302, '') : response(200, complete)) });
      return failures.length === 2 && failures[0].includes('status 302');
    }],
    ['complete deployment passes', async () => (await checkServedHtml({ origin: 'https://x', paths: ['/'], notFoundPaths: ['/zz'], log: () => {},
      fetchImpl: async (u) => (String(u).endsWith('/zz') ? response(404, errorShell) : response(200, complete, 'HIT')) })).length === 0],
  ];
  let failed = 0;
  for (const [name, fn] of cases) {
    const ok = await fn();
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  }
  return failed ? 1 : 0;
}

/** @returns {Promise<number>} exit code */
export async function main(argv, env = process.env) {
  const a = parseArgs(argv);
  if (a.help) { console.log(HELP); return 0; }
  if (a.selfTest) return selfTest();
  if (a.error || !a.origin) { console.error(a.error ?? 'missing <origin>'); console.error(HELP); return 2; }
  const bypass = a.bypassEnv ? env[a.bypassEnv] : (env.VERCEL_PROTECTION_BYPASS ?? env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const failures = await checkServedHtml({ origin: a.origin, paths: a.paths, notFoundPaths: a.notFoundPaths, minBytes: a.minBytes, bypass });
  for (const f of failures) console.error(`FAIL ${f}`);
  return failures.length ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) process.exitCode = await main(process.argv.slice(2)); // not process.exit(): open fetch sockets abort Node 24 on Windows (exit 127)
