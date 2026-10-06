// VATAN duvar kâğıdı ailesi: her sahne bir yükseklik alanı, bir kıyı (varsa) ve
// iki tema verir; kabartma, ışık ve dither relief.mjs'ten gelir.
//
// Her sahnede alt %12 sakin tutulur (ada rıhtımı oraya oturur): denizli
// sahnelerde orası deniz, karalarda kabartma alt banda doğru düz bir taban
// seviyesine yumuşakça iner.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { W, H, LIGHT, clamp, smooth, lerp, vnoise, elevation, lcg, grid, segDist, signedDistance } from './relief.mjs';

const COASTS = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'coasts.json'), 'utf8'));
const BOXES = {
  ege: { w: 21.6, e: 31.6, s: 35.5, n: 41.0 },
  karadeniz: { w: 36.5, e: 43.3, s: 39.0, n: 42.9 },
};

const SOLID_LAND = 1000;

// y'nin alt banttaki ağırlığı: 0 yukarıda, 1 rıhtımın altında.
const quiet = (y, from = .76, to = .9) => smooth(clamp((y / H - from) / (to - from), 0, 1));

function view({ lon0, lat0, degLat, cy = .5 }) {
  const s = H / degLat, k = Math.cos(lat0 * Math.PI / 180);
  return { s, project: (lon, lat) => [W * .5 + (lon - lon0) * k * s, H * cy - (lat - lat0) * s] };
}

// Kıyı halkaları pikselde; kırpma kutusunun kenarında koşan parçalar yapaydır,
// uzaklığa katılmaz.
function coastline(name, project) {
  const box = BOXES[name], rings = [], coast = [];
  const onEdge = (a, b) => (a[0] === b[0] && (a[0] === box.w || a[0] === box.e)) || (a[1] === b[1] && (a[1] === box.s || a[1] === box.n));
  for (const flat of COASTS[name]) {
    const ll = [];
    for (let i = 0; i < flat.length; i += 2) ll.push([flat[i], flat[i + 1]]);
    const px = ll.map(p => project(...p));
    rings.push(px);
    for (let i = 0; i < ll.length; i++) {
      const j = (i + 1) % ll.length;
      if (!onEdge(ll[i], ll[j])) coast.push([px[i], px[j]]);
    }
  }
  return { rings, coast };
}

function eachCell(g, fn) {
  const out = new Float32Array(g.cols * g.rows);
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) out[j * g.cols + i] = fn(i * g.cell, j * g.cell, j * g.cols + i);
  return out;
}

// Kutu bulanıklığı, üç geçiş (~Gauss). Kıyı uzaklığından yükselti türeten
// sahneler bunu kullanır: ham uzaklığın orta ekseninde (koy ve burunlarda en
// yakın kıyı parçasının değiştiği yer) türevi kırık bir sırt vardır ve teraslar
// orada keskin dikey kıvrımlar çizer.
function blurred(g, src, radius) {
  let a = Float32Array.from(src), b = new Float32Array(a.length);
  const { cols, rows } = g;
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - radius); k <= Math.min(cols - 1, i + radius); k++) { sum += a[j * cols + k]; n++; }
      b[j * cols + i] = sum / n;
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let sum = 0, n = 0;
      for (let k = Math.max(0, j - radius); k <= Math.min(rows - 1, j + radius); k++) { sum += b[k * cols + i]; n++; }
      a[j * cols + i] = sum / n;
    }
  }
  return a;
}

const theme = (file, t) => ({ file, terraceShadow: .2, dropShadow: .28, shade: .08, rim: .8, seaLine: .06, ...t });

const ege = {
  name: 'ege',
  themes: {
    light: theme('ege-light.png', {
      seaCenter: [221, 232, 240], seaEdge: [190, 207, 222], landLow: [229, 232, 233], landHigh: [255, 255, 255],
      ink: [16, 30, 46], seaLine: .1,
    }),
    dark: theme('ege-dark.png', {
      seaCenter: [14, 30, 46], seaEdge: [5, 11, 18], landLow: [28, 38, 48], landHigh: [84, 102, 120],
      ink: [0, 0, 0], terraceShadow: .55, dropShadow: .75, shade: .14, rim: .16, seaLine: .07,
    }),
  },
  build() {
    const g = grid(8), { s, project } = view({ lon0: 27.3, lat0: 38.2, degLat: 3.4 });
    const { rings, coast } = coastline('ege', project);
    const sdf = signedDistance(g, rings, coast, 700);
    const ns = 1 / (s * 1.3);
    const field = eachCell(g, (x, y, k) => {
      const d = sdf[k];
      if (d <= 0) return .2 - .1 * Math.min(-d / 420, 1);
      const relief = .12 + .22 * clamp(x / W, 0, 1) + (elevation(x * ns + 3.3, y * ns + 1.7, .6) - .5) * .9;
      return .2 + Math.min(d / 380, 1) * Math.max(relief, .012);
    });
    return { g, field, sdf, coast: .2, levelStep: .04, topLevel: .84 };
  },
};

