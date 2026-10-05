// Draws the VATAN application icons into data/icons/VATAN/apps. Every icon
// shares one base, one light and one motif library, so they are generated
// rather than hand-written: a change to the rim or the shadow lands on all of
// them at once and the set cannot drift apart.
//
//   node tools/icons/apps/build.mjs
//
// Output is byte-for-byte deterministic: no randomness, no dates, numbers are
// rounded to two decimals and paint definitions are emitted in a fixed order.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/icons/VATAN/apps');

const RED = '#e62d42', RED_DEEP = '#9a1a2b', SLATE = '#1b1f27', IVORY = '#f3efe6';
const GOLD = '#c9a227', BLUE = '#1f5f8b';

// Base fills run from the lit top-left corner to the bottom-right; the end
// stops are the brief's colours pushed lighter/darker so the flat colour sits
// in the middle of the tile.
const BASES = {
  red: ['#f2566a', '#b81e34'],
  slate: ['#434b5a', '#15181e'],
  ivory: ['#fffefa', '#ddd5c4'],
  blue: ['#3288bd', '#15486a'],
  emerald: ['#23a780', '#0b573f'],
};

// Glyph paints are vertical only: light comes from above-left, and a vertical
// ramp reads as "lit from the top" without fighting the base's diagonal.
const PAINTS = {
  ivory: ['#fffdf8', '#e4dccb'],
  ivoryDim: ['#ece5d6', '#d3c9b5'],
  red: ['#f04c60', '#c4223a'],
  redDeep: ['#b52337', '#86152a'],
  slate: ['#3a414e', SLATE],
  blue: ['#2f82b8', '#174e72'],
  emerald: ['#20a07a', '#0d6248'],
  gold: ['#e3c35a', '#a8861c'],
  glass: ['#2d5f88', '#0a1620'],
  screen: ['#eef1f5', '#cdd4de'],
};

const f = n => String(Math.round(n * 100) / 100 || 0);
const pt = (x, y) => `${f(x)} ${f(y)}`;
const rad = d => d * Math.PI / 180;
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
const poly = pts => 'M' + pts.map(p => pt(...p)).join('L') + 'Z';
const line = pts => 'M' + pts.map(p => pt(...p)).join('L');

function rr(x, y, w, h, r) {
  return `M${pt(x + r, y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${pt(x + w, y + r)}` +
    `V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${pt(x + w - r, y + h)}` +
    `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${pt(x, y + h - r)}` +
    `V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${pt(x + r, y)}Z`;
}

// Continuous-curvature corner instead of a circular arc: the corner starts
// bending R units before the edge ends, which is what makes a squircle look
// "cut" rather than "rounded". R=42, c=.18 lands at the same visual radius as
// a 27.6 arc (corner midpoint at R(1+3c)/8 from the corner).
function squircle(x, y, w, h, R = 42, c = .18) {
  const k = R * c;
  return `M${pt(x + R, y)}H${f(x + w - R)}C${pt(x + w - k, y)} ${pt(x + w, y + k)} ${pt(x + w, y + R)}` +
    `V${f(y + h - R)}C${pt(x + w, y + h - k)} ${pt(x + w - k, y + h)} ${pt(x + w - R, y + h)}` +
    `H${f(x + R)}C${pt(x + k, y + h)} ${pt(x, y + h - k)} ${pt(x, y + h - R)}` +
    `V${f(y + R)}C${pt(x, y + k)} ${pt(x + k, y)} ${pt(x + R, y)}Z`;
}

const BASE = squircle(8, 8, 112, 112);

// Seljuk star: two squares at 45 degrees. Concave vertices sit at
// cos45/cos22.5 of the radius, which is where the square edges cross.
function star8(cx, cy, r, rot = 0) {
  const ri = r * Math.cos(rad(45)) / Math.cos(rad(22.5));
  const pts = [];
  for (let i = 0; i < 16; i++)
    pts.push(polar(cx, cy, i % 2 ? ri : r, rot - 90 + i * 22.5));
  return poly(pts);
}

// Compass rose as on Piri Reis's portolan: long cardinal and short
// intercardinal spikes.
function rose(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const rr_ = i % 4 === 0 ? r : i % 2 === 0 ? r * .55 : r * .2;
    pts.push(polar(cx, cy, rr_, -90 + i * 22.5));
  }
  return poly(pts);
}

function ringSegment(cx, cy, r1, r2, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r2, a0), [x1, y1] = polar(cx, cy, r2, a1);
  const [x2, y2] = polar(cx, cy, r1, a1), [x3, y3] = polar(cx, cy, r1, a0);
  return `M${pt(x0, y0)}A${f(r2)} ${f(r2)} 0 ${large} 1 ${pt(x1, y1)}L${pt(x2, y2)}` +
    `A${f(r1)} ${f(r1)} 0 ${large} 0 ${pt(x3, y3)}Z`;
}

// Old Turkic letters as stroke centrelines in the font-unit space of Noto Sans
// Old Turkic (cap height 714, y up). The centrelines were taken from that
// font's outlines, so each shape is the real Unicode letter, only re-stroked
// at icon weight. cx is the glyph's horizontal centre in the same units.
const ORKHON = {
  A: { cp: 0x10C00, cx: 330, d: 'M612 490L324 690V0M324 30L45 216' },            // 𐰀
  O: { cp: 0x10C06, cx: 243, d: 'M145 0V60Q145 170 225 252Q290 315 321 357Q290 399 225 462Q145 544 145 654V714' }, // 𐰆
  OE: { cp: 0x10C07, cx: 313, d: 'M145 0V714M145 670L481 340M481 300V714' },      // 𐰇
  AEB: { cp: 0x10C0B, cx: 291, d: 'M92 0L492 461L289 690L90 461L490 0' },        // 𐰋
  OEK: { cp: 0x10C1C, cx: 316, d: 'M488 515V672H145V0M145 350H488V0' },          // 𐰜
  OQ: { cp: 0x10C38, cx: 309, d: 'M309 714V60M15 252C150 250 270 160 309 0C348 160 468 250 603 252' }, // 𐰸
  AER: { cp: 0x10C3C, cx: 309, d: 'M309 0V540L179 662L46 530M309 540L439 662L572 530' }, // 𐰼
  AET: { cp: 0x10C45, cx: 323, d: 'M145 0V714M145 251L470 433Q437 330 437 215Q437 100 498 0' }, // 𐱅
};

function orkhon(key, cx, top, h, color, weight = 105, extra = '') {
  const g = ORKHON[key], s = h / 714;
  return `<path d="${g.d}" transform="matrix(${f(s * 1000) / 1000} 0 0 ${-f(s * 1000) / 1000} ${f(cx - g.cx * s)} ${f(top + h)})" ` +
    `fill="none" stroke="${color}" stroke-width="${weight}" stroke-linejoin="miter" stroke-miterlimit="3"${extra}/>`;
}

// "Türk" as written on the Kül Tigin stele: 𐱅𐰇𐰼𐰜, right to left.
function turkWord(right, top, h, color, weight = 110, extra = '') {
  const step = h * .78;
  return ['AET', 'OE', 'AER', 'OEK']
    .map((k, i) => orkhon(k, right - step * i - h * .32, top, h, color, weight, extra)).join('');
}

