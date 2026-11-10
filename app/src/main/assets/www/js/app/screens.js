// Screens. Pure functions from app state to HTML; they own no game state.
// Interaction is wired by data-act attributes handled in main.js.

import { creatureSvg } from './creature.js';
import { blob } from './art/paint.js';
import { queueBoard, foldBoard } from './extras.js';
import { family } from '../core/families.js';
import { decodeCombo, comboCount } from '../core/traits.js';
import { HOME, countStatus, legDef, branchDef, puzzleDef, readyAt, strandedAt, friendsFor, canFreeRescue, sharedTraits, unlockedTrinkets } from '../core/game.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const btn = (act, label, cls = '', attrs = '') => `<button class="btn ${cls}" data-act="${act}" ${attrs}>${esc(label)}</button>`;

function kinName(a, c) {
  if (c.guide) return a.t('creature.guide');
  return c.nickname || a.t('creature.unnamed', { n: Number(c.id.slice(2)) });
}

function traitWords(a, c) {
  return a.content.traits.slots.map((s) => {
    const v = a.t(`${s.id}.${c.traits[s.id]}`);
    return ['crest', 'eyes', 'feet'].includes(s.id) ? `${v} ${a.t('slot.' + s.id)}` : v;
  });
}

export function kin(a, c, { size = 52, cls = '', act = 'inspect', extra = '', pressed = null } = {}) {
  const label = a.t('creature.label', { name: kinName(a, c), traits: traitWords(a, c).join(', ') });
  return `<button class="kin ${cls}" data-act="${act}" data-id="${c.id}" aria-label="${esc(label)}"${pressed === null ? '' : ` aria-pressed="${pressed}"`}>
${creatureSvg(c.traits, a.palette, { size, trinket: c.trinket })}${c.favourite ? '<span class="fav" aria-hidden="true">★</span>' : ''}${extra}</button>`;
}

// Roster creatures, or the trail guides of the current Stop.
function byId(a, id) {
  const p = a.profile;
  const c = p.roster.find((x) => x.id === id);
  if (c) return c;
  if (p.stop && p.stop.examples[id]) return { id, traits: p.stop.examples[id], guide: true };
  return null;
}

const homePill = (a) => `<span class="pill">${esc(a.t('map.home', { d: countStatus(a.profile, 'delivered'), t: a.profile.roster.length }))}</span>`;

function filterSelects(a) {
  return a.content.traits.slots
    .map((s) => {
      const cur = a.ui.filter[s.id];
      return `<select data-change="filter" data-slot="${s.id}" aria-label="${esc(a.t('party.filter'))} ${esc(a.t('slot.' + s.id))}">
        <option value="">${esc(a.t('party.any', { slot: a.t('slot.' + s.id) }))}</option>
        ${s.values.map((v) => `<option value="${v}" ${cur === String(v) ? 'selected' : ''}>${esc(a.t(`${s.id}.${v}`))}</option>`).join('')}</select>`;
    })
    .join('');
}
const matchesFilter = (a, traits) => Object.keys(a.ui.filter).every((slot) => String(traits[slot]) === a.ui.filter[slot]);

// ---- App-level views ----------------------------------------------------

export function titleView(a) {
  const demo = [
    { crest: 'tuft', eyes: 'wide', mark: 'none', feet: 'paws', tint: 0 },
    { crest: 'horn', eyes: 'lidded', mark: 'ring', feet: 'roller', tint: 2 },
    { crest: 'fin', eyes: 'round', mark: 'stripe', feet: 'webs', tint: 1 },
  ];
  const any = a.slots.some((s) => s && s.profile);
  return `<main class="screen title">
  <div class="title-art">${demo.map((d) => creatureSvg(d, a.palette, { size: 84 })).join('')}</div>
  <h1 class="logo">${esc(a.t('app.title'))}</h1>
  <p class="tagline">${esc(a.t('app.tagline'))}</p>
  <div class="actions col">
    ${any ? btn('title-continue', a.t('title.continue'), 'primary') : ''}
    ${btn('title-new', a.t('title.new'), any ? '' : 'primary')}
    <div class="actions inner">${btn('open-daily', a.t('title.daily'))}${btn('open-book', a.t('title.book'))}</div>
    <div class="actions inner">${btn('open-practice', a.t('title.practice'))}${btn('open-settings', a.t('title.settings'))}</div>
    <div class="actions inner">${btn('open-credits', a.t('title.credits'), 'quiet')}</div>
  </div></main>`;
}

export function slotsView(a) {
  const cards = a.slots
    .map((s, i) => {
      const n = i + 1;
      const name = a.t('slots.slot', { n });
      if (!s) {
        if (a.ui.slotsMode === 'continue') return '';
        return `<button class="card slot" data-act="slot-new" data-slot="${n}"><b>${esc(name)}</b><span>${esc(a.t('slots.empty'))}</span></button>`;
      }
      if (s.error) {
        return `<div class="card slot"><b>${esc(name)}</b><span>${esc(a.t(s.error === 'future' ? 'slots.future' : 'slots.broken'))}</span>
          ${s.error === 'future' ? '' : btn('slot-delete', a.t('slots.delete'), 'quiet', `data-slot="${n}"`)}</div>`;
      }
      const meta = a.t('slots.delivered', { d: countStatus(s.profile, 'delivered'), t: s.profile.roster.length });
      const main = a.ui.slotsMode === 'continue' ? 'slot-open' : 'slot-new';
      return `<div class="card slot"><button class="slot-main" data-act="${main}" data-slot="${n}"><b>${esc(name)}</b><span>${esc(meta)}</span></button>
        ${btn('slot-delete', a.t('slots.delete'), 'quiet', `data-slot="${n}"`)}</div>`;
    })
    .join('');
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('slots.pick'))}</h2></header>
  <div class="body col">${cards}</div>
  <div class="actions">${btn('to-title', a.t('common.back'))}</div></main>`;
}

export function creditsView(a) {
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('title.credits'))}</h2></header>
  <div class="body"><p>${esc(a.t('credits.body'))}</p></div>
  <div class="actions">${btn('to-title', a.t('common.back'))}</div></main>`;
}