const karadeniz = {
  name: 'karadeniz',
  themes: {
    light: theme('karadeniz-light.png', {
      seaCenter: [204, 217, 221], seaEdge: [176, 192, 199], landLow: [203, 221, 208], landHigh: [240, 247, 241],
      ink: [14, 32, 22], terraceShadow: .3, dropShadow: .38, seaLine: .1,
    }),
    dark: theme('karadeniz-dark.png', {
      seaCenter: [12, 20, 23], seaEdge: [4, 7, 9], landLow: [20, 40, 31], landHigh: [72, 120, 94],
      ink: [0, 0, 0], terraceShadow: .55, dropShadow: .75, shade: .12, rim: .18, seaLine: .05,
    }),
  },
  build() {
    const g = grid(8), { project } = view({ lon0: 39.9, lat0: 40.72, degLat: 2.0 });
    const { rings, coast } = coastline('karadeniz', project);
    const sdf = signedDistance(g, rings, coast, 1400);
    // Yükselti kıyıya olan ham uzaklıktan değil, bulanıklaştırılmış hâlinden
    // gelir: ham hâli terasları kıyının ofset kopyaları yapıyordu; yoğun, paralel
    // çizgiler küçükte gri bir şerit oluyor, orta eksende dikey kıvrımlar çıkıyordu.
    const reach = blurred(g, sdf, 12);
    const [kx, ky] = project(41.15, 40.83); // Kaçkar
    const ridged = (x, y, z) => 1 - Math.abs(2 * vnoise(x, y, z) - 1);
    const field = eachCell(g, (x, y, k) => {
      const d = sdf[k];
      if (d <= 0) return .2 - .1 * Math.min(-d / 520, 1);
      // Doğu-batı uzanan sırtlar: Pontuslar kıyıya paralel dizilir. Sırtların
      // biçimini gürültü verir, kıyı yalnız onları 450 px içinde yükseltir.
      const m = .6 * ridged(x / 1000 + 2.1, y / 340 + 4.3, 2.3) + .25 * ridged(x / 460 + 7.7, y / 170 + 1.9, 4.1) + .15 * vnoise(x / 200, y / 200, 6.6);
      const kackar = .16 * Math.exp(-((x - kx) ** 2 + (y - ky) ** 2) / (2 * 300 ** 2));
      // Bulanık uzaklık kıyıdan ~150 px içeri negatiftir; o şerit deniz
      // seviyesinde düz kalırsa seviye indeksi bilinear gürültüyle 8 px'lik
      // basamaklar çizer. Kıyıda her zaman küçük bir eğim kalır (vatan'daki gibi).
      const rise = smooth(clamp((reach[k] + 150) / 600, 0, 1));
      const v = .2 + Math.min(d / 120, 1) * Math.max(.02, rise * (.06 + .46 * m + kackar));
      return lerp(v, .46, quiet(y));
    });
    return { g, field, sdf, coast: .2, levelStep: .04, topLevel: .84 };
  },
};

const bozkir = {
  name: 'bozkir',
  themes: {
    light: theme('bozkir-light.png', {
      seaCenter: [0, 0, 0], seaEdge: [0, 0, 0], landLow: [231, 222, 202], landHigh: [251, 247, 237],
      ink: [58, 44, 22], terraceShadow: .3, shade: .1, landVignette: .12,
    }),
    dark: theme('bozkir-dark.png', {
      seaCenter: [0, 0, 0], seaEdge: [0, 0, 0], landLow: [34, 30, 23], landHigh: [116, 102, 76],
      ink: [0, 0, 0], terraceShadow: .55, shade: .14, rim: .16, landVignette: .35,
    }),
  },
  build() {
    const g = grid(8);
    // Geniş, yatık tepeler: x ölçeği y'den büyük, bozkır ufka doğru uzanır.
    const field = eachCell(g, (x, y) => {
      const broad = elevation(x / 1700 + 11.3, y / 1050 + 4.2, .71), roll = vnoise(x / 560 + 2.2, y / 360 + 9.1, 1.7);
      const v = .06 + .3 * clamp((broad - .2) / .55, 0, 1) + .07 * roll;
      return .2 + lerp(v, .2, quiet(y, .7, .92));
    });
    return { g, field, sdf: new Float32Array(g.cols * g.rows).fill(SOLID_LAND), coast: .2, levelStep: .022, topLevel: .62 };
  },
};

