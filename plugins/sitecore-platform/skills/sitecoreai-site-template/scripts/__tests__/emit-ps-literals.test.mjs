// PowerShell literal contexts other than the doubled single-quote: $ and backtick interpolate inside "...", a newline ends a # comment.
// Values reach the script from the spec (name, dictionary phrase, settings, renderingHost). Found in a field review on 2026-10-24.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSpec, validateBlueprintSpec, dictItemName, CONTAINER } from '../lib/spec.mjs';
import { emitSiteSetup, emitConfigureHost, psdq } from '../lib/emit-ps.mjs';

const NASTY = 'a $zz9 `c "d" \'e\' $(Get-Date) \nline2';
const build = over => {
  const { spec, errors } = validateSpec({ name: 'N', module: 'nasty', description: 'd', renderingHost: 'h', homeType: 'Home',
    pageTypes: [{ name: 'Home' }], pages: [{ path: '' }],
    dictionary: [{ key: 'K', phrase: NASTY }], settings: { RobotsContent: NASTY }, ...over });
  assert.deepEqual(errors, []);
  return spec;
};
const resolved = { pageTypeIds: { Home: '{H}' }, renderingIds: {}, datasourceTemplates: {} };
// remove single-quoted literals (a doubled '' is the escape), then look for a nasty token in what is left: that is code or "..." text
const strip = ps => ps.split('\n').filter(l => !l.trim().startsWith('#')).join('\n').replace(/'(?:[^']|'')*'/g, "''");
const leaks = ps => /\$zz9|\$\(Get-Date\)|`c|\$env:USERNAME/.test(strip(ps));

test('dictionary phrase and RobotsContent with $ ` " and a newline stay inside single-quoted literals', () => {
  const ps = emitSiteSetup(build({}), resolved);
  assert.ok(!leaks(ps), 'no spec value reaches code or a double-quoted PowerShell string');
  assert.ok(ps.includes("'a $zz9 `c \"d\" ''e'' $(Get-Date) \nline2'"), 'value is carried verbatim in a single-quoted literal');
});

test('a spec name with $ ` " cannot interpolate in the Write-Log lines', () => {
  const ps = emitSiteSetup(build({ name: 'My $env:USERNAME `n "x"' }), resolved);
  assert.ok(!leaks(ps), 'name only appears inside single-quoted literals');
});

test('a newline in the rendering host cannot escape the generated # comment line', () => {
  const ps = emitConfigureHost({ name: 'N', renderingHost: 'h\nRemove-Item -Recurse C:/' });
  const lines = ps.split('\n');
  const c = lines.findIndex(l => l.includes('binds the new site'));
  assert.ok(lines[c + 1].includes('[Item]$SiteLocation'), 'the comment is one line; the next line is the generator\'s own');
});

// --- placeholders: a nested container's placeholder is built inside a double-quoted string ---
const PWN = 'headless-main$(Write-Output PWNED)';
const nested = placeholder => {
  const { spec, errors } = validateSpec({ name: 'N', module: 'nasty', description: 'd', renderingHost: 'h', homeType: 'Home', pageTypes: [{ name: 'Home' }],
    pages: [{ path: '', components: [{ rendering: 'Page Structure/Container', children: [{ rendering: 'Page Structure/Container', children: [{ rendering: 'Page Content/Title' }] }] }] }] });
  assert.deepEqual(errors, []);
  spec.pages[0].components[0].placeholder = placeholder; // past the validator on purpose: the emitter must hold on its own
  return emitSiteSetup(spec, resolved);
};
const SHELL = ['powershell.exe', 'pwsh'].find(c => spawnSync(c, ['-NoProfile', '-Command', 'exit 0']).status === 0);
// Parse with the real PowerShell AST; prints parse errors and every command or subexpression holding the marker.
const astFindings = (ps, marker) => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-ast-'));
  writeFileSync(join(dir, 'out.ps1'), '\uFEFF' + ps);
  const script = '$e=$null;$t=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile("' + join(dir, 'out.ps1') + '",[ref]$t,[ref]$e);'
    + '"errors:$($e.Count)";$a.FindAll({param($n) ($n -is [System.Management.Automation.Language.SubExpressionAst]) -or ($n -is [System.Management.Automation.Language.CommandAst])},$true) | Where-Object { $_.Extent.Text -match "' + marker + '" -and $_.GetType().Name -eq "SubExpressionAst" } | ForEach-Object { "HIT:" + $_.Extent.Text }';
  return spawnSync(SHELL, ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
};

test('placeholder in nested containers: $ and backtick are escaped in the double-quoted string, $dyn stays live', () => {
  const ps = nested(PWN);
  assert.ok(ps.includes('"/headless-main`$(Write-Output PWNED)/container-$dyn1"'), ps.split('\n').find(l => l.includes('container-')));
  assert.ok(ps.includes('"/headless-main`$(Write-Output PWNED)/container-$dyn1/container-$dyn2"'), 'second level keeps the escape and its own live $dyn');
});

test('psdq escapes backtick, dollar, double quote and the curly double-quote look-alikes', () => {
  assert.equal(psdq('a$b`c"d\u201Ce\u201Df\u201Eg'), 'a`$b``c`"d`\u201Ce`\u201Df`\u201Eg');
});

test('PowerShell AST: no subexpression from a placeholder, in nested containers', { skip: !SHELL && 'no PowerShell on this machine' }, () => {
  const out = astFindings(nested(PWN), 'PWNED');
  assert.deepEqual(out, ['errors:0'], out.join('\n'));
  const curly = astFindings(nested('a\u201D$(Write-Output PWNED)\u201Cb'), 'PWNED');
  assert.deepEqual(curly, ['errors:0'], curly.join('\n'));
});

