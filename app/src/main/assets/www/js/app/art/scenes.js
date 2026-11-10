// Painted backdrops. One full-screen scene sits behind every screen. A
// biome's colours and landmarks come from the theme pack (content/theme.json),
// so a new biome is data, not code. Scenes are lit like a stage: a glowing
// sky, saturated ground, violet shadows, and dark shapes framing the edges.
// They are built once per change of screen kind and never while playing.

import { seeded, blob, ridge, strokes, tufts, INK } from './paint.js';

const W = 390;
const H = 844;

const LANDMARKS = {
  tree: (x, y, s, seed, c) =>
    `<path d="M${x - 2.5 * s} ${y} l${1.2 * s} ${-14 * s} h${2.6 * s} l${1.2 * s} ${14 * s} Z" fill="${c.dark}"/>
     <path d="${blob(seed, x, y - 22 * s, 13 * s, 12 * s, 8, 0.2)}" fill="${c.shade}"/>
     <path d="${blob(seed + 1, x - 3 * s, y - 25 * s, 9 * s, 8 * s, 7, 0.2)}" fill="${c.lit}"/>`,
  pine: (x, y, s, seed, c) =>
    [0, 1, 2].map((i) => `<path d="M${x - (11 - i * 2.5) * s} ${y - i * 10 * s} L${x} ${y - (20 + i * 10) * s} L${x + (11 - i * 2.5) * s} ${y - i * 10 * s} Z" fill="${i % 2 ? c.lit : c.shade}"/>`).join('') +
    `<rect x="${x - 1.5 * s}" y="${y}" width="${3 * s}" height="${6 * s}" fill="${c.dark}"/>`,
  // Rock arches and round spiky shrubs.
  mesa: (x, y, s, seed, c) =>
    seed % 3 === 0
      ? `<path d="M${x - 34 * s} ${y + 6} C${x - 36 * s} ${y - 66 * s} ${x + 36 * s} ${y - 66 * s} ${x + 34 * s} ${y + 6} h${-16 * s} C${x + 16 * s} ${y - 36 * s} ${x - 16 * s} ${y - 36 * s} ${x - 18 * s} ${y + 6} Z" fill="${c.shade}"/>`
      : `<path d="${blob(seed, x, y - 8 * s, 9 * s, 9 * s, 8, 0.12)}" fill="${c.shade}"/><path d="${blob(seed + 2, x - 2 * s, y - 10 * s, 5.5 * s, 5.5 * s, 7, 0.15)}" fill="${c.lit}"/>
         <path d="M${x} ${y - 17 * s} v${-6 * s} M${x - 8 * s} ${y - 12 * s} l${-5 * s} ${-3 * s} M${x + 8 * s} ${y - 12 * s} l${5 * s} ${-3 * s}" stroke="${c.dark}" stroke-width="${1.6 * s}" stroke-linecap="round"/>`,
};

// Dark shapes at the picture's edges, like looking out between trunks or rocks.
const FRAMES = {
  trunk: (c) =>
    `<path d="M-30 ${H} C10 620 -6 380 26 150 C34 90 20 40 -30 -20 Z" fill="${c.dark}"/><path d="M26 150 C-6 380 10 620 -4 ${H}" stroke="${c.rim}" stroke-width="5" fill="none" opacity="0.55"/>
     <path d="${blob(91, 8, 70, 86, 78, 11, 0.22)}" fill="${c.dark}"/><path d="${blob(92, 52, 118, 44, 34, 9, 0.25)}" fill="${c.dark}"/>
     <path d="M${W + 30} ${H} C${W - 14} 640 ${W + 6} 420 ${W - 30} 210 C${W - 38} 150 ${W - 16} 80 ${W + 30} 30 Z" fill="${c.dark}"/><path d="M${W - 30} 210 C${W + 6} 420 ${W - 14} 640 ${W + 2} ${H}" stroke="${c.rim}" stroke-width="5" fill="none" opacity="0.4"/>
     <path d="${blob(93, W - 6, 96, 78, 70, 11, 0.22)}" fill="${c.dark}"/>`,
  rock: (c) =>
    `<path d="M-30 ${H} L-30 180 C6 150 34 210 30 300 C60 380 20 470 44 560 C30 700 60 780 30 ${H} Z" fill="${c.dark}"/><path d="M30 300 C60 380 20 470 44 560" stroke="${c.rim}" stroke-width="5" fill="none" opacity="0.55"/>
     <path d="M${W + 30} ${H} L${W + 30} 120 C${W - 20} 110 ${W - 44} 190 ${W - 26} 290 C${W - 60} 400 ${W - 22} 520 ${W - 40} 640 C${W - 20} 740 ${W - 40} 800 ${W - 24} ${H} Z" fill="${c.dark}"/>
     <path d="M${W - 26} 290 C${W - 60} 400 ${W - 22} 520 ${W - 40} 640" stroke="${c.rim}" stroke-width="5" fill="none" opacity="0.45"/>`,
  pine: (c) =>
    [-18, 30, W - 34, W + 14]
      .map((x, i) => [0, 1, 2, 3, 4].map((k) => `<path d="M${x - (58 - k * 9)} ${H - 240 - k * 96 + (i % 2) * 60} L${x} ${H - 400 - k * 96 + (i % 2) * 60} L${x + (58 - k * 9)} ${H - 240 - k * 96 + (i % 2) * 60} Z" fill="${c.dark}"/>`).join('') + `<rect x="${x - 9}" y="${H - 250 + (i % 2) * 60}" width="18" height="300" fill="${c.dark}"/>`)
      .join(''),
};