// Kilim "eli belinde" (hands on hips): diamond head, triangular arms closing
// on the waist, skirt. s is the half height.
function eliBelinde(cx, cy, s, fill) {
  const P = (x, y) => [cx + x * s, cy + y * s];
  const head = poly([P(0, -1), P(.24, -.76), P(0, -.52), P(-.24, -.76)]);
  const body = poly([P(-.42, -.44), P(.42, -.44), P(.1, .02), P(.6, .92), P(-.6, .92), P(-.1, .02)]);
  const arm = side => poly([P(side * .42, -.44), P(side * .92, -.06), P(side * .16, .06), P(side * .3, -.06), P(side * .62, -.1), P(side * .36, -.3)]);
  return `<path d="${head}${body}${arm(1)}${arm(-1)}" fill="${fill}"/>`;
}

// Kilim "koç boynuzu" (ram's horn), the weaver's sign for abundance. Drawn
// with the loom's 45-degree diagonals rather than round curls: the rounded
// version is the zodiac sign for Aries, the woven one is not.
function kocBoynuzu(cx, cy, s, color, w) {
  const P = (x, y) => pt(cx + x * s, cy + y * s);
  const horn = k => `M${P(0, 0)}L${P(k * .5, -.5)}L${P(k * .95, -.05)}L${P(k * .6, .3)}L${P(k * .38, .08)}`;
  return `<path d="M${P(0, .95)}L${P(0, 0)}${horn(1)}${horn(-1)}" fill="none" stroke="${color}" ` +
    `stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"/>`;
}

// İznik tulip: three pointed petals, the side petals flaring outward.
// (cx, cy) is the bottom of the bulb, s its height.
function tulip(cx, cy, s, petal, leaf, withStem = true) {
  const P = (x, y) => pt(cx + x * s, cy + y * s);
  const bulb = `M${P(0, 0)}C${P(-.34, 0)} ${P(-.46, -.3)} ${P(-.42, -.66)}L${P(-.22, -.46)}` +
    `C${P(-.2, -.74)} ${P(-.1, -.88)} ${P(0, -1)}C${P(.1, -.88)} ${P(.2, -.74)} ${P(.22, -.46)}` +
    `L${P(.42, -.66)}C${P(.46, -.3)} ${P(.34, 0)} ${P(0, 0)}Z`;
  if (!withStem)
    return `<path d="${bulb}" fill="${petal}"/>`;
  const leaves = `M${P(0, .62)}C${P(-.14, .36)} ${P(-.36, .3)} ${P(-.56, .08)}C${P(-.44, .42)} ${P(-.22, .58)} ${P(0, .7)}Z` +
    `M${P(0, .42)}C${P(.12, .24)} ${P(.3, .2)} ${P(.46, .02)}C${P(.38, .3)} ${P(.2, .42)} ${P(0, .5)}Z`;
  return `<path d="M${P(0, 0)}C${P(0, .3)} ${P(-.03, .55)} ${P(0, .78)}" fill="none" stroke="${leaf}" stroke-width="${f(s * .06)}" stroke-linecap="round"/>` +
    `<path d="${leaves}" fill="${leaf}"/><path d="${bulb}" fill="${petal}"/>`;
}

// An incised line: dark on the upper-left wall, light on the lower-right,
// because the light comes from the top left.
function groove(d, w, dark, light, extra = '') {
  return `<path d="${d}" fill="none" stroke="${light}" stroke-width="${w}" transform="translate(.6 .6)"${extra}/>` +
    `<path d="${d}" fill="none" stroke="${dark}" stroke-width="${w}"${extra}/>`;
}

const ICONS = {};

ICONS['org.gnome.Nautilus'] = ['ivory', () => {
  // The tab steps down like the stair edge of a kilim diamond.
  const back = 'M27 24H46V27.5H50V31H54V34.5H101Q108 34.5 108 41.5V95Q108 102 101 102H27Q20 102 20 95V31Q20 24 27 24Z';
  const front = 'M20 53Q20 47 27 47H101Q108 47 108 53V96Q108 104 100 104H28Q20 104 20 96Z';
  const band = [44, 64, 84].map(x => eliBelinde(x, 80, 9, '#ffb0b9')).join('');
  return `<path d="${back}" fill="url(#p-redDeep)"/>` +
    `<path d="${rr(28, 40, 72, 30, 3)}" fill="url(#p-ivory)"/>` +
    `<path d="${front}" fill="url(#p-red)"/>` +
    `<path d="M26 47.8H102" stroke="#ff9eaa" stroke-width="1.4" opacity=".8"/>` +
    `<g opacity=".55">${band}<path d="M28 67H100M28 93H100" stroke="#ffb0b9" stroke-width="1.2"/>` +
    `<path d="${[54, 74].map(x => poly([[x, 76], [x + 3, 80], [x, 84], [x - 3, 80]])).join('')}" fill="#ffb0b9"/></g>`;
}];

ICONS['org.gnome.Settings'] = ['slate', () => {
  const cx = 64, cy = 64, ro = 43, rt = 34;
  let d = '';
  for (let k = 0; k < 8; k++) {
    const a = k * 45 - 90;
    const p = [polar(cx, cy, rt, a - 13), polar(cx, cy, ro, a - 8), polar(cx, cy, ro, a + 8), polar(cx, cy, rt, a + 13)];
    const next = polar(cx, cy, rt, a + 45 - 13);
    d += (k ? 'L' : 'M') + pt(...p[0]) + 'L' + pt(...p[1]) + `A${ro} ${ro} 0 0 1 ${pt(...p[2])}L${pt(...p[3])}` +
      `A${rt} ${rt} 0 0 1 ${pt(...next)}`;
  }
  d += 'Z';
  const hole = star8(cx, cy, 19);
  return `<circle cx="64" cy="64" r="21" fill="url(#p-red)"/>` +
    `<path d="${d}${hole}" fill="url(#p-ivory)" fill-rule="evenodd"/>` +
    groove(`M${pt(cx - 27, cy)}A27 27 0 1 0 ${pt(cx + 27, cy)}A27 27 0 1 0 ${pt(cx - 27, cy)}`, 1.2, 'rgba(27,31,39,.22)', 'rgba(255,255,255,.9)') +
    `<path d="${hole}" fill="none" stroke="${RED_DEEP}" stroke-width="2.4" transform="translate(.8 .8)" opacity=".7"/>`;
}];