export function settingsView(a) {
  const s = a.settings;
  const toggle = (key) => `<label class="row"><span>${esc(a.t('settings.' + key))}</span>
    <input type="checkbox" class="switch" data-change="setting" data-key="${key}" ${s[key] ? 'checked' : ''}></label>`;
  const sizes = [1, 1.3, 1.6, 2];
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('settings.title'))}</h2></header>
  <div class="body col">
    ${toggle('audio')}${toggle('music')}${toggle('haptics')}${toggle('reducedMotion')}${toggle('colourSafe')}${toggle('assist')}
    <small>${esc(a.t('settings.assistNote'))}</small>
    <label class="row"><span>${esc(a.t('settings.textSize'))}</span>
      <select data-change="setting" data-key="textSize">${sizes.map((z) => `<option value="${z}" ${s.textSize === z ? 'selected' : ''}>${Math.round(z * 100)}%</option>`).join('')}</select></label>
    <label class="row"><span>${esc(a.t('settings.language'))}</span>
      <select data-change="setting" data-key="language">${a.languages.map((l) => `<option value="${l}" ${s.language === l ? 'selected' : ''}>${esc(a.t('lang.' + l))}</option>`).join('')}</select></label>
  </div>
  <div class="actions">${btn('open-record', a.t('record.title'))}${btn('settings-back', a.t('common.back'), 'primary')}</div></main>`;
}

// Collection Book: every trait combination met so far, across all Trails.
export function bookView(a) {
  const total = comboCount(a.content.traits);
  const found = [...a.book].sort((x, y) => x - y).map((n) => decodeCombo(a.content.traits, n));
  const shown = found.filter((traits) => matchesFilter(a, traits));
  const LIMIT = 96;
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('book.title'))}</h2>
    <span class="pill">${esc(a.t('book.count', { n: found.length, t: total }))}</span></header>
  <div class="body"><p>${esc(a.t('book.body'))}</p>
    <div class="filters">${filterSelects(a)}</div>
    ${shown.length ? `<div class="grid">${shown.slice(0, LIMIT).map((traits) => `<span class="kin" role="img" aria-label="${esc(traitWords(a, { traits }).join(', '))}">${creatureSvg(traits, a.palette, { size: 44 })}</span>`).join('')}</div>` : `<p>${esc(a.t('book.none'))}</p>`}
    ${shown.length > LIMIT ? `<p class="meta">${esc(a.t('book.more', { n: shown.length - LIMIT }))}</p>` : ''}
  </div>
  <div class="actions">${btn('to-title', a.t('common.back'), 'primary')}</div></main>`;
}

// ---- Game screens ---------------------------------------------------------

