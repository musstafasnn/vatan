// Builds data/icons/VATAN/places from Pardus's pardus-gnome icon theme by
// moving its teal folder palette onto the accent red the apps use, so files,
// sidebars and the shell share one red. Only icons that carry the teal are
// written; everything else is inherited from pardus-gnome at runtime.
//
//   node tools/icons/recolor.mjs [/usr/share/icons/pardus-gnome]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keys are the pardus-gnome colors; values keep their light/dark order around
// the libadwaita red #e62d42 so the folder still reads as back, front and glyph.
const PALETTE = {
  '#2AB2AE': '#B51D32', // back sheet
  '#79DCD9': '#F47580', // front highlight
  '#71D0CD': '#F7808C',
  '#6BB0BB': '#D8364B', // front body
  '#88C4CD': '#E8737F',
  '#3B8B88': '#8E1526', // emblem
  '#1EBF97': '#E62D42', // bookmarks ribbon
  '#368471': '#9A1A2B',
};

const source = resolve(process.argv[2] ?? '/usr/share/icons/pardus-gnome', 'places');
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/icons/VATAN/places');
mkdirSync(outDir, { recursive: true });

const pattern = new RegExp(Object.keys(PALETTE).join('|'), 'gi');
let written = 0;
for (const name of readdirSync(source).filter(n => n.endsWith('.svg')).sort()) {
  const svg = readFileSync(join(source, name), 'utf8');
  const red = svg.replace(pattern, c => PALETTE[c.toUpperCase()]);
  if (red === svg)
    continue;
  writeFileSync(join(outDir, name), red);
  written++;
}
if (!written)
  throw new Error(`no pardus-gnome folder icons found in ${source}`);
