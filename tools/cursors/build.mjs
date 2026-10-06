// VATAN imleç temasını data/cursors/VATAN içine Xcursor dosyaları olarak yazar.
//
//   node tools/cursors/build.mjs           # üret + doğrula
//   node tools/cursors/build.mjs --check   # yalnız mevcut dosyaları doğrula
//
// Her imleç 32 birimlik bir tasarım alanında işaretli uzaklık alanı (SDF) olarak
// tanımlanır. Kenar yumuşatma, fildişi kontur ve gölge aynı alandan türetilir:
// poligon ofsetlemeye gerek kalmaz, kontur her boyutta aynı kalınlıkta durur.
// Her boyutta tasarım, sıcak nokta tam bir piksel merkezine düşecek şekilde
// piksel altı kaydırılır; sıcak nokta bu yüzden yuvarlama hatası taşımaz.
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/cursors/VATAN');
export const SIZES = [24, 32, 48, 64, 96];

const INK_LIT = [38, 44, 55], INK = [20, 24, 31], IVORY = [243, 239, 230], RED = [230, 45, 66];
const FRAMES = 12, FRAME_MS = 60;

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;

// --- SDF ilkelleri (tasarım birimi) ---------------------------------------

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
const poly = pts => (x, y) => {
  let d = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    d = Math.min(d, segDist(x, y, xj, yj, xi, yi));
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -d : d;
};
const capsule = (ax, ay, bx, by, r) => (x, y) => segDist(x, y, ax, ay, bx, by) - r;
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const ring = (cx, cy, r, w) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2;
const box = (cx, cy, hw, hh, r) => (x, y) => {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
// a0'dan saat yönünde span derecelik yay, yuvarlak uçlu.
const arc = (cx, cy, r, w, a0, span) => {
  const e0 = [cx + r * Math.cos(a0 * Math.PI / 180), cy + r * Math.sin(a0 * Math.PI / 180)];
  const e1 = [cx + r * Math.cos((a0 + span) * Math.PI / 180), cy + r * Math.sin((a0 + span) * Math.PI / 180)];
  return (x, y) => {
    const a = ((Math.atan2(y - cy, x - cx) * 180 / Math.PI - a0) % 360 + 360) % 360;
    if (a <= span) return Math.abs(Math.hypot(x - cx, y - cy) - r) - w / 2;
    return Math.min(Math.hypot(x - e0[0], y - e0[1]), Math.hypot(x - e1[0], y - e1[1])) - w / 2;
  };
};
const union = (...fs) => (x, y) => { let d = Infinity; for (const f of fs) d = Math.min(d, f(x, y)); return d; };
const minus = (f, g) => (x, y) => Math.max(f(x, y), -g(x, y));
const inter = (f, g) => (x, y) => Math.max(f(x, y), g(x, y));
const rotate = (f, deg, cx = 16, cy = 16) => {
  const c = Math.cos(-deg * Math.PI / 180), s = Math.sin(-deg * Math.PI / 180);
  return (x, y) => f(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c);
};
const rotPoint = ([x, y], deg, cx = 16, cy = 16) => {
  const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
};

// --- Biçimler -------------------------------------------------------------

// VATAN oku: sapsız bir temren. Taban köşesinde açılı bir çentik var; Orhun
// OK harfinin uçları gibi. macOS ve Windows oklarının sapı ve kuyruk
// kıvrımı yok, bu yüzden siluet onlardan ayrılır; uç ve sol kenar alışılmış
// yerinde kaldığı için okunurluk bozulmaz.
const DART_TIP = [5, 4];
const dart = poly([DART_TIP, [5, 23.6], [9.7, 17.9], [18.2, 17.9]]);

const head = (tx, ty, dx, dy, len = 5, half = 4.2) => {
  const bx = tx - dx * len, by = ty - dy * len;
  return poly([[tx, ty], [bx - dy * half, by + dx * half], [bx + dy * half, by - dx * half]]);
};
// Çift başlı ok: (ax,ay) → (bx,by).
const double = (ax, ay, bx, by) => {
  const l = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / l, dy = (by - ay) / l;
  return union(capsule(ax + dx * 4, ay + dy * 4, bx - dx * 4, by - dy * 4, 1.15), head(bx, by, dx, dy), head(ax, ay, -dx, -dy));
};

const badge = (cx = 22.6, cy = 23.4) => circle(cx, cy, 5.6);

// Yaprak: { f, fill, outline } — çizim sırası listedeki sıradır.
const ink = f => ({ f, fill: 'ink', outline: true });
const ivory = f => ({ f, fill: 'ivory', outline: false });
const red = f => ({ f, fill: 'red', outline: false });

const spinner = (cx, cy, r, w, frame) => [
  ink(ring(cx, cy, r, w)),
  red(arc(cx, cy, r, w * .55, frame * 30 - 90, 110)),
];

const hand = () => {
  const fingers = union(
    capsule(12.5, 5.6, 12.5, 17, 2.15), capsule(16.8, 12.2, 16.8, 19, 2), capsule(20.8, 13.4, 20.8, 19.5, 1.95),
    capsule(24.4, 15.2, 24.4, 20.5, 1.75), capsule(7.7, 17.4, 11, 22.6, 1.9), box(18.3, 22.4, 7.6, 4.8, 3.6));
  // Parmak araları ince yarıklar: fildişi kontur içlerine dolar ve parmakları ayırır.
  return minus(fingers, union(capsule(14.65, 13.6, 14.65, 18.4, .3), capsule(18.8, 14.8, 18.8, 19.2, .3), capsule(22.6, 16.4, 22.6, 19.8, .3)));
};
const openHand = () => minus(union(
  capsule(11.4, 8.4, 12.6, 17, 1.95), capsule(15.8, 6.4, 16.2, 16, 2), capsule(20.2, 7.4, 19.8, 16.5, 1.95),
  capsule(24.2, 10.6, 23.2, 17.5, 1.75), capsule(6.8, 15.2, 10.6, 21.4, 1.9), box(17.6, 22.2, 7.4, 5.2, 4)),
union(capsule(13.9, 12, 14.2, 17.5, .3), capsule(18, 11.6, 18, 17.5, .3), capsule(21.9, 13, 21.6, 18, .3)));
const fist = () => minus(union(
  circle(11.6, 15, 2.3), circle(15.6, 14, 2.4), circle(19.6, 14.2, 2.4), circle(23.4, 15.4, 2.2),
  box(17.4, 20.6, 7.8, 5.8, 4), capsule(8.6, 19, 13.4, 22.4, 1.9)),
union(capsule(13.6, 13.6, 13.6, 16.6, .3), capsule(17.6, 13, 17.6, 16.2, .3), capsule(21.5, 13.6, 21.5, 16.6, .3)));

const lens = (sign) => [
  ink(union(ring(13.5, 13.5, 7, 2.4), capsule(18.6, 18.6, 25.4, 25.4, 2.1))),
  ivory(circle(13.5, 13.5, 5.8)),
  ink(sign === '+' ? union(capsule(10.4, 13.5, 16.6, 13.5, .9), capsule(13.5, 10.4, 13.5, 16.6, .9)) : capsule(10.4, 13.5, 16.6, 13.5, .9)),
];

const sideResize = deg => {
  const f = union(capsule(9, 6, 23, 6, 1.05), head(16, 9.2, 0, -1, 5, 4.2), capsule(16, 13, 16, 25.5, 1.15));
  return { layers: [ink(rotate(f, deg))], hot: rotPoint([16, 6], deg) };
};
const cornerResize = deg => {
  const d = Math.SQRT1_2;
  const f = union(capsule(7, 7, 16, 7, 1.05), capsule(7, 7, 7, 16, 1.05), head(10.6, 10.6, -d, -d, 5.2, 4), capsule(13.4, 13.4, 24.5, 24.5, 1.15));
  return { layers: [ink(rotate(f, deg))], hot: rotPoint([7, 7], deg) };
};
const twoBars = deg => ({
  layers: [ink(rotate(union(capsule(14.4, 8, 14.4, 24, .95), capsule(17.6, 8, 17.6, 24, .95),
    head(4.5, 16, -1, 0, 4.6, 3.8), capsule(8, 16, 12.6, 16, 1.05),
    head(27.5, 16, 1, 0, 4.6, 3.8), capsule(19.4, 16, 24, 16, 1.05)), deg))],
  hot: [16, 16],
});
const fourWay = () => union(capsule(16, 8, 16, 24, 1.1), capsule(8, 16, 24, 16, 1.1),
  head(16, 3.5, 0, -1), head(16, 28.5, 0, 1), head(3.5, 16, -1, 0), head(28.5, 16, 1, 0));

// İmleçler: tek kare { layers, hot } ya da animasyon için kare dizisi.
const CURSORS = {
  default: { layers: [ink(dart)], hot: DART_TIP },
  pointer: { layers: [ink(hand())], hot: [12.5, 3.45] },
  text: { layers: [ink(union(capsule(16, 7, 16, 25, .95), capsule(13, 6, 19, 6, .95), capsule(13, 26, 19, 26, .95)))], hot: [16, 16] },
  'vertical-text': { layers: [ink(rotate(union(capsule(16, 7, 16, 25, .95), capsule(13, 6, 19, 6, .95), capsule(13, 26, 19, 26, .95)), 90))], hot: [16, 16] },
  wait: { frames: f => [ink(ring(16, 16, 8.5, 3.4)), red(arc(16, 16, 8.5, 1.9, f * 30 - 90, 100))], hot: [16, 16] },
  progress: { frames: f => [ink(dart), ...spinner(21.8, 23, 4.4, 2.6, f)], hot: DART_TIP },
  crosshair: {
    layers: [ink(union(capsule(16, 4.5, 16, 12.5, .9), capsule(16, 19.5, 16, 27.5, .9), capsule(4.5, 16, 12.5, 16, .9), capsule(19.5, 16, 27.5, 16, .9))),
      red(circle(16, 16, 1.2))],
    hot: [16, 16],
  },
  move: { layers: [ink(fourWay())], hot: [16, 16] },
  'all-scroll': { layers: [ink(union(fourWay(), circle(16, 16, 3.2))), ivory(circle(16, 16, 1.4))], hot: [16, 16] },
  grab: { layers: [ink(openHand())], hot: [16, 16] },
  grabbing: { layers: [ink(fist())], hot: [16, 16] },
  'not-allowed': { layers: [ink(ring(16, 16, 9, 3.2)), red(inter(capsule(9.6, 9.6, 22.4, 22.4, 1.6), circle(16, 16, 8.2)))], hot: [16, 16] },
  'no-drop': {
    layers: [ink(dart), ink(badge()), ivory(ring(22.6, 23.4, 3.3, 1.1)), red(inter(capsule(20.2, 21, 25, 25.8, .7), circle(22.6, 23.4, 3.3)))],
    hot: DART_TIP,
  },
  help: {
    layers: [ink(dart), ink(badge()), ivory(union(arc(22.6, 21.6, 1.9, 1.3, 180, 230), capsule(23.3, 23.3, 22.6, 24.2, .65), circle(22.6, 26.1, .8)))],
    hot: DART_TIP,
  },
  'context-menu': {
    layers: [ink(dart), ink(box(23, 23.6, 5, 5.2, 1.4)), ivory(union(capsule(20.6, 21.4, 25.4, 21.4, .55), capsule(20.6, 23.6, 25.4, 23.6, .55), capsule(20.6, 25.8, 25.4, 25.8, .55)))],
    hot: DART_TIP,
  },
  copy: { layers: [ink(dart), ink(badge()), ivory(union(capsule(19.8, 23.4, 25.4, 23.4, .7), capsule(22.6, 20.6, 22.6, 26.2, .7)))], hot: DART_TIP },
  alias: {
    layers: [ink(dart), ink(badge()), ivory(union(arc(22.6, 24.6, 2.7, 1.3, 180, 100), capsule(22, 21.9, 25, 21.9, .65), poly([[26.4, 21.9], [24.3, 19.9], [24.3, 23.9]])))],
    hot: DART_TIP,
  },
  cell: { layers: [ink(union(box(16, 16, 2.6, 9, .8), box(16, 16, 9, 2.6, .8))), red(circle(16, 16, 1.1))], hot: [16, 16] },
  'zoom-in': { layers: lens('+'), hot: [13.5, 13.5] },
  'zoom-out': { layers: lens('-'), hot: [13.5, 13.5] },
  'col-resize': twoBars(0),
  'row-resize': twoBars(90),
  'n-resize': sideResize(0), 'e-resize': sideResize(90), 's-resize': sideResize(180), 'w-resize': sideResize(270),
  'nw-resize': cornerResize(0), 'ne-resize': cornerResize(90), 'se-resize': cornerResize(180), 'sw-resize': cornerResize(270),
  'ew-resize': { layers: [ink(double(3.5, 16, 28.5, 16))], hot: [16, 16] },
  'ns-resize': { layers: [ink(double(16, 3.5, 16, 28.5))], hot: [16, 16] },
  'nwse-resize': { layers: [ink(double(7, 7, 25, 25))], hot: [16, 16] },
  'nesw-resize': { layers: [ink(double(25, 7, 7, 25))], hot: [16, 16] },
};

// Eski X11 adları ve tarayıcıların/Qt'nin sorduğu karma adlar; hepsi göreli
// sembolik bağ. Burada olmayan bir adı Adwaita'dan alır (Inherits).
export const ALIASES = {
  default: ['left_ptr', 'arrow', 'top_left_arrow', 'right_ptr', 'center_ptr', 'dnd-ask'],
  pointer: ['hand', 'hand1', 'hand2', 'pointing_hand', '9d800788f1b08800ae810202380a0822', 'e29285e634086352946a0e7090d73106'],
  text: ['xterm', 'ibeam'],
  'vertical-text': ['vertical_text'],
  wait: ['watch', '0426c94ea35c87780ff01dc239897213'],
  progress: ['left_ptr_watch', 'half-busy', '3ecb610c1bf2410f44200f48c40d3599', '08e8e1c95fe2fc01f976f1e063a24ccd'],
  crosshair: ['cross', 'tcross', 'cross_reverse', 'diamond_cross'],
  move: ['fleur', 'size_all', 'dnd-move', '4498f0e0c1937ffe01fd06f973665830', '9081237383d90e509aa00f00170e968f'],
  grab: ['openhand', '5aca4d189052212118709018842178c0'],
  grabbing: ['closedhand', '208530c400c041818281048008011002'],
  'not-allowed': ['crossed_circle', 'forbidden', 'circle', 'X_cursor', '03b6e0fcb3499374a867c041f52298f0'],
  'no-drop': ['dnd-no-drop', 'dnd-none'],
  help: ['question_arrow', 'whats_this', 'left_ptr_help', '5c6cd98b3f3ebcb1f9c7f1c204630408', 'd9ce0ab605698f320427677b458ad60b'],
  copy: ['dnd-copy', '1081e37283d90000800003c07f3ef6bf', '6407b0e94181790501fd1e167b474872', 'b66166c04f8c3109214a4fbd64a50fc8'],
  alias: ['dnd-link', 'link', '0876e1c15ff2fc01f906f1c363074c0f', '3085a0e285430894940527032f8b26df', '640fb0e74195791501fd1ed57b41487f', 'a2a266d0498c3104214a47bd64ab0fc8'],
  cell: ['plus'],
  'zoom-in': ['zoom_in'],
  'zoom-out': ['zoom_out'],
  'col-resize': ['split_h', '14fef782d02440884392942c11205230'],
  'row-resize': ['split_v', '2870a09082c103050810ffdffffe0204'],
  'n-resize': ['top_side'], 's-resize': ['bottom_side'], 'e-resize': ['right_side'], 'w-resize': ['left_side'],
  'ne-resize': ['top_right_corner'], 'nw-resize': ['top_left_corner'], 'se-resize': ['bottom_right_corner'], 'sw-resize': ['bottom_left_corner'],
  'ew-resize': ['h_double_arrow', 'size_hor', 'sb_h_double_arrow', '028006030e0e7ebffc7f7070c0600140'],
  'ns-resize': ['v_double_arrow', 'size_ver', 'sb_v_double_arrow', '00008160000006810000408080010102'],
  'nesw-resize': ['fd_double_arrow', 'size_bdiag', 'fcf1c3c7cd4491d801f1e1c78f100000'],
  'nwse-resize': ['bd_double_arrow', 'size_fdiag', 'c7088f0f3e6c8088236ef8e1e3e70000'],
};

// --- Rasterleştirme ---------------------------------------------------------

// Işık sol üstten: gölge sağ alta, gövde sol üstte hafifçe açık.
const SHADOW = { dx: .7, dy: 1.2, blur: 1.5, alpha: .32 };

// Bir karenin size×size premultiplied ARGB pikselleri (0..1 float, [a, r, g, b]).
export function renderFrame(layers, hot, size) {
  const s = size / 32, hotPx = [Math.floor(hot[0] * s), Math.floor(hot[1] * s)];
  const tx = hotPx[0] + .5 - hot[0] * s, ty = hotPx[1] + .5 - hot[1] * s;
  // Kontur en az bir piksel: 24 px'te daha incesi koyu duvar kâğıdında kaybolur.
  const outline = Math.max(1, 1.15 * s) / s;
  const outlined = union(...layers.filter(l => l.outline).map(l => l.f));
  const px = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + .5 - tx) / s, dy = (y + .5 - ty) / s;
    let a = 0, r = 0, g = 0, b = 0;
    const over = (col, cov) => {
      if (cov <= 0) return;
      r = col[0] / 255 * cov + r * (1 - cov); g = col[1] / 255 * cov + g * (1 - cov); b = col[2] / 255 * cov + b * (1 - cov);
      a = cov + a * (1 - cov);
    };
    const sh = outlined(dx - SHADOW.dx, dy - SHADOW.dy) - outline;
    over([0, 0, 0], SHADOW.alpha * Math.pow(clamp((SHADOW.blur - sh) / (2 * SHADOW.blur), 0, 1), 1.6));
    for (const l of layers) {
      const d = l.f(dx, dy) * s;
      if (l.outline) over(IVORY, clamp(.5 - (d - outline * s), 0, 1));
      const col = l.fill === 'ink' ? INK.map((c, i) => lerp(INK_LIT[i], c, clamp((dx + dy) / 40, 0, 1))) : l.fill === 'ivory' ? IVORY : RED;
      over(col, clamp(.5 - d, 0, 1));
    }
    px.set([a, r, g, b], (y * size + x) * 4);
  }
  return { px, xhot: hotPx[0], yhot: hotPx[1] };
}

