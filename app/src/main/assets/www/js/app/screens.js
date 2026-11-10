// Screens. Pure functions from app state to HTML; they own no game state.
// Interaction is wired by data-act attributes handled in main.js.

import { creatureSvg } from './creature.js';
import { family } from '../core/families.js';
import { countStatus, legDef, puzzleDef } from '../core/game.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const btn = (act, label, cls = '', attrs = '') => `<button class="btn ${cls}" data-act="${act}" ${attrs}>${esc(label)}</button>`;

function kinName(a, c) {
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

const byId = (a, id) => a.profile.roster.find((c) => c.id === id);

// ---- App-level views ----------------------------------------------------

export function titleView(a) {
  const demo = [
    { crest: 'tuft', eyes: 'wide', mark: 'none', feet: 'paws', tint: 0 },
    { crest: 'horn', eyes: 'lidded', mark: 'ring', feet: 'roller', tint: 2 },
    { crest: 'fin', eyes: 'round', mark: 'stripe', feet: 'webs', tint: 1 },
  ];
  return `<main class="screen title">
  <div class="title-art">${demo.map((d) => creatureSvg(d, a.palette, { size: 84 })).join('')}</div>
  <h1 class="logo">${esc(a.t('app.title'))}</h1>
  <p class="tagline">${esc(a.t('app.tagline'))}</p>
  <div class="actions col">
    ${a.slots.some((s) => s && s.profile) ? btn('title-continue', a.t('title.continue'), 'primary') : ''}
    ${btn('title-new', a.t('title.new'), a.slots.some((s) => s && s.profile) ? '' : 'primary')}
    ${btn('open-settings', a.t('title.settings'))}
    ${btn('open-credits', a.t('title.credits'), 'quiet')}
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
    ${toggle('audio')}${toggle('haptics')}${toggle('reducedMotion')}${toggle('colourSafe')}
    <label class="row"><span>${esc(a.t('settings.textSize'))}</span>
      <select data-change="setting" data-key="textSize">${sizes.map((z) => `<option value="${z}" ${s.textSize === z ? 'selected' : ''}>${Math.round(z * 100)}%</option>`).join('')}</select></label>
    <label class="row"><span>${esc(a.t('settings.language'))}</span>
      <select data-change="setting" data-key="language">${a.languages.map((l) => `<option value="${l}" ${s.language === l ? 'selected' : ''}>${esc(a.t('lang.' + l))}</option>`).join('')}</select></label>
  </div>
  <div class="actions">${btn('settings-back', a.t('common.back'), 'primary')}</div></main>`;
}

// ---- Game screens ---------------------------------------------------------

function rosterScreen(a) {
  const p = a.profile;
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('roster.title'))}</h2></header>
  <div class="body"><p>${esc(a.t('roster.body', { n: p.roster.length }))}</p>
  <div class="grid">${p.roster.map((c) => kin(a, c)).join('')}</div></div>
  <div class="actions">${btn('reroll', a.t('roster.reroll'))}${btn('roster-ok', a.t('roster.accept'), 'primary')}</div></main>`;
}

function mapScreen(a) {
  const p = a.profile;
  const leg = a.content.trail.legs[0];
  const ls = p.legs[leg.id];
  const stops = leg.stops.map((id) => a.loc(puzzleDef(a.content, id).title));
  const nodes = [a.t('map.start'), ...stops, a.t('map.campNode')];
  const ys = nodes.map((_, i) => 300 - i * 62);
  const xs = nodes.map((_, i) => (i % 2 ? 215 : 85));
  const path = nodes.map((_, i) => `${i ? 'L' : 'M'}${xs[i]} ${ys[i]}`).join(' ');
  const waiting = countStatus(p, 'available');
  const tiers = a.content.puzzles.tierOrder
    .map((tier) => `<button class="seg ${ls.tier === tier ? 'on' : ''}" data-act="set-tier" data-tier="${tier}" aria-pressed="${ls.tier === tier}">${esc(a.t('tier.' + tier))}</button>`)
    .join('');
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('map.title'))}</h2>
    <span class="pill">${esc(a.t('map.home', { d: countStatus(p, 'delivered'), t: p.roster.length }))}</span></header>
  <div class="body">
    <svg class="map" viewBox="0 0 300 340" role="img" aria-label="${esc(a.loc(leg.name))}">
      <path d="${path}" fill="none" stroke="#b79a6a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 16"/>
      ${nodes
        .map((label, i) => {
          const camp = i === nodes.length - 1;
          const shape = camp
            ? `<path d="M${xs[i] - 17} ${ys[i] + 13} L${xs[i]} ${ys[i] - 17} L${xs[i] + 17} ${ys[i] + 13} Z" class="node camp"/>`
            : `<circle cx="${xs[i]}" cy="${ys[i]}" r="${i ? 15 : 10}" class="node"/>`;
          const num = i && !camp ? `<text x="${xs[i]}" y="${ys[i] + 5}" text-anchor="middle" class="node-n">${i}</text>` : '';
          const tx = i % 2 ? xs[i] - 24 : xs[i] + 24;
          return `${shape}${num}<text x="${tx}" y="${ys[i] + 5}" text-anchor="${i % 2 ? 'end' : 'start'}" class="node-t">${esc(label)}</text>`;
        })
        .join('')}
      ${ls.fullParties > 0 ? `<path d="M${xs[4] + 22} ${ys[4] + 12} v-34 l16 7 l-16 7" class="flag"/>` : ''}
      <text x="150" y="18" text-anchor="middle" class="node-t faint">${esc(a.t('map.beyond'))}</text>
    </svg>
    <div class="card"><b>${esc(a.loc(leg.name))} · ${esc(a.t('map.tier'))}</b>
      <div class="segs">${tiers}</div><small>${esc(a.t('map.tierNote'))}</small></div>
    <p class="meta">${esc(a.t('map.hints', { n: p.hintTokens }))} · ${esc(a.t('map.waiting', { n: waiting }))}</p>
  </div>
  <div class="actions col">
    ${btn('goto', a.t('map.pickParty'), 'primary', `data-screen="party" ${waiting ? '' : 'disabled'}`)}
    <div class="actions inner">${btn('goto', a.t('map.camp'), '', 'data-screen="camp"')}${btn('end-trail', a.t('map.end'), 'quiet')}${btn('to-title', a.t('pause.quit'), 'quiet')}</div>
  </div></main>`;
}

