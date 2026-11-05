// CLI plumbing the gates share: Git Bash path rewriting, the estate credential fallback, and the exit path.
// Each test fails against the code it guards (measured 2026-10-06 on a Windows/Git Bash machine).
import test from 'node:test';
import assert from 'node:assert/strict';
import { msysRoot, routePathArg, sitecorePathArg, credentialPrefixes } from '../lib/env.mjs';
import { runGateCli } from '../lib/gate.mjs';
import { result, addFinding } from '../lib/findings.mjs';

const MSYS = { MSYSTEM: 'MINGW64', EXEPATH: String.raw`C:\Tools\Git\bin` };

test('msys: a rewritten leading-slash arg is restored under Git Bash', () => {
  assert.equal(msysRoot(MSYS), 'C:/Tools/Git/');
  assert.equal(routePathArg('C:/Tools/Git/Models', 'pages', MSYS), '/Models');
  assert.equal(routePathArg('C:/Tools/Git/', 'pages', MSYS), '/');
  assert.equal(sitecorePathArg('C:/Tools/Git/sitecore/content/X', 'root', MSYS), '/sitecore/content/X');
  assert.equal(routePathArg('/about', 'pages', MSYS), '/about');
});

test('msys: any other drive-letter path is refused, never guessed', () => {
  assert.throws(() => routePathArg('D:/work/Models', 'pages', MSYS), { code: 'MSYS_PATH' });
  // outside Git Bash the install root is unknown, so even the Git-shaped path is refused
  assert.throws(() => routePathArg('C:/Tools/Git/Models', 'pages', {}), { code: 'MSYS_PATH' });
});

test('credentials: a labelled org falls back to the unsuffixed pair only when its own pair is absent', () => {
  const plain = { SITECORE_DEPLOY_ADMIN_CLIENT_ID: 'a', SITECORE_DEPLOY_ADMIN_CLIENT_SECRET: 'b' };
  const fb = credentialPrefixes({ org: 'other' }, plain);
  assert.equal(fb.org, 'SITECORE_DEPLOY_ADMIN_CLIENT');
  assert.equal(fb.notes.length, 1);
  assert.match(fb.notes[0], /unsuffixed SITECORE_DEPLOY_ADMIN_CLIENT/);

  const both = credentialPrefixes({ org: 'acme' }, { ...plain, SITECORE_DEPLOY_ACME_ADMIN_CLIENT_ID: 'c', SITECORE_DEPLOY_ACME_ADMIN_CLIENT_SECRET: 'd' });
  assert.equal(both.org, 'SITECORE_DEPLOY_ACME_ADMIN_CLIENT');
  assert.deepEqual(both.notes, []);

  const none = credentialPrefixes({ org: 'other' }, {});
  assert.equal(none.org, 'SITECORE_DEPLOY_OTHER_ADMIN_CLIENT'); // the clear "missing credentials" error stays

  const explicit = credentialPrefixes({ org: 'other', 'org-client-prefix': 'MY_CLIENT' }, plain);
  assert.equal(explicit.org, 'MY_CLIENT');
});

test('gate CLI sets process.exitCode and returns instead of calling process.exit()', async () => {
  const realExit = process.exit; const realLog = console.log; const prevCode = process.exitCode;
  let exited = null;
  process.exit = (c) => { exited = c; throw new Error('process.exit called'); };
  console.log = () => {};
  try {
    const fail = await runGateCli('t', async () => { const r = result('T1', 't'); addFinding(r, { severity: 'P0', blocker: true, title: 'x' }); return { results: [r] }; });
    assert.equal(exited, null);
    assert.equal(fail, 1);
    assert.equal(process.exitCode, 1);
    const pass = await runGateCli('t', async () => ({ results: [result('T1', 't')] }));
    assert.equal(pass, 0);
    assert.equal(process.exitCode, 0);
  } finally {
    process.exit = realExit; console.log = realLog; process.exitCode = prevCode;
  }
});
