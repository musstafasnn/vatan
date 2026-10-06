// VATAN Plymouth temasını data/plymouth/vatan içine derler: PNG varlıkları ve
// vatan.script; script'in yerleşim sayıları aşağıdaki LAYOUT'tan gelir, böylece
// önizleme aracı ile script öğelerin nereye gideceği konusunda asla ayrışamaz.
//
//   node tools/plymouth/build.mjs
//
// Kabartma yeniden render edilmez. tools/wallpaper/generate.mjs hiçbir şey export
// etmez ve import edildiğinde data/backgrounds'ı yeniden yazar; bu yüzden bu dosya
// onun yayımlanmış çıktısını (vatan-dark.png) okur; böylece açılış ekranı her
// zaman kullanıcının birkaç saniye sonra göreceği duvar kâğıdıyla eşleşir.
//
// Varlıklar iki sette gelir: 1920x1080 referans için çizilmiş @1 ve 3840x2160
// için @2. Plymouth'un Image.Scale'i önfiltresiz nokta örneklemeli bilinear'dır
// (ply_pixel_buffer_resize); bu yüzden 1:2'nin çok altına küçültmek teras
// çizgilerini tırtıklar. Script, ekrandan küçük olmayan en küçük seti seçer ve
// böylece yalnızca en fazla 2:1 oranında küçültür.
//
// Çıktı deterministiktir: rastgelelik yok, sabit PNG filtre seçimi, sabit zlib
// seviyesi.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = resolve(root, 'data/plymouth/vatan');

const ACCENT = [230, 45, 66];
const INK = [233, 236, 241];
const MUTED = [138, 143, 152];
const BG_CENTER = [21, 25, 33], BG_EDGE = [7, 8, 11];

// Konumlar ekranın kesirleri ya da 1920x1080 referans pikselinde uzunluklardır;
// script ikincisini k ölçeğiyle çarpar.
export const LAYOUT = {
  mapCenterY: .40,        // ekran yüksekliğinin oranı, duvar kâğıdının kabartması gibi
  mapWidth: 820,          // referans px
  mapAlpha: .34,          // en parlak teras, böylece harita bir siluet olarak kalır
  wordGap: 34,            // harita altı -> wordmark üstü
  wordCap: 17,            // wordmark büyük harf yüksekliği
  barGap: 92,             // wordmark altı -> ilerleme çizgisi
  barWidth: 260, barHeight: 2,
  fieldWidth: 380, fieldHeight: 44, labelGap: 14, labelCap: 11,
  bullet: 8, bulletPitch: 18,
  messageGap: 40,         // ilerleme çizgisi -> açılış mesajı
};

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- PNG

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

function filterRow(type, row, prev, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
    const pred = type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : type === 4 ? paeth(a, b, c) : 0;
    out[i] = (row[i] - pred) & 255;
  }
  return out;
}

// channels: 3 (RGB) ya da 4 (RGBA). Satır başına, işaretli kalıntıların toplamı
// en küçük olan filtre kazanır: olağan libpng sezgiseli ve deterministik.
export function encodePng(w, h, channels, px) {
  const stride = w * channels, parts = [];
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = null, bestType = 0, bestScore = Infinity;
    for (let t = 0; t < 5; t++) {
      const f = filterRow(t, row, prev, channels);
      let score = 0;
      for (const v of f) score += v < 128 ? v : 256 - v;
      if (score < bestScore) { best = f; bestType = t; bestScore = score; }
    }
    parts.push(Buffer.from([bestType]), best);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(parts), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Yalnızca kendi dosyalarımızın kullandığı: 8-bit RGB/RGBA, interlaced değil.
export function decodePng(buf) {
  let o = 8, w = 0, h = 0, channels = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0 || (data[9] !== 2 && data[9] !== 6))
        throw new Error('decodePng: only 8-bit non-interlaced RGB/RGBA');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * channels, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const t = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0, b = prev ? prev[i] : 0, c = prev && i >= channels ? prev[i - channels] : 0;
      const pred = t === 1 ? a : t === 2 ? b : t === 3 ? (a + b) >> 1 : t === 4 ? paeth(a, b, c) : 0;
      row[i] = (src[i] + pred) & 255;
    }
  }
  return { w, h, channels, px };
}