// VATAN's own settings: a smooth rotary knob over the island dock, so it
// stays apart from the toothed GNOME gear at 32 px. The knob's cap is the
// Seljuk star and its lit scale is the accent red.
ICONS['org.vatan.Settings'] = ['slate', () => {
  let scale = '';
  for (let i = 0; i <= 12; i++) {
    const a = 135 + i * 22.5, on = a <= 315;
    scale += `<path d="${line([polar(64, 50, 27, a), polar(64, 50, i % 4 ? 31 : 33, a)])}" stroke="${on ? RED : IVORY}" stroke-width="2.6" stroke-linecap="round" opacity="${on ? 1 : .3}"/>`;
  }
  const apps = [34, 48, 62, 76].map((x, i) => `<path d="${rr(x, 88, 10, 10, 2.5)}" fill="${i === 3 ? RED : SLATE}" opacity="${i === 3 ? 1 : .7}"/>`).join('');
  return scale +
    `<circle cx="64" cy="50" r="21" fill="url(#p-ivory)"/>` +
    groove('M48 50A16 16 0 1 0 80 50A16 16 0 1 0 48 50', 1.1, 'rgba(27,31,39,.18)', 'rgba(255,255,255,.95)') +
    `<path d="${star8(64, 50, 9)}" fill="url(#p-red)"/>` +
    `<path d="${line([polar(64, 50, 12.5, 315), polar(64, 50, 18, 315)])}" stroke="${SLATE}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="${rr(22, 82, 84, 22, 11)}" fill="url(#p-ivory)"/>` +
    `<path d="M32 82.8H96" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>` +
    `<path d="M91 93H96" stroke="${SLATE}" stroke-width="2" stroke-linecap="round" opacity=".4"/>` + apps;
}];

ICONS['org.gnome.Console'] = ['slate', () =>
  orkhon('O', 46, 38, 52, IVORY, 118) +
  `<path d="${rr(62, 81, 30, 9, 1.5)}" fill="url(#p-red)"/>`];

ICONS['org.gnome.Terminal'] = ['ivory', () =>
  `<path d="${rr(18, 24, 92, 80, 10)}" fill="url(#p-slate)"/>` +
  `<path d="M28 25H100" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>` +
  turkWord(56, 36, 11, IVORY, 120, ' opacity=".55"') +
  `<path d="M32 56L44 65L32 74" fill="none" stroke="${IVORY}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${rr(50, 70, 20, 6, 1.5)}" fill="url(#p-red)"/>` +
  `<path d="M32 88H74" stroke="${IVORY}" stroke-width="4" stroke-linecap="round" opacity=".22"/>`];

ICONS['org.gnome.TextEditor'] = ['blue', () => {
  const page = 'M36 16H76L94 34V106Q94 112 88 112H36Q30 112 30 106V22Q30 16 36 16Z';
  const lines = [[54, 46], [64, 50], [74, 40], [84, 48], [94, 30]]
    .map(([y, w]) => `<path d="M40 ${y}H${40 + w}" stroke="${SLATE}" stroke-width="3.2" stroke-linecap="round" opacity=".28"/>`).join('');
  // Reed pen (kamış kalem) of the calligraphers, drawn tip-down then rotated.
  const pen = `<g transform="translate(76 98) rotate(32)">` +
    `<path d="M0 0L-5.5 -15H5.5Z" fill="#ead9b4"/><path d="M0 -1V-9" stroke="#8a6d2e" stroke-width="1"/>` +
    `<path d="${rr(-5.5, -19, 11, 4, 1)}" fill="url(#p-gold)"/>` +
    `<path d="${rr(-5.5, -64, 11, 46, 2)}" fill="url(#p-red)"/>` +
    `<path d="M-3 -62V-21" stroke="#ff9aa6" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>` +
    `<path d="${rr(-5.5, -72, 11, 9, 3)}" fill="url(#p-slate)"/></g>`;
  return `<path d="${page}" fill="url(#p-ivory)"/><path d="M76 16V30Q76 34 80 34H94Z" fill="#d6cbb5"/>` +
    turkWord(74, 26, 13, SLATE, 115) + lines + pen;
}];