// Kapadokya: köşegen boyunca akan tek bir kanyon konunun kendisidir. Yayla
// sakin, kanyon duvarları eşit basamaklarla iner, tabanda birkaç uzun, sivri
// peribacası durur; her birinin şapka taşı keskin bir basamaktır ve ışığın
// tersine uzun bir gölge düşürür. Serpiştirilmiş çok sayıda alçak koni küçük
// boyutta gürültü gibi okunuyordu.
const CANYON = { floor: 120, wall: 330 };
const canyonAt = t => [lerp(-.06 * W, 1.06 * W, t), lerp(.1 * H, .66 * H, t) + 90 * Math.sin(t * 7.3) + 40 * Math.sin(t * 17.9)];
const CHIMNEYS = [[.13, -.4], [.19, .3], [.31, -.1], [.37, .5], [.47, -.45], [.55, .15], [.68, -.3], [.74, .4], [.86, 0]];

const kapadokya = {
  name: 'kapadokya',
  themes: {
    light: theme('kapadokya-light.png', {
      seaCenter: [0, 0, 0], seaEdge: [0, 0, 0], landLow: [222, 196, 172], landHigh: [250, 241, 229],
      ink: [72, 38, 20], terraceShadow: .32, shade: .04, rim: .85, riser: .3, landVignette: .1, dither: 0, castShadow: .22, cap: .3,
    }),
    dark: theme('kapadokya-dark.png', {
      seaCenter: [0, 0, 0], seaEdge: [0, 0, 0], landLow: [48, 31, 24], landHigh: [138, 96, 72],
      ink: [0, 0, 0], terraceShadow: .55, shade: .06, rim: .22, riser: .45, landVignette: .35, dither: .4, castShadow: .38, cap: .45,
    }),
  },
  cones: [],
  build() {
    const g = grid(4), rnd = lcg(1071), path = [];
    for (let i = 0; i <= 240; i++) path.push(canyonAt(i / 240));
    const normal = t => { const [ax, ay] = canyonAt(t - .002), [bx, by] = canyonAt(t + .002), l = Math.hypot(bx - ax, by - ay); return [-(by - ay) / l, (bx - ax) / l]; };
    this.cones = CHIMNEYS.map(([t, side]) => {
      const [cx, cy] = canyonAt(t), [nx, ny] = normal(t), off = side * CANYON.floor * .8;
      return { x: cx + nx * off, y: cy + ny * off, r: 62 + 22 * rnd(), h: .3 + .08 * rnd() };
    });
    const FLOOR = .03, PLATEAU = .4;
    const field = eachCell(g, (x, y) => {
      let dc = Infinity;
      for (let i = 1; i < path.length; i++) {
        const [ax, ay] = path[i - 1];
        if (Math.abs(ax - x) > 900) continue;
        dc = Math.min(dc, segDist(x, y, path[i - 1], path[i]));
      }
      // Duvar kenarı gürültüyle oynar ki kanyon cetvelle çizilmiş durmasın.
      const e = dc + 70 * (vnoise(x / 260, y / 260, 3.1) - .5) * 2;
      let v = lerp(FLOOR, PLATEAU, clamp((e - CANYON.floor) / CANYON.wall, 0, 1)) + .012 * vnoise(x / 500, y / 500, 7.4);
      for (const c of this.cones) {
        const dd = Math.hypot(x - c.x, y - c.y);
        if (dd >= c.r) continue;
        // Dik konik gövde, tepede bir basamak yüksek, keskin kenarlı şapka taşı.
        const body = c.h * Math.min((1 - dd / c.r) * 1.25, 1);
        v = Math.max(v, FLOOR + (dd < c.r * .2 ? c.h + .035 : body));
      }
      return .2 + lerp(v, PLATEAU, quiet(y));
    });
    return { g, field, sdf: new Float32Array(g.cols * g.rows).fill(SOLID_LAND), coast: .2, levelStep: .03, topLevel: .62 };
  },
  // Peribacalarının uzun gölgeleri: ışığın tersine (sağ alta) uzanan, ucuna
  // doğru sivrilen yumuşak kenarlı bir üçgen. Kabartmanın kendi teras gölgesi
  // 26 px'te biter; uzun bir koninin gölgesi kanyon tabanına yayılmalı. Tepedeki
  // bazalt şapka koyu boyanır: peribacasını tüf koniden ayıran işaret odur.
  overlay(t) {
    const dir = [-LIGHT[0], -LIGHT[1]], dl = Math.hypot(...dir), ux = dir[0] / dl, uy = dir[1] / dl;
    const shapes = this.cones.map(c => ({ ...c, len: 900 * c.h }));
    return (x, y, col, mix) => {
      let a = 0;
      for (const c of shapes) {
        const px = x - c.x, py = y - c.y, along = px * ux + py * uy;
        if (along < 0 || along > c.len + 30) continue;
        const across = Math.abs(px * uy - py * ux), half = lerp(c.r * .9, 0, along / c.len);
        const dd = Math.hypot(px, py);
        a = Math.max(a, clamp((half - across) / 10 + .5, 0, 1) * clamp((c.len - along) / 60, 0, 1) * clamp((dd - c.r * .85) / 10, 0, 1));
      }
      if (a) col = mix(col, t.ink, a * t.castShadow);
      for (const c of shapes) {
        const cap = clamp(c.r * .2 + .5 - Math.hypot(x - c.x, y - c.y), 0, 1);
        if (cap) col = mix(col, t.ink, cap * t.cap);
      }
      return col;
    };
  },
};