export function filteredAvailable(a) {
  const f = a.ui.filter;
  return a.profile.roster.filter((c) => c.status === 'available' && Object.keys(f).every((slot) => String(c.traits[slot]) === f[slot]));
}

function partyScreen(a) {
  const p = a.profile;
  const max = a.content.traits.partyMax;
  const list = filteredAvailable(a);
  const filters = a.content.traits.slots
    .map((s) => {
      const cur = a.ui.filter[s.id];
      return `<select data-change="filter" data-slot="${s.id}" aria-label="${esc(a.t('party.filter'))} ${esc(a.t('slot.' + s.id))}">
        <option value="">${esc(a.t('party.any', { slot: a.t('slot.' + s.id) }))}</option>
        ${s.values.map((v) => `<option value="${v}" ${cur === String(v) ? 'selected' : ''}>${esc(a.t(`${s.id}.${v}`))}</option>`).join('')}</select>`;
    })
    .join('');
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('party.title'))}</h2>
    <span class="pill">${esc(a.t('party.count', { n: p.selection.length, max }))}</span></header>
  <div class="body">
    <div class="filters">${filters}</div>
    ${list.length ? `<div class="grid">${list.map((c) => kin(a, c, { act: 'party-toggle', cls: p.selection.includes(c.id) ? 'picked' : '', pressed: p.selection.includes(c.id) })).join('')}</div>` : `<p>${esc(a.t('party.none'))}</p>`}
  </div>
  <div class="actions">${btn('goto', a.t('common.back'), '', 'data-screen="map"')}${btn('party-fill', a.t('party.auto'))}${btn('party-clear', a.t('party.clear'))}
    ${btn('start-leg', a.t('party.go'), 'primary', p.selection.length ? '' : 'disabled')}</div></main>`;
}

const ARROWS = { '0,1': '→', '0,-1': '←', '1,0': '↓', '-1,0': '↑', '1,1': '↘', '1,-1': '↙', '-1,1': '↗', '-1,-1': '↖' };

function targetBox(a, stop, target, label, cls = '') {
  const inside = Object.keys(stop.placed).filter((id) => stop.placed[id] === target.id);
  const bounced = stop.observations.filter((o) => !o.fb.ok && o.target === target.id);
  const mini = (id, extra = '', k = '') => kin(a, byId(a, id), { size: 30, cls: 'mini ' + k, extra });
  const bounce = (o) => {
    let tag = '✕';
    if ('rowOk' in o.fb) {
      // In a 2x2 field a miss says exactly where the creature belongs.
      const dr = o.fb.rowOk ? 0 : target.row === 0 ? 1 : -1;
      const dc = o.fb.colOk ? 0 : target.col === 0 ? 1 : -1;
      tag = ARROWS[`${dr},${dc}`];
    }
    return mini(o.id, `<span class="tag" aria-hidden="true">${tag}</span>`, 'no');
  };
  return `<div class="target ${cls}" role="button" tabindex="0" data-act="target" data-target="${target.id}" aria-label="${esc(label)}">
    <div class="target-head"><b>${cls === 'cell' ? '' : esc(label)}</b><span class="tally">${inside.length}</span></div>
    <div class="minis" aria-label="${esc(a.t('stop.in'))}">${inside.map((id) => mini(id, '', 'yes')).join('')}</div>
    ${bounced.length ? `<div class="minis bounced" aria-label="${esc(a.t('stop.bounced'))}">${bounced.map(bounce).join('')}</div>` : ''}
  </div>`;
}

function stopScreen(a) {
  const p = a.profile;
  const stop = p.stop;
  const def = puzzleDef(a.content, stop.puzzleId);
  const fam = family(stop.family);
  const leg = legDef(a.content, p.run.legId);
  const targets = fam.targets(def);
  const max = def.tiers[stop.tier].patience;
  const pips = Array.from({ length: max }, (_, i) => `<i class="pip ${i < stop.patience ? 'on' : ''}"></i>`).join('');
  const grid = stop.family === 'pattern_grid';
  const boxes = targets
    .map((tg) => targetBox(a, stop, tg, grid ? a.t('target.cell', { r: tg.row + 1, c: tg.col + 1 }) : a.t(tg.label), grid ? 'cell' : stop.family))
    .join('');
  const hints = stop.hints.length ? `<p class="hintline">${stop.hints.map((s) => esc(a.t('stop.hintIs', { slot: a.t('slot.' + s) }))).join(' · ')}</p>` : '';
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
      <small>${esc(a.t('stop.stopOf', { n: p.run.stopIndex + 1, t: leg.stops.length }))} · ${esc(a.t('tier.' + stop.tier))}</small></div>
    <div class="patience" role="img" aria-label="${esc(a.t('stop.patience'))} ${stop.patience}/${max}">${pips}</div></header>
  <div class="body">
    <p class="blurb">${esc(a.ui.sel ? a.t('stop.tapTarget') : a.loc(def.blurb))}</p>${hints}
    <div class="targets ${grid ? 'gridded' : ''}">${boxes}</div>
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
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('summary.title'))}</h2></header>
  <div class="body col big">
    <p>${esc(a.t('summary.delivered', { n: s.delivered }))}</p>
    <p>${esc(a.t('summary.returned', { n: s.returned }))}</p>
    <p>${esc(a.t('summary.flawless', { n: s.flawlessStops }))}</p>
    <p>${esc(a.t('summary.tokens', { n: s.tokensEarned }))}</p>
    ${s.fullParty ? `<p class="good">${esc(a.t('summary.fullParty'))}</p>` : ''}
    ${s.tierUp ? `<p class="good">${esc(a.t('summary.tierUp', { tier: a.t('tier.' + s.tierUp) }))}</p>` : ''}
  </div>
  <div class="actions">${btn('summary-ok', a.t('summary.toCamp'), 'primary')}</div></main>`;
}