ICONS['org.gnome.Calculator'] = ['slate', () => {
  let keys = '';
  const ops = ['M0 -5V5M-5 0H5', 'M-5 0H5', 'M-5 -2.5H5M-5 2.5H5'];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 24 + c * 21, y = 54 + r * 19;
      const op = c === 3;
      keys += `<path d="${rr(x, y, 17, 15, 3.5)}" fill="url(#p-${op ? 'red' : 'ivory'})"/>`;
      if (op)
        keys += `<path d="${ops[r]}" transform="translate(${f(x + 8.5)} ${f(y + 7.5)})" stroke="${IVORY}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  }
  return `<path d="${rr(24, 22, 80, 24, 5)}" fill="#0c0f14"/>` +
    `<path d="M26 45.4H102" stroke="#fff" stroke-opacity=".1" stroke-width="1"/>` +
    `<path d="${star8(35, 34, 5)}" fill="none" stroke="${GOLD}" stroke-width="1.2"/>` +
    `<path d="M66 34H96" stroke="${IVORY}" stroke-width="7" stroke-linecap="round" opacity=".9"/>` +
    keys;
}];

ICONS['org.gnome.Calendar'] = ['ivory', () => {
  let grid = '';
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5; c++) {
      const x = 26 + c * 16.5, y = 58 + r * 17;
      grid += r === 1 && c === 3
        ? `<path d="${rr(x - 2, y - 2, 14, 14, 4)}" fill="url(#p-red)"/>`
        : `<path d="${rr(x, y, 10, 10, 2.5)}" fill="${SLATE}" opacity=".2"/>`;
    }
  const rings = [40, 88].map(x => `<path d="${rr(x - 3.5, 14, 7, 16, 3.5)}" fill="url(#p-slate)"/>`).join('');
  return `<clipPath id="top"><path d="${BASE}"/></clipPath>` +
    `<path d="M8 8H120V44H8Z" fill="url(#p-red)" clip-path="url(#top)"/>` +
    `<path d="M8 44.6H120" stroke="${RED_DEEP}" stroke-width="1.2" opacity=".5"/>` +
    tulip(64, 34, 18, '#ffd5da', '#ffd5da', false) +
    rings + grid;
}];

ICONS['org.gnome.clocks'] = ['slate', () => {
  let ticks = '';
  for (let h = 0; h < 12; h++) {
    const a = h * 30 - 90, major = h % 3 === 0;
    ticks += `<path d="${line([polar(64, 64, major ? 31 : 34, a), polar(64, 64, 38, a)])}" stroke="${SLATE}" stroke-width="${major ? 3.4 : 2}"/>`;
  }
  const hand = (a, len, w, color, tail = 0) =>
    `<path d="${line([polar(64, 64, -tail, a), polar(64, 64, len, a)])}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  return `<circle cx="64" cy="64" r="44" fill="url(#p-ivory)"/>` +
    `<circle cx="64" cy="64" r="44" fill="none" stroke="#cfc6b3" stroke-width="1.4"/>` +
    groove(star8(64, 64, 26), 1.1, 'rgba(27,31,39,.2)', 'rgba(255,255,255,.95)') +
    groove(star8(64, 64, 26, 22.5), 1.1, 'rgba(27,31,39,.12)', 'rgba(255,255,255,.95)') +
    ticks + hand(210, 20, 5.5, SLATE) + hand(-30, 31, 4, SLATE) + hand(130, 34, 1.8, RED, 9) +
    `<circle cx="64" cy="64" r="4.2" fill="${RED}"/><circle cx="64" cy="64" r="1.5" fill="${IVORY}"/>`;
}];

ICONS['org.gnome.Weather'] = ['blue', () => {
  let ticks = '';
  for (let i = 0; i < 36; i++) {
    const a = i * 10;
    ticks += line([polar(80, 44, 23.5, a), polar(80, 44, i % 3 ? 26 : 28, a)]);
  }
  const cloud = 'M36 96A16 16 0 0 1 32.5 64.4A22 22 0 0 1 74 55A19 19 0 0 1 92 96Z';
  return `<circle cx="80" cy="44" r="18" fill="url(#p-red)"/>` +
    `<circle cx="80" cy="44" r="23.5" fill="none" stroke="${GOLD}" stroke-width="1.1"/>` +
    `<path d="${ticks}" stroke="${GOLD}" stroke-width="1.1"/>` +
    `<path d="${cloud}" fill="url(#p-ivory)"/>`;
}];

ICONS['org.gnome.Maps'] = ['blue', () => {
  const p1 = [[22, 30], [50, 24], [50, 98], [22, 104]];
  const p2 = [[50, 24], [78, 30], [78, 104], [50, 98]];
  const p3 = [[78, 30], [106, 24], [106, 98], [78, 104]];
  let rhumbs = '';
  for (let i = 0; i < 16; i++)
    rhumbs += line([[58, 66], polar(58, 66, 80, i * 22.5)]);
  return `<clipPath id="map"><path d="${poly(p1)}${poly(p2)}${poly(p3)}"/></clipPath>` +
    `<path d="${poly(p1)}${poly(p3)}" fill="url(#p-ivory)"/><path d="${poly(p2)}" fill="url(#p-ivoryDim)"/>` +
    `<path d="${rhumbs}" stroke="${SLATE}" stroke-width=".8" opacity=".22" clip-path="url(#map)"/>` +
    `<path d="${rose(58, 66, 12)}" fill="${SLATE}" opacity=".85"/>` +
    `<path d="${poly([[58, 54], [60.2, 62], [55.8, 62]])}" fill="${RED}"/>` +
    `<path d="M90 66C86 60 80 55 80 48A10 10 0 0 1 100 48C100 55 94 60 90 66Z" fill="url(#p-red)"/>` +
    `<circle cx="90" cy="48" r="3.6" fill="${IVORY}"/>`;
}];

ICONS['org.gnome.Contacts'] = ['ivory', () =>
  `<circle cx="56" cy="48" r="17" fill="url(#p-slate)"/>` +
  `<path d="M24 102C24 82 38 72 56 72C74 72 88 82 88 102Q88 106 84 106H28Q24 106 24 102Z" fill="url(#p-slate)"/>` +
  `<circle cx="92" cy="88" r="16" fill="url(#p-red)"/>` +
  `<circle cx="92" cy="88" r="12.5" fill="none" stroke="#ffc2c9" stroke-width="1" opacity=".8"/>` +
  `<path d="M92 80V96M86 84Q92 79 98 84M88 96H96" fill="none" stroke="${IVORY}" stroke-width="2.4" stroke-linecap="round"/>`];

ICONS['org.gnome.Characters'] = ['ivory', () =>
  `<path d="${rr(24, 18, 80, 92, 10)}" fill="#fffdf9" stroke="#d9d0bf" stroke-width="1.2"/>` +
  `<path d="M28 36H100M28 94H100" stroke="${RED}" stroke-width="1" opacity=".35" stroke-dasharray="3 3"/>` +
  orkhon('AEB', 64, 36, 58, RED, 108) +
  `<path d="M30 30V24H36M98 24V30M30 98V104H36M92 104H98V98" fill="none" stroke="${SLATE}" stroke-width="1.2" opacity=".45"/>`];

// A specimen "Aa", with Orkhon A (𐰀) as the small corner mark. At full size
// next to the Latin A the Orkhon letter read as a music note at 32 px, so it
// is kept to the detail layer.
ICONS['org.gnome.font-viewer'] = ['slate', () =>
  `<path d="M20 96L39 36H51L70 96H59.5L55.2 82H34.8L30.5 96ZM37.6 73H52.4L45 49Z" fill="url(#p-ivory)"/>` +
  `<circle cx="86" cy="80.5" r="11.5" fill="none" stroke="${RED}" stroke-width="8"/>` +
  `<path d="M101.5 66V96" stroke="${RED}" stroke-width="8"/>` +
  orkhon('A', 94, 26, 18, IVORY, 120, ' opacity=".55"') +
  `<path d="M18 100H110" stroke="${IVORY}" stroke-width="1" opacity=".22"/>`];

ICONS['org.gnome.Loupe'] = ['slate', () =>
  `<path d="${rr(16, 22, 96, 84, 9)}" fill="url(#p-ivory)"/>` +
  `<path d="${rr(23, 29, 82, 70, 4)}" fill="url(#p-blue)"/>` +
  `<path d="${rr(27.5, 33.5, 73, 61, 2)}" fill="none" stroke="${IVORY}" stroke-width="1" opacity=".45"/>` +
  tulip(64, 66, 30, 'url(#p-red)', IVORY)];

ICONS['org.gnome.Evince'] = ['red', () => {
  const lines = [[76, 46], [84, 50], [92, 40], [100, 30]]
    .map(([y, w]) => `<path d="M40 ${y}H${40 + w}" stroke="${SLATE}" stroke-width="3" stroke-linecap="round" opacity=".28"/>`).join('');
  // Köşebent: the corner piece of a Turkish book cover.
  return `<path d="${rr(28, 16, 72, 96, 6)}" fill="url(#p-ivory)"/>` +
    `<path d="M33 21H51C45 23 41 27 39 31C37 35 34 37 33 39Z" fill="url(#p-gold)"/>` +
    `<path d="M36 24H44Q39 27 36 32Z" fill="#fff8e2" opacity=".6"/>` +
    `<path d="M40 44H72" stroke="${SLATE}" stroke-width="5" stroke-linecap="round" opacity=".75"/>` +
    `<path d="${rr(40, 54, 48, 14, 2)}" fill="${SLATE}" opacity=".14"/>` + lines +
    `<path d="M80 10H92V42L86 37L80 42Z" fill="url(#p-redDeep)"/>`;
}];

ICONS['org.gnome.Snapshot'] = ['slate', () =>
  `<path d="${rr(42, 27, 44, 18, 6)}" fill="url(#p-ivoryDim)"/>` +
  `<path d="${rr(16, 38, 96, 64, 12)}" fill="url(#p-ivory)"/>` +
  `<path d="${rr(26, 46, 12, 7, 2)}" fill="${SLATE}" opacity=".7"/>` +
  `<circle cx="96" cy="49" r="5" fill="url(#p-red)"/>` +
  `<circle cx="64" cy="70" r="25" fill="url(#p-slate)"/>` +
  `<circle cx="64" cy="70" r="17.5" fill="url(#p-glass)"/>` +
  `<path d="${star8(64, 70, 11, 22.5)}" fill="none" stroke="${IVORY}" stroke-width="1" opacity=".35"/>` +
  `<path d="M54 63A12 12 0 0 1 62 58" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`];

ICONS['org.gnome.Screenshot'] = ['emerald', () => {
  const c = 'M26 48V36Q26 26 36 26H48M80 26H92Q102 26 102 36V48M102 80V92Q102 102 92 102H80M48 102H36Q26 102 26 92V80';
  return `<path d="${c}" fill="none" stroke="${IVORY}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M64 40V48M64 80V88M40 64H48M80 64H88" stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="64" cy="64" r="11" fill="url(#p-red)"/>` +
    `<circle cx="64" cy="64" r="15.5" fill="none" stroke="${IVORY}" stroke-width="2"/>`;
}];

ICONS['org.gnome.Totem'] = ['red', () =>
  `<radialGradient id="perde" cx=".45" cy=".42" r=".7"><stop offset="0" stop-color="#fffdf6"/><stop offset=".7" stop-color="#f1e7cf"/><stop offset="1" stop-color="#d8c8a6"/></radialGradient>` +
  `<path d="${rr(16, 22, 96, 84, 9)}" fill="url(#p-slate)"/>` +
  `<path d="${rr(23, 29, 82, 66, 3)}" fill="url(#perde)"/>` +
  `<path d="M23 99H105" stroke="${IVORY}" stroke-width="2" stroke-dasharray="4 3" opacity=".35"/>` +
  `<path d="M56 48L79 62L56 76Z" fill="url(#p-red)" stroke="${RED}" stroke-width="3" stroke-linejoin="round"/>`];

ICONS['org.gnome.SystemMonitor'] = ['slate', () => {
  let ticks = '';
  for (let a = -90; a <= 0; a += 5)
    ticks += line([polar(20, 108, 78, a), polar(20, 108, a % 15 ? 81 : 84, a)]);
  const pts = [[20, 86], [34, 86], [42, 72], [51, 94], [61, 44], [71, 80], [79, 64], [88, 64], [96, 54], [108, 54]];
  return `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${RED}" stop-opacity=".45"/><stop offset="1" stop-color="${RED}" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="tile"><path d="${BASE}"/></clipPath>` +
    `<g clip-path="url(#tile)"><path d="M8 40H120M8 56H120M8 72H120M8 88H120M40 8V120M56 8V120M72 8V120M88 8V120" stroke="${IVORY}" stroke-width=".8" opacity=".07"/>` +
    `<path d="M20 30A78 78 0 0 1 98 108" fill="none" stroke="${GOLD}" stroke-width="1.1" opacity=".8"/>` +
    `<path d="${ticks}" stroke="${GOLD}" stroke-width="1.1" opacity=".8"/></g>` +
    `<path d="${line(pts)}L108 106H20Z" fill="url(#fade)"/>` +
    `<path d="${line(pts)}" fill="none" stroke="${RED}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
}];

ICONS['org.gnome.DiskUtility'] = ['blue', () => {
  let studs = '';
  for (let i = 0; i < 8; i++) {
    const [x, y] = polar(64, 56, 14.5, i * 45 + 22.5);
    studs += `<circle cx="${f(x)}" cy="${f(y)}" r="1.5" fill="${IVORY}" opacity=".55"/>`;
  }
  const screws = [[33, 23], [95, 23], [33, 105], [95, 105]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="${SLATE}" opacity=".35"/>`).join('');
  return `<path d="${rr(24, 14, 80, 100, 11)}" fill="url(#p-ivory)"/>` + screws +
    `<circle cx="64" cy="56" r="31" fill="url(#p-slate)"/>` +
    `<circle cx="64" cy="56" r="26" fill="none" stroke="${IVORY}" stroke-width="1" opacity=".14"/>` +
    `<circle cx="64" cy="56" r="20" fill="none" stroke="${IVORY}" stroke-width="1" opacity=".14"/>` +
    studs + `<circle cx="64" cy="56" r="8" fill="url(#p-ivory)"/><circle cx="64" cy="56" r="3" fill="${RED}"/>` +
    `<path d="M88 98L74 72" stroke="${RED}" stroke-width="5.5" stroke-linecap="round"/>` +
    `<circle cx="88" cy="98" r="6.5" fill="url(#p-slate)"/><circle cx="88" cy="98" r="2" fill="${IVORY}" opacity=".5"/>` +
    `<path d="M36 100H50" stroke="${RED}" stroke-width="3" stroke-linecap="round"/>`;
}];

