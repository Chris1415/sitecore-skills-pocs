// The scanner's data-fetching and async signals sat inside \b...\b, so a non-word last character such as ( or a backtick never matched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', 'scan-atomic-candidates.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [SCAN, ...args], { encoding: 'utf8', cwd });
const app = files => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  mkdirSync(join(dir, 'src', 'components'), { recursive: true });
  for (const [n, src] of Object.entries(files)) writeFileSync(join(dir, 'src', 'components', n), src);
  return dir;
};
const scan = files => {
  const dir = app(files);
  const out = join(dir, 'o.json');
  assert.equal(run(['--app', dir, '--json', out], dir).status, 0);
  return Object.fromEntries(JSON.parse(readFileSync(out, 'utf8')).components.map(c => [c.component, c]));
};
const names = c => c.reasons.map(r => r.name);

test('fetch with a relative url, gql + newline and a spaced call are data fetching', () => {
  const r = scan({
    'Rel.tsx': "export const Default = () => { fetch('/api/x'); return <p>a</p>; };",
    'Gql.tsx': 'const q = gql`\n  query { a }\n`;\nexport const Default = () => <p>{String(q)}</p>;',
    'Spaced.tsx': "export const Default = () => { fetch ('/api/x'); return <p>a</p>; };",
  });
  for (const k of ['Rel', 'Gql', 'Spaced']) { assert.ok(names(r[k]).includes('data-fetching'), k); assert.equal(r[k].verdict, 'keep-code', k); }
});

test('every form of an async server component is seen', () => {
  const r = scan({
    'Named.tsx': 'export async function Default() { return <p>a</p>; }',
    'Def.tsx': 'export default async function Def() { return <p>a</p>; }',
    'Arrow.tsx': 'export const Default = async (props) => <p>a</p>;',
  });
  for (const k of ['Named', 'Def', 'Arrow']) { assert.ok(names(r[k]).includes('server-component-async'), k); assert.equal(r[k].verdict, 'keep-code', k); }
});

test('known-good controls stay low-code candidates', () => {
  const r = scan({
    'Plain.tsx': 'export const Default = () => <p>hello</p>;',
    'Pre.tsx': 'export const Default = () => <p data-prefetch="x" className="refetch">hello</p>;',
    'Sync.tsx': 'export function Default() { return <p>hello</p>; }',
  });
  for (const k of ['Plain', 'Pre', 'Sync']) assert.equal(r[k].verdict, 'low-code-candidate', k + ': ' + names(r[k]).join(','));
});

test('--json creates a missing parent folder', () => {
  const dir = app({ 'Plain.tsx': 'export const Default = () => <p>x</p>;' });
  const out = join(dir, 'a', 'b', 'o.json');
  assert.equal(run(['--app', dir, '--json', out], dir).status, 0);
  assert.ok(existsSync(out));
});

test('--json --md is a usage error and writes no file named --md', () => {
  const dir = app({ 'Plain.tsx': 'export const Default = () => <p>x</p>;' });
  const r = run(['--app', dir, '--json', '--md'], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json needs a file path/);
  assert.ok(!existsSync(join(dir, '--md')));
});

test('a --json path that cannot be written exits 2 and says so', () => {
  const dir = app({ 'Plain.tsx': 'export const Default = () => <p>x</p>;' });
  writeFileSync(join(dir, 'file'), '');
  const r = run(['--app', dir, '--json', join(dir, 'file', 'o.json')], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot write/);
});