// ---------------------------------------------------------------- Geist

// Minimal bir TrueType okuyucu: cmap format 4, hmtx, basit ve bileşik glifli
// loca/glyf. Bir wordmark dizmeye yeter; hinting ve kerning gerekmez çünkü metin
// sabit boyutta rasterize edilmiş geniş aralıklı büyük harflerdir.
function readFont(file) {
  const b = readFileSync(file), tables = {};
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const r = 12 + i * 16;
    tables[b.toString('ascii', r, r + 4)] = b.readUInt32BE(r + 8);
  }
  const head = tables.head, longLoca = b.readInt16BE(head + 50) === 1;
  const numH = b.readUInt16BE(tables.hhea + 34);
  const loca = i => longLoca ? b.readUInt32BE(tables.loca + i * 4) : b.readUInt16BE(tables.loca + i * 2) * 2;

  let sub = 0;
  for (let i = 0, n = b.readUInt16BE(tables.cmap + 2); i < n; i++) {
    const r = tables.cmap + 4 + i * 8;
    if (b.readUInt16BE(r) === 3 && b.readUInt16BE(r + 2) === 1) sub = tables.cmap + b.readUInt32BE(r + 4);
  }
  if (!sub || b.readUInt16BE(sub) !== 4) throw new Error('font: no Windows BMP cmap');
  const segs = b.readUInt16BE(sub + 6) / 2;
  const glyphIndex = cp => {
    for (let s = 0; s < segs; s++) {
      const end = b.readUInt16BE(sub + 14 + s * 2);
      if (cp > end) continue;
      const start = b.readUInt16BE(sub + 16 + segs * 2 + s * 2);
      if (cp < start) break;
      const delta = b.readInt16BE(sub + 16 + segs * 4 + s * 2), roAt = sub + 16 + segs * 6 + s * 2, ro = b.readUInt16BE(roAt);
      if (!ro) return (cp + delta) & 0xffff;
      const g = b.readUInt16BE(roAt + ro + (cp - start) * 2);
      return g ? (g + delta) & 0xffff : 0;
    }
    throw new Error(`font: U+${cp.toString(16)} missing`);
  };
  const advance = g => b.readUInt16BE(tables.hmtx + Math.min(g, numH - 1) * 4);

  // Konturlar {x, y, on} dizileri olarak.
  function contours(g) {
    const o = tables.glyf + loca(g);
    if (loca(g + 1) === loca(g)) return [];
    const n = b.readInt16BE(o);
    if (n < 0) {
      const out = [];
      let p = o + 10, flags;
      do {
        flags = b.readUInt16BE(p); const gi = b.readUInt16BE(p + 2); p += 4;
        let dx, dy;
        if (flags & 1) { dx = b.readInt16BE(p); dy = b.readInt16BE(p + 2); p += 4; }
        else { dx = b.readInt8(p); dy = b.readInt8(p + 1); p += 2; }
        if (!(flags & 2)) throw new Error('font: point-matched components unsupported');
        let sx = 1, sy = 1;
        if (flags & 8) { sx = sy = b.readInt16BE(p) / 16384; p += 2; }
        else if (flags & 0x40) { sx = b.readInt16BE(p) / 16384; sy = b.readInt16BE(p + 2) / 16384; p += 4; }
        else if (flags & 0x80) throw new Error('font: 2x2 component transforms unsupported');
        for (const c of contours(gi)) out.push(c.map(q => ({ x: q.x * sx + dx, y: q.y * sy + dy, on: q.on })));
      } while (flags & 0x20);
      return out;
    }
    const ends = [];
    for (let i = 0; i < n; i++) ends.push(b.readUInt16BE(o + 10 + i * 2));
    const count = ends[n - 1] + 1;
    let p = o + 10 + n * 2;
    p += 2 + b.readUInt16BE(p);
    const flags = [];
    while (flags.length < count) {
      const f = b[p++]; flags.push(f);
      if (f & 8) for (let r = b[p++]; r > 0; r--) flags.push(f);
    }
    const coords = (short, same) => {
      const v = []; let acc = 0;
      for (const f of flags) {
        if (f & short) { const d = b[p++]; acc += f & same ? d : -d; }
        else if (!(f & same)) { acc += b.readInt16BE(p); p += 2; }
        v.push(acc);
      }
      return v;
    };
    const xs = coords(2, 16), ys = coords(4, 32), out = [];
    let start = 0;
    for (const e of ends) {
      const c = [];
      for (let i = start; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
      out.push(c); start = e + 1;
    }
    return out;
  }
  return { glyphIndex, advance, contours };
}