ICONS['org.gnome.baobab'] = ['slate', () =>
  `<path d="${ringSegment(64, 64, 24, 42, -88, 128)}" fill="url(#p-red)"/>` +
  `<path d="${ringSegment(64, 64, 24, 42, 132, 222)}" fill="url(#p-ivory)"/>` +
  `<path d="${ringSegment(64, 64, 24, 42, 226, 268)}" fill="url(#p-blue)"/>` +
  kocBoynuzu(64, 62, 13, IVORY, 3.2)];

ICONS['org.gnome.Logs'] = ['blue', () => {
  // Combed ebru: parallel waves dragged through the paint by a tarak.
  let waves = '';
  const colors = [RED, BLUE, SLATE, RED, BLUE];
  colors.forEach((c, i) => {
    const y = 20 + i * 5.5, a = i % 2 ? 3 : -3;
    waves += `<path d="M20 ${y}C30 ${y + a} 36 ${y - a} 46 ${y}S62 ${y - a} 72 ${y}S88 ${y - a} 98 ${y}S112 ${y - a} 112 ${y}" fill="none" stroke="${c}" stroke-width="2.6" opacity=".85"/>`;
  });
  const rows = [[56, 50, RED], [70, 40, SLATE], [84, 46, SLATE], [98, 32, SLATE]]
    .map(([y, w, c]) => `<circle cx="39" cy="${y}" r="3.2" fill="${c}" opacity="${c === RED ? 1 : .5}"/>` +
      `<path d="M48 ${y}H${48 + w}" stroke="${SLATE}" stroke-width="3.4" stroke-linecap="round" opacity=".3"/>`).join('');
  return `<clipPath id="sheet"><path d="${rr(26, 14, 76, 100, 8)}"/></clipPath>` +
    `<path d="${rr(26, 14, 76, 100, 8)}" fill="url(#p-ivory)"/>` +
    `<g clip-path="url(#sheet)"><path d="M26 14H102V44H26Z" fill="#f4e9d4"/>${waves}` +
    `<path d="M26 44.5H102" stroke="${SLATE}" stroke-width="1" opacity=".15"/></g>` + rows;
}];