function rosterScreen(a) {
  const p = a.profile;
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('roster.title'))}</h2></header>
  <div class="body"><p>${esc(a.t('story.intro'))}</p><p>${esc(a.t('roster.body', { n: p.roster.length }))}</p>${p.options.hardTrail ? `<p class="warn">${esc(a.t('newtrail.hardOn'))}</p>` : ''}
  <div class="grid">${p.roster.map((c) => kin(a, c)).join('')}</div></div>
  <div class="actions">${btn('reroll', a.t('roster.reroll'))}${btn('roster-ok', a.t('roster.accept'), 'primary')}</div></main>`;
}

// Long names are squeezed to fit rather than clipped or overlapping.
const fit = (text, max, px) => (text.length * px * 0.6 > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '');

// Little inked landmarks for the map, by the kind of landmark a biome has.
const TENTS = ['#e9b65a', '#7fb6a0', '#d98a6a'];
const DOODLE = {
  tree: 'M0 0 v-9 M-7 -9 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0',
  mesa: 'M-10 0 v-12 h8 v-6 h8 v18 Z',
  pine: 'M-11 0 L-2 -16 L3 -8 L7 -13 L13 0 Z M-5 -10 l3 3 l3 -3',
};

function mapSvg(a) {
  const p = a.profile;
  const legs = a.content.trail.legs;
  const ROW = 46;
  const rows = legs.reduce((n, leg) => n + leg.branches[0].stops.length + 1, 1);
  const H = rows * ROW + 24;
  const y = (row) => H - 34 - row * ROW;
  let row = 0;
  let out = '';
  const campNode = (camp, r) => {
    const ready = readyAt(p, camp).length;
    const lost = strandedAt(p, camp).length;
    const home = camp === legs.length;
    const n = home ? countStatus(p, 'delivered') : ready;
    const label = `${a.loc(a.content.trail.camps[camp])}: ${n}${lost ? `, ${a.t('map.strandedN', { n: lost })}` : ''}`;
    const cy = y(r);
    const name = a.loc(a.content.trail.camps[camp]);
    // A flag marks a camp that a full party has reached.
    const flag = camp > 0 && p.legs[legs[camp - 1].id].fullParties > 0;
    return `<g class="campnode ${p.camp === camp ? 'on' : ''}" data-act="select-camp" data-camp="${camp}" role="button" tabindex="0" aria-label="${esc(label)}" aria-pressed="${p.camp === camp}">
      <rect x="14" y="${cy - 22}" width="272" height="44" rx="12" class="camphit"/>
      ${home
        ? `<path d="M27 ${cy + 13} v-14 q14 -20 28 0 v14 Z" class="node camp" style="--tent:#f4e6c4"/><path d="M23 ${cy - 1} q18 -26 36 0 Z" class="node camp" style="--tent:#d9634a"/><path d="M37 ${cy + 13} v-8 a4 4 0 0 1 8 0 v8 Z" class="door"/>`
        : `<path d="M24 ${cy + 13} l17 -29 l17 29 Z" class="node camp" style="--tent:${TENTS[camp % TENTS.length]}"/><path d="M36 ${cy + 13} l5 -12 l5 12 Z" class="door"/>`}
      ${flag ? `<path d="M41 ${cy - 16} v-15 l13 5 l-13 5" class="flag"/>` : ''}
      <text x="66" y="${cy + 5}" class="node-t"${fit(name, 150, 14)}>${esc(name)}</text>
      <circle cx="262" cy="${cy}" r="15" class="count"/><text x="262" y="${cy + 5}" text-anchor="middle" class="count-n">${n}</text>
      ${lost ? `<text x="234" y="${cy + 6}" text-anchor="middle" class="lost-n">!</text>` : ''}
    </g>`;
  };
  let camps = campNode(0, 0);
  let paths = '';
  let land = '';
  legs.forEach((leg, li) => {
    const start = row;
    const end = row + leg.branches[0].stops.length + 1;
    // Each leg's country: a wash of its colour and a few inked landmarks.
    const mid = (y(start) + y(end)) / 2;
    land += `<path d="${blob(li + 3, 150, mid, 150, (y(start) - y(end)) / 2 + 6, 10, 0.1)}" fill="${a.content.theme.themes[leg.theme].map}" class="biome"/>`;
    for (let k = 0; k < 4; k++) {
      const dx = k % 2 ? 268 : 22;
      const dy = y(start) - 34 - Math.floor(k / 2) * 66 - (k % 2) * 24;
      land += `<path d="${DOODLE[a.content.theme.themes[leg.theme].scene.landmark] || DOODLE.tree}" class="doodle" transform="translate(${dx} ${dy})"/>`;
    }
    leg.branches.forEach((br, bi) => {
      const x = leg.branches.length === 1 ? 150 : bi === 0 ? 78 : 222;
      const pts = [[150, y(start) - 18], ...br.stops.map((_, si) => [x + (leg.branches.length === 1 ? (si % 2 ? 22 : -22) : 0), y(start + 1 + si)]), [150, y(end) + 18]];
      paths += `<path d="${pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join(' ')}" class="trailpath"/>`;
      br.stops.forEach((id, si) => {
        const [sx, sy] = pts[si + 1];
        out += `<circle cx="${sx}" cy="${sy}" r="13" class="node"/><text x="${sx}" y="${sy + 5}" text-anchor="middle" class="node-n">${si + 1}</text>`;
      });
      if (leg.branches.length > 1) {
        // Branch names sit in the gap between the two paths, on different rows.
        const [sx, sy] = pts[bi === 0 ? 3 : 1];
        const name = a.loc(br.name);
        out += `<text x="${bi === 0 ? sx + 20 : sx - 20}" y="${sy + 4}" text-anchor="${bi === 0 ? 'start' : 'end'}" class="node-t small"${fit(name, 100, 12)}>${esc(name)}</text>`;
      }
    });
    if (leg.branches.length === 1) out += `<text x="150" y="${y(start + 2) - 20}" text-anchor="middle" class="node-t small">${esc(a.loc(leg.name))}</text>`;
    row = end;
    camps += campNode(li + 1, row);
  });
  return `<svg class="map" viewBox="0 0 300 ${H}" style="aspect-ratio:300/${H}" role="group" aria-label="${esc(a.t('map.title'))}">${land}${paths}${out}${camps}</svg>`;
}

function mapScreen(a) {
  const p = a.profile;
  const home = HOME(a.content);
  const leg = a.content.trail.legs[p.camp];
  const ready = readyAt(p, p.camp).length;
  const lost = strandedAt(p, p.camp).length;
  let legCard = '';
  if (leg) {
    const ls = p.legs[leg.id];
    const tiers = a.content.puzzles.tierOrder
      .map((tier) => `<button class="seg ${ls.tier === tier ? 'on' : ''}" data-act="set-tier" data-tier="${tier}" aria-pressed="${ls.tier === tier}">${esc(a.t('tier.' + tier))}</button>`)
      .join('');
    const order = a.content.puzzles.tierOrder;
    const suggest =
      p.assist.suggest === leg.id && order.indexOf(ls.tier) < order.length - 1
        ? `<div class="suggest"><span>${esc(a.t('assist.tierUp', { tier: a.t('tier.' + order[order.indexOf(ls.tier) + 1]) }))}</span>
            ${btn('suggest-yes', a.t('common.yes'), 'small')}${btn('suggest-no', a.t('assist.noThanks'), 'small quiet')}</div>`
        : '';
    legCard = `<b>${esc(a.t('map.next', { leg: a.loc(leg.name) }))}</b><div class="segs" role="group" aria-label="${esc(a.t('map.tier'))}">${tiers}</div>${suggest}`;
  }
  const where = `${a.loc(a.content.trail.camps[p.camp])} · ${p.camp === home ? a.t('map.homeN', { n: countStatus(p, 'delivered') }) : a.t('map.waiting', { n: ready })}${lost ? ` · ${a.t('map.strandedN', { n: lost })}` : ''}`;
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('map.title'))}</h2>${homePill(a)}</header>
  <div class="body mapbody">${mapSvg(a)}</div>
  <div class="actions col">
    <div class="card campcard"><span>${esc(where)} · ${esc(a.t('map.hints', { n: p.hintTokens }))}</span>${legCard}</div>
    <div class="actions inner">${leg ? btn('goto', a.t('map.pickParty'), 'primary', `data-screen="party" ${ready ? '' : 'disabled'}`) : ''}${btn('goto', a.t('map.camp'), leg ? '' : 'primary', 'data-screen="camp"')}</div>
    <div class="actions inner">${btn('goto', a.t('map.goals'), 'quiet', 'data-screen="goals"')}${btn('end-trail', a.t('map.end'), 'quiet')}${btn('to-title', a.t('pause.quit'), 'quiet')}</div>
  </div></main>`;
}

export function filteredAvailable(a) {
  return readyAt(a.profile, a.profile.camp).filter((c) => matchesFilter(a, c.traits));
}

function partyScreen(a) {
  const p = a.profile;
  const max = a.content.traits.partyMax;
  const leg = a.content.trail.legs[p.camp];
  const list = filteredAvailable(a);
  const go = leg.branches
    .map((br) => btn('start-leg', leg.branches.length === 1 ? a.t('party.go') : a.t('party.goBranch', { branch: a.loc(br.name) }), 'primary', `data-branch="${br.id}" ${p.selection.length ? '' : 'disabled'}`))
    .join('');
  return `<main class="screen"><header class="bar"><div><h2>${esc(a.t('party.title'))}</h2><small>${esc(a.loc(leg.name))} · ${esc(a.t('tier.' + p.legs[leg.id].tier))}</small></div>
    <span class="pill">${esc(a.t('party.count', { n: p.selection.length, max }))}</span></header>
  <div class="body">
    <div class="filters">${filterSelects(a)}</div>
    ${list.length ? `<div class="grid">${list.map((c) => kin(a, c, { act: 'party-toggle', cls: p.selection.includes(c.id) ? 'picked' : '', pressed: p.selection.includes(c.id) })).join('')}</div>` : `<p>${esc(a.t('party.none'))}</p>`}
    ${leg.branches.length > 1 ? `<p class="meta">${esc(a.t('party.fork'))}</p>` : ''}
  </div>
  <div class="actions">${btn('goto', a.t('common.back'), '', 'data-screen="map"')}${btn('party-fill', a.t('party.auto'))}${btn('party-clear', a.t('party.clear'))}</div>
  <div class="actions tight">${go}</div></main>`;
}

// ---- Stop boards: one layout per kind of puzzle ----------------------------