// Selçuklu yıldızları: iki kaydırılmış kafeste (kare ve onun merkezleri)
// sekiz köşeli yıldızlar (iki kare). Her yıldızın kenarı taşa oyulmuş yuvarlak
// bir silme, içi basamaklı bir pano, ortasında 22,5° döndürülmüş küçük bir
// göbek yıldızı. Yıldızlar araları kesintisiz bir zemin kalacak kadar küçüktür:
// birbirine değen ya da yaklaşan yıldızlar arasında haç / X biçimli boşluklar
// kalıyor, bunlar dini bir işaret gibi okunuyordu.
const sdBox = (u, v, a) => {
  const qx = Math.abs(u) - a, qy = Math.abs(v) - a;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
};
const SQ = Math.SQRT1_2;
const sdStar = (u, v, R) => Math.min(sdBox(u, v, R * SQ), sdBox((u + v) * SQ, (v - u) * SQ, R * SQ));

const selcuklu = {
  name: 'selcuklu',
  themes: {
    light: theme('selcuklu-light.png', {
      seaCenter: [0, 0, 0], seaEdge: [0, 0, 0], landLow: [218, 210, 196], landHigh: [249, 246, 239],
      ink: [50, 38, 26], terraceShadow: .34, shade: .1, landVignette: .14, dither: 0,
    }),
    dark: theme('selcuklu-dark.png', {
      seaCenter: [0, 0, 0], seaEdge: [0, 0, 0], landLow: [28, 30, 34], landHigh: [96, 98, 106],
      ink: [0, 0, 0], terraceShadow: .6, shade: .14, rim: .2, landVignette: .4, dither: .4,
    }),
  },
  build() {
    const g = grid(2), P = 640, R = P * .25, ox = W / 2, oy = H * .42, BAND = 11;
    const molding = (sd, w) => Math.sqrt(Math.max(0, 1 - (sd / w) ** 2));
    const c = Math.cos(Math.PI / 8), s = Math.sin(Math.PI / 8);
    const field = eachCell(g, (x, y) => {
      let v = 0;
      for (const shift of [0, .5]) {
        const i = Math.round((x - ox) / P - shift), j = Math.round((y - oy) / P - shift);
        const u = x - ox - (i + shift) * P, w = y - oy - (j + shift) * P, sd = sdStar(u, w, R);
        // Rıhtım bandına girecek yıldız hiç çizilmez; soldurmak kırık parçalar bırakıyordu.
        if (sd > BAND || y - w + R > H * .86) continue;
        const inner = sdStar(u * c + w * s, w * c - u * s, R * .42);
        v = Math.max(v, sd < 0 ? .045 : 0, inner < 0 ? .08 : 0, .12 * molding(sd, BAND), .1 * molding(inner, BAND * .8));
      }
      return .2 + .03 + v;
    });
    return { g, field, sdf: new Float32Array(g.cols * g.rows).fill(SOLID_LAND), coast: .2, levelStep: .025, topLevel: .35 };
  },
};