ICONS['org.gnome.FileRoller'] = ['ivory', () => {
  let band = '';
  for (let i = 0; i < 6; i++) {
    const x = 30.5 + i * 13.4;
    band += poly([[x, 66.5], [x + 4.5, 72], [x, 77.5], [x - 4.5, 72]]);
  }
  let zig = 'M24 66';
  for (let x = 24; x < 104; x += 5) zig += `L${x + 2.5} 69L${x + 5} 66`;
  let zig2 = 'M24 78';
  for (let x = 24; x < 104; x += 5) zig2 += `L${x + 2.5} 75L${x + 5} 78`;
  return `<path d="M24 50V44Q24 30 38 30H90Q104 30 104 44V50Z" fill="url(#p-redDeep)"/>` +
    `<path d="M28 34H100" stroke="#ff8996" stroke-width="1.2" opacity=".5" stroke-linecap="round"/>` +
    `<path d="M24 50H104V100Q104 106 98 106H30Q24 106 24 100Z" fill="url(#p-red)"/>` +
    `<path d="M24 63H104V81H24Z" fill="url(#p-ivory)"/>` +
    `<path d="${band}" fill="${RED}"/>` +
    `<path d="${zig}${zig2}" fill="none" stroke="${SLATE}" stroke-width="1" opacity=".55"/>` +
    `<path d="${rr(58, 44, 12, 14, 2.5)}" fill="url(#p-gold)"/>` +
    `<path d="M64 49V53" stroke="${SLATE}" stroke-width="2" stroke-linecap="round"/>`;
}];

ICONS['org.gnome.Extensions'] = ['emerald', () => {
  const piece = 'M32 46Q32 40 38 40H51A9.5 9.5 0 1 1 69 40H82Q88 40 88 46V59A9.5 9.5 0 1 1 88 77V90Q88 96 82 96H38Q32 96 32 90Z';
  return `<g transform="translate(-4 4)"><path d="${piece}" fill="url(#p-ivory)"/>` +
    groove(rr(41, 49, 38, 38, 4), 1.2, 'rgba(27,31,39,.2)', 'rgba(255,255,255,.95)') +
    groove(poly([[60, 58], [69, 68], [60, 78], [51, 68]]), 1.2, 'rgba(27,31,39,.2)', 'rgba(255,255,255,.95)') + '</g>';
}];

ICONS['org.gnome.tweaks'] = ['ivory', () =>
  [[38, 50], [64, 82], [90, 40]].map(([y, x]) =>
    `<path d="M26 ${y}H102" stroke="${SLATE}" stroke-width="6" stroke-linecap="round" opacity=".2"/>` +
    `<path d="M26 ${y}H${x}" stroke="${RED}" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="${rr(x - 7, y - 11, 14, 22, 4.5)}" fill="url(#p-slate)"/>` +
    `<path d="M${x} ${y - 5}V${y + 5}" stroke="${IVORY}" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>`).join('')];

ICONS['org.gnome.Software'] = ['red', () =>
  `<path d="M45 54C42 40 49 28 57 29Q64 33 71 29C79 28 86 40 83 54" fill="none" stroke="${SLATE}" stroke-width="5" stroke-linecap="round"/>` +
  `<path d="M28 48H100L95 104Q94.5 110 88.5 110H39.5Q33.5 110 33 104Z" fill="url(#p-ivory)"/>` +
  `<path d="M29 52H99" stroke="${SLATE}" stroke-width="1.4" opacity=".14"/>` +
  `<circle cx="45" cy="56" r="2.6" fill="${SLATE}" opacity=".6"/><circle cx="83" cy="56" r="2.6" fill="${SLATE}" opacity=".6"/>` +
  orkhon('OQ', 64, 64, 36, RED, 115)];

ICONS['org.gnome.Connections'] = ['blue', () => {
  const screen = (x, y) => `<path d="${rr(x, y, 40, 30, 4)}" fill="url(#p-ivory)"/>` +
    `<path d="${rr(x + 3.5, y + 3.5, 33, 21, 1.5)}" fill="url(#p-slate)"/>` +
    `<path d="M${x + 14} ${y + 36}H${x + 26}" stroke="${IVORY}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M${x + 20} ${y + 30}V${y + 35}" stroke="${IVORY}" stroke-width="3"/>`;
  // Pointed stone arch, as on Malabadi bridge, spanning the two screens.
  return `<path d="M36 64C36 46 48 36 64 28C80 36 92 46 92 64" fill="none" stroke="${IVORY}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M44 64C44 50 52 43 64 36C76 43 84 50 84 64" fill="none" stroke="${IVORY}" stroke-width="1.4" opacity=".45"/>` +
    `<path d="${poly([[64, 24], [68, 30], [64, 35], [60, 30]])}" fill="url(#p-red)"/>` +
    screen(14, 64) + screen(74, 64);
}];

ICONS['org.gnome.SimpleScan'] = ['blue', () =>
  `<path d="${rr(34, 16, 60, 70, 4)}" fill="url(#p-ivory)"/>` +
  turkWord(79, 26, 12, SLATE, 115) +
  `<path d="M44 48H84M44 56H76" stroke="${SLATE}" stroke-width="3" stroke-linecap="round" opacity=".28"/>` +
  `<path d="M30 66H98" stroke="${RED}" stroke-width="8" opacity=".25" stroke-linecap="round"/>` +
  `<path d="M30 66H98" stroke="${RED}" stroke-width="2.4" stroke-linecap="round"/>` +
  `<path d="${rr(14, 74, 100, 34, 9)}" fill="url(#p-slate)"/>` +
  `<path d="M22 76H106" stroke="#fff" stroke-width="1.2" opacity=".18" stroke-linecap="round"/>` +
  `<path d="M26 96H52" stroke="${IVORY}" stroke-width="2.4" stroke-linecap="round" opacity=".3"/>` +
  `<circle cx="98" cy="96" r="3" fill="${RED}"/>`];

ICONS['org.gnome.PowerStats'] = ['emerald', () => {
  const chev = (y, fill) => `<path d="${poly([[49, y + 9], [64, y], [79, y + 9], [79, y + 17], [64, y + 8], [49, y + 17]])}" fill="${fill}"/>`;
  return `<path d="${rr(56, 18, 16, 10, 3)}" fill="url(#p-ivory)"/>` +
    `<path d="${rr(41, 26, 46, 84, 10)}" fill="none" stroke="${IVORY}" stroke-width="6"/>` +
    chev(84, 'url(#p-ivory)') + chev(66, 'url(#p-ivory)') + chev(48, 'url(#p-red)');
}];

ICONS['org.gnome.Yelp'] = ['blue', () => {
  let ring = '';
  for (let i = 0; i < 4; i++)
    ring += `<path d="${ringSegment(64, 64, 20, 40, i * 90 - 45, i * 90 + 45)}" fill="url(#p-${i % 2 ? 'ivory' : 'red'})"/>`;
  return ring +
    `<circle cx="64" cy="64" r="40" fill="none" stroke="${SLATE}" stroke-width="1" opacity=".25"/>` +
    `<path d="${rose(64, 64, 13)}" fill="url(#p-gold)"/>`;
}];

ICONS['org.gnome.Tour'] = ['emerald', () =>
  `<path d="M36 112C36 92 88 94 86 72C84 54 50 62 54 42" fill="none" stroke="${IVORY}" stroke-width="13" stroke-linecap="round"/>` +
  `<path d="M36 112C36 92 88 94 86 72C84 54 50 62 54 42" fill="none" stroke="${RED}" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round"/>` +
  `<path d="M54 42V14" stroke="${SLATE}" stroke-width="3" stroke-linecap="round"/>` +
  `<path d="M55.5 15L80 22L55.5 29Z" fill="url(#p-red)"/>`];