const ARROWS = { '0,1': '→', '0,-1': '←', '1,0': '↓', '-1,0': '↑', '1,1': '↘', '1,-1': '↙', '-1,1': '↗', '-1,-1': '↖' };
const GLYPHS = ['◆', '☽', '✚', '≋'];
const LINK_NAMES = ['A', 'B', 'C', 'D'];

function bounceTag(fb, target, def) {
  if ('rowOk' in fb) {
    if (def.params.rows === 2 && def.params.cols === 2) {
      // In a 2x2 field a miss says exactly where the creature belongs.
      const dr = fb.rowOk ? 0 : target.row === 0 ? 1 : -1;
      const dc = fb.colOk ? 0 : target.col === 0 ? 1 : -1;
      return ARROWS[`${dr},${dc}`];
    }
    return fb.rowOk ? '↔' : fb.colOk ? '↕' : '✕';
  }
  if ('at' in fb) return fb.at === 0 ? '①' : '②';
  if ('dir' in fb) return fb.dir < 0 ? '←' : '→';
  if ('cell' in fb) return '●';
  return '✕';
}

const miniOf = (a, id, extra = '', cls = '', size = 30) => kin(a, byId(a, id), { size, cls: 'mini ' + cls, extra });
const moves = (stop) => stop.observations.filter((o) => !o.guide);

// Sorting Stops: a row or grid of targets, each showing who is in and who bounced.
function sortBoard(a, stop, def, fam) {
  const targets = fam.targets(def, stop);
  const kind = stop.family;
  const grid = kind === 'pattern_grid' || kind === 'toss_plot';
  const cols = grid ? (kind === 'toss_plot' ? 4 : def.params.cols) : targets.length;
  const dense = targets.length > 4;
  const label = (tg, i) =>
    grid ? a.t('target.cell', { r: tg.row + 1, c: tg.col + 1 }) : ['tour_path', 'rank_line', 'totem_match'].includes(kind) ? a.t(tg.label, { n: i + 1 }) : a.t(tg.label);
  const boxes = targets
    .map((tg, i) => {
      const guides = stop.observations.filter((o) => o.guide && o.action.target === tg.id).map((o) => o.action.id);
      const inside = Object.keys(stop.placed).filter((id) => stop.placed[id] === tg.id);
      // A tossed creature is shown on the patch where it landed.
      const bounced = moves(stop).filter((o) => !o.fb.ok && (o.fb.cell || o.action.target) === tg.id);
      const size = dense ? 26 : 30;
      const head = kind === 'totem_match' ? `<b class="glyph" aria-hidden="true">${GLYPHS[i]}</b>` : `<b>${grid ? '' : esc(label(tg, i))}</b>`;
      return `<div class="target ${kind} ${dense ? 'dense' : ''}" role="button" tabindex="0" data-act="target" data-target="${tg.id}" aria-label="${esc(label(tg, i))}">
        <div class="target-head">${head}<span class="tally">${inside.length}</span></div>
        <div class="minis" aria-label="${esc(a.t('stop.in'))}">${guides.map((id) => miniOf(a, id, '', 'guide', size)).join('')}${inside.map((id) => miniOf(a, id, '', 'yes', size)).join('')}</div>
        ${bounced.length ? `<div class="minis bounced" aria-label="${esc(a.t('stop.bounced'))}">${bounced.map((o) => miniOf(a, o.action.id, `<span class="tag" aria-hidden="true">${bounceTag(o.fb, tg, def)}</span>`, 'no', size)).join('')}</div>` : ''}
      </div>`;
    })
    .join('');
  const art =
    kind === 'tour_path'
      ? `<svg class="forks" viewBox="0 0 400 64" aria-hidden="true">
  <path d="M200 62 L100 34 L50 4 M100 34 L150 4 M200 62 L300 34 L250 4 M300 34 L350 4" class="trailpath thin"/>
  <circle cx="200" cy="54" r="11" class="node"/><text x="200" y="59" text-anchor="middle" class="node-n">1</text>
  <circle cx="100" cy="34" r="11" class="node"/><text x="100" y="39" text-anchor="middle" class="node-n">2</text>
  <circle cx="300" cy="34" r="11" class="node"/><text x="300" y="39" text-anchor="middle" class="node-n">2</text></svg>`
      : kind === 'rank_line'
        ? `<p class="meta ends"><span>${esc(a.t('stop.front'))}</span><span>${esc(a.t('stop.back'))}</span></p>`
        : '';
  return `${kind === 'rank_line' ? art : ''}<div class="targets n${cols}">${boxes}</div>${kind === 'tour_path' ? art : ''}`;
}

// Seating Stops: a grid of seats with links between some neighbours.
function seatBoard(a, stop) {
  const { seats, cols, edges } = stop.setup;
  const last = moves(stop).slice(-1)[0];
  const bad = last && !last.fb.ok ? last.fb.bad : [];
  const link = (i, j, dir) => {
    const e = edges.findIndex(([x, y]) => x === i && y === j);
    if (e < 0) return `<span class="link none ${dir}"></span>`;
    const kind = edges[e][2];
    return `<span class="link ${dir} k${kind} ${bad.includes(e) ? 'bad' : ''}" role="img" aria-label="${esc(a.t('stop.link', { kind: LINK_NAMES[kind] }))}">${stop.setup.kinds > 1 ? LINK_NAMES[kind] : ''}</span>`;
  };
  let html = '';
  for (let r = 0; r * cols < seats; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= seats) {
        html += '<span></span>' + (c < cols - 1 ? '<span></span>' : '');
        continue;
      }
      const id = stop.extra.seats[i];
      const who = id ? byId(a, id) : null;
      const label = `${a.t('target.seat', { n: i + 1 })}${who ? ': ' + (who.nickname || a.t('creature.unnamed', { n: Number(id.slice(2)) })) : ''}`;
      html += `<div class="seat ${who ? 'taken' : ''}" role="button" tabindex="0" data-act="target" data-target="s${i}" aria-label="${esc(label)}">${who ? creatureSvg(who.traits, a.palette, { size: 40 }) : ''}</div>`;
      if (c < cols - 1) html += i + 1 < seats ? link(i, i + 1, 'h') : '<span></span>';
    }
    if ((r + 1) * cols < seats) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        html += (i + cols < seats ? link(i, i + cols, 'v') : '<span></span>') + (c < cols - 1 ? '<span></span>' : '');
      }
    }
  }
  return `<div class="seats">${html}</div>`;
}

