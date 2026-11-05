// PowerShell treats the typographic single quotes U+2018 U+2019 U+201A U+201B as single-quote characters, so a value like
// "This site’s model" ends a '...' literal early ("Unexpected token 's' in expression or statement") and the whole
// site-setup script fails to compile in the dialog. Found in a field test on 2026-10-24 (a Dictionary phrase with a typographic quote).
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../lib/spec.mjs';
import { emitSiteSetup, psq } from '../lib/emit-ps.mjs';

const QUOTES = ['\u2018', '\u2019', '\u201A', '\u201B'];
// a quote char that is not part of a doubled pair
const lone = s => new RegExp(`(?<![${QUOTES.join('')}])[${QUOTES.join('')}](?![${QUOTES.join('')}])`).test(s);

test('psq doubles every PowerShell single-quote character, not only the ASCII one', () => {
  assert.equal(psq("it's"), "'it''s'");
  for (const q of QUOTES) assert.equal(psq(`a${q}b`), `'a${q}${q}b'`, `U+${q.codePointAt(0).toString(16)}`);
  assert.equal(psq('plain'), "'plain'");
});

test('a typographic apostrophe in a dictionary phrase, a datasource field and a setting survives into the script escaped', () => {
  const { spec, errors } = validateSpec({
    name: 'Quotes', module: 'quotes', description: 'd', renderingHost: 'h', homeType: 'Home',
    pageTypes: [{ name: 'Home' }],
    pages: [{ path: '', components: [{ rendering: 'Page Content/Promo', datasource: { name: 'A', fields: { PromoText: 'This site\u2019s model' } } }] }],
    dictionary: [{ key: 'K', phrase: 'This site\u2019s model, \u2018quoted\u2019' }],
    settings: { RobotsContent: 'User-agent: *\nAllow: /' },
  });
  assert.deepEqual(errors, []);
  const ps = emitSiteSetup(spec, { pageTypeIds: { Home: '{H}' }, renderingIds: {}, datasourceTemplates: { [spec.pages[0].components[0].renderingPath]: '/t/Promo' } });
  assert.ok(ps.includes('This site\u2019\u2019s model'), 'apostrophe doubled');
  assert.ok(!lone(ps), 'no lone typographic single quote left in the script');
});
