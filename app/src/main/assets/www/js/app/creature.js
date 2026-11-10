// Pathkin art: one layer per trait slot, composed at runtime, so 1,024
// combinations need about twenty drawn parts. Cut-paper style: a bean-shaped
// body with a shadow side, an inked outline, and a face with some life in it.
// Every trait has a shape cue, so nothing depends on colour alone (the coat
// "tint" is both a colour and a belly pattern).

const INK = '#33291f';
const S = `stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`;
const THIN = `stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
const BODY = 'M32 15 C45 14 55 25 55 39 C56 52 46 60 32 60 C18 60 8 52 9 39 C9 25 19 14 32 15 Z';

const crest = {
  // Three leafy curls.
  tuft: (fill) => `<path d="M31 18 C24 14 20 8 22 3 C27 5 31 10 32 17 Z M32 17 C30 9 32 3 36 0 C39 5 37 12 33 18 Z M33 18 C36 11 41 7 46 8 C45 13 40 17 34 19 Z" fill="${fill}" ${S}/>`,
  // A sail-like fin.
  fin: (fill) => `<path d="M19 22 C20 10 25 3 30 1 C40 5 46 13 47 22 Z" fill="${fill}" ${S}/><path d="M29 6 L31 17 M37 9 L38 18" fill="none" ${THIN}/>`,
  // One curved horn.
  horn: () => `<path d="M26 19 C27 10 31 3 38 0 C39 8 38 14 37 19 Z" fill="#f6ecd2" ${S}/><path d="M30 12 L36 13" fill="none" ${THIN}/>`,
  bare: () => '',
};

const eye = (x, r, pr, dy = 0) =>
  `<circle cx="${x}" cy="${35 + dy}" r="${r}" fill="#fffdf6" ${THIN}/><circle cx="${x + 0.6}" cy="${35.6 + dy}" r="${pr}" fill="${INK}"/><circle cx="${x - pr * 0.3}" cy="${34.4 + dy}" r="${pr * 0.35}" fill="#fff"/>`;
const eyes = {
  round: () => eye(23.5, 5.2, 2.5) + eye(40.5, 5.2, 2.5),
  // Tall, narrow cat eyes.
  slit: () => [23.5, 40.5].map((x) => `<ellipse cx="${x}" cy="35" rx="3.4" ry="6.4" fill="#fffdf6" ${THIN}/><ellipse cx="${x}" cy="35" rx="1.2" ry="5" fill="${INK}"/>`).join(''),
  // Big goggle eyes that nearly touch.
  wide: () => eye(22.5, 8, 2.1) + eye(41.5, 8, 2.1),
  // Half closed under heavy lids.
  lidded: (lid) =>
    [23.5, 40.5]
      .map((x) => `<circle cx="${x}" cy="35.5" r="5.6" fill="#fffdf6" ${THIN}/><circle cx="${x}" cy="37.6" r="2.2" fill="${INK}"/><path d="M${x - 6.2} 35.5 a6.2 6.2 0 0 1 12.4 0 Z" fill="${lid}" ${THIN}/>`)
      .join(''),
};

const mark = {
  dot: `<circle cx="32" cy="22.5" r="3.3" fill="${INK}"/>`,
  stripe: `<path d="M19 23.6 C27 19.6 37 19.6 45 23.6" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  ring: `<circle cx="32" cy="22.5" r="3.7" fill="none" stroke="${INK}" stroke-width="2.2"/>`,
  none: '',
};

const feet = {
  paws: [21.5, 42.5].map((x) => `<path d="M${x - 8} 66 C${x - 8} 60 ${x + 8} 60 ${x + 8} 66 C${x + 8} 69 ${x - 8} 69 ${x - 8} 66 Z" fill="#f6ecd2" ${S}/>`).join(''),
  hooves: [15, 35].map((x) => `<path d="M${x + 1} 69 L${x + 3} 58 L${x + 12} 58 L${x + 14} 69 Z" fill="${INK}" ${S}/>`).join(''),
  webs: [11, 34].map((x) => `<path d="M${x} 69 C${x + 3} 62 ${x + 6} 58 ${x + 9.5} 57 C${x + 13} 58 ${x + 16} 62 ${x + 19} 69 Z" fill="#eda03a" ${S}/><path d="M${x + 6} 68 L${x + 8.5} 61 M${x + 13} 68 L${x + 10.5} 61" fill="none" ${THIN}/>`).join(''),
  roller: `<circle cx="32" cy="64" r="8" fill="#a39a8c" ${S}/><circle cx="32" cy="64" r="2.6" fill="${INK}"/><path d="M32 57.5 v3 M32 67.5 v3 M25.5 64 h3 M35.5 64 h3" fill="none" ${THIN}/>`,
};