// Trail foods, drawn as simple shapes.
const FOODS = {
  berry: '<circle cx="12" cy="13" r="7"/><path d="M12 6 L14 2"/>',
  nut: '<path d="M12 3 L20 12 L12 21 L4 12 Z"/>',
  leaf: '<path d="M4 20 Q4 5 20 4 Q19 19 4 20 Z M4 20 L14 10"/>',
  root: '<path d="M7 4 H17 L12 22 Z M9 9 H15"/>',
  seed: '<ellipse cx="12" cy="12" rx="5" ry="8.5"/>',
  cone: '<path d="M12 2 L20 21 H4 Z M8 12 H16 M6.5 16.5 H17.5"/>',
};
const food = (id, size = 26) => `<svg class="food" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${FOODS[id]}</svg>`;

// A stall keeper: a mossy, hatted lump who brightens up once fed.
const KEEPER_COATS = ['#8fae7a', '#c9a66b', '#9a8fc0'];
function keeperArt(n, fed) {
  const c = KEEPER_COATS[n % KEEPER_COATS.length];
  const ink = 'stroke="#33291f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="keeper-art" viewBox="0 0 64 56" aria-hidden="true">
    <path d="M8 54 C4 34 14 18 32 18 C50 18 60 34 56 54 Z" fill="${c}" ${ink}/>
    <path d="M12 22 Q32 ${10 - n * 2} 52 22 Q32 28 12 22 Z" fill="#6b4a2f" ${ink}/><path d="M22 18 Q32 ${-2 + n * 3} 42 18 Z" fill="#8a5a2e" ${ink}/>
    <circle cx="24" cy="34" r="4.5" fill="#fffdf6" ${ink}/><circle cx="40" cy="34" r="4.5" fill="#fffdf6" ${ink}/><circle cx="${fed ? 24 : 25}" cy="${fed ? 34 : 35}" r="1.9" fill="#33291f"/><circle cx="${fed ? 40 : 41}" cy="${fed ? 34 : 35}" r="1.9" fill="#33291f"/>
    <path d="${fed ? 'M24 43 Q32 50 40 43' : 'M26 45 Q32 42 38 45'}" fill="none" ${ink}/>
  </svg>`;
}

function tradeBoard(a, stop, def, fam) {
  const { items } = stop.setup;
  const set = (mask) => items.filter((_, i) => mask & (1 << i));
  const keepers = fam
    .targets(def, stop)
    .map((tg) => {
      const fed = stop.extra.fed[tg.n];
      const rows = stop.observations
        .filter((o) => o.action.keeper === tg.n)
        .map((o) => `<div class="offer ${o.fb.ok ? 'yes' : o.fb.kind}">${set(o.action.items).map((id) => food(id, 20)).join('')}<b aria-label="${esc(a.t(o.fb.ok ? 'stop.accepted' : o.fb.kind === 'bad' ? 'stop.tradeBad' : 'stop.tradeMore'))}">${o.fb.ok ? '✓' : o.fb.kind === 'bad' ? '✕' : '+'}</b></div>`)
        .join('');
      return `<div class="target keeper ${fed ? 'fed' : ''}" role="button" tabindex="0" data-act="keeper" data-target="${tg.id}" data-keeper="${tg.n}" aria-label="${esc(a.t('target.keeper', { n: tg.n + 1 }))}">
        <div class="target-head">${keeperArt(tg.n, fed)}<b>${esc(a.t('target.keeper', { n: tg.n + 1 }))}</b><span class="tally">${fed ? '✓' : '?'}</span></div>${rows}</div>`;
    })
    .join('');
  const chips = items
    .map((id, i) => `<button class="chip ${a.ui.basket & (1 << i) ? 'on' : ''}" data-act="item" data-item="${i}" aria-pressed="${!!(a.ui.basket & (1 << i))}">${food(id)}<span>${esc(a.t('item.' + id))}</span></button>`)
    .join('');
  return `<div class="targets n${stop.setup.keepers}">${keepers}</div>
    <div class="basket" data-drag="basket" aria-label="${esc(a.t('stop.basket'))}"><b>${esc(a.t('stop.basket'))}</b>${a.ui.basket ? set(a.ui.basket).map((id) => food(id, 24)).join('') : `<span class="meta">${esc(a.t('stop.basketEmpty'))}</span>`}</div>
    <div class="chips">${chips}</div>`;
}

function signalBoard(a, stop) {
  const fam = family('signal_guess');
  if (stop.status !== 'playing') return '';
  const want = byId(a, fam.truth(stop));
  const carved = fam.carved(stop);
  const slots = a.content.traits.slots.map((s) => s.id);
  const tries = stop.observations
    .filter((o) => o.pre.round === stop.extra.round && !o.fb.ok)
    .map((o) => {
      const marks = stop.setup.grade === 'count' ? `<b>${esc(a.t('stop.matches', { n: o.fb.marks }))}</b>` : [...o.fb.marks].map((m, i) => `<i class="mark ${m === '1' ? 'hit' : ''}" role="img" aria-label="${esc(a.t('slot.' + slots[i]))}: ${esc(a.t(m === '1' ? 'stop.same' : 'stop.differs'))}">${m === '1' ? '●' : '○'}</i>`).join('');
      return `<div class="try">${miniOf(a, o.action.id)}<span class="marks">${marks}</span></div>`;
    })
    .join('');
  return `<div class="target stone" role="button" tabindex="0" data-act="target" data-target="stone" aria-label="${esc(a.t('target.stone'))}">
    <div class="target-head"><b>${esc(a.t('stop.signalOf', { n: stop.extra.round + 1, t: stop.setup.rounds }))}</b></div>
    <div class="carved">${carved.length ? carved.map((s) => `<span>${creatureSvg(want.traits, a.palette, { size: 40, only: s })}<small>${esc(a.t(`${s}.${want.traits[s]}`))}</small></span>`).join('') : `<span class="meta">${esc(a.t('stop.nothingCarved'))}</span>`}</div>
    ${stop.setup.grade === 'count' ? '' : `<small class="meta">${esc(slots.map((s) => a.t('slot.' + s)).join(' · '))}</small>`}
    ${tries}</div>`;
}

function keyTraits(a, key) {
  const parts = key.split(',');
  const out = {};
  a.content.traits.slots.forEach((s, i) => (out[s.id] = s.values.find((v) => String(v) === parts[i])));
  return out;
}

function echoBoard(a, stop) {
  const fam = family('echo_match');
  const now = fam.current(stop);
  const shown = now ? fam.reflect(stop.hyp, byId(a, now).traits, a.content.traits) : null;
  const pairs = stop.observations
    .map((o) => {
      const refl = keyTraits(a, o.fb.ok ? o.pre.shown : o.fb.refl);
      return `<div class="pair">${miniOf(a, o.action.id, '', o.guide ? 'guide' : '')}<span aria-hidden="true">→</span><span class="refl" role="img" aria-label="${esc(traitWords(a, { traits: refl }).join(', '))}">${creatureSvg(refl, a.palette, { size: 30 })}</span></div>`;
    })
    .join('');
  const pond = shown
    ? `<div class="target pond" role="button" tabindex="0" data-act="target" data-target="pond" aria-label="${esc(a.t('target.pond'))}: ${esc(traitWords(a, { traits: shown }).join(', '))}">
    <div class="target-head"><b>${esc(a.t('stop.whose'))}</b></div>
    <div class="refl big">${creatureSvg(shown, a.palette, { size: 88 })}</div></div>`
    : '';
  return `${pond}
    <div class="pairs" aria-label="${esc(a.t('stop.seen'))}">${pairs}</div>`;
}

function switchBoard(a, stop, def, fam) {
  const dirs = a.ui.dirs;
  const sheds = fam
    .targets(def, stop)
    .map((tg) => {
      const inside = Object.keys(stop.placed).filter((id) => stop.placed[id] === tg.id);
      const tint = stop.setup.sheds[tg.n];
      return `<div class="target shed" aria-label="${esc(a.t('target.shed', { n: tg.n + 1 }))}: ${esc(a.t('tint.' + tint))}">
        <div class="target-head"><b>${tg.n + 1}</b>${creatureSvg({ tint }, a.palette, { size: 34, only: 'tint' })}<span class="tally">${inside.length}</span></div>
        <div class="minis">${inside.map((id) => miniOf(a, id, '', 'yes', 24)).join('')}</div></div>`;
    })
    .join('');
  const sw = (j) => {
    const atom = stop.setup.triggers[j] || (stop.extra.known.includes(j) ? stop.hyp[j] : null);
    const trig = atom ? creatureSvg({ [atom.slot]: atom.value }, a.palette, { size: 30, only: atom.slot }) : '<b class="unknown">?</b>';
    const label = `${a.t('stop.switch', { n: j + 1 })}: ${a.t(dirs[j] ? 'stop.right' : 'stop.left')}. ${atom ? a.t('stop.flipsFor', { rule: a.t(`${atom.slot}.${atom.value}`) }) : a.t('stop.flipsHidden')}`;
    return `<button class="switch-btn" data-act="switch" data-switch="${j}" aria-label="${esc(label)}"><span class="arrow" aria-hidden="true">${dirs[j] ? '↗' : '↖'}</span>${trig}</button>`;
  };
  const need = stop.queue.length > stop.setup.size ? stop.setup.size : null;
  const ready = need ? a.ui.convoy.length === need : a.ui.convoy.length >= 1;
  // Earlier guide convoys stay visible, with the player's two latest launches.
  const runs = stop.observations
    .filter((o) => o.guide)
    .concat(moves(stop).slice(-2))
    .map((o) => `<div class="run">${o.action.dirs.map((d) => (d ? '↗' : '↖')).join('')} ${o.action.convoy.map((id, i) => miniOf(a, id, `<span class="tag share" aria-hidden="true">${o.fb.exits[i] + 1}</span>`, o.guide ? 'guide' : '', 24)).join('')}</div>`)
    .join('');
  return `<div class="targets n4">${sheds}</div>
    <div class="rails"><div class="rail-row">${sw(1)}${sw(2)}</div><div class="rail-row">${sw(0)}</div></div>
    <div class="target rail" role="button" tabindex="0" data-act="target" data-target="rail" aria-label="${esc(a.t('stop.convoy'))}">
      <b>${esc(need ? a.t('stop.convoyOf', { n: need }) : a.t('stop.convoy'))}</b>
      <div class="minis">${a.ui.convoy.map((id, i) => miniOf(a, id, `<span class="tag share" aria-hidden="true">${i + 1}</span>`)).join('')}</div>
      ${btn('launch', a.t('stop.send'), 'primary small', ready ? '' : 'disabled')}</div>
    <div class="runs" aria-label="${esc(a.t('stop.seen'))}">${runs}</div>`;
}

const BOARDS = { sort: sortBoard, seat: seatBoard, trade_ledger: tradeBoard, signal_guess: signalBoard, echo_match: echoBoard, switch_run: switchBoard, queue_route: queueBoard, fold_sequence: foldBoard };

function stopScreen(a) {
  const p = a.profile;
  const stop = p.stop;
  const def = puzzleDef(a.content, stop.puzzleId);
  const fam = family(stop.family);
  const max = def.tiers[stop.tier].patience;
  const pips = Array.from({ length: max }, (_, i) => `<i class="pip ${i < stop.patience ? 'on' : ''}"></i>`).join('');
  const board = (BOARDS[stop.family] || BOARDS[fam.kind])(a, stop, def, fam);
  const hints = stop.hints.length ? `<p class="hintline">${stop.hints.map((s) => esc(a.t('stop.hintIs', { slot: a.t('slot.' + s) }))).join(' · ')}</p>` : '';
  const guides = stop.observations.some((o) => o.guide) || stop.held.length > 0;
  const tried = moves(stop).length > 0;
  // First Stop of a new Trail: a two-step coach instead of the blurb.
  const coach = p.kind === 'trail' && p.stats.stopsSolved === 0 && p.run.stopIndex === 0 && fam.kind === 'sort';
  const line = a.ui.sel ? a.t('stop.tapTarget') : coach ? a.t(tried ? 'coach.learn' : 'coach.send') : a.loc(def.blurb);
  let where;
  if (p.kind !== 'trail') where = a.t(p.kind === 'practice' ? 'practice.title' : 'daily.title');
  else {
    const leg = legDef(a.content, p.run.legId);
    where = a.t('stop.stopOf', { n: p.run.stopIndex + 1, t: branchDef(leg, p.run.branch).stops.length });
  }
  const picking = stop.family === 'switch_run';
  const tray = stop.queue
    .map((id) => {
      const on = picking ? a.ui.convoy.includes(id) : a.ui.sel === id;
      return kin(a, byId(a, id), {
        size: 40,
        act: 'tray',
        cls: 'tray-kin' + (on ? ' sel' : ''),
        pressed: on,
        extra: stop.badges[id] ? `<span class="badge" aria-hidden="true">${stop.badges[id]}</span>` : '',
      });
    })
    .join('');
  return `<main class="screen stop"><header class="bar"><div><h2>${esc(a.loc(def.title))}</h2>
      <small>${esc(where)} · ${esc(a.t('tier.' + stop.tier))}</small></div>
    <div class="patience" role="img" aria-label="${esc(a.t('stop.patience'))} ${stop.patience}/${max}">${pips}</div></header>
  <div class="body">
    ${!tried || a.ui.sel ? `<p class="blurb">${esc(line)}</p>` : ''}${guides && !tried && fam.kind === 'sort' ? `<p class="meta">${esc(a.t('stop.guides'))}</p>` : ''}${hints}
    ${board}
  </div>
  <section class="tray" aria-label="${esc(a.t('stop.tray'))}">${tray}</section>
  <div class="corner">
    <button class="round" data-act="hint" aria-label="${esc(a.t('stop.hint'))}: ${p.hintTokens}" ${p.hintTokens ? '' : 'disabled'}><span aria-hidden="true">?</span><i aria-hidden="true">${p.hintTokens}</i></button>
    <button class="round" data-act="pause" aria-label="${esc(a.t('stop.pause'))}"><span aria-hidden="true" class="bars"></span></button>
  </div>
  ${stop.status === 'playing' ? '' : stopResult(a, stop, fam)}</main>`;
}

function stopResult(a, stop, fam) {
  const n = Object.keys(stop.placed).length;
  const solved = stop.status === 'solved';
  return `<div class="scrim"><div class="sheet center" role="dialog" aria-modal="true" aria-label="${esc(a.t(solved ? 'stop.solved' : 'stop.failed'))}">
    <h2>${esc(a.t(solved ? 'stop.solved' : 'stop.failed'))}</h2>
    <p>${esc(solved ? a.t('stop.solvedBody', { n }) : a.t('stop.failedBody', { n, r: stop.queue.length }))}</p>
    <div class="card"><b>${esc(a.t('stop.ruleWas'))}</b>${fam.describe(stop.hyp, a.t, stop.setup, { traits: a.content.traits }).map((line) => `<div>${esc(line)}</div>`).join('')}</div>
    <div class="actions">${btn('stop-continue', a.t('common.continue'), 'primary')}</div></div></div>`;
}

function summaryScreen(a) {
  const s = a.profile.summary;
  const camp = a.loc(a.content.trail.camps[s.to]);
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('summary.title'))}</h2>${homePill(a)}</header>
  <div class="body col big">
    <p>${esc(a.t(s.home ? 'summary.home' : 'summary.arrived', { n: s.arrived, camp }))}</p>
    <p>${esc(a.t('summary.returned', { n: s.returned - s.stranded }))}</p>
    ${s.stranded ? `<p class="warn">${esc(a.t('summary.stranded', { n: s.stranded, camp }))}</p>` : ''}
    <p>${esc(a.t('summary.flawless', { n: s.flawlessStops }))}</p>
    <p>${esc(a.t('summary.tokens', { n: s.tokensEarned }))}</p>
    ${s.fullParty ? `<p class="good">${esc(a.t('summary.fullParty'))}</p>` : ''}
    ${s.tierUp ? `<p class="good">${esc(a.t('summary.tierUp', { tier: a.t('tier.' + s.tierUp) }))}</p>` : ''}
  </div>
  <div class="actions">${btn('summary-ok', a.t('summary.toCamp'), 'primary')}</div></main>`;
}

