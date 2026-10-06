// Duvar kâğıtlarının ortak zanaatı: teraslı kabartma, sol üstten ışık, PNG.
// Her sahne yalnız bir yükseklik alanı, bir işaretli uzaklık alanı (kara > 0,
// deniz < 0) ve bir renk teması verir; görünümü bu dosya belirler, böylece aile
// tek bir el çıkarmış gibi durur.
//
// render() vatan-light/dark.png'nin baytlarını üreten döngünün aynısıdır;
// parametreleştirilirken işlem sırası değiştirilmedi. Değiştirmek yayımlanmış
// görselleri değiştirir: önce eski çıktıların md5'ini alın.
import { deflateSync, crc32 } from 'node:zlib';

export const W = 3840, H = 2160;

export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const smooth = t => t * t * (3 - 2 * t);
export const lerp = (a, b, t) => a + (b - a) * t;

// Işık adada ve Komut yüzeylerinde olduğu gibi sol üstten gelir, böylece kabartma
// ve kabuk gölgelerin nereye düştüğü konusunda hemfikir olur.
export const LIGHT = (() => { const v = [-.55, -.65, .52], n = Math.hypot(...v); return v.map(c => c / n); })();

// Sabit tohumlu LCG karıştırması: yeniden üretim, yayımlanan görselleri bayt bayt tekrar etmeli.
const PERM = (() => {
  let seed = 1923;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return Uint8Array.from(p);
})();

export function vnoise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = smooth(x - X), fy = smooth(y - Y), fz = smooth(z - Z);
  const h = (i, j, k) => PERM[(PERM[(PERM[(X + i) & 255] + Y + j) & 255] + Z + k) & 255];
  const a = lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy);
  const b = lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy);
  return lerp(a, b, fz) / 255;
}
export const elevation = (x, y, z) => vnoise(x, y, z) * .58 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3, z * 1.4) * .28 + vnoise(x * 4.3 + 9.1, y * 4.3 + 3.7, z * 1.9) * .14;

// Sahneye özgü rastgelelik (ör. peribacası yerleri) için ayrı tohumlu LCG;
// PERM'e dokunmaz.
export function lcg(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export function grid(cell) {
  const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
  // Bir grid alanının piksel koordinatlarındaki bilinear örneği.
  const sampler = values => (x, y) => {
    const gx = clamp(x / cell, 0, cols - 1.001), gy = clamp(y / cell, 0, rows - 1.001);
    const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * cols + i;
    return lerp(lerp(values[k], values[k + 1], fx), lerp(values[k + cols], values[k + cols + 1], fx), fy);
  };
  return { cell, cols, rows, sampler };
}

export function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// Binlerce kıyı parçalı sahneler için işaretli uzaklık: her hücre her parçaya
// bakarsa (vatan'ın yaptığı gibi) 1:10m Ege kıyısında dakikalar sürer. İç/dış
// satır taramasıyla kesin bulunur; uzaklık yalnız "reach" içindeki kovalardaki
// parçalara bakar, ötesi reach'e kırpılır (alanlar zaten orada doyar).
// rings: kapalı halkalar (piksel); coast: uzaklığa katılan parçalar. Kırpma
// kutusunun yapay kenarları coast'a girmez ki kara kenarda "kıyı" sanılmasın.
export function signedDistance(g, rings, coast, reach) {
  const { cell, cols, rows } = g, inside = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const py = j * cell;
    for (const r of rings) {
      const xs = [];
      for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const [xi, yi] = r[i], [xk, yk] = r[k];
        if ((yi > py) !== (yk > py)) xs.push((xk - xi) * (py - yi) / (yk - yi) + xi);
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2)
        for (let i = Math.max(0, Math.ceil(xs[n] / cell)); i < cols && i * cell < xs[n + 1]; i++) inside[j * cols + i] = 1;
    }
  }
  const B = 128, bc = Math.ceil(W / B) + 1, br = Math.ceil(H / B) + 1, buckets = Array.from({ length: bc * br }, () => []);
  for (const s of coast) {
    const [[ax, ay], [bx, by]] = s;
    const x0 = clamp(Math.floor((Math.min(ax, bx) - reach) / B), 0, bc - 1), x1 = clamp(Math.floor((Math.max(ax, bx) + reach) / B), 0, bc - 1);
    const y0 = clamp(Math.floor((Math.min(ay, by) - reach) / B), 0, br - 1), y1 = clamp(Math.floor((Math.max(ay, by) + reach) / B), 0, br - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets[y * bc + x].push(s);
  }
  const sdf = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = i * cell, py = j * cell, list = buckets[clamp(Math.floor(py / B), 0, br - 1) * bc + clamp(Math.floor(px / B), 0, bc - 1)];
    let d = reach;
    for (const [a, b] of list) d = Math.min(d, segDist(px, py, a, b));
    sdf[j * cols + i] = inside[j * cols + i] ? d : -d;
  }
  return sdf;
}

