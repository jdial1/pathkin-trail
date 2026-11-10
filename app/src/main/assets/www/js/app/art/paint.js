// Painting helpers. All art in the game is drawn by code as SVG, in a
// cut-paper gouache style: flat shapes with ragged, hand-cut edges, a darker
// shadow side, a few dry-brush strokes, and paper grain over everything.
// Shapes are generated from seeds so every scene is the same each time.

export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

// A smooth closed curve through the points (quadratic through midpoints).
export function smooth(points) {
  const n = points.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(points[n - 1], points[0]);
  let d = `M${r1(start[0])} ${r1(start[1])}`;
  for (let i = 0; i < n; i++) {
    const m = mid(points[i], points[(i + 1) % n]);
    d += ` Q${r1(points[i][0])} ${r1(points[i][1])} ${r1(m[0])} ${r1(m[1])}`;
  }
  return d + ' Z';
}

// An organic blob: an ellipse whose outline wanders a little.
export function blob(seed, cx, cy, rx, ry, n = 9, wander = 0.16) {
  const rnd = seeded(seed);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 2 * wander;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smooth(pts);
}

// A ridge line across the picture (hills, mesas, peaks), closed down to `floor`.
// shape: 'hill' rolls, 'mesa' has flat tops and steep sides, 'peak' is jagged.
export function ridge(seed, y, amp, { w = 390, floor = 900, steps = 8, shape = 'hill' } = {}) {
  const rnd = seeded(seed);
  const pts = [];
  for (let i = -1; i <= steps + 1; i++) {
    const x = (i / steps) * w;
    let h = rnd();
    if (shape === 'mesa') h = h > 0.5 ? 0.9 + rnd() * 0.1 : 0.15 + rnd() * 0.15;
    if (shape === 'peak') h = i % 2 ? 0.75 + rnd() * 0.25 : rnd() * 0.3;
    pts.push([x + (shape === 'hill' ? (rnd() - 0.5) * (w / steps) * 0.5 : 0), y - h * amp]);
  }
  let d = `M${-40} ${floor} L${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [x, yy] = pts[i];
    // Hills roll: curve through each point toward the midpoint of the next span.
    if (shape === 'hill') {
      const next = pts[i + 1] || [x + 40, yy];
      d += ` Q${r1(x)} ${r1(yy)} ${r1((x + next[0]) / 2)} ${r1((yy + next[1]) / 2)}`;
    }
    else if (shape === 'mesa') d += ` L${r1(px + (x - px) * 0.82)} ${r1(py)} L${r1(x)} ${r1(yy)}`;
    else d += ` L${r1(x)} ${r1(yy)}`;
  }
  return `${d} L${w + 40} ${floor} Z`;
}

// Short dry-brush strokes scattered over an area, for texture.
export function strokes(seed, x0, y0, x1, y1, count, len = 26) {
  const rnd = seeded(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const y = y0 + rnd() * (y1 - y0);
    const l = len * (0.5 + rnd());
    d += `M${r1(x)} ${r1(y)} q${r1(l / 2)} ${r1((rnd() - 0.5) * 6)} ${r1(l)} ${r1((rnd() - 0.5) * 4)} `;
  }
  return d;
}

// Grass tufts along a line.
export function tufts(seed, x0, x1, y, count, size = 9) {
  const rnd = seeded(seed);
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const yy = y + (rnd() - 0.5) * 6;
    const s = size * (0.6 + rnd() * 0.8);
    d += `M${r1(x - s * 0.5)} ${r1(yy)} l${r1(s * 0.15)} ${r1(-s)} l${r1(s * 0.35)} ${r1(s)} l${r1(s * 0.2)} ${r1(-s * 1.25)} l${r1(s * 0.3)} ${r1(s * 1.25)} `;
  }
  return d;
}

export const INK = '#33291f';

// Filters and patterns every scene shares. Put once into the page.
export const DEFS = `
<filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="7"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3"/>
  <feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 -1.1 0.62"/>
</filter>
<filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>`;