// Gece: VATAN kabartmasının kendisi, gece renginde, gerçek koordinatlarında
// şehir ışıklarıyla. Kırmızı yalnız Ankara'dır; diğerleri sıcak beyaz, boyları
// nüfusla (2023 TÜİK il nüfusu, milyon) logaritmik büyür.
const CITIES = [
  ['İstanbul', 41.015, 28.979, 15.6], ['İzmir', 38.419, 27.129, 4.5], ['Bursa', 40.183, 29.067, 3.2],
  ['Antalya', 36.897, 30.713, 2.7], ['Konya', 37.871, 32.485, 2.3], ['Adana', 37.0, 35.321, 2.3],
  ['Şanlıurfa', 37.159, 38.797, 2.2], ['Gaziantep', 37.066, 37.383, 2.2], ['Kocaeli', 40.765, 29.941, 2.1],
  ['Mersin', 36.812, 34.641, 1.9], ['Diyarbakır', 37.914, 40.231, 1.8], ['Hatay', 36.202, 36.16, 1.7],
  ['Manisa', 38.614, 27.429, 1.5], ['Kayseri', 38.734, 35.467, 1.4], ['Samsun', 41.286, 36.33, 1.4],
  ['Balıkesir', 39.649, 27.886, 1.3], ['Kahramanmaraş', 37.585, 36.937, 1.2], ['Van', 38.494, 43.38, 1.1],
  ['Aydın', 37.845, 27.846, 1.1], ['Tekirdağ', 40.978, 27.511, 1.1], ['Sakarya', 40.774, 30.398, 1.1],
  ['Denizli', 37.774, 29.087, 1.1], ['Muğla', 37.215, 28.364, 1.0], ['Eskişehir', 39.777, 30.52, .9],
  ['Mardin', 37.312, 40.735, .9], ['Malatya', 38.355, 38.309, .8], ['Trabzon', 41.002, 39.717, .8],
  ['Erzurum', 39.904, 41.268, .75],
];
const ANKARA = [32.86, 39.93, 5.8];

function gece(turkey) {
  let lights;
  // Işık katmanı bir kez hesaplanır: her piksel için yalnız yakın şehirlere bakılır.
  const layer = () => lights ??= (() => {
    const warm = new Float32Array(W * H), red = new Float32Array(W * H);
    const stamp = (target, lon, lat, pop, haloK) => {
      const [cx, cy] = turkey.project(lon, lat), rad = 2.4 + 1.9 * Math.log2(pop / .75), reach = Math.ceil(rad * 3.2);
      for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(H - 1, cy + reach); y++)
        for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(W - 1, cx + reach); x++) {
          const r = Math.hypot(x - cx, y - cy);
          const a = Math.max(clamp(rad + .5 - r, 0, 1), Math.exp(-((r / (rad * 1.6)) ** 2)) * haloK);
          target[y * W + x] = Math.max(target[y * W + x], a);
        }
    };
    for (const [, lat, lon, pop] of CITIES) stamp(warm, lon, lat, pop, .32);
    stamp(red, ANKARA[0], ANKARA[1], ANKARA[2], .22);
    return { warm, red };
  })();
  return {
    name: 'gece',
    themes: {
      light: theme('gece-light.png', {
        seaCenter: [92, 104, 128], seaEdge: [60, 68, 88], landLow: [100, 112, 136], landHigh: [172, 182, 202],
        ink: [14, 18, 30], terraceShadow: .3, dropShadow: .5, shade: .1, rim: .3, seaLine: .06,
        lightColor: [255, 222, 168], accent: [230, 45, 66],
      }),
      dark: theme('gece-dark.png', {
        seaCenter: [10, 14, 24], seaEdge: [3, 4, 8], landLow: [17, 21, 31], landHigh: [50, 58, 76],
        ink: [0, 0, 0], terraceShadow: .5, dropShadow: .8, shade: .12, rim: .1, seaLine: .04,
        lightColor: [255, 226, 176], accent: [239, 64, 86],
      }),
    },
    build: () => ({ g: turkey.g, ...turkey.build(), ...turkey.levels }),
    overlay: t => {
      const { warm, red } = layer();
      return (x, y, c, mix) => {
        const i = y * W + x;
        if (warm[i]) c = mix(c, t.lightColor, warm[i]);
        if (red[i]) c = mix(c, t.accent, red[i]);
        return c;
      };
    },
  };
}

export const familyScenes = turkey => [ege, kapadokya, bozkir, karadeniz, selcuklu, gece(turkey)];