const tent = (x, y, s, fill) =>
  `<path d="M${x - 34 * s} ${y} L${x} ${y - 46 * s} L${x + 34 * s} ${y} Z" fill="${fill}"/><path d="M${x} ${y - 46 * s} L${x + 34 * s} ${y} H${x + 6 * s} Z" fill="#000" opacity="0.25"/>
   <path d="M${x - 9 * s} ${y} L${x} ${y - 24 * s} L${x + 9 * s} ${y} Z" fill="${INK}"/><path d="M${x} ${y - 46 * s} v${-12 * s} l${11 * s} ${4 * s} l${-11 * s} ${4 * s}" fill="#e2603f" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`;
const house = (x, y, s, roof, seed) =>
  `<path d="${blob(seed, x, y - 13 * s, 17 * s, 14 * s, 8, 0.08)}" fill="#f4e6c4"/><path d="M${x - 21 * s} ${y - 21 * s} Q${x} ${y - 50 * s} ${x + 21 * s} ${y - 21 * s} Z" fill="${roof}"/>
   <path d="M${x - 5 * s} ${y} v${-11 * s} a${5 * s} ${5 * s} 0 0 1 ${10 * s} 0 v${11 * s} Z" fill="${INK}"/><circle cx="${x + 10 * s}" cy="${y - 16 * s}" r="${3 * s}" fill="#ffd257"/>`;

function clouds(seed, yMax, tint) {
  const rnd = seeded(seed);
  let out = '';
  for (let i = 0; i < 4; i++) {
    const x = rnd() * W;
    const y = 40 + rnd() * yMax;
    const s = 0.7 + rnd() * 0.9;
    out += `<g class="cloud" style="animation-delay:${-Math.round(rnd() * 60)}s;animation-duration:${70 + Math.round(rnd() * 50)}s">
      <path d="${blob(seed + i * 7, x, y, 42 * s, 13 * s, 10, 0.22)}" fill="${tint}" opacity="0.8"/>
      <path d="${blob(seed + i * 7 + 3, x + 18 * s, y - 9 * s, 22 * s, 11 * s, 8, 0.2)}" fill="${tint}" opacity="0.8"/></g>`;
  }
  return out;
}

