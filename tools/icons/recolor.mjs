// data/icons/VATAN/places'i, Pardus'un pardus-gnome ikon temasındaki teal klasör
// paletini uygulamaların kullandığı vurgu kırmızısına taşıyarak üretir; böylece
// dosyalar, kenar çubukları ve kabuk tek bir kırmızıyı paylaşır. Yalnızca teal
// taşıyan ikonlar yazılır; geri kalan her şey çalışma anında pardus-gnome'dan
// miras alınır.
//
//   node tools/icons/recolor.mjs [/usr/share/icons/pardus-gnome]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anahtarlar pardus-gnome renkleridir; değerler, klasör hâlâ arka, ön ve glif
// olarak okunsun diye libadwaita kırmızısı #e62d42 etrafındaki açık/koyu
// sırasını korur.
const PALETTE = {
  '#2AB2AE': '#B51D32', // arka sayfa
  '#79DCD9': '#F47580', // ön vurgu
  '#71D0CD': '#F7808C',
  '#6BB0BB': '#D8364B', // ön gövde
  '#88C4CD': '#E8737F',
  '#3B8B88': '#8E1526', // amblem
  '#1EBF97': '#E62D42', // yer imi kurdelesi
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
