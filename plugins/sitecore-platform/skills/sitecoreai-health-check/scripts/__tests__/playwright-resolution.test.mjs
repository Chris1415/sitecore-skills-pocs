// loadPlaywright's header claims resolution from the cwd, then PLAYWRIGHT_MODULE. The bare `import('playwright')`
// it used to rely on resolves relative to THIS FILE's own location (Node's module algorithm walks up from the
// importer, never from process.cwd()), so a head app with playwright in its own node_modules was never found
// unless PLAYWRIGHT_MODULE pointed at it by hand. This pins the cwd path actually working.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadPlaywright } from '../crawl-live-links.mjs';

// A global install reachable through NODE_PATH (a cloud sandbox ships one) satisfies the cwd lookup
// from ANY directory, so the "cwd has no playwright" cases cannot be arranged there.
function globalPlaywright() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-probe-'));
  try { return createRequire(path.join(tmp, 'package.json')).resolve('playwright'); } catch { return null; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const GLOBAL = globalPlaywright();
const noGlobal = GLOBAL ? { skip: `a global playwright resolves from any cwd (${GLOBAL})` } : {};

function makeFakePlaywrightPackage(root) {
  const dir = path.join(root, 'node_modules', 'playwright');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'exports.chromium = { marker: "cwd-resolved" };');
}

test('loadPlaywright: resolves from the CWD node_modules when PLAYWRIGHT_MODULE is unset', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-cwd-'));
  makeFakePlaywrightPackage(tmp);
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const pw = await loadPlaywright({});
    assert.ok(pw, 'expected loadPlaywright to find the cwd-installed package');
    assert.equal(pw.chromium.marker, 'cwd-resolved');
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadPlaywright: falls back to PLAYWRIGHT_MODULE when the cwd has no playwright', noGlobal, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-nocwd-'));
  const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-module-'));
  const modFile = path.join(modDir, 'playwright-stub.js');
  fs.writeFileSync(modFile, 'exports.chromium = { marker: "env-resolved" };');
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const pw = await loadPlaywright({ PLAYWRIGHT_MODULE: modFile });
    assert.ok(pw, 'expected loadPlaywright to fall back to PLAYWRIGHT_MODULE');
    assert.equal(pw.chromium.marker, 'env-resolved');
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(modDir, { recursive: true, force: true });
  }
});

test('loadPlaywright: neither cwd nor PLAYWRIGHT_MODULE present returns null', noGlobal, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-none-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const pw = await loadPlaywright({});
    assert.equal(pw, null);
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
