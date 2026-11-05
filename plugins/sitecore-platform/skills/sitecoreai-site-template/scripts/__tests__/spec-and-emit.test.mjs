// Offline gates for the spec validator, the PowerShell emitter and the thumbnail encoder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, renderingsUsed, componentMapKeys, CONTAINER } from '../lib/spec.mjs';
import { emitSiteSetup, emitConfigureHost, psq } from '../lib/emit-ps.mjs';
import { wireframe } from '../make-thumbnail.mjs';

const base = () => ({
  name: 'Acme', module: 'acme', description: 'd', renderingHost: 'nextjsstarter', homeType: 'Landing',
  pageTypes: [{ name: 'Landing' }, { name: 'Article', fields: [{ name: 'Summary', type: 'Multi-Line Text' }] }],
  partials: [{ name: 'Header', placeholder: 'headless-header', components: [{ rendering: 'Navigation/Navigation' }] }],
  pages: [
    { path: '', components: [{ rendering: 'Page Structure/Container', children: [
      { rendering: 'Page Content/Promo', datasource: { name: 'A', fields: { PromoText: "it's" } } },
      { rendering: 'Page Structure/Container', children: [{ rendering: 'Page Content/RichText', datasource: { name: 'B', fields: { Text: 'x' } } }] }] }] },
    { path: 'News/Item', type: 'Article' },
    { path: 'News', type: 'Landing' },
  ],
});
const resolved = { pageTypeIds: { Landing: '{L}', Article: '{A}' }, datasourceTemplates: {
  '/sitecore/layout/Renderings/Feature/JSS Experience Accelerator/Page Content/Promo': '/t/Promo',
  '/sitecore/layout/Renderings/Feature/JSS Experience Accelerator/Page Content/RichText': '/t/Text' } };

test('valid spec normalises: Home first, parents before children, defaults filled', () => {
  const { spec, errors } = validateSpec(base());
  assert.deepEqual(errors, []);
  assert.deepEqual(spec.pages.map(p => p.path), ['', 'News', 'News/Item']);
  assert.equal(spec.layer, 'Project');
  assert.equal(spec.pages[0].components[0].placeholder, 'headless-main');
});

test('rejects what would fail at site creation', () => {
  const s = base();
  s.module = 'Bad Module';
  s.pages.push({ path: 'Orphan/Child', type: 'Landing' }, { path: 'X', type: 'Nope' });
  s.pages[0].components.push({ rendering: 'Page Content/RichText', children: [{ rendering: 'Page Content/Title' }] });
  const { errors } = validateSpec(s);
  for (const needle of ['module:', 'parent "Orphan"', 'unknown type "Nope"', 'only Page Structure/Container takes "children"'])
    assert.ok(errors.some(e => e.includes(needle)), `expected an error containing ${needle}; got ${errors.join(' | ')}`);
});

test('duplicate datasource names within one page are refused', () => {
  const s = base();
  s.pages[0].components.push({ rendering: 'Page Content/RichText', datasource: { name: 'A', fields: {} } });
  assert.ok(validateSpec(s).errors.some(e => e.includes('duplicate datasource name "A"')));
});

test('renderingsUsed resolves short paths against the OOTB root and includes nested ones', () => {
  const used = renderingsUsed(validateSpec(base()).spec);
  assert.ok(used.includes(CONTAINER));
  assert.ok(used.some(r => r.endsWith('Page Content/RichText')));
  assert.ok(used.some(r => r.endsWith('Navigation/Navigation')));
});

test('emitter: nested containers use $dyn1/$dyn2 and SXA dynamic placeholder keys', () => {
  const ps = emitSiteSetup(validateSpec(base()).spec, resolved);
  assert.match(ps, /\$dyn1 = Add-Component \$pages\[''\] '[^']+Container' 'headless-main'/);
  assert.match(ps, /"\/headless-main\/container-\$dyn1"/);
  assert.match(ps, /\$dyn2 = Add-Component .*"\/headless-main\/container-\$dyn1"/);
  assert.match(ps, /"\/headless-main\/container-\$dyn1\/container-\$dyn2"/);
});

test('emitter: quotes are escaped, home is re-templated, partials are shared layout', () => {
  const ps = emitSiteSetup(validateSpec(base()).spec, resolved);
  assert.ok(ps.includes("'PromoText' = 'it''s'"));
  assert.match(ps, /ChangeTemplate\(\[Sitecore\.Data\.Items\.TemplateItem\]\$types\['Landing'\]\)/);
  assert.match(ps, /Add-Component \$pd '[^']+Navigation' 'headless-header' '' '' @\{  \} \$true/);
  assert.match(ps, /\$pages\['News\/Item'\] = Ensure-Page \$pages\['News'\] 'Item' \$types\['Article'\]/);
  assert.ok(ps.indexOf("$pages['News'] =") < ps.indexOf("$pages['News/Item'] ="), 'parents are created first');
});