// Kuadratik konturlar çokgenlere, örtük eğri-üstü orta noktalarla.
function flatten(contour, map) {
  const n = contour.length, pts = [];
  let s = contour.findIndex(q => q.on);
  const ring = s < 0
    ? contour.flatMap((q, i) => [{ x: (q.x + contour[(i + 1) % n].x) / 2, y: (q.y + contour[(i + 1) % n].y) / 2, on: true }, contour[(i + 1) % n]])
    : [...contour.slice(s), ...contour.slice(0, s)];
  const m = ring.length;
  let prev = ring[0];
  pts.push(map(prev.x, prev.y));
  for (let i = 1; i <= m; i++) {
    const q = ring[i % m];
    if (q.on) { pts.push(map(q.x, q.y)); prev = q; continue; }
    const nx = ring[(i + 1) % m], end = nx.on ? nx : { x: (q.x + nx.x) / 2, y: (q.y + nx.y) / 2, on: true };
    for (let t = 1; t <= 8; t++) {
      const u = t / 8;
      pts.push(map(lerp(lerp(prev.x, q.x, u), lerp(q.x, end.x, u), u), lerp(lerp(prev.y, q.y, u), lerp(q.y, end.y, u), u)));
    }
    prev = end;
    if (nx.on) i++;
  }
  return pts;
}

// Sıfır olmayan sarım (non-zero winding) kapsaması, piksel başına 16 alt tarama
// satırı ve kesin yatay aralık kapsamasıyla: hinting olmadan net gövdeler.
function fillPolygons(polys, w, h) {
  const cov = new Float32Array(w * h), SUB = 16;
  const edges = [];
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
      if (y0 !== y1) edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
    }
  for (let y = 0; y < h; y++)
    for (let sy = 0; sy < SUB; sy++) {
      const yy = y + (sy + .5) / SUB, hits = [];
      for (const [x0, y0, x1, y1, d] of edges)
        if (yy >= y0 && yy < y1) hits.push([x0 + (yy - y0) / (y1 - y0) * (x1 - x0), d]);
      hits.sort((a, b) => a[0] - b[0]);
      let wind = 0;
      for (let i = 0; i < hits.length - 1; i++) {
        wind += hits[i][1];
        if (!wind) continue;
        const a = clamp(hits[i][0], 0, w), z = clamp(hits[i + 1][0], 0, w);
        for (let x = Math.floor(a); x < Math.ceil(z) && x < w; x++)
          cov[y * w + x] += (Math.min(z, x + 1) - Math.max(a, x)) / SUB;
      }
    }
  return cov;
}

