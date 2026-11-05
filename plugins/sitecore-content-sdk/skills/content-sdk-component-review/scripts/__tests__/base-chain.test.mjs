// Offline tests for check-template-base-chain.mjs: the binding, the error-vs-defect split and
// template discovery. No network: every request goes through an injected fetch double.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tenantOf, bindTenant, projectTemplates, checkTemplates, report, authoringEndpointFor } from '../check-template-base-chain.mjs';

const CLAIM = 'https://auth.sitecorecloud.io/claims/';
const jwt = (claims) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const silent = (fn) => { const [l, e] = [console.log, console.error]; console.log = console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };

test('binding: the token must name the expected tenant', () => {
  const token = jwt({ [CLAIM + 'tenant_name']: 'acme-cm0001' });
  assert.equal(tenantOf(token), 'acme-cm0001');
  assert.equal(bindTenant(token, 'acme-cm0001'), 'acme-cm0001');
  assert.throws(() => bindTenant(token, 'other-cm0002'), /TENANT MISMATCH.*acme-cm0001.*other-cm0002/);
  assert.throws(() => bindTenant(token, ''), /refusing/);
  assert.throws(() => bindTenant(jwt({ [CLAIM + 'org_name']: 'org' }), 'acme-cm0001'), /no tenant claim/);
});

test('endpoint is derived from the tenant, with the xmc- host prefix', () => {
  assert.equal(authoringEndpointFor('acme-cm0001'), 'https://xmc-acme-cm0001.sitecorecloud.io/sitecore/api/authoring/graphql/v1');
});

test('an error is not a defect: could-not-check exits 2, an empty chain exits 1, resolving chains exit 0', async () => {
  const templates = [{ id: 'a', path: '/t/A' }, { id: 'b', path: '/t/B' }];
  const ctx = (byId) => ({ endpoint: 'x', token: 't', fetchImpl: async (_u, init) => byId[JSON.parse(init.body).variables.id] });
  const ok = await checkTemplates(templates, ctx({ a: json({ data: { itemTemplate: { name: 'A', baseTemplates: { nodes: [{ name: 'Std' }] } } } }), b: json({ data: { itemTemplate: { name: 'B', baseTemplates: { nodes: [{ name: 'Std' }] } } } }) }));
  assert.equal(silent(() => report(ok, { quiet: true })), 0);
  const empty = await checkTemplates(templates, ctx({ a: json({ data: { itemTemplate: { name: 'A', baseTemplates: { nodes: [] } } } }), b: json({ data: { itemTemplate: { name: 'B', baseTemplates: { nodes: [{ name: 'Std' }] } } } }) }));
  assert.equal(silent(() => report(empty, { quiet: true })), 1);
  const errored = await checkTemplates(templates, ctx({ a: json({ errors: [{ message: 'Cannot query field "itemId"' }] }), b: json({}, 500) }));
  assert.deepEqual(errored.map((r) => r.ok), [false, false]);
  assert.equal(silent(() => report(errored, { quiet: true })), 2, 'a broken query must never read as a broken tenant');
});

test('discovery: template items only, module folders may start with the slug, none found = empty', () => {
  const items = mkdtempSync(join(tmpdir(), 'base-chain-'));
  const dir = join(items, 'acme-brand', 'templatesProject', 'Acme');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Hero.yml'), 'ID: "11111111-1111-1111-1111-111111111111"\nPath: /sitecore/templates/Project/Acme/Hero\nSharedFields:\n- ID: "x"\n  Hint: __Base template\n');
  writeFileSync(join(dir, 'Title.yml'), 'ID: "22222222-2222-2222-2222-222222222222"\nPath: /sitecore/templates/Project/Acme/Hero/Content/Title\n');
  const found = projectTemplates(items, 'acme');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, '11111111-1111-1111-1111-111111111111');
  assert.deepEqual(projectTemplates(items, 'nobody'), []);
});

test('discovery: a quoted __Base template hint counts as a template', () => {
  const items = mkdtempSync(join(tmpdir(), 'base-chain-'));
  const dir = join(items, 'acme', 'templatesProject', 'Acme');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Hero.yml'), 'ID: "33333333-3333-3333-3333-333333333333"\nPath: "/sitecore/templates/Project/Acme/Hero"\nSharedFields:\n- ID: "x"\n  Hint: "__Base template"\n');
  assert.deepEqual(projectTemplates(items, 'acme').map((t) => t.id), ['33333333-3333-3333-3333-333333333333']);
});
