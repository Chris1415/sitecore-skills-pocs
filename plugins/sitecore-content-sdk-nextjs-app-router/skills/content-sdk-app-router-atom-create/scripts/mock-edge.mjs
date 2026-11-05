#!/usr/bin/env node
// Stand-in for Experience Edge + MMS: prove an atom with next build && next start
// before a tenant exists. MMS bodies go out as text/plain; an application/json
// body makes the beta wrapper double-parse and render null.
// Usage: node mock-edge.mjs --dir <fixtures> [--port 4599] [--site <name>]
// <fixtures>/routes.json { "/path": {name, itemId, renderings} }, documents.json { "<ref>": Document }
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.dir) {
  console.error('usage: node mock-edge.mjs --dir <fixtures> [--port 4599] [--site <name>]');
  process.exit(2);
}
const dir = path.resolve(args.dir);
const PORT = Number(args.port || 4599);
const SITE = args.site || process.env.NEXT_PUBLIC_DEFAULT_SITE_NAME || 'site';
// Re-read per request so fixture edits apply without restarting the mock.
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

function layoutFor(routes, itemPath) {
  const r = routes[itemPath];
  if (!r) return null;
  return {
    sitecore: {
      context: { pageEditing: false, site: { name: SITE }, language: 'en', itemPath },
      route: {
        name: r.name, displayName: r.name, itemId: r.itemId, itemLanguage: 'en', itemVersion: 1,
        layoutId: '96e5f4ba-a2cf-4a4c-a4e7-64da88226362', templateId: '00000000-0000-0000-0000-000000000001',
        templateName: 'Page', fields: { Title: { value: r.name } },
        placeholders: { 'headless-header': [], 'headless-footer': [], 'headless-main': r.renderings },
      },
    },
  };
}

const emptySite = {
  routes: { total: 0, pageInfo: { hasNext: false, endCursor: '' }, results: [] },
  dictionary: { pageInfo: { hasNext: false, endCursor: '' }, results: [] },
  redirects: [], robots: '', sitemap: [],
  errorHandling: { notFoundPage: null, notFoundPagePath: null, serverErrorPage: null, serverErrorPagePath: null },
};

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      // A bad fixture answers 500 and the mock stays up: fixtures are re-read on every request.
      try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/mms/')) {
        const p = decodeURIComponent(url.pathname.slice(5));
        const doc = load('documents.json')[p];
        res.writeHead(doc ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' });
        console.log(`MMS ${doc ? 200 : 404} ${p}`);
        return res.end(doc ? JSON.stringify(doc) : '{"error":"unknown"}');
      }
      if (req.method !== 'POST') {
        res.writeHead(404);
        return res.end();
      }
      let q = '', vars = {};
      try { ({ query: q = '', variables: vars = {} } = JSON.parse(body)); } catch {}
      let data = {};
      if (/layout\s*\(/.test(q)) {
        const itemPath = vars.itemPath ?? q.match(/routePath:"([^"]*)"/)?.[1] ?? '/';
        const l = layoutFor(load('routes.json'), itemPath);
        data = { layout: l ? { item: { rendered: l } } : { item: null } };
      } else if (/siteInfoCollection|siteInfo\b|site\s*\{/.test(q)) {
        data = { site: { siteInfoCollection: [{ name: SITE, hostName: 'localhost', language: 'en' }], siteInfo: emptySite } };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data }));
      } catch (e) {
        console.error(`bad fixture: ${e.message}`);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `bad fixture: ${e.message}` }));
      }
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock edge on 127.0.0.1:${PORT}, site ${SITE}, fixtures ${dir}`));
