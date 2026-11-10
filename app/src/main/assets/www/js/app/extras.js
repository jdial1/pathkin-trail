// More screens and boards: the cart queue and stepping-pad Stops, practice,
// the new-Trail choices, the picture maker and the play record.
// Like screens.js these are pure functions from app state to HTML.

import { creatureSvg } from './creature.js';
import { DEFS } from './art/paint.js';
import { scene } from './art/scenes.js';
import { esc, btn, byId, miniOf, moves } from './screens.js';

// ---- Boards ----------------------------------------------------------------

// A cart that takes riders in loads; they must board in a hidden order.
export function queueBoard(a, stop) {
  const cap = stop.setup.cap;
  const guides = stop.observations.filter((o) => o.guide).map((o) => o.action.id);
  const seats = Array.from({ length: cap }, (_, i) => {
    const id = stop.extra.load[i];
    return `<span class="cart-seat">${id ? miniOf(a, id, `<span class="tag share" aria-hidden="true">${i + 1}</span>`, 'yes', 34) : ''}</span>`;
  }).join('');
  const last = moves(stop).slice(-1)[0];
  return `${guides.length ? `<div class="runs"><div class="run">${esc(a.t('stop.earlierLoad'))} ${guides.map((id, i) => miniOf(a, id, `<span class="tag share" aria-hidden="true">${i + 1}</span>`, 'guide', 28)).join('')}</div></div>` : ''}
    <div class="target cart ${last && !last.fb.ok ? 'bumped' : ''}" role="button" tabindex="0" data-act="target" data-target="cart" aria-label="${esc(a.t('target.cart'))}">
      <div class="target-head"><b>${esc(a.t('stop.cartLoad', { n: stop.extra.load.length, cap }))}</b><span class="tally">${Object.keys(stop.placed).length}</span></div>
      <div class="cart-seats">${seats}</div>
      <div class="wheels" aria-hidden="true"><i></i><i></i></div>
    </div>
    <p class="meta">${esc(a.t('stop.trips', { n: stop.extra.trips }))}</p>`;
}

// A row of stepping pads that follows a repeating pattern.
export function foldBoard(a, stop) {
  const shown = stop.extra.row.slice(-7);
  const first = stop.extra.index - shown.length;
  const pads = shown.map((id, i) => `<span class="pad"><small>${first + i + 1}</small>${miniOf(a, id, '', byId(a, id).guide ? 'guide' : 'yes', 30)}</span>`).join('');
  return `<div class="pads">${pads}
      <div class="target pad next" role="button" tabindex="0" data-act="target" data-target="pad" aria-label="${esc(a.t('target.pad'))} ${stop.extra.index + 1}"><small>${stop.extra.index + 1}</small><b aria-hidden="true">?</b></div>
    </div>`;
}

// ---- Practice: any puzzle, any tier, nothing at stake -----------------------

