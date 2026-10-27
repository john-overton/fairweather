#!/usr/bin/env node
// WCAG contrast check for every Fairweather palette (11 themes x light/dark).
// Run: node scripts/contrast.mjs   (exits 1 on any failure)
import { readFileSync } from 'node:fs';

const themes = JSON.parse(readFileSync(new URL('../lib/themes.json', import.meta.url)));
const KEYS = ['bg', 'surface', 'surface2', 'ink', 'muted', 'line', 'accent', 'onAccent', 'cool', 'heroA', 'heroB'];

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const CHECKS = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['muted', 'surface', 3],
  ['onAccent', 'accent', 4.5],
];

let failures = 0;
for (const [id, theme] of Object.entries(themes)) {
  for (const mode of ['light', 'dark']) {
    const p = Object.fromEntries(KEYS.map((k, i) => [k, theme[mode][i]]));
    for (const [fg, bg, min] of CHECKS) {
      const r = ratio(p[fg], p[bg]);
      if (r < min) {
        failures++;
        console.log(`FAIL ${id}/${mode}: ${fg} on ${bg} = ${r.toFixed(2)} (needs ${min})`);
      }
    }
  }
}
console.log(failures ? `${failures} contrast failure(s)` : `All ${Object.keys(themes).length * 2} palettes pass`);
process.exit(failures ? 1 : 0);
