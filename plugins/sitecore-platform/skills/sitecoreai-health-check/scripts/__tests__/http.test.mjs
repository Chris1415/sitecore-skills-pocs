// The request layer refuses every write shape and never reaches the network for a refused call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guard, graphqlOperations, request, gql, setRate, redact, addSecret, _setFetchForTests, _resetRates, TOKEN_URL } from '../lib/http.mjs';
import { fakeFetch, res } from './_fake.mjs';

const AGQL = 'https://xmc-demo.sitecorecloud.io/sitecore/api/authoring/graphql/v1';
const EDGE = 'https://edge-platform.sitecorecloud.io/v1/content/api/graphql/v1?sitecoreContextId=abc';
const refused = (o) => assert.throws(() => guard(o), (e) => e.code === 'READ_ONLY');
const allowed = (o) => assert.doesNotThrow(() => guard(o));
const body = (query) => JSON.stringify({ query });

test('verbs: DELETE, PUT, PATCH refused; GET and HEAD allowed', () => {
  for (const method of ['DELETE', 'PUT', 'PATCH', 'OPTIONS']) refused({ method, url: 'https://xmclouddeploy-api.sitecorecloud.io/api/environments/v1/x' });
  allowed({ method: 'GET', url: 'https://xmclouddeploy-api.sitecorecloud.io/api/environments/v2/x' });
  allowed({ method: 'HEAD', url: 'https://xmcloud-monitoring-api.sitecorecloud.io/api/logs/v1/x/f.txt' });
});

test('GraphQL: any mutation or subscription refused, parsed not keyword-matched', () => {
  refused({ method: 'POST', url: AGQL, body: body('mutation { deleteItem(input:{}) { successful } }') });
  refused({ method: 'POST', url: AGQL, body: body('# comment\n  mutation M($i:ID!){ x }') });
  refused({ method: 'POST', url: AGQL, body: body('query A { a } mutation B { b }') });
  refused({ method: 'POST', url: EDGE, body: body('subscription { s }') });
  refused({ method: 'POST', url: AGQL, body: JSON.stringify([{ query: '{ a }' }, { query: 'mutation { b }' }]) });
  allowed({ method: 'POST', url: AGQL, body: body('{ item(where:{ path:"/sitecore/content/mutation" }){ itemId } }') });
  allowed({ method: 'POST', url: AGQL, body: body('query($i:ID!, $o:In = {a: 1}){ item(where:{itemId:$i}){ itemId } } fragment F on Item { name }') });
  allowed({ method: 'POST', url: EDGE, body: body('"""mutation in a block string"""\nquery { a }') });
});

test('GraphQL: missing or unparseable documents refused', () => {
  refused({ method: 'POST', url: AGQL, body: JSON.stringify({ variables: {} }) });
  refused({ method: 'POST', url: AGQL, body: body('') });
  refused({ method: 'POST', url: AGQL, body: 'not json' });
  refused({ method: 'POST', url: AGQL, body: '[]' });
});

test('operation parser', () => {
  assert.deepEqual(graphqlOperations('{ a }'), ['query']);
  assert.deepEqual(graphqlOperations('query Q { a } mutation { b }'), ['query', 'mutation']);
  assert.deepEqual(graphqlOperations('fragment F on X { a } { b }'), ['query']);
  assert.deepEqual(graphqlOperations('{ a(s:"mutation { x }") }'), ['query']);
});

test('POST: only GraphQL, token mint and the non-JSON revalidate probe', () => {
  refused({ method: 'POST', url: 'https://xmclouddeploy-api.sitecorecloud.io/api/environments/v1/x/restart', body: '' });
  refused({ method: 'POST', url: 'https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs', body: '{}' });
  allowed({ method: 'POST', url: TOKEN_URL, body: 'grant_type=client_credentials&client_id=a' });
  refused({ method: 'POST', url: TOKEN_URL, body: 'grant_type=password&username=a' });
  allowed({ method: 'POST', url: 'https://site.example/api/revalidate', body: 'x' });
  refused({ method: 'POST', url: 'https://site.example/api/revalidate', body: '{}' });
  refused({ method: 'POST', url: 'https://site.example/api/revalidate', body: 'x', headers: { 'x-revalidate-secret': 's' } });
});

test('Edge Admin: read allowlist only, any /content route refused', () => {
  allowed({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/webhooks' });
  allowed({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/webhooks/0d9a5c1e-1111-2222-3333-444455556666' });
  allowed({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/settings' });
  refused({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/content' });
  refused({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/webhooks/content' });
  refused({ method: 'GET', url: 'https://edge.sitecorecloud.io/api/admin/v1/cache' });
  refused({ method: 'POST', url: 'https://edge.sitecorecloud.io/api/admin/v1/webhooks', body: '{}' });
  refused({ method: 'DELETE', url: 'https://edge.sitecorecloud.io/api/admin/v1/content' });
  allowed({ method: 'GET', url: 'https://edge.sitecorecloud.io/tenant-abc/media/img.jpg' });
});

test('request(): a refused call never reaches fetch; redirects are not followed; rate caps hold', async () => {
  _resetRates();
  const f = fakeFetch([() => res('ok', 302, { location: 'https://vercel.com/sso-api' })]);
  _setFetchForTests(f);
  try {
    await assert.rejects(request('https://xmclouddeploy-api.sitecorecloud.io/x', { method: 'DELETE' }), (e) => e.code === 'READ_ONLY');
    await assert.rejects(gql(AGQL, 'mutation { x }'), (e) => e.code === 'READ_ONLY');
    assert.equal(f.calls.length, 0);
    const r = await request('https://site.example/');
    assert.equal(r.status, 302);
    assert.equal(f.calls[0].init.redirect, 'manual');
    assert.throws(() => setRate('edge', 81), RangeError);
    assert.throws(() => setRate('edge-preview', 6), RangeError);
    setRate('edge', 80);
  } finally { _setFetchForTests(null); _resetRates(); }
});

test('redaction: JWTs, context ids, registered secrets, the editing-debug leak', () => {
  addSecret('super-secret-value-123');
  const s = redact('a eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop b sitecoreContextId=XYZ123abc&x super-secret-value-123 sent "aaa" expected "bbb" {"liveContextId":"q1w2e3r4t5"}');
  assert.ok(!/eyJ|XYZ123abc|super-secret|aaa|q1w2e3r4t5/.test(s), s);
});