export function practiceView(a) {
  const tier = a.ui.practiceTier;
  const tiers = a.content.puzzles.tierOrder
    .map((t) => `<button class="seg ${tier === t ? 'on' : ''}" data-act="practice-tier" data-tier="${t}" aria-pressed="${tier === t}">${esc(a.t('tier.' + t))}</button>`)
    .join('');
  const list = a.content.puzzles.puzzles
    .map((p) => `<button class="card slot" data-act="practice-start" data-puzzle="${p.id}"><b>${esc(a.loc(p.title))}</b><span>${esc(a.loc(p.blurb))}</span></button>`)
    .join('');
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('practice.title'))}</h2></header>
  <div class="body col"><p>${esc(a.t('practice.body'))}</p><div class="segs">${tiers}</div>${list}</div>
  <div class="actions">${btn('to-title', a.t('common.back'), 'primary')}</div></main>`;
}

// ---- Choices when a new Trail begins -----------------------------------------

export function newTrailSheet(a) {
  const nt = a.ui.newTrail;
  const sizes = a.content.trail.rosterSizes
    .map((n) => `<button class="seg ${nt.size === n ? 'on' : ''}" data-act="nt-size" data-size="${n}" aria-pressed="${nt.size === n}">${esc(a.t('newtrail.size', { n }))}</button>`)
    .join('');
  return `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(a.t('title.new'))}">
    <h2>${esc(a.t('title.new'))}</h2>
    <div class="card"><b>${esc(a.t('newtrail.howMany'))}</b><div class="segs">${sizes}</div></div>
    <label class="row"><span>${esc(a.t('newtrail.hard'))}</span><input type="checkbox" class="switch" data-change="nt-hard" ${nt.hard ? 'checked' : ''}></label>
    <p class="${nt.hard ? 'warn' : 'meta'}">${esc(a.t(nt.hard ? 'newtrail.hardOn' : 'newtrail.hardOff'))}</p>
    <div class="actions">${btn('nt-cancel', a.t('common.cancel'))}${btn('nt-start', a.t('roster.accept'), 'primary')}</div>
  </div></div>`;
}

// ---- Picture maker ------------------------------------------------------------

export const STICKERS = {
  star: '<path d="M0 -15 L4.5 -5 L15 -4 L7 3.5 L9.5 14 L0 8.5 L-9.5 14 L-7 3.5 L-15 -4 L-4.5 -5 Z" fill="#ffd23f"/>',
  heart: '<path d="M0 13 C-18 0 -12 -14 0 -5 C12 -14 18 0 0 13 Z" fill="#ef5b6b"/>',
  flag: '<path d="M-8 15 V-15" fill="none"/><path d="M-8 -15 L12 -8 L-8 -1 Z" fill="#e2603f"/>',
  sun: '<circle r="8" fill="#ffb627"/><path d="M0 -15 V-11 M0 15 V11 M-15 0 H-11 M15 0 H11 M-10.5 -10.5 L-8 -8 M10.5 10.5 L8 8 M-10.5 10.5 L-8 8 M10.5 -10.5 L8 -8" fill="none"/>',
  flower: '<circle cx="0" cy="-8" r="6" fill="#f4a3c0"/><circle cx="8" cy="-2" r="6" fill="#f4a3c0"/><circle cx="5" cy="7" r="6" fill="#f4a3c0"/><circle cx="-5" cy="7" r="6" fill="#f4a3c0"/><circle cx="-8" cy="-2" r="6" fill="#f4a3c0"/><circle r="4.5" fill="#ffd23f"/>',
  print: '<ellipse cx="0" cy="5" rx="7" ry="8" fill="#6b4a2f"/><circle cx="-8" cy="-7" r="3" fill="#6b4a2f"/><circle cx="0" cy="-11" r="3" fill="#6b4a2f"/><circle cx="8" cy="-7" r="3" fill="#6b4a2f"/>',
};
const stickerSvg = (k, size = 30) => `<svg viewBox="-18 -18 36 36" width="${size}" height="${size}" aria-hidden="true"><g stroke="#33291f" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${STICKERS[k]}</g></svg>`;

// Who is in the picture: favourites first, then those already home, then the rest.
function cast(a) {
  const r = a.profile.roster.filter((c) => !c.gone);
  const order = [...r.filter((c) => c.favourite), ...r.filter((c) => !c.favourite && c.status === 'delivered'), ...r.filter((c) => !c.favourite && c.status !== 'delivered')];
  return order.slice(0, 11);
}

// One self-contained SVG, so it can be shown on screen and saved as an image.
export function photoSvg(a) {
  const ph = a.ui.photo;
  const [kind, themeId] = ph.scene.split('|');
  const W = 390;
  const H = 488;
  const who = cast(a);
  const back = who.slice(0, 5);
  const front = who.slice(5);
  const row = (list, y, size) =>
    list
      .map((c, i) => {
        const x = W / 2 + (i - (list.length - 1) / 2) * (size * 1.02) - size / 2;
        return `<g transform="translate(${x.toFixed(1)} ${y})">${creatureSvg(c.traits, a.palette, { size, trinket: c.trinket })}</g>`;
      })
      .join('');
  const stickers = ph.stickers.map((s) => `<g transform="translate(${s.x} ${s.y}) scale(1.5)" stroke="#33291f" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${STICKERS[s.k]}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="photo-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a.t('photo.title'))}">
    <defs>${DEFS}</defs>
    <svg x="0" y="0" width="${W}" height="${H}" viewBox="0 ${kind === 'stop' ? 0 : 300} 390 ${H}">${scene(kind, a.content.theme.themes[themeId]).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg>
    ${row(back, 300, 58)}${row(front, 366, 66)}
    ${stickers}
    <rect x="5" y="5" width="${W - 10}" height="${H - 10}" rx="14" fill="none" stroke="#fff8e6" stroke-width="10"/>
    <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="16" fill="none" stroke="#33291f" stroke-width="3"/>
  </svg>`;
}

export function photoView(a) {
  const ph = a.ui.photo;
  const scenes = [...a.content.trail.legs.map((l) => ['stop|' + l.theme, a.loc(l.name)]), ['camp|' + a.content.trail.legs[0].theme, a.t('camp.title')], ['home|' + a.content.trail.legs[0].theme, a.loc(a.content.trail.camps[a.content.trail.camps.length - 1])]];
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('photo.title'))}</h2></header>
  <div class="body col">
    <div class="photo" data-act="photo-place" role="button" tabindex="0" aria-label="${esc(a.t('photo.place'))}">${photoSvg(a)}</div>
    <div class="chips">${scenes.map(([key, name]) => `<button class="chip ${ph.scene === key ? 'on' : ''}" data-act="photo-scene" data-scene="${key}" aria-pressed="${ph.scene === key}">${esc(name)}</button>`).join('')}</div>
    <div class="chips stickers">${Object.keys(STICKERS).map((k) => `<button class="chip ${ph.pick === k ? 'on' : ''}" data-act="photo-pick" data-sticker="${k}" aria-pressed="${ph.pick === k}" aria-label="${esc(a.t('sticker.' + k))}">${stickerSvg(k)}</button>`).join('')}</div>
    <p class="meta">${esc(a.t(ph.pick ? 'photo.place' : 'photo.pick'))}</p>
  </div>
  <div class="actions">${btn('photo-back', a.t('common.back'))}${btn('photo-clear', a.t('party.clear'), '', ph.stickers.length ? '' : 'disabled')}${btn('photo-save', a.t('photo.save'), 'primary')}</div></main>`;
}