test('a placeholder outside the allowed characters is a spec error, at any depth, in pages, partials and blueprints', () => {
  const base = { name: 'N', module: 'nasty', description: 'd', renderingHost: 'h' };
  const top = validateSpec({ ...base, pages: [{ path: '', components: [{ rendering: 'Page Content/Title', placeholder: PWN }] }] });
  assert.ok(top.errors.some(e => e.includes('placeholder')), top.errors.join('|'));
  const deep = validateSpec({ ...base, pages: [{ path: '', components: [{ rendering: 'Page Structure/Container', children: [{ rendering: 'Page Content/Title', placeholder: 'x y' }] }] }] });
  assert.ok(deep.errors.some(e => e.includes('placeholder')), deep.errors.join('|'));
  const partial = validateSpec({ ...base, partials: [{ name: 'Header', placeholder: PWN, components: [{ rendering: 'Page Content/Title' }] }] });
  assert.ok(partial.errors.some(e => e.includes('placeholder')), partial.errors.join('|'));
  const inTemplateBp = validateSpec({ ...base, blueprints: [{ name: 'Landing', components: [{ rendering: 'Page Content/Title', placeholder: PWN }] }] });
  assert.ok(inTemplateBp.errors.some(e => e.includes('placeholder')), inTemplateBp.errors.join('|'));
  const bp = validateBlueprintSpec({ site: 's', name: 'Landing', components: [{ rendering: 'Page Content/Title', placeholder: PWN }] });
  assert.ok(bp.errors.some(e => e.includes('placeholder')), bp.errors.join('|'));
  for (const ok of ['headless-main', '/headless-main/container-1', 'sxa-header-{A1B2}-0', 'a_b']) {
    assert.deepEqual(validateSpec({ ...base, pages: [{ path: '', components: [{ rendering: 'Page Content/Title', placeholder: ok }] }] }).errors, [], ok);
  }
});

// --- dictionary item names ---
const emittedDictRegex = ps => { const m = ps.match(/-replace '((?:[^']|'')+)', '-'/); assert.ok(m, 'emitter writes a -replace'); return m[1]; };
const CASES = { 'a/b': 'a-b', 'c[d]': 'c-d-', 'x*y': 'x-y', 'a\\b': 'a-b', 'a:b?c': 'a-b-c', 'q"r<s>t|u': 'q-r-s-t-u', 'brand.cta.book': 'brand.cta.book' };

test('the emitted dictionary regex keeps its backslashes and replaces what it says', () => {
  const src = emittedDictRegex(emitSiteSetup(build({}), resolved));
  assert.equal(src, String.raw`[\\/:?"<>|*\[\]]`);
  const re = new RegExp(src, 'g');
  for (const [k, want] of Object.entries(CASES)) { assert.equal(k.replace(re, '-'), want, k); assert.equal(dictItemName(k), want, k); }
});

test('PowerShell agrees with the emitted dictionary regex', { skip: !SHELL && 'no PowerShell on this machine' }, () => {
  const src = emittedDictRegex(emitSiteSetup(build({}), resolved));
  for (const [k, want] of Object.entries(CASES)) {
    const out = spawnSync(SHELL, ['-NoProfile', '-EncodedCommand', Buffer.from("'" + k + "' -replace '" + src + "', '-'", 'utf16le').toString('base64')], { encoding: 'utf8' }).stdout.trim();
    assert.equal(out, want, k);
  }
});

test('dictionary keys that give the same item name are an error, case-insensitive', () => {
  const base = { name: 'N', module: 'nasty', description: 'd', renderingHost: 'h' };
  const r = dictionary => validateSpec({ ...base, dictionary }).errors;
  assert.ok(r([{ key: 'a/b', phrase: 'x' }, { key: 'a:b', phrase: 'y' }]).some(e => e.includes('same item name')));
  assert.ok(r([{ key: 'A-B', phrase: 'x' }, { key: 'a*b', phrase: 'y' }]).some(e => e.includes('same item name')));
  assert.deepEqual(r([{ key: 'a/b', phrase: 'x' }, { key: 'a/c', phrase: 'y' }]), []);
});

test('names differing only by case are duplicates: page types, pages, partials, blueprints, datasources', () => {
  const base = { name: 'N', module: 'nasty', description: 'd', renderingHost: 'h' };
  const dup = s => validateSpec({ ...base, ...s }).errors.filter(e => e.includes('duplicate'));
  assert.equal(dup({ pageTypes: [{ name: 'Landing' }, { name: 'landing' }], homeType: 'Landing' }).length, 1);
  assert.equal(dup({ pageTypes: [{ name: 'Landing' }], homeType: 'Landing', pages: [{ path: '' }, { path: 'About', type: 'Landing' }, { path: 'about', type: 'Landing' }] }).length, 1);
  assert.equal(dup({ partials: [{ name: 'Header', placeholder: 'p', components: [] }, { name: 'HEADER', placeholder: 'p', components: [] }] }).length, 1);
  const c = n => ({ rendering: 'Page Content/Title', datasource: { name: n } });
  assert.equal(dup({ blueprints: [{ name: 'Land', components: [c('A')] }, { name: 'land', components: [c('A')] }] }).length, 1);
  assert.equal(dup({ pages: [{ path: '', components: [c('Hero'), c('hero')] }] }).length, 1);
  assert.equal(validateBlueprintSpec({ site: 's', name: 'Land', components: [c('Hero'), c('hero')] }).errors.filter(e => e.includes('duplicate')).length, 1);
});
