#!/usr/bin/env node
// test-layout-params.mjs: behavioural self-test of assets/layout-params.ts on param shapes captured
// from real Edge layouts (2026-10-15). Imports the .ts directly: needs Node 22.18+ (type stripping).
//
// Usage: node test-layout-params.mjs --self-test
// Exit: 0 all pass · 1 a case failed · 2 usage or Node too old.
const [maj, min] = process.versions.node.split('.').map(Number);
if (!process.argv.includes('--self-test')) { console.log('usage: test-layout-params.mjs --self-test'); process.exit(2); }
if (maj < 22 || (maj === 22 && min < 18)) { console.log(`usage: Node ${process.versions.node} cannot import .ts; need 22.18+`); process.exit(2); }

const L = await import(new URL('../assets/layout-params.ts', import.meta.url));

// Delivered params, verbatim shapes from Edge preview.
const COLUMN = { ColumnWidth1: 'col-sm-8', ColumnWidth2: 'col-sm-4', SplitterSize: '2', EnabledPlaceholders: '1,2', DynamicPlaceholderId: '2' };
const UNSORTED = { EnabledPlaceholders: '1,3,2,4', DynamicPlaceholderId: '5', ColumnWidth1: 'col-xs-12|col-sm-6', ColumnWidth3: 'col-6' };
const CONTAINER = { GridParameters: 'col-sm-12', DynamicPlaceholderId: '1' };
const CONTAINER_STYLED = { Styles: 'top-nav', DynamicPlaceholderId: '7', styles: 'top-nav' };
const BARE = { DynamicPlaceholderId: '3' };

let failed = 0, n = 0;
const eq = (got, want, name) => {
  n++; const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  if (!ok) failed++;
};

eq(L.slotName('column', COLUMN, 1), 'column-1-2', 'concrete column key from DynamicPlaceholderId');
eq(L.slotName('container', CONTAINER), 'container-1', 'concrete container key');
eq(L.slotName('column', { DynamicPlaceholderId: 'abc' }, 1), 'column-1-{*}', 'non-numeric id falls back to the literal wildcard');
eq(L.slotName('row', {}, 2), 'row-2-{*}', 'missing id falls back to the literal wildcard');
eq(new RegExp('^column-1-\\d+$').test(L.slotName('column', COLUMN, 1)), true, 'concrete key matches the SDK dynamic pattern for column-1-{*}');

eq(L.enabledSlots(COLUMN), [1, 2], 'EnabledPlaceholders drives the slots');
eq(L.enabledSlots(UNSORTED), [1, 3, 2, 4], 'authored order is kept (unsorted EnabledPlaceholders seen on Edge)');
eq(L.enabledSlots({ EnabledPlaceholders: '1,1,9,x,2' }), [1, 2], 'duplicates, out-of-range and junk entries are dropped');
eq(L.enabledSlots({ ColumnWidth2: 'col-6', ColumnWidth1: 'col-6' }), [1, 2], 'no EnabledPlaceholders: ColumnWidthN keys, sorted');
eq(L.enabledSlots({ SplitterSize: '3' }), [1, 2, 3], 'then SplitterSize');
eq(L.enabledSlots(BARE), [1, 2], 'then the fallback of 2');
eq(L.enabledSlots(undefined, 8, 1), [1], 'undefined params with fallback 1');

eq(L.styleClasses(CONTAINER), 'col-sm-12', 'GridParameters alone');
eq(L.styleClasses(CONTAINER_STYLED), 'top-nav', 'SDK styles + Styles de-duplicated');
eq(L.styleClasses(BARE), '', 'nothing set: empty string, never "undefined"');
eq(L.slotClasses(UNSORTED, 1), 'col-xs-12 col-sm-6', 'pipe-joined multi-breakpoint width is split');
eq(L.slotClasses(UNSORTED, 2, 'col-12'), 'col-12', 'missing ColumnWidthN uses the default width');
eq(L.slotClasses({ ColumnWidth1: 'col-6', Styles1: 'bg-muted' }, 1), 'col-6 bg-muted', 'width plus per-slot styles');
eq(L.cx('a', undefined, false, 'b a', null), 'a b', 'cx drops empties and duplicates');

eq(L.backgroundImageUrl({ BackgroundImage: '<image mediaid="{X}" mediaurl="/-/media/hero.jpg" />' }), '/-/media/hero.jpg', 'BackgroundImage mediaurl extracted');
eq(L.backgroundImageUrl({}), undefined, 'no BackgroundImage: undefined');

console.log(`\n${n - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
