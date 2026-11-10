// Screens. Pure functions from app state to HTML; they own no game state.
// Interaction is wired by data-act attributes handled in main.js.

import { creatureSvg } from './creature.js';
import { family } from '../core/families.js';
import { decodeCombo, comboCount } from '../core/traits.js';
import { HOME, countStatus, legDef, branchDef, puzzleDef, readyAt, strandedAt, friendsFor, canFreeRescue, sharedTraits } from '../core/game.js';

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
${creatureSvg(c.traits, a.palette, { size })}${c.favourite ? '<span class="fav" aria-hidden="true">★</span>' : ''}${extra}</button>`;
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
    <div class="actions inner">${btn('open-settings', a.t('title.settings'))}${btn('open-credits', a.t('title.credits'), 'quiet')}</div>
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
    ${toggle('audio')}${toggle('haptics')}${toggle('reducedMotion')}${toggle('colourSafe')}${toggle('assist')}
    <small>${esc(a.t('settings.assistNote'))}</small>
    <label class="row"><span>${esc(a.t('settings.textSize'))}</span>
      <select data-change="setting" data-key="textSize">${sizes.map((z) => `<option value="${z}" ${s.textSize === z ? 'selected' : ''}>${Math.round(z * 100)}%</option>`).join('')}</select></label>
    <label class="row"><span>${esc(a.t('settings.language'))}</span>
      <select data-change="setting" data-key="language">${a.languages.map((l) => `<option value="${l}" ${s.language === l ? 'selected' : ''}>${esc(a.t('lang.' + l))}</option>`).join('')}</select></label>
  </div>
  <div class="actions">${btn('settings-back', a.t('common.back'), 'primary')}</div></main>`;
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
  <div class="body"><p>${esc(a.t('roster.body', { n: p.roster.length }))}</p>
  <div class="grid">${p.roster.map((c) => kin(a, c)).join('')}</div></div>
  <div class="actions">${btn('reroll', a.t('roster.reroll'))}${btn('roster-ok', a.t('roster.accept'), 'primary')}</div></main>`;
}

// Long names are squeezed to fit rather than clipped or overlapping.
const fit = (text, max, px) => (text.length * px * 0.6 > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '');

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
      <path d="M26 ${cy + 13} l15 -27 l15 27 Z" class="node camp"/>
      ${flag ? `<path d="M41 ${cy - 14} v-17 l13 5 l-13 5" class="flag"/>` : ''}
      <text x="66" y="${cy + 5}" class="node-t"${fit(name, 150, 14)}>${esc(name)}</text>
      <circle cx="262" cy="${cy}" r="15" class="count"/><text x="262" y="${cy + 5}" text-anchor="middle" class="count-n">${n}</text>
      ${lost ? `<text x="234" y="${cy + 6}" text-anchor="middle" class="lost-n">!</text>` : ''}
    </g>`;
  };
  let camps = campNode(0, 0);
  let paths = '';
  legs.forEach((leg, li) => {
    const start = row;
    const end = row + leg.branches[0].stops.length + 1;
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
  return `<svg class="map" viewBox="0 0 300 ${H}" style="aspect-ratio:300/${H}" role="group" aria-label="${esc(a.t('map.title'))}">${paths}${out}${camps}</svg>`;
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

const ARROWS = { '0,1': '→', '0,-1': '←', '1,0': '↓', '-1,0': '↑', '1,1': '↘', '1,-1': '↙', '-1,1': '↗', '-1,-1': '↖' };

function bounceTag(fb, target) {
  if ('rowOk' in fb) {
    // In a 2x2 field a miss says exactly where the creature belongs.
    const dr = fb.rowOk ? 0 : target.row === 0 ? 1 : -1;
    const dc = fb.colOk ? 0 : target.col === 0 ? 1 : -1;
    return ARROWS[`${dr},${dc}`];
  }
  if ('at' in fb) return fb.at === 0 ? '①' : '②';
  return '✕';
}

function targetBox(a, stop, target, label, cls, showLabel) {
  const guides = stop.observations.filter((o) => stop.examples[o.id] && o.target === target.id).map((o) => o.id);
  const inside = Object.keys(stop.placed).filter((id) => stop.placed[id] === target.id);
  const bounced = stop.observations.filter((o) => !o.fb.ok && o.target === target.id);
  const mini = (id, extra = '', k = '') => kin(a, byId(a, id), { size: 30, cls: 'mini ' + k, extra });
  return `<div class="target ${cls}" role="button" tabindex="0" data-act="target" data-target="${target.id}" aria-label="${esc(label)}">
    <div class="target-head"><b>${showLabel ? esc(label) : ''}</b><span class="tally">${inside.length}</span></div>
    <div class="minis" aria-label="${esc(a.t('stop.in'))}">${guides.map((id) => mini(id, '', 'guide')).join('')}${inside.map((id) => mini(id, '', 'yes')).join('')}</div>
    ${bounced.length ? `<div class="minis bounced" aria-label="${esc(a.t('stop.bounced'))}">${bounced.map((o) => mini(o.id, `<span class="tag" aria-hidden="true">${bounceTag(o.fb, target)}</span>`, 'no')).join('')}</div>` : ''}
  </div>`;
}

const forkArt = () => `<svg class="forks" viewBox="0 0 400 64" aria-hidden="true">
  <path d="M200 62 L100 34 L50 4 M100 34 L150 4 M200 62 L300 34 L250 4 M300 34 L350 4" class="trailpath thin"/>
  <circle cx="200" cy="54" r="11" class="node"/><text x="200" y="59" text-anchor="middle" class="node-n">1</text>
  <circle cx="100" cy="34" r="11" class="node"/><text x="100" y="39" text-anchor="middle" class="node-n">2</text>
  <circle cx="300" cy="34" r="11" class="node"/><text x="300" y="39" text-anchor="middle" class="node-n">2</text></svg>`;

function stopScreen(a) {
  const p = a.profile;
  const stop = p.stop;
  const def = puzzleDef(a.content, stop.puzzleId);
  const fam = family(stop.family);
  const targets = fam.targets(def);
  const max = def.tiers[stop.tier].patience;
  const pips = Array.from({ length: max }, (_, i) => `<i class="pip ${i < stop.patience ? 'on' : ''}"></i>`).join('');
  const kind = stop.family;
  const label = (tg, i) => (kind === 'pattern_grid' ? a.t('target.cell', { r: tg.row + 1, c: tg.col + 1 }) : kind === 'tour_path' ? a.t('target.exit', { n: i + 1 }) : a.t(tg.label));
  const boxes = targets.map((tg, i) => targetBox(a, stop, tg, label(tg, i), kind, kind !== 'pattern_grid')).join('');
  const cols = kind === 'pattern_grid' ? 2 : targets.length;
  const hints = stop.hints.length ? `<p class="hintline">${stop.hints.map((s) => esc(a.t('stop.hintIs', { slot: a.t('slot.' + s) }))).join(' · ')}</p>` : '';
  const guides = Object.keys(stop.examples).length;
  const tried = stop.observations.length > guides;
  // First Stop of a new Trail: a two-step coach instead of the blurb.
  const coach = p.kind === 'trail' && p.stats.stopsSolved === 0 && p.run.stopIndex === 0;
  const line = a.ui.sel ? a.t('stop.tapTarget') : coach ? a.t(tried ? 'coach.learn' : 'coach.send') : a.loc(def.blurb);
  let where;
  if (p.kind === 'daily') where = a.t('daily.title');
  else {
    const leg = legDef(a.content, p.run.legId);
    where = a.t('stop.stopOf', { n: p.run.stopIndex + 1, t: branchDef(leg, p.run.branch).stops.length });
  }
  const tray = stop.queue
    .map((id) =>
      kin(a, byId(a, id), {
        size: 46,
        act: 'tray',
        cls: 'tray-kin' + (a.ui.sel === id ? ' sel' : ''),
        pressed: a.ui.sel === id,
        extra: stop.badges[id] ? `<span class="badge" aria-hidden="true">${stop.badges[id]}</span>` : '',
      })
    )
    .join('');
  return `<main class="screen stop"><header class="bar"><div><h2>${esc(a.loc(def.title))}</h2>
      <small>${esc(where)} · ${esc(a.t('tier.' + stop.tier))}</small></div>
    <div class="patience" role="img" aria-label="${esc(a.t('stop.patience'))} ${stop.patience}/${max}">${pips}</div></header>
  <div class="body">
    <p class="blurb">${esc(line)}</p>${guides && !tried ? `<p class="meta">${esc(a.t('stop.guides'))}</p>` : ''}${hints}
    <div class="targets n${cols}">${boxes}</div>${kind === 'tour_path' ? forkArt() : ''}
  </div>
  <section class="tray" aria-label="${esc(a.t('stop.tray'))}">${tray}</section>
  <div class="actions">${btn('pause', a.t('stop.pause'))}${btn('hint', `${a.t('stop.hint')} (${p.hintTokens})`, '', p.hintTokens ? '' : 'disabled')}</div>
  ${stop.status === 'playing' ? '' : stopResult(a, stop, fam)}</main>`;
}

function stopResult(a, stop, fam) {
  const n = Object.keys(stop.placed).length;
  const solved = stop.status === 'solved';
  return `<div class="scrim"><div class="sheet center" role="dialog" aria-modal="true" aria-label="${esc(a.t(solved ? 'stop.solved' : 'stop.failed'))}">
    <h2>${esc(a.t(solved ? 'stop.solved' : 'stop.failed'))}</h2>
    <p>${esc(solved ? a.t('stop.solvedBody', { n }) : a.t('stop.failedBody', { n, r: stop.queue.length }))}</p>
    <div class="card"><b>${esc(a.t('stop.ruleWas'))}</b>${fam.describe(stop.hyp, a.t).map((line) => `<div>${esc(line)}</div>`).join('')}</div>
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
  <div class="actions">${btn('goto', a.t('camp.toMap'), 'primary', 'data-screen="map"')}</div></main>`;
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
  const all = d === p.roster.length;
  return `<main class="screen title"><h1 class="logo">${esc(a.t('finale.title'))}</h1>
  <p class="tagline">${esc(all ? a.t('finale.all') : a.t('finale.some', { d, t: p.roster.length }))}</p>
  <div class="grid">${p.roster.filter((c) => c.status === 'delivered').map((c) => kin(a, c, { size: 40 })).join('')}</div>
  <div class="actions col">${all ? '' : btn('goto', a.t('finale.keep'), '', 'data-screen="map"')}${btn('to-title', a.t('finale.toTitle'), 'primary')}</div></main>`;
}

function dailyDoneScreen(a) {
  const r = a.profile.result;
  const solved = r.status === 'solved';
  return `<main class="screen title"><h1 class="logo">${esc(a.t('daily.title'))}</h1>
  <p class="tagline">${esc(a.t(solved ? 'daily.solved' : 'daily.failed', { n: r.through, w: r.wrong }))}</p>
  <p>${esc(a.t('daily.total', { n: a.dailySolved }))}</p>
  <p class="meta">${esc(a.t('daily.tomorrow'))}</p>
  <div class="actions col">${btn('to-title', a.t('finale.toTitle'), 'primary')}</div></main>`;
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
    <div class="inspect-top">${creatureSvg(c.traits, a.palette, { size: 96 })}
      <div><h2>${esc(kinName(a, c))}</h2>
      <small>${own ? `${esc(a.t('inspect.cleared', { n: c.history.stopsCleared }))}<br>${esc(a.t('inspect.returned', { n: c.history.timesReturned }))}` : esc(a.t('inspect.guide'))}</small></div></div>
    <ul class="traits">${rows}</ul>
    ${camp && c.status === 'lost' ? rescuePanel(a, c) : ''}
    ${own && p.kind === 'trail' ? `<label class="row"><span>${esc(a.t('inspect.nickname'))}</span>
      <input type="text" maxlength="16" value="${esc(c.nickname || '')}" data-change="nickname" autocomplete="off"></label>` : ''}
    <div class="actions">${own && p.kind === 'trail' ? btn('fav', a.t(c.favourite ? 'inspect.unfav' : 'inspect.fav'), '', `aria-pressed="${c.favourite}"`) : ''}${rest}${btn('close-inspect', a.t('common.close'), 'primary')}</div>
  </div></div>`;
}

export function pauseSheet(a) {
  return `<div class="scrim"><div class="sheet center" role="dialog" aria-modal="true" aria-label="${esc(a.t('pause.title'))}">
    <h2>${esc(a.t('pause.title'))}</h2>
    <div class="actions col">${btn('resume', a.t('pause.resume'), 'primary')}${btn('open-settings', a.t('title.settings'))}${btn('to-title', a.t('pause.quit'))}</div></div></div>`;
}

export function confirmSheet(a) {
  return `<div class="scrim"><div class="sheet center" role="alertdialog" aria-modal="true">
    <p>${esc(a.ui.confirm.text)}</p>
    <div class="actions">${btn('confirm-no', a.t('common.cancel'))}${btn('confirm-yes', a.t('common.yes'), 'primary')}</div></div></div>`;
}