export function cursorFrames(name) {
  const c = CURSORS[name];
  return c.frames ? Array.from({ length: FRAMES }, (_, f) => c.frames(f)) : [c.layers];
}
export const CURSOR_NAMES = Object.keys(CURSORS);
export const hotOf = name => CURSORS[name].hot;

// --- Xcursor ------------------------------------------------------------------

const XCUR_IMAGE = 0xfffd0002;

function encodeXcursor(name) {
  const images = [];
  for (const size of SIZES)
    for (const layers of cursorFrames(name)) {
      const { px, xhot, yhot } = renderFrame(layers, hotOf(name), size);
      images.push({ size, xhot, yhot, delay: CURSORS[name].frames ? FRAME_MS : 0, px });
    }
  const head = 16 + images.length * 12, chunks = [];
  let pos = head;
  const toc = Buffer.alloc(head);
  toc.write('Xcur', 0, 'ascii'); toc.writeUInt32LE(16, 4); toc.writeUInt32LE(0x10000, 8); toc.writeUInt32LE(images.length, 12);
  images.forEach((im, i) => {
    const chunk = Buffer.alloc(36 + im.size * im.size * 4);
    [36, XCUR_IMAGE, im.size, 1, im.size, im.size, im.xhot, im.yhot, im.delay].forEach((v, k) => chunk.writeUInt32LE(v, k * 4));
    for (let p = 0; p < im.size * im.size; p++) {
      const [a, r, g, b] = im.px.subarray(p * 4, p * 4 + 4);
      // Xcursor pikseli: ön çarpılmış ARGB, küçük uçlu CARD32 → bellekte B, G, R, A.
      chunk.writeUInt32LE(((Math.round(a * 255) << 24) | (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)) >>> 0, 36 + p * 4);
    }
    toc.writeUInt32LE(XCUR_IMAGE, 16 + i * 12); toc.writeUInt32LE(im.size, 20 + i * 12); toc.writeUInt32LE(pos, 24 + i * 12);
    pos += chunk.length;
    chunks.push(chunk);
  });
  return Buffer.concat([toc, ...chunks]);
}

