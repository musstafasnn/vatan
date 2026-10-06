// VATAN duvar kâğıtlarını data/backgrounds içine yazar: özgün VATAN kabartması
// ve aynı zanaatla çizilen aile (scenes.mjs). Her sahnenin açık ve koyu sürümü
// vardır; 3840x2160, belirlenimci.
//
//   node tools/wallpaper/generate.mjs              # hepsi
//   node tools/wallpaper/generate.mjs ege dark     # yalnız Ege'nin koyusu
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { W, H, clamp, elevation, grid, segDist, render } from './relief.mjs';
import { familyScenes } from './scenes.mjs';

const CELL = 8;

// Natural Earth 1:50m, kamu malı; düz [lon, lat, ...] halkaları.
const TURKEY = [[25.97,40.14,25.74,40.11,25.67,40.14,25.74,40.20,25.92,40.24,25.98,40.18],[41.51,41.52,41.82,41.43,41.93,41.50,42.21,41.49,42.47,41.44,42.51,41.47,42.57,41.56,42.61,41.58,42.68,41.59,42.79,41.56,42.82,41.49,42.91,41.47,43.17,41.29,43.14,41.26,43.21,41.20,43.36,41.19,43.43,41.16,43.46,41.06,43.63,40.93,43.72,40.72,43.71,40.65,43.67,40.57,43.57,40.48,43.62,40.39,43.61,40.36,43.71,40.17,43.67,40.13,43.94,40.02,44.01,40.01,44.29,40.04,44.40,40.00,44.73,39.75,44.82,39.65,44.78,39.65,44.59,39.77,44.52,39.73,44.46,39.67,44.39,39.42,44.34,39.40,44.12,39.41,44.02,39.38,44.08,39.22,44.18,39.14,44.17,39.06,44.14,38.99,44.17,38.93,44.27,38.84,44.26,38.70,44.30,38.56,44.30,38.39,44.43,38.36,44.45,38.33,44.38,38.25,44.35,38.15,44.27,38.04,44.21,37.91,44.22,37.88,44.34,37.87,44.56,37.74,44.59,37.71,44.55,37.66,44.58,37.56,44.57,37.44,44.72,37.36,44.79,37.29,44.76,37.22,44.77,37.14,44.73,37.17,44.61,37.18,44.28,36.98,44.25,36.98,44.20,37.05,44.21,37.20,44.19,37.25,44.11,37.30,44.01,37.31,43.84,37.22,43.68,37.23,43.52,37.24,43.09,37.37,42.94,37.32,42.77,37.37,42.74,37.36,42.64,37.25,42.46,37.13,42.36,37.11,42.31,37.23,42.27,37.28,42.20,37.30,42.06,37.21,41.89,37.16,41.52,37.09,41.26,37.07,40.96,37.11,40.71,37.10,40.02,36.83,39.69,36.74,39.36,36.68,38.77,36.69,38.69,36.72,38.44,36.86,38.19,36.90,37.44,36.64,37.07,36.65,36.99,36.70,36.94,36.76,36.66,36.80,36.63,36.78,36.60,36.70,36.54,36.46,36.64,36.26,36.64,36.23,36.48,36.22,36.38,36.17,36.35,36.00,36.25,35.97,36.20,35.94,36.15,35.83,36.13,35.83,35.97,35.91,35.89,35.92,35.96,36.00,35.81,36.31,35.88,36.41,36.19,36.66,36.18,36.81,36.05,36.91,35.90,36.85,35.80,36.78,35.66,36.72,35.63,36.65,35.54,36.60,35.39,36.58,35.18,36.63,34.94,36.73,34.81,36.80,34.70,36.82,34.60,36.78,34.30,36.60,33.95,36.30,33.69,36.18,33.52,36.14,33.44,36.15,32.93,36.10,32.79,36.04,32.53,36.10,32.38,36.18,32.13,36.45,32.02,36.54,31.78,36.61,31.35,36.80,30.64,36.87,30.58,36.80,30.56,36.53,30.51,36.45,30.48,36.31,30.45,36.27,30.39,36.24,30.23,36.31,30.08,36.25,29.69,36.16,29.35,36.26,29.22,36.32,29.14,36.40,29.12,36.52,29.07,36.59,29.04,36.69,28.97,36.72,28.90,36.67,28.82,36.68,28.48,36.80,28.30,36.81,28.20,36.69,28.11,36.65,28.02,36.63,28.01,36.67,28.08,36.75,27.80,36.74,27.66,36.67,27.45,36.71,27.47,36.75,27.63,36.79,27.93,36.81,28.01,36.83,28.08,36.92,28.22,37.00,28.24,37.03,27.67,37.01,27.35,37.02,27.31,36.98,27.26,36.98,27.25,37.08,27.30,37.13,27.37,37.12,27.54,37.16,27.52,37.25,27.40,37.31,27.38,37.34,27.29,37.35,27.22,37.39,27.20,37.49,27.15,37.60,27.07,37.66,27.08,37.69,27.22,37.73,27.25,37.88,27.23,37.98,27.16,37.99,26.94,38.06,26.88,38.05,26.81,38.14,26.68,38.20,26.58,38.15,26.33,38.24,26.29,38.28,26.34,38.37,26.42,38.37,26.43,38.44,26.37,38.56,26.38,38.62,26.44,38.64,26.51,38.63,26.59,38.56,26.61,38.49,26.60,38.42,26.64,38.35,26.67,38.34,26.70,38.41,26.73,38.42,26.77,38.39,26.86,38.37,27.10,38.42,27.14,38.45,26.97,38.45,26.91,38.48,26.84,38.56,26.76,38.71,26.79,38.74,26.91,38.78,27.01,38.89,26.92,38.93,26.87,38.92,26.81,38.96,26.81,39.01,26.85,39.06,26.85,39.12,26.68,39.29,26.71,39.34,26.91,39.52,26.90,39.55,26.83,39.56,26.48,39.52,26.35,39.48,26.11,39.47,26.10,39.52,26.10,39.57,26.15,39.66,26.15,39.87,26.18,39.99,26.31,40.02,26.48,40.20,26.74,40.40,27.01,40.40,27.12,40.45,27.28,40.46,27.33,40.38,27.48,40.32,27.73,40.33,27.85,40.38,27.73,40.48,27.77,40.51,27.87,40.51,27.99,40.49,27.99,40.47,27.93,40.38,27.96,40.37,28.29,40.40,28.63,40.38,29.01,40.39,29.06,40.42,28.79,40.53,28.96,40.63,29.84,40.74,29.85,40.76,29.36,40.81,29.26,40.85,29.11,40.94,29.05,41.01,29.09,41.18,29.15,41.22,29.32,41.23,29.92,41.15,30.34,41.20,30.81,41.08,31.25,41.11,31.35,41.16,31.46,41.32,32.09,41.59,32.31,41.73,32.54,41.81,32.95,41.89,33.28,42.00,33.38,42.02,34.19,41.96,34.75,41.96,35.01,42.06,35.15,42.03,35.11,41.96,35.12,41.89,35.30,41.73,35.56,41.63,35.92,41.71,36.05,41.68,36.18,41.43,36.28,41.34,36.41,41.27,36.51,41.26,36.65,41.35,36.78,41.36,36.99,41.28,37.07,41.18,37.43,41.11,37.77,41.08,37.91,41.00,38.38,40.92,38.56,40.94,38.85,41.02,39.43,41.11,39.81,40.98,39.91,40.97,40.00,40.98,40.13,40.94,40.27,40.96,40.69,41.11,40.82,41.19,40.96,41.21,41.08,41.26,41.41,41.42],[28.01,41.97,27.99,41.85,28.05,41.73,28.20,41.55,28.35,41.47,28.95,41.25,29.06,41.23,29.00,41.06,28.96,41.01,28.78,40.97,28.29,41.07,28.17,41.08,27.93,40.99,27.75,41.01,27.50,40.97,27.43,40.84,27.26,40.69,26.97,40.56,26.77,40.50,26.47,40.26,26.33,40.12,26.20,40.08,26.26,40.20,26.25,40.31,26.45,40.45,26.72,40.54,26.79,40.63,26.11,40.61,26.04,40.73,26.11,40.75,26.24,40.88,26.33,40.95,26.35,41.00,26.33,41.10,26.33,41.24,26.54,41.34,26.60,41.35,26.62,41.40,26.58,41.60,26.50,41.63,26.41,41.70,26.32,41.72,26.32,41.74,26.36,41.80,26.51,41.83,26.58,41.95,26.88,41.99,27.01,42.06,27.24,42.09,27.29,42.08,27.53,41.92,27.66,41.96,27.80,41.96,27.83,41.98,27.88,41.99]];
const BBOX = { w: 25.67, e: 44.82, s: 35.83, n: 42.09 };
const ANKARA = [32.86, 39.93];
const COS_LAT = Math.cos((BBOX.s + BBOX.n) / 2 * Math.PI / 180);
const COAST = .2, LEVEL_STEP = .04, TOP_LEVEL = .84, SEA_DEPTH = .1;
const WALL_Z = 0;

