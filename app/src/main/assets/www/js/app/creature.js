// Placeholder creature art: one layer per trait slot, composed at runtime.
// Every trait has a shape cue, so nothing depends on colour alone
// (the coat "tint" is both a colour and a belly pattern).

const INK = '#3a2f28';
const S = `stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;

const crest = {
  tuft: `<path d="M32 17 L23 5 M32 17 L32 2 M32 17 L41 5" fill="none" ${S}/>`,
  fin: (fill) => `<path d="M19 22 L25 1 Q42 5 47 22 Z" fill="${fill}" ${S}/><path d="M28 6 L31 16 M35 7 L37 16" fill="none" ${S} stroke-width="1.5"/>`,
  horn: `<path d="M26 18 L32 1 L38 18 Z" fill="#f4ead2" ${S}/>`,
  bare: '',
};

const eyes = {
  round: [23, 41].map((x) => `<circle cx="${x}" cy="35" r="5" fill="#fff" ${S} stroke-width="2"/><circle cx="${x}" cy="35" r="2.2" fill="${INK}"/>`).join(''),
  slit: [23, 41].map((x) => `<ellipse cx="${x}" cy="35" rx="2.1" ry="6" fill="${INK}"/>`).join(''),
  wide: [21, 43].map((x) => `<circle cx="${x}" cy="35" r="7.5" fill="#fff" ${S} stroke-width="2"/><circle cx="${x}" cy="35" r="1.7" fill="${INK}"/>`).join(''),
  lidded: [23, 41]
    .map((x) => `<path d="M${x - 6} 34 h12 a6 6 0 0 1 -12 0 Z" fill="#fff" ${S} stroke-width="2"/><circle cx="${x}" cy="36.5" r="1.8" fill="${INK}"/><path d="M${x - 7} 33.5 h14" fill="none" ${S} stroke-width="3.2"/>`)
    .join(''),
};

const mark = {
  dot: `<circle cx="32" cy="22.5" r="3.4" fill="${INK}"/>`,
  stripe: `<rect x="23" y="20.5" width="18" height="4.2" rx="2.1" fill="${INK}"/>`,
  ring: `<circle cx="32" cy="22.5" r="3.6" fill="none" ${S} stroke-width="2"/>`,
  none: '',
};

const feet = {
  paws: [22, 42].map((x) => `<ellipse cx="${x}" cy="65" rx="7.5" ry="4.5" fill="#f4ead2" ${S}/>`).join(''),
  hooves: [16, 34].map((x) => `<path d="M${x} 69 L${x + 3} 58 L${x + 11} 58 L${x + 14} 69 Z" fill="${INK}" ${S}/>`).join(''),
  webs: [12, 34].map((x) => `<path d="M${x} 69 L${x + 9} 57 L${x + 18} 69 Z" fill="#e9a23b" ${S}/><path d="M${x + 9} 59 L${x + 9} 68" fill="none" ${S} stroke-width="1.4"/>`).join(''),
  roller: `<circle cx="32" cy="64" r="7.5" fill="#9a9288" ${S}/><circle cx="32" cy="64" r="2.3" fill="${INK}"/>`,
};

const P = `fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"`;
const coat = [
  '',
  `<path d="M12 45 H52 M13 50 H51 M16 55 H48" ${P}/>`,
  `<path d="M13 47 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l5 4 l5 -4 l3 3 M16 55 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4 l4 -4 l4 4" ${P}/>`,
  `<path d="M12 44 H52 M13 50 H51 M16 56 H48 M20 44 V58 M26 44 V60 M32 44 V60 M38 44 V60 M44 44 V58" ${P}/>`,
];

let uid = 0;

// traits: creature trait values. palette: four tint colours.
// only: draw just one slot on a blank body (used for trait icons).
export function creatureSvg(traits, palette, { size = 56, only = null } = {}) {
  const show = (slot) => !only || only === slot;
  const fill = show('tint') ? palette[traits.tint] : '#efe7d6';
  const clip = 'kb' + ++uid;
  const finArt = typeof crest[traits.crest] === 'function' ? crest[traits.crest](fill) : crest[traits.crest];
  return `<svg class="kin-svg" viewBox="0 0 64 72" width="${size}" height="${Math.round(size * 1.125)}" aria-hidden="true" focusable="false">
<defs><clipPath id="${clip}"><ellipse cx="32" cy="38" rx="22" ry="21"/></clipPath></defs>
${show('feet') ? feet[traits.feet] : ''}
${show('crest') ? finArt : ''}
<ellipse cx="32" cy="38" rx="23" ry="22" fill="${fill}" ${S}/>
<g clip-path="url(#${clip})">${show('tint') ? coat[traits.tint] : ''}</g>
${show('mark') ? mark[traits.mark] : ''}
${show('eyes') ? eyes[traits.eyes] : ''}
</svg>`;
}