// Dosyayı baştan okur: başlık, TOC, her parçanın türü/boyutu/sıcak noktası
// ve piksel ön çarpımı (renk kanalı alfayı aşamaz).
export function readXcursor(buf) {
  if (buf.toString('ascii', 0, 4) !== 'Xcur') throw new Error('magic yok');
  const headerLen = buf.readUInt32LE(4), n = buf.readUInt32LE(12), images = [];
  if (headerLen !== 16) throw new Error('başlık 16 bayt değil');
  for (let i = 0; i < n; i++) {
    const type = buf.readUInt32LE(16 + i * 12), sub = buf.readUInt32LE(20 + i * 12), at = buf.readUInt32LE(24 + i * 12);
    const f = k => buf.readUInt32LE(at + k * 4);
    if (type !== XCUR_IMAGE || f(1) !== XCUR_IMAGE || f(0) !== 36 || f(2) !== sub) throw new Error(`TOC ${i} parçayla uyuşmuyor`);
    const w = f(4), h = f(5), xhot = f(6), yhot = f(7), delay = f(8);
    if (w !== sub || h !== sub || xhot >= w || yhot >= h) throw new Error(`parça ${i}: boyut/sıcak nokta geçersiz`);
    if (at + 36 + w * h * 4 > buf.length) throw new Error(`parça ${i} dosya sonunu aşıyor`);
    for (let p = 0; p < w * h; p++) {
      const v = buf.readUInt32LE(at + 36 + p * 4), a = v >>> 24;
      if (((v >>> 16) & 255) > a || ((v >>> 8) & 255) > a || (v & 255) > a) throw new Error(`parça ${i}: ön çarpılmamış piksel`);
    }
    images.push({ size: sub, xhot, yhot, delay });
  }
  return images;
}