ICONS['org.freedesktop.MalcontentControl'] = ['emerald', () =>
  `<path d="M64 16L101 28V58C101 82 85 99 64 110C43 99 27 82 27 58V28Z" fill="url(#p-ivory)"/>` +
  groove('M64 24L94 34V58C94 78 81 92 64 102C47 92 34 78 34 58V34Z', 1.2, 'rgba(27,31,39,.2)', 'rgba(255,255,255,.95)') +
  eliBelinde(54, 60, 22, SLATE) + eliBelinde(79, 72, 13, RED)];

ICONS['pardus-software'] = ['blue', () => {
  let awning = '';
  const n = 6, w = 88 / n;
  for (let i = 0; i < n; i++) {
    const x = 20 + i * w;
    awning += `<path d="M${f(x)} 28H${f(x + w)}V44A${f(w / 2)} ${f(w / 2)} 0 0 1 ${f(x)} 44Z" fill="url(#p-${i % 2 ? 'ivory' : 'red'})"/>`;
  }
  return `<path d="M30 46H98V104Q98 110 92 110H36Q30 110 30 104Z" fill="url(#p-ivoryDim)"/>` +
    `<path d="${rr(18, 22, 92, 8, 3)}" fill="url(#p-slate)"/>` + awning +
    orkhon('OQ', 64, 62, 38, RED, 115);
}];

ICONS['pardus-update'] = ['emerald', () => {
  const cx = 64, cy = 64, r = 32, a0 = 205, a1 = 505;
  const [sx, sy] = polar(cx, cy, r, a0), [ex, ey] = polar(cx, cy, r, a1);
  const t = [-Math.sin(rad(a1)), Math.cos(rad(a1))], n = [Math.cos(rad(a1)), Math.sin(rad(a1))];
  // Barbed temren, longer than it is wide so the head reads along the arc.
  const at = (u, v) => pt(ex + t[0] * u + n[0] * v, ey + t[1] * u + n[1] * v);
  const head = `M${at(16, 0)}L${at(-3, 9)}L${at(1, 0)}L${at(-3, -9)}Z`;
  const vane = (r1, r2) => poly([polar(cx, cy, r1, a0 + 2), polar(cx, cy, r1, a0 + 20), polar(cx, cy, r2, a0 + 13), polar(cx, cy, r2, a0 - 3)]);
  return `<path d="M${pt(sx, sy)}A${r} ${r} 0 1 1 ${pt(ex, ey)}" fill="none" stroke="${IVORY}" stroke-width="7"/>` +
    `<path d="${head}" fill="url(#p-ivory)"/>` +
    `<path d="${vane(r + 3, r + 10)}${vane(r - 3, r - 10)}" fill="url(#p-red)"/>` +
    `<circle cx="64" cy="64" r="13" fill="none" stroke="${IVORY}" stroke-width="3" opacity=".7"/>` +
    `<circle cx="64" cy="64" r="7" fill="url(#p-red)"/>`;
}];

ICONS['pardus-package-installer'] = ['red', () =>
  orkhon('OQ', 64, 16, 44, SLATE, 120) +
  `<path d="${poly([[28, 64], [48, 64], [44, 52], [18, 56]])}" fill="url(#p-ivoryDim)"/>` +
  `<path d="${poly([[100, 64], [80, 64], [84, 52], [110, 56]])}" fill="url(#p-ivoryDim)"/>` +
  `<path d="M28 64H100V102Q100 108 94 108H34Q28 108 28 102Z" fill="url(#p-ivory)"/>` +
  `<path d="M56 64H72V80H56Z" fill="${RED}" opacity=".85"/>` +
  `<path d="M28 64.6H100" stroke="${SLATE}" stroke-width="1.2" opacity=".2"/>`];

ICONS['pardus-about'] = ['red', () => {
  const pts = [];
  for (let i = 0; i < 64; i++)
    pts.push(polar(64, 64, i % 2 ? 38 : 41, i * 360 / 64));
  return `<path d="${poly(pts)}" fill="url(#p-ivory)"/>` +
    groove(`M32 64A32 32 0 1 0 96 64A32 32 0 1 0 32 64`, 1.2, 'rgba(27,31,39,.22)', 'rgba(255,255,255,.95)') +
    `<circle cx="64" cy="44" r="6.5" fill="url(#p-slate)"/>` +
    `<path d="M57 57H70V86H75V92H53V86H58V63H57Z" fill="url(#p-slate)"/>`;
}];

ICONS['pardus-hardware-info'] = ['emerald', () => {
  let pins = '', traces = '';
  for (const c of [46, 55, 64, 73, 82]) {
    pins += `<path d="M${c - 1.6} 30h3.2v8h-3.2zM${c - 1.6} 90h3.2v8h-3.2zM30 ${c - 1.6}h8v3.2h-8zM90 ${c - 1.6}h8v3.2h-8z"/>`;
    traces += `M${c} 30V16M${c} 98V112M30 ${c}H16M98 ${c}H112`;
  }
  return `<path d="${traces}" stroke="${IVORY}" stroke-width="1.4" opacity=".22"/>` +
    `<g fill="url(#p-ivory)">${pins}</g>` +
    `<path d="${rr(37, 37, 54, 54, 6)}" fill="url(#p-slate)"/>` +
    `<path d="${rr(45, 45, 38, 38, 3)}" fill="none" stroke="${GOLD}" stroke-width="1" opacity=".7"/>` +
    `<path d="${star8(64, 64, 12)}" fill="none" stroke="${GOLD}" stroke-width="1.6"/>` +
    `<circle cx="44" cy="44" r="2" fill="${IVORY}" opacity=".7"/>`;
}];

ICONS['pardus-mycomputer'] = ['ivory', () =>
  `<path d="${rr(16, 20, 96, 68, 8)}" fill="url(#p-slate)"/>` +
  `<path d="${rr(22, 26, 84, 54, 3)}" fill="url(#p-screen)"/>` +
  `<path d="M30 60C40 48 52 66 62 52S86 46 98 54M34 70C46 60 60 74 72 62S90 60 100 66M44 44C54 38 64 46 76 40" fill="none" stroke="${SLATE}" stroke-width="1" opacity=".22"/>` +
  `<circle cx="54" cy="47" r="6" fill="${RED}" opacity=".18"/><circle cx="54" cy="47" r="2.6" fill="${RED}"/>` +
  `<path d="M56 88H72L74 99H54Z" fill="url(#p-slate)"/>` +
  `<path d="${rr(40, 98, 48, 7, 3.5)}" fill="url(#p-slate)"/>`];

ICONS['pardus-font-manager'] = ['red', () =>
  `<path d="${rr(34, 24, 56, 76, 6)}" fill="url(#p-ivoryDim)" transform="rotate(-14 62 104)"/>` +
  `<path d="${rr(36, 22, 56, 78, 6)}" fill="url(#p-ivoryDim)" transform="rotate(-5 64 104)"/>` +
  `<path d="${rr(40, 22, 56, 82, 6)}" fill="url(#p-ivory)" transform="rotate(5 68 104)"/>` +
  `<g transform="rotate(5 68 104)">${orkhon('AET', 68, 38, 44, SLATE, 112)}` +
  `<path d="M48 90H88" stroke="${RED}" stroke-width="1.2" opacity=".6"/></g>`];

