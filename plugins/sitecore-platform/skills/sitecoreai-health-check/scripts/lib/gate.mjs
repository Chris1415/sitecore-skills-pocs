// Shared gate verdict + CLI wrapper for the extracted go-live gates.
// Exit codes: 0 pass, 1 fail (a blocker finding), 2 unknown (instrument error, missing input, degraded where a
// browser is required). A gate never folds UNKNOWN into pass.
import { redact, stats } from './http.mjs';

export function verdict(results) {
  if (results.some((r) => r.status === 'unknown')) return 'unknown';
  if (results.some((r) => r.findings.some((f) => f.blocker))) return 'fail';
  return 'pass';
}
export const EXIT = { pass: 0, fail: 1, unknown: 2 };

/**
 * Sets process.exitCode and RETURNS instead of calling process.exit(): an exit while fetch keep-alive
 * sockets are still closing trips a libuv assertion on Windows (exit 127 after the verdict was printed).
 */
export async function runGateCli(name, fn) {
  const t0 = Date.now();
  try {
    const out = await fn();
    const v = verdict(out.results);
    const summary = {
      gate: name, verdict: v,
      blockers: out.results.flatMap((r) => r.findings.filter((f) => f.blocker).map((f) => `${f.severity} ${f.check}: ${f.title}${f.url ? ` (${f.url})` : ''}`)),
      advisories: out.results.flatMap((r) => r.findings.filter((f) => !f.blocker).map((f) => `${f.severity} ${f.check}: ${f.title}`)),
      unknown: out.results.filter((r) => r.status === 'unknown').map((r) => `${r.check}: ${r.reason}`),
      degraded: out.results.filter((r) => r.degraded).map((r) => `${r.check}: ${r.degraded}`),
      notes: out.results.flatMap((r) => r.notes || []),
      calls: stats.calls, wallMs: Date.now() - t0,
    };
    if (process.argv.includes('--json')) console.log(JSON.stringify(redact({ ...summary, results: out.results }), null, 1));
    else console.log(JSON.stringify(redact(summary), null, 1));
    process.exitCode = EXIT[v];
    return EXIT[v];
  } catch (e) {
    console.error(redact(`${name}: ${e.code === 'READ_ONLY' ? 'REFUSED ' : ''}${e.message}`));
    process.exitCode = 2;
    return 2;
  }
}