test('emitter: collection page types inherit the module type and the collection Page, never mutate it', () => {
  const ps = emitSiteSetup(validateSpec(base()).spec, resolved);
  assert.ok(ps.includes('"$moduleTemplateId|$((Get-Item -Path "$templatesRoot/Page").ID)"'));
  assert.ok(!/\$templatesRoot\/Page"\)\.?\s*\["__Base template"\]\s*=/.test(ps), 'must not rewrite the shared collection Page');
  assert.ok(ps.includes('already has a page type'), 'guards against another template family in the same collection');
});

test('host binding script names the host and warns when it is missing', () => {
  const ps = emitConfigureHost({ renderingHost: "kit's-host" });
  assert.ok(ps.includes("$siteGrouping.RenderingHost = 'kit''s-host'"));
  assert.match(ps, /does not exist on this CM/);
});

test('componentMapKeys reads the generated component map shape', () => {
  const src = "export const componentMap = new Map([\n  ['BYOCWrapper', BYOCServerWrapper],\n  ['RichText', { ...RichText }],\n  [\"Promo\", Promo],\n]);";
  assert.deepEqual([...componentMapKeys(src)], ['BYOCWrapper', 'RichText', 'Promo']);
});

test('psq doubles single quotes', () => { assert.equal(psq("a'b"), "'a''b'"); });

test('thumbnail is a valid PNG of the requested size', () => {
  const png = wireframe({ width: 120, height: 180 });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 120);
  assert.equal(png.readUInt32BE(20), 180);
});

// (2026-10-24 field test): variants on custom renderings, Dictionary entries, Settings fields, unknown-key warning.
test('emitter: Ensure-Variant creates a missing variants folder and a definition from an existing one; FieldNames = variant item id', () => {
  const s = base();
  s.pages[0].components = [{ rendering: '/sitecore/layout/Renderings/Project/Brand-Kit/MediaGallery', variant: 'Lightbox' }];
  const ps = emitSiteSetup(validateSpec(s).spec, { ...resolved });
  const fn = ps.slice(ps.indexOf('function Ensure-Variant'), ps.indexOf('function Add-Component'));
  assert.doesNotMatch(fn, /throw "no Headless Variants folder for/, 'a missing folder must not abort the component');
  assert.match(fn, /New-Item -Path \$root -Name \$rendering\.Name -ItemType \$anyFolder\.TemplateID\.ToString\(\)/, 'folder created from a sibling folder template');
  assert.match(fn, /Get-ChildItem -Path "master:\$\(\$f\.Paths\.FullPath\)"/, 'definition template taken from any existing definition');
  assert.match(fn, /throw "no existing Variant Definition/, 'explicit error when no definition template is discoverable');
  assert.match(ps, /\$p\['FieldNames'\] = \(Ensure-Variant \$rendering \$variant\)\.ID\.ToString\(\)/, 'FieldNames is the variant ITEM id');
  assert.ok(ps.includes("'Lightbox'"));
});

test('spec: dictionary[] needs key + phrase; unknown top-level keys warn instead of vanishing', () => {
  const s = base();
  s.dictionary = [{ key: 'zz.hello', phrase: 'Hello' }, { key: 'nophrase' }];
  s.dictoinary = [];
  const r = validateSpec(s);
  assert.ok(r.errors.some(e => e.startsWith('dictionary:')), r.errors.join('|'));
  assert.ok(r.warnings.some(w => w.includes('unknown top-level key "dictoinary"')), r.warnings.join('|'));
  assert.ok(!r.warnings.some(w => w.includes('"dictionary"') || w.includes('"settings"')), 'known keys do not warn');
  assert.deepEqual(validateSpec(base()).warnings.filter(w => w.startsWith('unknown')), []);
});

test('emitter: dictionary entries become Dictionary entry items with Key + Phrase under <site>/Dictionary', () => {
  const s = base();
  s.dictionary = [{ key: 'zz.probe/hello', phrase: "it's Hello" }];
  const ps = emitSiteSetup(validateSpec(s).spec, resolved);
  assert.match(ps, /\$dict = Get-Item -Path "\$sitePath\/Dictionary" -Language \$lang/);
  assert.ok(ps.includes("'{6D1CD897-1936-4A3A-A511-289A94C2A7B1}'"));
  assert.ok(ps.includes("'Key' = 'zz.probe/hello'") && ps.includes("'Phrase' = 'it''s Hello'"));
  assert.doesNotMatch(emitSiteSetup(validateSpec(base()).spec, resolved), /\$dict = /, 'no dictionary block without entries');
});

test('emitter: settings{} are written to <site>/Settings with Set-Fields', () => {
  const s = base();
  s.settings = { RobotsContent: 'User-agent: *\nAllow: /' };
  const ps = emitSiteSetup(validateSpec(s).spec, resolved);
  assert.match(ps, /Set-Fields \(Get-Item -Path "\$sitePath\/Settings" -Language \$lang\) @\{ 'RobotsContent' = 'User-agent: \*\nAllow: \/' \}/);
  assert.doesNotMatch(emitSiteSetup(validateSpec(base()).spec, resolved), /\/Settings" -Language/);
});