// Kabartma üst üste dizilmiş kâğıt gibi teraslıdır: her kontur seviyesi, altındakinin
// bir basamak üzerinde duran ve ışıktan uzağa yumuşak bir gölge düşüren bir tabakadır.
// Terasların altındaki yumuşak bir hillshade dağları yuvarlak tutar.
// overlay(x, y, c, mix) dither'dan hemen önce rengi değiştirebilir (işaretler,
// şehir ışıkları). theme.landVignette kenarları karada da koyulaştırır; denizi
// olmayan sahneler çerçevesini böyle bulur.
export function render({ g, field, sdf, theme, coast, levelStep, topLevel, overlay }) {
  const h = g.sampler(field), d = g.sampler(sdf);
  const px = new Uint8Array(W * H * 3);
  const levelOf = v => (v - coast) / levelStep;
  const shadowSteps = [[6, .5], [14, .3], [26, .2]].map(([r, w]) => [-LIGHT[0] * r, -LIGHT[1] * r, w]);
  const drop = [-LIGHT[0] * 44, -LIGHT[1] * 44];
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const ditherAmp = theme.dither ?? 1;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = h(x, y), dist = d(x, y);
    const vig = clamp(Math.hypot((x - W * .5) / W, (y - H * .42) / H) * 1.5, 0, 1);
    let c = mix(theme.seaCenter, theme.seaEdge, vig * vig);

    // Kara denizin üzerinde yüzer; gölgesi bulanıklaştırılmış, ötelenmiş bir kıyıdır.
    const lifted = smooth(clamp((d(x - drop[0], y - drop[1]) + 60) / 120, 0, 1));
    c = mix(c, theme.ink, lifted * theme.dropShadow * .6);

    const fl = levelOf(v);
    const gx = (h(x + 1, y) - h(x - 1, y)) / 2 / levelStep, gy = (h(x, y + 1) - h(x, y - 1)) / 2 / levelStep;
    const perPx = Math.max(Math.hypot(gx, gy), 1e-4);

    if (dist <= 0) {
      if (fl < 0) {
        const f = fl - Math.floor(fl), line = 1 - clamp(Math.min(f, 1 - f) / perPx - .5, 0, 1);
        c = mix(c, theme.landHigh, line * theme.seaLine);
      }
    } else {
      // Kenar yumuşatmalı teras indeksi: basamak bir piksel boyunca harmanlanır.
      const f = fl - Math.floor(fl), step = Math.floor(fl) + smooth(clamp((f - 1) / perPx + 1, 0, 1));
      const top = levelOf(topLevel);
      let land = mix(theme.landLow, theme.landHigh, Math.pow(clamp(step / top, 0, 1), .8));

      let shadow = 0;
      for (const [ox, oy, w] of shadowSteps) shadow += w * clamp(Math.floor(levelOf(h(x + ox, y + oy))) - Math.floor(fl), 0, 1);
      land = mix(land, theme.ink, shadow * theme.terraceShadow);

      const nz = 1 / Math.hypot(gx * .9, gy * .9, 1);
      const lambert = (-gx * .9 * nz) * LIGHT[0] + (-gy * .9 * nz) * LIGHT[1] + nz * LIGHT[2];
      land = mix(land, lambert > .52 ? [255, 255, 255] : theme.ink, Math.min(Math.abs(lambert - .52) * 1.6, 1) * theme.shade);

      // Işığa bakan her tabaka kenarı boyunca aydınlık bir dudak.
      const edge = 1 - clamp(Math.min(f, 1 - f) / perPx - .6, 0, 1);
      const facing = clamp(-(gx * LIGHT[0] + gy * LIGHT[1]) / perPx, 0, 1);
      land = mix(land, [255, 255, 255], edge * facing * theme.rim);
      // Işığa sırtını dönen basamak kenarı: dudak ve kısa gölge yalnız ışığa
      // bakan yamaçta görünür, karşı yamaç düz bir koyuluğa dönüşür. Kanyon
      // gibi iki yamacı da basamaklı görünmesi gereken sahneler için açılır.
      if (theme.riser) land = mix(land, theme.ink, edge * (1 - facing) * theme.riser);

      if (theme.landVignette) land = mix(land, theme.ink, vig * vig * theme.landVignette);

      c = mix(c, land, clamp(dist, 0, 1));
    }

    if (overlay) c = overlay(x, y, c, mix);

    // Yarım seviyelik sıralı dither: koyu denizdeki 8-bit bandlanmayı gizler.
    // theme.dither onu kısar; dokulu, açık sahnelerde bandlanma görünmez ama
    // dither dosyayı megabaytlarca büyütür. 1 ile çarpım bit düzeyinde etkisizdir.
    const dither = (((x * 7 + y * 13) % 16) / 16 - .5) * ditherAmp;
    const o = (y * W + x) * 3;
    px[o] = clamp(Math.round(c[0] + dither), 0, 255);
    px[o + 1] = clamp(Math.round(c[1] + dither), 0, 255);
    px[o + 2] = clamp(Math.round(c[2] + dither), 0, 255);
  }
  return encodePng(px);
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(px, w = W, h = H) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    // "Up" filtresi: alan satırlar arasında yavaş değişir, bu yüzden en iyi bu sıkışır.
    const o = y * (stride + 1);
    raw[o] = y ? 2 : 0;
    for (let i = 0; i < stride; i++) raw[o + 1 + i] = (px[y * stride + i] - (y ? px[(y - 1) * stride + i] : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