// kind: 'vista' (open view with a winding path), 'stop' (a lit clearing to
// play in), 'camp' (dusk, tents, a fire), 'home' (journey's end).
// theme: one entry of content/theme.json "themes".
export function scene(kind, theme) {
  const c = theme.scene;
  const dusk = kind === 'camp';
  const night = dusk || c.night;
  const horizon = kind === 'stop' ? 230 : 430;
  const sky = dusk ? ['#2d2358', '#e78a5c'] : c.sky;
  const rnd = seeded(c.far.length * 131 + kind.length * 7 + c.ridge.length);
  const mark = LANDMARKS[c.landmark] || LANDMARKS.tree;

  let land = `<path d="${ridge(11, horizon - 70, 150, { shape: c.ridge, steps: 6 })}" fill="${c.far}"/>`;
  // Snow: the far peaks again in white, with the rock drawn a little lower over them.
  if (c.snow) land = `<path d="${ridge(11, horizon - 70, 150, { shape: c.ridge, steps: 6 })}" fill="#f4f6ff"/><path d="${ridge(11, horizon - 70, 150, { shape: c.ridge, steps: 6 })}" fill="${c.far}" transform="translate(0 30)"/>`;
  land += `<path d="${ridge(23, horizon - 10, 110, { shape: c.ridge, steps: 7 })}" fill="${c.mid}"/>
    <path d="${strokes(5, 0, horizon - 80, W, horizon - 20, 14)}" stroke="${c.glow}" stroke-width="3" fill="none" opacity="0.35" stroke-linecap="round"/>
    <path d="${ridge(37, horizon + 60, 70, { shape: 'hill', steps: 5 })}" fill="${c.near}"/>`;
  for (let i = 0; i < 6; i++) land += mark(40 + rnd() * (W - 80), horizon + 34 + rnd() * 26, 0.8 + rnd() * 0.7, 40 + i, c);
  land += `<path d="${ridge(53, horizon + 110, 34, { shape: 'hill', steps: 4 })}" fill="${c.ground}"/>`;

  // Light and shadow on the ground: a warm pool in the middle, violet at the edges.
  const cy = kind === 'stop' ? 470 : horizon + 250;
  let light = `<ellipse cx="195" cy="${cy}" rx="220" ry="${kind === 'stop' ? 260 : 170}" fill="${c.lit}" opacity="0.5" filter="url(#soft)"/>
    <path d="${strokes(9, 0, horizon + 130, W, H, 50, 34)}" stroke="${c.dark}" stroke-width="4" fill="none" opacity="0.35" stroke-linecap="round"/>
    <path d="${strokes(19, 40, horizon + 140, W - 40, H - 60, 34, 22)}" stroke="${c.glow}" stroke-width="3" fill="none" opacity="0.4" stroke-linecap="round"/>
    <path d="${tufts(3, 0, W, horizon + 96, 22)}" fill="${c.shade}"/>`;

  let extra = '';
  if (kind === 'vista' || kind === 'home') {
    // The trail itself, winding to the horizon.
    extra += `<path d="M190 ${H + 20} C90 ${H - 110} 330 ${H - 190} 220 ${horizon + 190}" stroke="${c.path}" stroke-width="54" fill="none" stroke-linecap="round"/>
      <path d="M220 ${horizon + 190} C150 ${horizon + 150} 250 ${horizon + 120} 205 ${horizon + 96}" stroke="${c.path}" stroke-width="26" fill="none" stroke-linecap="round"/>
      <path d="M205 ${horizon + 96} C185 ${horizon + 80} 215 ${horizon + 66} 200 ${horizon + 52}" stroke="${c.path}" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="M150 ${H - 30} q40 -30 100 -40 M180 ${H - 120} q50 -20 70 -50" stroke="${c.dark}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.35"/>`;
  }
  if (kind === 'home') {
    const roofs = ['#e0553c', '#4f86d6', '#f0aa2e', '#8a63c9', '#3fa37b'];
    for (let i = 0; i < 7; i++) extra += house(46 + i * 46 + (i % 2) * 8, horizon + 150 + (i % 3) * 46, 1.1 + (i % 3) * 0.25, roofs[i % roofs.length], 80 + i);
  }
  if (dusk) {
    extra += tent(98, horizon + 200, 1.5, '#f0b44a') + tent(288, horizon + 176, 1.15, '#55b3a0');
    extra += `<circle cx="196" cy="${horizon + 262}" r="150" fill="#ff9a3a" opacity="0.55" filter="url(#soft)"/>
      <path d="M170 ${horizon + 272} l52 -12 M222 ${horizon + 272} l-52 -12" stroke="#3a2416" stroke-width="9" stroke-linecap="round"/>
      <g class="flame"><path d="${blob(7, 196, horizon + 244, 15, 26, 7, 0.25)}" fill="#ff6a2a"/><path d="${blob(8, 196, horizon + 252, 8, 15, 6, 0.25)}" fill="#ffe066"/></g>`;
  }
  let stars = '';
  if (night) for (let i = 0; i < 34; i++) stars += `<circle cx="${Math.round(rnd() * W)}" cy="${Math.round(rnd() * (horizon - 110))}" r="${(0.8 + rnd() * 1.4).toFixed(1)}" fill="#fff" opacity="${(0.4 + rnd() * 0.6).toFixed(2)}"/>`;
  const frame = kind === 'home' ? '' : (FRAMES[c.frame] || FRAMES.trunk)(c);
  const sunY = night ? horizon - 150 : horizon - 190;

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
    <radialGradient id="vignette" cx="50%" cy="48%" r="72%"><stop offset="0.55" stop-color="#1a0f33" stop-opacity="0"/><stop offset="1" stop-color="#1a0f33" stop-opacity="0.62"/></radialGradient>
  </defs>
  <rect width="${W}" height="${horizon + 140}" fill="url(#sky)"/>${stars}
  <circle cx="286" cy="${sunY}" r="110" fill="${c.glow}" opacity="0.55" filter="url(#soft)"/>
  <circle cx="286" cy="${sunY}" r="${night ? 22 : 32}" fill="${night ? '#fdf3cf' : c.glow}"/>
  ${clouds(kind.length * 13 + c.ridge.length, Math.max(60, horizon - 220), c.cloud)}
  <g filter="url(#rough)">${land}</g>
  ${light}
  <g filter="url(#rough)">${extra}${frame}</g>
  ${dusk ? `<rect width="${W}" height="${H}" fill="#2a1f5c" opacity="0.38" style="mix-blend-mode:multiply"/>` : ''}
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.45"/>
</svg>`;
}

// A worn parchment sheet, for the journal-like screens (map, goals, settings).
export function parchment() {
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
  <defs><radialGradient id="page" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#f8e9bf"/><stop offset="0.7" stop-color="#eccf93"/><stop offset="1" stop-color="#b88a4e"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#page)"/>
  <path d="${strokes(77, 0, 0, W, H, 60, 40)}" stroke="#b98f4f" stroke-width="2" fill="none" opacity="0.3" stroke-linecap="round"/>
  <g fill="none" stroke="#9a733c" stroke-width="2.5" stroke-linecap="round" opacity="0.5">
    <circle cx="330" cy="92" r="30"/><path d="M330 54 v76 M292 92 h76 M330 62 l7 30 l-7 30 l-7 -30 Z"/>
    <path d="M30 790 q40 -50 90 -20 t90 -10" stroke-dasharray="3 10"/></g>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.6"/>
</svg>`;
}