const usb = inner =>
  `<path d="${rr(50, 18, 28, 30, 3)}" fill="url(#p-ivoryDim)"/>` +
  `<path d="M56 26H62V32H56ZM66 26H72V32H66Z" fill="${SLATE}" opacity=".55"/>` +
  `<path d="${rr(40, 44, 48, 68, 9)}" fill="url(#p-ivory)"/>` + inner;

ICONS['pardus-image-writer'] = ['blue', () => usb(orkhon('OQ', 64, 56, 40, RED, 120))];

ICONS['pardus-usb-formatter'] = ['red', () =>
  usb(`<path d="M50 62H55V57H61V62H67V57H73V62H78V78C78 89 72 96 64 100C56 96 50 89 50 78Z" fill="url(#p-slate)"/>` +
    groove('M55 67H73V78C73 86 69 91 64 94C59 91 55 86 55 78Z', 1.2, 'rgba(0,0,0,.45)', 'rgba(255,255,255,.18)'))];

ICONS['pardus-java-installer'] = ['slate', () =>
  `<path d="M54 18C50 24 58 28 54 34M64 16C60 22 68 28 64 34M74 18C70 24 78 28 74 34" fill="none" stroke="${IVORY}" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>` +
  `<path d="M82 60L110 46" stroke="${IVORY}" stroke-width="7" stroke-linecap="round"/>` +
  `<path d="M38 44H84L80 50L88 98Q89 106 81 106H41Q33 106 34 98L42 50Z" fill="url(#p-red)"/>` +
  `<path d="M34 42L40 50H84" fill="none" stroke="${GOLD}" stroke-width="2.4" stroke-linejoin="round"/>` +
  `<path d="M44 56L40 96" stroke="#ff9aa6" stroke-width="2" stroke-linecap="round" opacity=".6"/>`];

ICONS['pardus-gnome-greeter'] = ['blue', () => {
  let niches = '';
  for (let i = 0; i < 6; i++) {
    const x = 38 + i * 10.4;
    niches += `M${f(x)} 34V30C${f(x)} 27 ${f(x + 2.6)} 25.5 ${f(x + 4)} 24.5C${f(x + 5.4)} 25.5 ${f(x + 8)} 27 ${f(x + 8)} 30V34Z`;
  }
  const arch = 'M46 108V68C46 52 54 44 64 38C74 44 82 52 82 68V108Z';
  return `<radialGradient id="light" cx=".5" cy=".85" r=".8"><stop offset="0" stop-color="#ff8a5c"/><stop offset=".6" stop-color="${RED}"/><stop offset="1" stop-color="${RED_DEEP}"/></radialGradient>` +
    `<path d="M26 108V22Q26 18 30 18H98Q102 18 102 22V108Z" fill="url(#p-ivory)"/>` +
    `<path d="${niches}" fill="${SLATE}" opacity=".18"/>` +
    groove('M38 108V66C38 48 50 38 64 30C78 38 90 48 90 66V108', 1.4, 'rgba(27,31,39,.22)', 'rgba(255,255,255,.95)') +
    `<path d="${arch}" fill="url(#light)"/>` +
    `<path d="M26 108H102" stroke="${SLATE}" stroke-width="1.4" opacity=".3"/>`;
}];

ICONS['pardus-gnome-shortcuts'] = ['slate', () => {
  let keys = '';
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 6; c++)
      keys += `<path d="${rr(22 + c * 14.4, 44 + r * 15, 12, 12, 2.6)}" fill="url(#p-ivoryDim)"/>`;
  return `<path d="${rr(15, 36, 98, 62, 9)}" fill="url(#p-ivory)"/>` + keys +
    `<path d="${rr(22, 74, 12, 12, 2.6)}" fill="url(#p-red)"/>` +
    `<path d="${rr(37, 74, 54, 12, 2.6)}" fill="url(#p-ivoryDim)"/>` +
    `<path d="${rr(94, 74, 12, 12, 2.6)}" fill="url(#p-ivoryDim)"/>`;
}];

ICONS['vatan-nsosyal'] = ['red', () => {
  let heads = '';
  for (let i = 0; i < 6; i++) {
    const [x, y] = polar(64, 57, 19, i * 60 - 90);
    heads += `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="url(#p-slate)"/>`;
  }
  return `<path d="M64 20C89 20 106 35 106 57C106 79 89 94 64 94C58 94 52 93 47 91L31 103L34 86C27 79 22 69 22 57C22 35 39 20 64 20Z" fill="url(#p-ivory)"/>` +
    `<circle cx="64" cy="57" r="19" fill="none" stroke="${SLATE}" stroke-width="1" opacity=".15"/>` +
    heads + `<circle cx="64" cy="57" r="7.5" fill="url(#p-red)"/>`;
}];

function paintDefs(body) {
  const used = new Set([...body.matchAll(/url\(#p-(\w+)\)/g)].map(m => m[1]));
  return Object.keys(PAINTS).filter(k => used.has(k)).map(k =>
    `<linearGradient id="p-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PAINTS[k][0]}"/><stop offset="1" stop-color="${PAINTS[k][1]}"/></linearGradient>`).join('');
}

function render(base, body) {
  const [hi, lo] = BASES[base];
  const light = base === 'ivory';
  // On a light tile a dark rim would read as an outline, so ivory gets a
  // softer bottom edge and a weaker glyph shadow than the coloured tiles.
  const rimLow = light ? .14 : .32, lift = light ? .16 : .38;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs>` +
    `<linearGradient id="base" x1=".15" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient>` +
    `<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${light ? .9 : .5}"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${rimLow}"/></linearGradient>` +
    `<radialGradient id="sheen" cx=".2" cy=".1" r=".9"><stop offset="0" stop-color="#fff" stop-opacity="${light ? 0 : .12}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="inside"><path d="${BASE}"/></clipPath>` +
    `<filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.3"/><feOffset dx=".7" dy="1.8"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="${lift}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    paintDefs(body) +
    `</defs>` +
    `<path d="${BASE}" fill="#000" opacity=".3" transform="translate(0 2.6)" filter="url(#drop)"/>` +
    `<path d="${BASE}" fill="#000" opacity=".18" transform="translate(0 .8)"/>` +
    `<path d="${BASE}" fill="url(#base)"/>` +
    `<path d="${BASE}" fill="url(#sheen)"/>` +
    `<g filter="url(#lift)">${body}</g>` +
    `<path d="${BASE}" fill="none" stroke="url(#rim)" stroke-width="2.4" clip-path="url(#inside)"/>` +
    `</svg>\n`;
}

// One element per line keeps the files diffable and readable by hand.
const pretty = svg => svg.replace(/></g, '>\n<');

mkdirSync(outDir, { recursive: true });
for (const [name, [base, draw]] of Object.entries(ICONS))
  writeFileSync(resolve(outDir, `${name}.svg`), pretty(render(base, draw())));

export { ICONS, ORKHON };
