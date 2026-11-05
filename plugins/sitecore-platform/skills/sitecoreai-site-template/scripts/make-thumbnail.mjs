#!/usr/bin/env node
// make-thumbnail.mjs: draw a wireframe page preview PNG (header, hero, cards, footer) in two brand colours.
// A stand-in for a real screenshot; the Create Site card shows the top of the image at roughly 2:3.
// Usage: node make-thumbnail.mjs --out thumb.png [--primary #0f3d5e] [--accent #f2a541] [--width 960] [--height 1440]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { parseArgs } from './lib/client.mjs';

const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) throw new Error(`bad colour ${h}`); const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function wireframe({ width = 960, height = 1440, primary = '#0f3d5e', accent = '#f2a541' } = {}) {
  const P = hex(primary), A = hex(accent), W = [255, 255, 255], G = [236, 238, 241], D = [70, 78, 90];
  const px = Buffer.alloc(width * height * 3);
  const rect = (x0, y0, w, h, c) => { [x0, y0, w, h] = [x0, y0, w, h].map(Math.round); for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) px.set(c, (y * width + x) * 3); };
  const u = width / 100;
  rect(0, 0, width, height, W);
  rect(0, 0, width, 9 * u, P);                                   // header bar
  rect(4 * u, 3 * u, 14 * u, 3 * u, A);                          // logo
  for (let i = 0; i < 4; i++) rect(52 * u + i * 11 * u, 4 * u, 8 * u, 1.2 * u, W); // nav
  for (let y = 0; y < 52 * u; y++) rect(0, 9 * u + y, width, 1, mix(P, A, y / (52 * u) * 0.55)); // hero gradient
  rect(6 * u, 22 * u, 60 * u, 5 * u, W); rect(6 * u, 30 * u, 44 * u, 5 * u, W);  // headline
  rect(6 * u, 40 * u, 38 * u, 1.6 * u, mix(W, P, 0.25)); rect(6 * u, 43 * u, 30 * u, 1.6 * u, mix(W, P, 0.25));
  rect(6 * u, 49 * u, 18 * u, 5 * u, A);                         // CTA
  for (let i = 0; i < 3; i++) {                                  // cards
    const x = 6 * u + i * 30 * u, y = 68 * u;
    rect(x, y, 27 * u, 34 * u, G); rect(x, y, 27 * u, 16 * u, mix(G, P, 0.35));
    rect(x + 2 * u, y + 19 * u, 20 * u, 2 * u, D); rect(x + 2 * u, y + 24 * u, 23 * u, 1.2 * u, mix(G, D, 0.4)); rect(x + 2 * u, y + 27 * u, 18 * u, 1.2 * u, mix(G, D, 0.4));
  }
  for (let i = 0; i < 6; i++) rect(6 * u, 110 * u + i * 3 * u, (i % 2 ? 70 : 84) * u, 1.4 * u, mix(W, D, 0.3)); // text block
  rect(0, height - 14 * u, width, 14 * u, mix(P, [0, 0, 0], 0.25)); // footer
  rect(6 * u, height - 9 * u, 20 * u, 1.4 * u, mix(P, W, 0.5)); rect(40 * u, height - 9 * u, 16 * u, 1.4 * u, mix(P, W, 0.5));
  return encodePng(width, height, px);
}

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1]?.endsWith('make-thumbnail.mjs')) {
  const o = parseArgs(process.argv.slice(2), { out: 1, primary: 1, accent: 1, width: 1, height: 1 });
  if (!o.out) { console.log('usage: --out <file.png> [--primary #hex] [--accent #hex]'); process.exit(2); }
  writeFileSync(o.out, wireframe({ primary: o.primary, accent: o.accent, width: +(o.width || 960), height: +(o.height || 1440) }));
  console.log(`wrote ${o.out}`);
}