function setText(font, text, cap, tracking) {
  const scale = cap / 710, pad = Math.ceil(cap * .4);
  let pen = 0;
  const glyphs = [...text].map(ch => {
    const g = font.glyphIndex(ch.codePointAt(0)), x = pen;
    pen += font.advance(g) * scale + cap * tracking;
    return { g, x };
  });
  const w = Math.ceil(pen - cap * tracking) + pad * 2, h = Math.ceil(cap * 1.5) + pad * 2, base = pad + Math.ceil(cap * 1.25);
  const polys = glyphs.flatMap(({ g, x }) =>
    font.contours(g).map(c => flatten(c, (fx, fy) => [pad + x + fx * scale, base - fy * scale])));
  return { w, h, cov: fillPolygons(polys, w, h) };
}

// Sabit renk, bilgi alfada: neredeyse hiçbir şeye sıkışır ve Plymouth'un onu
// arkasındaki her şeyin üzerine harmanlamasını sağlar.
function tinted(w, h, cov, [r, g, b], alpha = 1) {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b;
    px[i * 4 + 3] = Math.round(clamp(cov[i], 0, 1) * alpha * 255);
  }
  return encodePng(w, h, 4, px);
}

function shape(w, h, sdf) {
  const cov = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cov[y * w + x] = clamp(.5 - sdf(x + .5, y + .5), 0, 1);
  return cov;
}
const pillSdf = (w, h, inset = 0) => (x, y) => {
  const r = h / 2 - inset, cx = clamp(x, h / 2, w - h / 2);
  return Math.hypot(x - cx, y - h / 2) - r;
};

// ---------------------------------------------------------------- kabartma

// Koyu duvar kâğıdındaki karanın parlaklığı, yalnızca yeşil+maviden okunur:
// kırmızı Ankara işareti neredeyse tamamen kırmızı kanalda yaşar.
function reliefFromWallpaper() {
  const { w, h, px } = decodePng(readFileSync(resolve(root, 'data/backgrounds/vatan-dark.png')));
  const lum = new Float32Array(w * h);
  let mx = 0, my = 0, mn = 0;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], bl = px[i * 3 + 2];
    lum[i] = (g + bl) / 2;
    if (r - g > 40) { mx += i % w; my += (i / w) | 0; mn++; }
  }
  // Açılış ekranında işaret yok: boot ekranında "buradasınız" yoktur. Nokta
  // ve halkası çevredeki araziye doğru gevşetilerek doldurulur (Laplace dolgusu);
  // satır satır interpolasyon, bir teras kenarı yamaya değdiği her yerde
  // görünür bir iz bırakıyordu.
  if (mn) {
    const cx = Math.round(mx / mn), cy = Math.round(my / mn), R = 38, hole = [];
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++)
      if (Math.hypot(x - cx, y - cy) <= R) hole.push(y * w + x);
    for (const i of hole) lum[i] = 0;
    for (let it = 0; it < 1500; it++)
      for (const i of hole) lum[i] = (lum[i - 1] + lum[i + 1] + lum[i - w] + lum[i + w]) / 4;
  }
  // Deniz ile karanın düşen gölgesi ~31'in altındadır; denizin soluk kontur
  // çizgileri ~3 ekler, bu yüzden taban onları siluetin dışında tutar.
  const FLOOR = 31, SPAN = 75, alpha = new Float32Array(w * h);
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let i = 0; i < w * h; i++) {
    const a = clamp((lum[i] - FLOOR) / SPAN, 0, 1);
    alpha[i] = a;
    if (a > .02) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { w, alpha, box: [x0, y0, x1 + 1, y1 + 1] };
}

// Bir kırpmanın alan ortalamalı yeniden örneklenmesi: burada, derleme zamanında
// yapılır, böylece Plymouth'un kendi ölçekleyicisine yalnızca küçük bir adım kalır.
function resample(src, sw, [x0, y0, x1, y1], ow, oh) {
  const out = new Float32Array(ow * oh), fx = (x1 - x0) / ow, fy = (y1 - y0) / oh;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const ax = x0 + x * fx, ay = y0 + y * fy;
    let sum = 0, area = 0;
    for (let yy = Math.floor(ay); yy < Math.ceil(ay + fy); yy++) {
      const wy = Math.min(yy + 1, ay + fy) - Math.max(yy, ay);
      for (let xx = Math.floor(ax); xx < Math.ceil(ax + fx); xx++) {
        const wx = Math.min(xx + 1, ax + fx) - Math.max(xx, ax);
        sum += src[yy * sw + xx] * wx * wy; area += wx * wy;
      }
    }
    out[y * ow + x] = sum / area;
  }
  return out;
}