const P = `fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"`;
const coat = [
  '',
  `<path d="M11 46 Q32 50 53 46 M13 51.5 Q32 55.5 51 51.5 M17 57 Q32 60 47 57" ${P}/>`,
  `<path d="M12 48 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l4 3 M16 56 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4" ${P}/>`,
  `<path d="M11 45 H53 M12 51 H52 M16 57 H48 M20 45 V59 M26 45 V60 M32 45 V60 M38 45 V60 M44 45 V59" ${P}/>`,
];

// Darker and lighter versions of a hex colour, for lids and shading.
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// Cosmetic trinkets a creature can wear once they are unlocked.
const trinkets = {
  scarf: `<path d="M12 47 Q32 55 52 47 L51 53 Q32 61 13 53 Z" fill="#e2603f" ${S}/><path d="M44 53 l5 10 l-7 -1 Z" fill="#e2603f" ${S}/>`,
  bell: `<path d="M27 50 Q32 44 37 50 L39 57 H25 Z" fill="#ffd23f" ${S}/><circle cx="32" cy="58.5" r="2" fill="${INK}"/>`,
  flower: `<g transform="translate(49 20)"><circle cx="0" cy="-5" r="4" fill="#f4a3c0" ${THIN}/><circle cx="5" cy="-1" r="4" fill="#f4a3c0" ${THIN}/><circle cx="3" cy="5" r="4" fill="#f4a3c0" ${THIN}/><circle cx="-3" cy="5" r="4" fill="#f4a3c0" ${THIN}/><circle cx="-5" cy="-1" r="4" fill="#f4a3c0" ${THIN}/><circle r="3" fill="#ffd23f" ${THIN}/></g>`,
  feather: `<path d="M12 24 C4 14 6 4 14 0 C18 8 18 16 14 25 Z" fill="#55b3a0" ${S}/><path d="M13 22 L13 6" fill="none" ${THIN}/>`,
  star: `<path d="M32 46 l2.6 5.4 l6 .7 l-4.4 4.1 l1.2 5.9 l-5.4 -3 l-5.4 3 l1.2 -5.9 l-4.4 -4.1 l6 -.7 Z" fill="#ffd23f" ${THIN}/>`,
};

let uid = 0;

// traits: creature trait values. palette: four tint colours.
// only: draw just one slot on a blank body (used for trait icons).
// trinket: an optional cosmetic the creature wears.
export function creatureSvg(traits, palette, { size = 56, only = null, trinket = null } = {}) {
  const show = (slot) => !only || only === slot;
  const blank = '#efe6d2';
  const fill = show('tint') && traits.tint !== undefined ? palette[traits.tint] : blank;
  const clip = 'kb' + ++uid;
  const face = !only;
  return `<svg class="kin-svg" viewBox="0 0 64 72" width="${size}" height="${Math.round(size * 1.125)}" aria-hidden="true" focusable="false">
<defs><clipPath id="${clip}"><path d="${BODY}"/></clipPath></defs>
<g class="kin-body">
${show('feet') && traits.feet ? feet[traits.feet] : ''}
${show('crest') && traits.crest ? crest[traits.crest](only ? blank : shade(fill, -0.18)) : ''}
<path d="${BODY}" fill="${fill}"/>
<g clip-path="url(#${clip})">
  <path d="M60 30 C58 54 44 66 20 64 L60 70 Z" fill="${INK}" opacity="0.13"/>
  <ellipse cx="22" cy="26" rx="9" ry="6" fill="#fff" opacity="${fill === blank ? 0 : 0.22}" transform="rotate(-28 22 26)"/>
  ${show('tint') && traits.tint !== undefined ? coat[traits.tint] : ''}
</g>
<path d="${BODY}" fill="none" ${S}/>
${show('mark') && traits.mark ? mark[traits.mark] : ''}
${show('eyes') && traits.eyes ? `<g class="kin-eyes">${eyes[traits.eyes](shade(fill, -0.22))}</g>` : ''}
${trinket && trinkets[trinket] && !only ? trinkets[trinket] : ''}
${face ? `<path d="M27.5 44.5 Q32 48 36.5 44.5" fill="none" ${THIN}/><circle cx="17" cy="42" r="2.6" fill="#e2603f" opacity="0.28"/><circle cx="47" cy="42" r="2.6" fill="#e2603f" opacity="0.28"/>` : ''}
</g>
</svg>`;
}

export const TRINKET_IDS = Object.keys(trinkets);