const CAMP_TABS = [
  ['delivered', 'camp.arrived'],
  ['available', 'camp.waiting'],
  ['parked', 'camp.resting'],
];

function campScreen(a) {
  const p = a.profile;
  const tab = a.ui.campTab;
  const list = p.roster.filter((c) => c.status === tab);
  return `<main class="screen"><header class="bar"><h2>${esc(a.t('camp.title'))}</h2>
    <span class="pill">${esc(a.t('map.home', { d: countStatus(p, 'delivered'), t: p.roster.length }))}</span></header>
  <div class="tabs" role="tablist">${CAMP_TABS.map(([st, key]) => `<button role="tab" class="tab ${tab === st ? 'on' : ''}" aria-selected="${tab === st}" data-act="camp-tab" data-tab="${st}">${esc(a.t(key))} (${countStatus(p, st)})</button>`).join('')}</div>
  <div class="body">${list.length ? `<div class="grid">${list.map((c) => kin(a, c)).join('')}</div>` : `<p>${esc(a.t('camp.empty'))}</p>`}
    <p class="meta">${esc(a.t('camp.note'))}</p></div>
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

export function gameView(a) {
  const screens = { roster: rosterScreen, map: mapScreen, party: partyScreen, stop: stopScreen, summary: summaryScreen, camp: campScreen, finale: finaleScreen };
  return screens[a.profile.screen](a);
}

// ---- Overlays ---------------------------------------------------------------

export function inspectSheet(a) {
  const c = byId(a, a.ui.inspect);
  if (!c) return '';
  const rows = a.content.traits.slots
    .map((s) => `<li>${creatureSvg(c.traits, a.palette, { size: 34, only: s.id })}<span><b>${esc(a.t('slot.' + s.id))}</b> ${esc(a.t(`${s.id}.${c.traits[s.id]}`))}</span></li>`)
    .join('');
  const camp = a.profile.screen === 'camp';
  const rest = camp && c.status === 'available' ? btn('park', a.t('camp.park')) : camp && c.status === 'parked' ? btn('retrieve', a.t('camp.retrieve')) : '';
  return `<div class="scrim" data-act="close-inspect"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(kinName(a, c))}">
    <div class="inspect-top">${creatureSvg(c.traits, a.palette, { size: 96 })}
      <div><h2>${esc(kinName(a, c))}</h2>
      <small>${esc(a.t('inspect.cleared', { n: c.history.stopsCleared }))}<br>${esc(a.t('inspect.returned', { n: c.history.timesReturned }))}</small></div></div>
    <ul class="traits">${rows}</ul>
    <label class="row"><span>${esc(a.t('inspect.nickname'))}</span>
      <input type="text" maxlength="16" value="${esc(c.nickname || '')}" data-change="nickname" autocomplete="off"></label>
    <div class="actions">${btn('fav', a.t(c.favourite ? 'inspect.unfav' : 'inspect.fav'), '', `aria-pressed="${c.favourite}"`)}${rest}${btn('close-inspect', a.t('common.close'), 'primary')}</div>
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