function campScreen(a) {
  const p = a.profile;
  const home = p.camp === HOME(a.content);
  const lists = {
    ready: home ? p.roster.filter((c) => c.status === 'delivered') : readyAt(p, p.camp),
    resting: home ? null : p.roster.filter((c) => c.status === 'parked' && c.at === p.camp),
    stranded: strandedAt(p, p.camp),
  };
  const names = { ready: home ? 'camp.arrived' : 'camp.waiting', resting: 'camp.resting', stranded: 'camp.stranded' };
  const tab = lists[a.ui.campTab] ? a.ui.campTab : 'ready';
  const tabs = Object.keys(lists)
    .filter((k) => lists[k])
    .map((k) => `<button role="tab" class="tab ${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="camp-tab" data-tab="${k}">${esc(a.t(names[k]))} (${lists[k].length})</button>`)
    .join('');
  const list = lists[tab];
  const note = tab === 'stranded' ? 'camp.strandedNote' : home ? 'camp.homeNote' : 'camp.note';
  return `<main class="screen"><header class="bar"><div><h2>${esc(a.loc(a.content.trail.camps[p.camp]))}</h2><small>${esc(a.t('camp.title'))}</small></div>${homePill(a)}</header>
  <div class="tabs" role="tablist">${tabs}</div>
  <div class="body">${list.length ? `<div class="grid">${list.map((c) => kin(a, c, { cls: c.status === 'lost' ? 'lost' : '' })).join('')}</div>` : `<p>${esc(a.t('camp.empty'))}</p>`}
    <p class="meta">${esc(a.t(note))}</p></div>
  <div class="actions">${btn('open-photo', a.t('photo.title'))}${btn('goto', a.t('camp.toMap'), 'primary', 'data-screen="map"')}</div></main>`;
}