const THEMES = {
  light: {
    file: 'vatan-light.png', seaCenter: [233, 236, 240], seaEdge: [203, 208, 215],
    landLow: [226, 230, 236], landHigh: [255, 255, 255], ink: [20, 24, 31],
    terraceShadow: .2, dropShadow: .28, shade: .08, rim: .8, seaLine: .06, accent: [230, 45, 66],
  },
  dark: {
    file: 'vatan-dark.png', seaCenter: [21, 25, 33], seaEdge: [7, 8, 11],
    landLow: [30, 35, 45], landHigh: [86, 96, 116], ink: [0, 0, 0],
    terraceShadow: .55, dropShadow: .75, shade: .14, rim: .16, seaLine: .05, accent: [239, 64, 86],
  },
};

// "zoom" 16:9 bir görseli yanlardan kırparak 16:10 yapar; bu yüzden harita her
// iki yandaki dış onda birden uzak durur ve her iki biçimde de bütün kalır.
const s = Math.min(W * .64 / ((BBOX.e - BBOX.w) * COS_LAT), H * .56 / (BBOX.n - BBOX.s));
const project = (lon, lat) => [
  W * .5 + (lon - (BBOX.w + BBOX.e) / 2) * COS_LAT * s,
  H * .38 - (lat - (BBOX.s + BBOX.n) / 2) * s,
];
const rings = TURKEY.map(r => {
  const pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push(project(r[i], r[i + 1]));
  return pts;
});