// ---- Play record: kept on this device only -------------------------------------

export function recordView(a) {
  const rec = a.record;
  const rows = a.content.puzzles.puzzles
    .map((p) => {
      const tiers = a.content.puzzles.tierOrder.map((t) => rec.stops[`${p.id}|${t}`]).filter(Boolean);
      if (!tiers.length) return '';
      const sum = (k) => tiers.reduce((n, x) => n + x[k], 0);
      const played = sum('played');
      return `<li><span>${esc(a.loc(p.title))}</span><small>${esc(a.t('record.line', { played, solved: Math.round((100 * sum('solved')) / played), wrong: (sum('wrong') / played).toFixed(1), secs: Math.round(sum('seconds') / played) }))}</small></li>`;
    })
    .join('');
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('record.title'))}</h2></header>
  <div class="body col"><p>${esc(a.t('record.body'))}</p>
    ${rows ? `<ul class="goals record">${rows}</ul>` : `<p>${esc(a.t('record.none'))}</p>`}
    <p class="meta">${esc(a.t('daily.streak', { n: rec.daily.streak, best: rec.daily.best }))}</p>
  </div>
  <div class="actions">${btn('record-erase', a.t('record.erase'), '', rows ? '' : 'disabled')}${btn('open-settings-back', a.t('common.back'), 'primary')}</div></main>`;
}
