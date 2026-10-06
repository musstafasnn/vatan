// coasts.json'u Natural Earth 1:10m kara ve küçük ada katmanlarından üretir.
// Tek seferlik bir araç: çıktı depoda durur, duvar kâğıdı üretimi ağa gitmez.
//
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_minor_islands.geojson
//   node tools/wallpaper/coasts-extract.mjs ne_10m_land.geojson ne_10m_minor_islands.geojson
//
// Natural Earth kamu malıdır. Halkalar bölge kutusuna kırpılır ve 0.001° (Ege'de
// ~0,5 px) hassasiyetle Douglas-Peucker ile seyreltilir: 1:50m veri bu
// yakınlıkta köşeli kıyı verirdi, ham 1:10m ise dosyayı gereksiz şişirirdi.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGIONS = {
  ege: { w: 21.6, e: 31.6, s: 35.5, n: 41.0 },
  karadeniz: { w: 36.5, e: 43.3, s: 39.0, n: 42.9 },
};
const TOLERANCE = .001;

// Sutherland–Hodgman, dikdörtgene karşı dört düzlem.
function clip(ring, box) {
  const planes = [
    [p => p[0] >= box.w, (a, b) => [box.w, a[1] + (b[1] - a[1]) * (box.w - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= box.e, (a, b) => [box.e, a[1] + (b[1] - a[1]) * (box.e - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= box.s, (a, b) => [a[0] + (b[0] - a[0]) * (box.s - a[1]) / (b[1] - a[1]), box.s]],
    [p => p[1] <= box.n, (a, b) => [a[0] + (b[0] - a[0]) * (box.n - a[1]) / (b[1] - a[1]), box.n]],
  ];
  let out = ring;
  for (const [inside, cut] of planes) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) {
        if (!inside(a)) out.push(cut(a, b));
        out.push(b);
      } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let best = -1, far = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > far) { far = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Yalnız dış halkalar: göller kara sayılır ve iki katmanın örtüşen adaları
// "herhangi bir halkanın içinde" kuralıyla birleşir, çift-tek kuralıyla
// birbirini silmez.
const rings = file => JSON.parse(readFileSync(file, 'utf8')).features.flatMap(f =>
  f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p => p[0]));

const out = {};
for (const [name, box] of Object.entries(REGIONS)) {
  out[name] = [];
  for (const file of process.argv.slice(2))
    for (const ring of rings(file)) {
      const r = simplify(clip(ring.slice(0, -1), box), TOLERANCE);
      if (r.length >= 3) out[name].push(r.flatMap(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
    }
}
writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'coasts.json'), JSON.stringify(out) + '\n');