const g = grid(CELL);
const { cell, cols, rows } = g;

function onLand(px, py) {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildDistanceField() {
  const pts = rings.flat(), reach = s * .7;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const sdf = new Float32Array(cols * rows), east = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, px = i * cell, py = j * cell;
    east[k] = clamp((px - minX) / (maxX - minX), 0, 1);
    if (px < minX - reach || px > maxX + reach || py < minY - reach || py > maxY + reach) { sdf[k] = -reach; continue; }
    let d = Infinity;
    for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) d = Math.min(d, segDist(px, py, r[a], r[b]));
    sdf[k] = onLand(px, py) ? d : -d;
  }
  return { sdf, east };
}

function buildField({ sdf, east }) {
  const inlandRamp = s * .5, seaRamp = s * .6, ns = 1 / (s * 3.2);
  const field = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, d = sdf[k];
    if (d <= 0) { field[k] = COAST - SEA_DEPTH * Math.min(-d / seaRamp, 1); continue; }
    const relief = .17 + .17 * east[k] + (elevation(i * cell * ns, j * cell * ns, WALL_Z) - .5) * .9;
    field[k] = COAST + Math.min(d / inlandRamp, 1) * Math.max(relief, .012);
  }
  return field;
}

// Ankara: nokta, ince halka ve çok hafif bir hare. Gece sahnesi aynı kabartmayı
// kendi ışıklarıyla kullanır.
function ankaraMarker(theme) {
  const [mx, my] = project(...ANKARA);
  return (x, y, c, mix) => {
    const r = Math.hypot(x - mx, y - my);
    const dot = clamp(9.5 - r, 0, 1), ring = clamp(1.4 - Math.abs(r - 30), 0, 1) * .4;
    const glow = Math.exp(-r * r / 2400) * .18;
    return mix(c, theme.accent, Math.max(dot, ring, glow));
  };
}

const turkey = { g, project, levels: { coast: COAST, levelStep: LEVEL_STEP, topLevel: TOP_LEVEL } };
let built;
turkey.build = () => {
  if (!built) {
    const distance = buildDistanceField();
    built = { field: buildField(distance), sdf: distance.sdf };
  }
  return built;
};

const scenes = [
  {
    name: 'vatan', themes: THEMES,
    build: () => ({ g, ...turkey.build(), ...turkey.levels }),
    overlay: ankaraMarker,
  },
  ...familyScenes(turkey),
];

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/backgrounds');
mkdirSync(outDir, { recursive: true });
const args = process.argv.slice(2);
for (const scene of scenes) {
  if (args.some(a => scenes.some(s => s.name === a)) && !args.includes(scene.name)) continue;
  let built = null;
  for (const [name, theme] of Object.entries(scene.themes)) {
    if (args.some(a => a in scene.themes) && !args.includes(name)) continue;
    built ??= scene.build();
    writeFileSync(resolve(outDir, theme.file), render({ ...built, theme, overlay: scene.overlay?.(theme) }));
  }
}