function goalsScreen(a) {
  const p = a.profile;
  const rows = a.content.goals.goals
    .map((g) => `<li class="${p.goals[g.id] ? 'done' : ''}"><span class="tick" aria-hidden="true">${p.goals[g.id] ? '✓' : ''}</span><span>${esc(a.t('goal.' + g.id))}</span>
      <small>${Math.min(p.stats[g.stat], g.atLeast)}/${g.atLeast}</small></li>`)
    .join('');
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('goals.title'))}</h2>
    <span class="pill">${Object.keys(p.goals).length}/${a.content.goals.goals.length}</span></header>
  <div class="body"><p>${esc(a.t('goals.body'))}</p><ul class="goals">${rows}</ul></div>
  <div class="actions">${btn('goto', a.t('camp.toMap'), 'primary', 'data-screen="map"')}</div></main>`;
}

function finaleScreen(a) {
  const p = a.profile;
  const d = countStatus(p, 'delivered');
  const gone = p.roster.filter((c) => c.gone).length;
  const all = d === p.roster.length - gone;
  return `<main class="screen title"><h1 class="logo">${esc(a.t('finale.title'))}</h1>
  <p class="tagline">${esc(all ? a.t(gone ? 'finale.hardAll' : 'finale.all', { d, g: gone }) : a.t('finale.some', { d, t: p.roster.length }))}</p>${all ? `<p class="tagline">${esc(a.t('story.outro'))}</p>` : ''}
  <div class="grid">${p.roster.filter((c) => c.status === 'delivered').map((c) => kin(a, c, { size: 40 })).join('')}</div>
  <div class="actions col">${btn('open-photo', a.t('photo.title'))}${all ? '' : btn('goto', a.t('finale.keep'), '', 'data-screen="map"')}${btn('to-title', a.t('finale.toTitle'), 'primary')}</div></main>`;
}

function dailyDoneScreen(a) {
  const r = a.profile.result;
  const solved = r.status === 'solved';
  const practice = a.profile.kind === 'practice';
  return `<main class="screen title"><h1 class="logo">${esc(a.t(practice ? 'practice.title' : 'daily.title'))}</h1>
  <p class="tagline">${esc(a.t(solved ? 'daily.solved' : 'daily.failed', { n: r.through, w: r.wrong }))}</p>
  ${practice ? '' : `<p>${esc(a.t('daily.total', { n: a.dailySolved }))}</p><p>${esc(a.t('daily.streak', { n: a.record.daily.streak, best: a.record.daily.best }))}</p><p class="meta">${esc(a.t('daily.tomorrow'))}</p>`}
  <div class="actions col">${practice ? btn('open-practice', a.t('practice.again')) : ''}${btn('to-title', a.t('finale.toTitle'), 'primary')}</div></main>`;
}

export function gameView(a) {
  const screens = { roster: rosterScreen, map: mapScreen, party: partyScreen, stop: stopScreen, summary: summaryScreen, camp: campScreen, goals: goalsScreen, finale: finaleScreen, dailyDone: dailyDoneScreen };
  return screens[a.profile.screen](a);
}

// ---- Overlays ---------------------------------------------------------------

function rescuePanel(a, c) {
  const p = a.profile;
  const need = a.content.trail.rescueSharedTraits;
  const friends = friendsFor(p, a.content, c);
  const free = canFreeRescue(p, a.content, c);
  return `<div class="card rescue"><b>${esc(a.t('rescue.title'))}</b><span>${esc(a.t('rescue.body', { n: need }))}</span>
    ${friends.length ? `<div class="grid">${friends.map((f) => kin(a, f, { size: 40, act: 'rescue-friend', extra: `<span class="tag share" aria-hidden="true">${sharedTraits(f, c)}</span>` })).join('')}</div>` : `<span>${esc(a.t('rescue.noFriends'))}</span>`}
    <div class="actions">${p.hintTokens > 0 ? btn('rescue-token', a.t('rescue.token', { n: p.hintTokens })) : ''}${free ? btn('rescue-free', a.t('rescue.free'), 'primary') : ''}</div></div>`;
}

// Trinkets the player has unlocked, to put on this creature or take off.
function trinketRow(a, c) {
  const have = unlockedTrinkets(a.profile, a.content);
  if (!have.length) return '';
  const item = (id, label) => `<button class="chip ${(c.trinket || '') === id ? 'on' : ''}" data-act="trinket" data-trinket="${id}" aria-pressed="${(c.trinket || '') === id}">${esc(label)}</button>`;
  return `<div class="card"><b>${esc(a.t('trinket.title'))}</b><div class="chips">${item('', a.t('trinket.none'))}${have.map((id) => item(id, a.t('trinket.' + id))).join('')}</div></div>`;
}

export function inspectSheet(a) {
  const c = byId(a, a.ui.inspect);
  if (!c) return '';
  const p = a.profile;
  const rows = a.content.traits.slots
    .map((s) => `<li>${creatureSvg(c.traits, a.palette, { size: 34, only: s.id })}<span><b>${esc(a.t('slot.' + s.id))}</b> ${esc(a.t(`${s.id}.${c.traits[s.id]}`))}</span></li>`)
    .join('');
  const camp = p.screen === 'camp';
  const rest = camp && c.status === 'available' ? btn('park', a.t('camp.park')) : camp && c.status === 'parked' ? btn('retrieve', a.t('camp.retrieve')) : '';
  const own = !c.guide;
  return `<div class="scrim" data-act="close-inspect"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(kinName(a, c))}">
    <div class="inspect-top">${creatureSvg(c.traits, a.palette, { size: 96, trinket: c.trinket })}
      <div><h2>${esc(kinName(a, c))}</h2>
      <small>${own ? `${esc(a.t('inspect.cleared', { n: c.history.stopsCleared }))}<br>${esc(a.t('inspect.returned', { n: c.history.timesReturned }))}` : esc(a.t('inspect.guide'))}</small></div></div>
    <ul class="traits">${rows}</ul>
    ${camp && c.status === 'lost' ? rescuePanel(a, c) : ''}
    ${own && p.kind === 'trail' ? trinketRow(a, c) : ''}
    ${own && p.kind === 'trail' ? `<label class="row"><span>${esc(a.t('inspect.nickname'))}</span>
      <input type="text" maxlength="16" value="${esc(c.nickname || '')}" data-change="nickname" autocomplete="off"></label>` : ''}
    <div class="actions">${own && p.kind === 'trail' ? btn('fav', a.t(c.favourite ? 'inspect.unfav' : 'inspect.fav'), '', `aria-pressed="${c.favourite}"`) : ''}${rest}${btn('close-inspect', a.t('common.close'), 'primary')}</div>
  </div></div>`;
}

export function pauseSheet(a) {
  return `<div class="scrim"><div class="sheet center" role="dialog" aria-modal="true" aria-label="${esc(a.t('pause.title'))}">
    <h2>${esc(a.t('pause.title'))}</h2>
    ${a.profile.stop ? `<div class="card">${esc(a.loc(puzzleDef(a.content, a.profile.stop.puzzleId).blurb))}</div>` : ''}
    <div class="actions col">${btn('resume', a.t('pause.resume'), 'primary')}${btn('open-settings', a.t('title.settings'))}${btn('to-title', a.t('pause.quit'))}</div></div></div>`;
}

export function confirmSheet(a) {
  return `<div class="scrim"><div class="sheet center" role="alertdialog" aria-modal="true">
    <p>${esc(a.ui.confirm.text)}</p>
    <div class="actions">${btn('confirm-no', a.t('common.cancel'))}${btn('confirm-yes', a.t('common.yes'), 'primary')}</div></div></div>`;
}

export { btn, byId, miniOf, moves };