function check() {
  const dir = join(outDir, 'cursors');
  for (const name of CURSOR_NAMES) {
    const images = readXcursor(readFileSync(join(dir, name)));
    const frames = cursorFrames(name).length;
    for (const size of SIZES) {
      const at = images.filter(i => i.size === size);
      if (at.length !== frames) throw new Error(`${name}: ${size} px için ${at.length} kare, beklenen ${frames}`);
      if (frames > 1 && at.some(i => i.delay !== FRAME_MS)) throw new Error(`${name}: kare gecikmesi ${FRAME_MS} ms değil`);
    }
  }
  for (const [target, names] of Object.entries(ALIASES))
    for (const n of names) readXcursor(readFileSync(join(dir, n)));
  console.log(`${CURSOR_NAMES.length} imleç, ${Object.values(ALIASES).flat().length} bağ doğrulandı`);
}

function main() {
  const dir = join(outDir, 'cursors');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(outDir, 'index.theme'), '[Icon Theme]\nName=VATAN\nComment=VATAN cursors\nComment[tr]=VATAN imleçleri\nInherits=Adwaita\n');
  for (const n of readdirSync(dir)) rmSync(join(dir, n));
  for (const name of CURSOR_NAMES) writeFileSync(join(dir, name), encodeXcursor(name));
  for (const [target, names] of Object.entries(ALIASES))
    for (const n of names) symlinkSync(target, join(dir, n));
  check();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) check();
  else main();
}
