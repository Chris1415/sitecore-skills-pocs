// Report shape, exit codes, SKIPPED/UNKNOWN never folded into clean, deep links, redaction, catalogue agreement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { result, addFinding, unknown, skipped, buildReport, exitCode } from '../lib/findings.mjs';
import { ALL_IDS, TITLES, NOT_RUN, selectChecks } from '../lib/catalogue.mjs';
import { makeRedactor } from '../doctor.mjs';
import { addSecret } from '../lib/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function sample() {
  const a = result('D2', 'robots'); addFinding(a, { severity: 'P0', title: 'blocks crawling', url: 'https://s.example/robots.txt', evidence: 'Disallow: /', remediation: 'set RobotsContent' });
  const b = result('L4', 'datasources'); addFinding(b, { severity: 'P1', title: 'missing datasource', item: '/sitecore/content/x', itemId: '{5E6D0C1A-0000-4000-8000-00000000DEAD}' });
  const c = result('D10', 'webhooks'); addFinding(c, { severity: 'P3', title: 'none registered', may_be_intentional: true });
  return [a, b, c, skipped(result('O6', 'publishing'), 'needs a tenant client'), unknown(result('D11', 'diff'), 'too complex'), result('D1', 'context')];
}

test('report: sections, severity order, SKIPPED with reasons, credential matrix, cost', () => {
  const rep = buildReport({ target: { site: 'Demo', cmEnv: 'env1' }, instruments: ['Edge live: published'], credentials: [{ name: 'org', source: 'X_ID', status: 'ok', enables: 'all' }], results: sample(), cost: { calls: 3, wallMs: 10, byHost: { a: 3 } }, startedAt: '2026-10-02T00:00:00Z', linkCtx: { site: 'Demo', organization: 'org_x', tenantName: 't', cmHost: 'https://xmc-demo.sitecorecloud.io' } });
  for (const h of ['## Summary', '## Findings', '### P0', '### P1', '### P3', '## UNKNOWN', '## SKIPPED', '## Passed', '## Credential matrix', '## Run cost', '## Instruments']) assert.ok(rep.md.includes(h), h);
  assert.ok(rep.md.indexOf('### P0') < rep.md.indexOf('### P1'));
  assert.match(rep.md, /\| O6 \| publishing \| needs a tenant client \|/);
  assert.deepEqual(Object.keys(rep.json).sort(), ['cost', 'credentials', 'exitCode', 'findings', 'finishedAt', 'harnessError', 'instruments', 'results', 'reverseDrift', 'startedAt', 'summary', 'target', 'tool', 'version'].sort());
  assert.equal(rep.json.summary.P0, 1); assert.equal(rep.json.summary.skipped, 1); assert.equal(rep.json.summary.unknown, 1);
  const f = rep.json.findings.find((x) => x.check === 'L4');
  assert.match(f.links.pages, /^https:\/\/pages\.sitecorecloud\.io\/editor\?.*sc_itemid=5e6d0c1a-0000-4000-8000-00000000dead/);
  assert.match(f.links.contentEditor, /Content%20Editor\.aspx\?fo=/);
  for (const x of rep.json.findings) for (const k of ['check', 'severity', 'title', 'fingerprint', 'fix_owner']) assert.ok(k in x, k);
});

test('exit codes: 0 clean, 1 for >= P1 or any UNKNOWN, 2 harness error; P2/P3 and SKIPPED stay 0', () => {
  const clean = [result('D1', 'x'), skipped(result('O6', 'y'), 'no client')];
  const p2 = result('D8', 'x'); addFinding(p2, { severity: 'P2', title: 't' });
  assert.equal(exitCode([...clean, p2]), 0);
  assert.equal(exitCode([...clean, unknown(result('R1', 'x'), 'err')]), 1);
  const p1 = result('L1', 'x'); addFinding(p1, { severity: 'P1', title: 't' });
  assert.equal(exitCode([p1]), 1);
  assert.equal(exitCode(clean, true), 2);
  assert.throws(() => addFinding(result('X', 'x'), { severity: 'HIGH', title: 't' }));
});

test('reverse drift renders the do-not-republish banner', () => {
  const w = result('W5', 'drift'); addFinding(w, { severity: 'P1', title: 'broken on master, good on Edge', reverse_drift: true });
  assert.match(buildReport({ results: [w] }).md, /Do not republish/);
});

test('redaction: secrets always; --redact masks hosts and ids', () => {
  addSecret('gate-cookie-value-xyz');
  const r = makeRedactor({ cmHost: 'https://xmc-demo-tenant-cm1.sitecorecloud.io', cmEnv: 'ENVID12345', org: 'org_ABCDEF' });
  const out = r('host xmc-demo-tenant-cm1.sitecorecloud.io env ENVID12345 org_ABCDEF eh xmc-zz9-eh.sitecorecloud.io media https://edge.sitecorecloud.io/tenant-x1/media/a.jpg cookie gate-cookie-value-xyz');
  assert.ok(!/xmc-demo|ENVID12345|org_ABCDEF|xmc-zz9|tenant-x1|gate-cookie/.test(out), out);
});

test('catalogue: titles cover every id, every id is in references/check-catalogue.md, --checks resolves families', () => {
  assert.deepEqual(Object.keys(TITLES).sort(), [...new Set(ALL_IDS)].sort());
  for (const id of Object.keys(NOT_RUN)) assert.ok(ALL_IDS.includes(id), id);
  const md = readFileSync(join(HERE, '..', '..', 'references', 'check-catalogue.md'), 'utf8');
  for (const id of ALL_IDS) assert.match(md, new RegExp(`^\\| ${id} \\|`, 'm'), `check-catalogue.md has no row for ${id}`);
  const s = selectChecks('delivery,O1'); assert.ok(s.has('X0') && s.has('D2') && s.has('O1') && !s.has('L1'));
  assert.throws(() => selectChecks('nope'));
});