// Koyu duvar kâğıdının denizindekiyle aynı vinyet, kabartmasının olduğu yerde
// ortalanmış. Yarım seviyelik sıralı dither, merkez ile kenar renkleri arasındaki
// 14 adımlık aralıktaki bandlanmayı gizler.
function background(w, h) {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = clamp(Math.hypot((x - w * .5) / w, (y - h * .42) / h) * 1.5, 0, 1), t = v * v;
    const dither = ((x * 7 + y * 13) % 16) / 16 - .5, o = (y * w + x) * 3;
    for (let c = 0; c < 3; c++) px[o + c] = clamp(Math.round(lerp(BG_CENTER[c], BG_EDGE[c], t) + dither), 0, 255);
  }
  return encodePng(w, h, 3, px);
}

// ---------------------------------------------------------------- script

function script() {
  const L = LAYOUT;
  return `# VATAN açılış ekranı. tools/plymouth/build.mjs tarafından LAYOUT tablosundan
# üretilir; sayıları burada değil, orada değiştir.
#
# Uzunluklar 1920x1080 referans biriminde verilir. İki varlık seti var: @1 (birim
# başına bir piksel) ve @2 (iki piksel). Set, ekranı kapsayan en küçük settir;
# bu yüzden aşağıdaki her Image.Scale en fazla 2:1 oranında küçültür: Plymouth'un
# ölçekleyicisi nokta örneklemeli bilinear'dır ve daha büyük adımlarda tırtıklanır.
#
# Fonksiyonların içinde var olan bir globale düz atama onu değiştirir, yeni bir
# isme atama ise yerel değişken oluşturur; çalışma anında oluşturulan globaller
# "global." ile yazılır.

Window.SetBackgroundTopColor(0.027, 0.031, 0.043);
Window.SetBackgroundBottomColor(0.027, 0.031, 0.043);

screen.x = Window.GetX();
screen.y = Window.GetY();
screen.w = Window.GetWidth();
screen.h = Window.GetHeight();

ref = Math.Min(screen.w / 1920, screen.h / 1080);
unit = Math.Min(ref, 2);
if (ref > 1) {
  set = "@2";
  f = unit / 2;
} else {
  set = "@1";
  f = unit;
}

fun asset(name) {
  local.raw = Image(name + set + ".png");
  return raw.Scale(Math.Max(Math.Int(raw.GetWidth() * f + 0.5), 1), Math.Max(Math.Int(raw.GetHeight() * f + 0.5), 1));
}

fun centre_x(img) {
  return screen.x + Math.Int((screen.w - img.GetWidth()) / 2);
}

# Vinyet, ayrıntısı olmayan yumuşak bir alandır; bu yüzden herhangi bir en-boy
# oranına gerilebilen tek görüntü odur.
bg.image = Image("background" + set + ".png").Scale(screen.w, screen.h);
bg.sprite = Sprite(bg.image);
bg.sprite.SetPosition(screen.x, screen.y, -100);

map.image = asset("map");
map.y = screen.y + Math.Int(screen.h * ${L.mapCenterY} - map.image.GetHeight() / 2);
map.sprite = Sprite(map.image);
map.sprite.SetPosition(centre_x(map.image), map.y, 0);

word.image = asset("wordmark");
word.y = map.y + map.image.GetHeight() + Math.Int(${L.wordGap} * unit);
word.sprite = Sprite(word.image);
word.sprite.SetPosition(centre_x(word.image), word.y, 0);

bar.y = word.y + word.image.GetHeight() + Math.Int(${L.barGap} * unit);
track.image = asset("track");
track.sprite = Sprite(track.image);
track.sprite.SetPosition(centre_x(track.image), bar.y, 1);
bar.full = asset("bar");
bar.x = centre_x(bar.full);
bar.width = 0;
bar.sprite = Sprite();
bar.sprite.SetPosition(bar.x, bar.y, 2);
prompting = 0;

# Kapatma ve güncelleme ekranlarında anlamlı bir ilerleme yoktur: çizgi orada
# gizli kalır ve kompozisyon yalnızca harita ile wordmark'tan oluşur.
if (Plymouth.GetMode() != "boot") {
  track.sprite.SetOpacity(0);
  bar.sprite.SetOpacity(0);
}

fun set_progress(progress) {
  local.w = Math.Int(bar.full.GetWidth() * Math.Clamp(progress, 0, 1));
  if (w == bar.width) return;
  bar.width = w;
  if (w < 1) {
    bar.sprite.SetOpacity(0);
    return;
  }
  bar.sprite.SetImage(bar.full.Scale(w, bar.full.GetHeight()));
  if (Plymouth.GetMode() == "boot" && !global.prompting)
    bar.sprite.SetOpacity(1);
}

fun boot_progress_callback(duration, progress) {
  set_progress(progress);
}
Plymouth.SetBootProgressFunction(boot_progress_callback);

# Parola istemi. İlk kullanımda kurulur, sonra yalnızca gösterilir ve gizlenir.
fun prompt_setup() {
  local.p;
  p.field = asset("field");
  p.field_x = centre_x(p.field);
  p.field_y = bar.y - Math.Int(p.field.GetHeight() / 2);
  p.field_sprite = Sprite(p.field);
  p.field_sprite.SetPosition(p.field_x, p.field_y, 10);
  p.label = asset("label");
  p.label_sprite = Sprite(p.label);
  p.label_sprite.SetPosition(centre_x(p.label), p.field_y - Math.Int(${L.labelGap} * unit) - p.label.GetHeight(), 10);
  p.bullet = asset("bullet");
  p.pitch = Math.Int(${L.bulletPitch} * unit);
  # Alanın iç genişliğini aşan noktalar çizilmez; sayaç yine de artar,
  # yalnızca görünmez olur.
  p.max = Math.Int((p.field.GetWidth() - p.field.GetHeight()) / p.pitch);
  p.bullets = 0;
  global.prompt = p;
}

fun prompt_opacity(o) {
  prompt.field_sprite.SetOpacity(o);
  prompt.label_sprite.SetOpacity(o);
  for (local.i = 0; prompt.dots[i]; i++)
    prompt.dots[i].SetOpacity(0);
  if (o > 0) {
    local.n = Math.Min(prompt.bullets, prompt.max);
    local.x0 = screen.x + Math.Int((screen.w - (n - 1) * prompt.pitch - prompt.bullet.GetWidth()) / 2);
    local.y = bar.y - Math.Int(prompt.bullet.GetHeight() / 2);
    for (i = 0; i < n; i++) {
      if (!prompt.dots[i])
        prompt.dots[i] = Sprite(prompt.bullet);
      prompt.dots[i].SetPosition(x0 + i * prompt.pitch, y, 11);
      prompt.dots[i].SetOpacity(1);
    }
  }
}

fun display_password_callback(prompt_text, bullets) {
  global.prompting = 1;
  if (!global.prompt)
    prompt_setup();
  prompt.bullets = bullets;
  track.sprite.SetOpacity(0);
  bar.sprite.SetOpacity(0);
  prompt_opacity(1);
}
Plymouth.SetDisplayPasswordFunction(display_password_callback);

fun display_normal_callback() {
  global.prompting = 0;
  if (global.prompt)
    prompt_opacity(0);
  if (Plymouth.GetMode() == "boot") {
    track.sprite.SetOpacity(1);
    if (bar.width > 0)
      bar.sprite.SetOpacity(1);
  }
}
Plymouth.SetDisplayNormalFunction(display_normal_callback);

# Açılış mesajları (fsck, kilit açma ipuçları) Image.Text gerektirir; yani
# Plymouth'un label eklentisi ve initramfs içinde bir font. Bunlar yoksa
# Image.Text boş bir görüntü döndürür ve mesaj sadece gösterilmez.
message.sprite = Sprite();
message.sprite.SetZ(20);

fun message_callback(text) {
  local.img = Image.Text(text, ${(MUTED[0] / 255).toFixed(3)}, ${(MUTED[1] / 255).toFixed(3)}, ${(MUTED[2] / 255).toFixed(3)});
  if (!img || text == "" || img.GetWidth() < 1) {
    message.sprite.SetOpacity(0);
    return;
  }
  message.sprite.SetImage(img);
  message.sprite.SetX(centre_x(img));
  message.sprite.SetY(bar.y + Math.Int(${L.messageGap} * unit));
  message.sprite.SetOpacity(1);
}
Plymouth.SetMessageFunction(message_callback);

fun quit_callback() {
  set_progress(1);
}
Plymouth.SetQuitFunction(quit_callback);
`;
}

