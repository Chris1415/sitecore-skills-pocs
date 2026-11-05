#!/usr/bin/env node
// remove-template.mjs: delete everything build-template.mjs created for a spec (template item, setup root, scripts,
// module page types, thumbnail media). Refuses while any site was created from the template: those sites' collection
// page types inherit the module page types, so deleting them breaks live pages. It also refuses while a root holds items
// the generator did not create, including under Templates and the script library's Functions. --force overrides both.
// Usage: node remove-template.mjs --spec <file.json> --cm-host <host> --client-prefix <PREFIX> [--env-file <.env>] [--force]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs, mintToken, makeClient } from './lib/client.mjs';
import { validateSpec } from './lib/spec.mjs';
import { paths } from './build-template.mjs';

// Test seam: `mint` replaces the OAuth token mint (stub-server tests only).
export async function main(argv, { log = console.log, mint = mintToken } = {}) {
  let o;
  try { o = parseArgs(argv, { spec: 1, cmHost: 1, clientPrefix: 1, envFile: 1, force: 'flag' }); } catch (e) { log(`usage: ${e.message}`); return 2; }
  if (!o.spec || !o.cmHost || !o.clientPrefix) { log('usage: --spec, --cm-host and --client-prefix are required'); return 2; }
  const { spec, errors } = validateSpec(JSON.parse(readFileSync(o.spec, 'utf8')));
  if (errors.length) { errors.forEach(e => log(`ERROR ${e}`)); return 2; }
  const api = makeClient({ cmHost: o.cmHost, token: await mint(o) });
  const P = paths(spec);
  const tpl = await api.item(P.templateItem);
  if (tpl) {
    const sites = (await api.gql('query{solutionSites(input:{}){name rootItem{path field(name:"SiteTemplate"){value}}}}')).solutionSites
      .filter(s => (s.rootItem?.field?.value || '').toUpperCase() === tpl.itemId.toUpperCase());
    if (sites.length && !o.force) {
      log(`REFUSED ${sites.length} site(s) were created from "${spec.name}": ${sites.map(s => s.name).join(', ')}`);
      log('        Remove those sites first, or pass --force to break them knowingly.');
      return 1;
    }
    if (sites.length) log(`WARN  --force: removing "${spec.name}" while these sites still use it: ${sites.map(s => s.name).join(', ')}`);
  }
  // Module roots are deleted recursively: refuse when one holds items this generator did not create (hand-made templates etc.).
  if (!o.force) {
    const owned = {
      [P.pageTypes]: spec.pageTypes.map(t => t.name),
      [P.settings]: [`${spec.name} Setup`, 'Templates'],
      [P.media]: [`${spec.name} Site Preview`.replace(/[^A-Za-z0-9 -]/g, '')], // the name build-template uploads under
      [P.scripts]: ['Functions'],
      [`${P.settings}/Templates`]: [spec.name],
      [`${P.scripts}/Functions`]: [`${spec.name} Site Setup`, `${spec.name} Configure Rendering Host`],
    };
    const foreign = [];
    for (const [root, names] of Object.entries(owned)) {
      const keep = new Set(names.map(n => n.toLowerCase()));
      for (const c of await api.children(root)) if (!keep.has(c.name.toLowerCase())) foreign.push(`${root}/${c.name}`);
    }
    if (foreign.length) {
      log(`REFUSED ${foreign.length} item(s) under the module roots were not created by this template: ${foreign.join(', ')}`);
      log('        Move them out, or pass --force to delete them with the roots.');
      return 1;
    }
  }
  let failed = 0;
  for (const p of [P.templateItem, P.setup, P.settings, P.scripts, P.pageTypes, P.media]) {
    // Page types can stay locked for a few seconds while a just-removed collection that inherits them is deleted.
    try { log(`${(await api.remove(p)) ? 'deleted' : 'absent '}  ${p}`); }
    catch (e) { failed++; log(`ERROR  ${p}: ${e.message} (re-run once the removed sites and collections are gone)`); }
  }
  const still = (await api.gql('query{solutionTemplates{id}}')).solutionTemplates.some(t => tpl && t.id.toUpperCase() === tpl.itemId.toUpperCase());
  log(still ? 'FAIL  template still listed' : `OK    template no longer listed${failed ? `; ${failed} path(s) left behind` : ''}`);
  return still || failed ? 1 : 0;
}

if (process.argv[1] && basename(process.argv[1]) === 'remove-template.mjs') main(process.argv.slice(2)).then(c => process.exit(c), e => { console.log(`ERROR ${e.message}`); process.exit(1); });
