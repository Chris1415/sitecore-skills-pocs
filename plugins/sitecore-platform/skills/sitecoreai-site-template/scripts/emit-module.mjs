#!/usr/bin/env node
// emit-module.mjs: write a Sitecore Content Serialization module that captures a built template, so `dotnet sitecore ser pull`
// can bring it into a repo and a deploy keeps it. Optional: a live-built template works without it, but lives only in that CM.
// Usage: node emit-module.mjs --spec <file.json> --out <authoring/items dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib/client.mjs';
import { validateSpec } from './lib/spec.mjs';
import { paths } from './build-template.mjs';

const o = parseArgs(process.argv.slice(2), { spec: 1, out: 1 });
if (!o.spec || !o.out) { console.log('usage: --spec <file.json> --out <dir>'); process.exit(2); }
const { spec, errors } = validateSpec(JSON.parse(readFileSync(o.spec, 'utf8')));
if (errors.length) { errors.forEach(e => console.log(`ERROR ${e}`)); process.exit(2); }
const P = paths(spec);
const inc = (name, path) => ({ name, path, scope: 'ItemAndDescendants', allowedPushOperations: 'CreateUpdateAndDelete' });
const module = {
  $schema: '../.sitecore/schemas/ModuleFile.schema.json',
  namespace: `SiteTemplate.${spec.module}`,
  items: { includes: [
    inc('settings', P.settings), inc('scripts', P.scripts), ...(spec.pageTypes.length ? [inc('pageTypes', P.pageTypes)] : []),
    ...(spec.thumbnail ? [inc('media', P.media)] : []) ] },
};
mkdirSync(o.out, { recursive: true });
const file = join(o.out, `${spec.module}.module.json`);
writeFileSync(file, JSON.stringify(module, null, 2) + '\n');
console.log(`wrote ${file}\nnext: dotnet sitecore ser pull -i SiteTemplate.${spec.module}   (scope the pull with -i)`);