const THEME_FILE = `[Plymouth Theme]
Name=VATAN
Description=VATAN boot splash: the relief map, a wordmark and a thin progress line
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/vatan
ScriptFile=/usr/share/plymouth/themes/vatan/vatan.script
`;

export function assets(S) {
  const L = LAYOUT, font = readFont(resolve(root, 'data/fonts/Geist-Medium.ttf'));
  const out = {};
  const relief = reliefFromWallpaper();
  const [x0, y0, x1, y1] = relief.box, mw = Math.round(L.mapWidth * S), mh = Math.round(mw * (y1 - y0) / (x1 - x0));
  out.map = tinted(mw, mh, resample(relief.alpha, relief.w, relief.box, mw, mh), INK, L.mapAlpha);

  const word = cropText(setText(font, 'VATAN', L.wordCap * S, .42));
  out.wordmark = tinted(word.w, word.h, word.cov, INK, .92);
  const label = cropText(setText(font, 'Disk parolası', L.labelCap * S, .04));
  out.label = tinted(label.w, label.h, label.cov, MUTED);

  const bw = L.barWidth * S, bh = L.barHeight * S;
  out.track = tinted(bw, bh, new Float32Array(bw * bh).fill(1), INK, .1);
  out.bar = tinted(bw, bh, new Float32Array(bw * bh).fill(1), ACCENT);

  const fw = L.fieldWidth * S, fh = L.fieldHeight * S;
  const outer = shape(fw, fh, pillSdf(fw, fh)), inner = shape(fw, fh, pillSdf(fw, fh, S));
  const field = outer.map((o, i) => inner[i] * .045 + (o - inner[i]) * .22);
  out.field = tinted(fw, fh, field, [255, 255, 255]);

  const d = L.bullet * S;
  out.bullet = tinted(d, d, shape(d, d, (x, y) => Math.hypot(x - d / 2, y - d / 2) - d / 2), INK);

  out.background = background(1920 * S, 1080 * S);
  return out;
}

// Bir metin bitmap'ini mürekkebine kırpar, böylece script onu kenarlarından yerleştirebilir.
function cropText({ w, h, cov }) {
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (cov[y * w + x] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = cov[(y + y0) * w + x + x0];
  return { w: cw, h: ch, cov: out };
}

function main() {
  mkdirSync(outDir, { recursive: true });
  for (const S of [1, 2])
    for (const [name, png] of Object.entries(assets(S)))
      writeFileSync(resolve(outDir, `${name}@${S}.png`), png);
  writeFileSync(resolve(outDir, 'vatan.script'), script());
  writeFileSync(resolve(outDir, 'vatan.plymouth'), THEME_FILE);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
