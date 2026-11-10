// App shell: loads content packs, owns the single store, saves after every
// event, renders the current screen and turns touches into game events.

import * as game from '../core/game.js';
import { prepareContent } from '../core/content.js';
import { encodeCombo } from '../core/traits.js';
import { family } from '../core/families.js';
import { storage } from './storage.js';
import { bus, attachSenses, music, voice } from './feedback.js';
import * as extras from './extras.js';
import * as view from './screens.js';
import { DEFS } from './art/paint.js';
import { scene, parchment } from './art/scenes.js';

const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt'];
const DEFAULT_SETTINGS = { audio: true, haptics: true, reducedMotion: false, colourSafe: false, assist: true, music: true, textSize: 1, language: 'en' };

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');
const stage = document.getElementById('stage');
document.getElementById('art-defs').innerHTML = DEFS;

const app = {
  content: null,
  settings: { ...DEFAULT_SETTINGS },
  languages: LANGUAGES,
  profile: null,
  slots: [null, null, null],
  palette: [],
  book: new Set(), // trait combinations met so far, across all Trails
  dailySolved: 0,
  ui: { view: 'title', back: 'title', slotsMode: 'continue', sel: null, inspect: null, paused: false, confirm: null, campTab: 'ready', filter: {}, basket: 0, convoy: [], dirs: [0, 0, 0], stopKey: '', stopStarted: 0, practiceTier: 'gentle', newTrail: null, photo: null },
  // Play record: kept on this device only, never sent anywhere.
  record: { stops: {}, daily: { last: 0, streak: 0, best: 0 } },
  t(key, vars) {
    let s = app.content.text[key];
    if (s === undefined) return key;
    if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
    return s;
  },
  // Content strings are written as "loc:key".
  loc: (ref) => (String(ref).startsWith('loc:') ? app.t(ref.slice(4)) : ref),
};

// ---- Content and storage ----------------------------------------------------

async function loadContent(language) {
  const names = { traits: 'traits.json', puzzles: 'puzzles.json', trail: 'trail.json', theme: 'theme.json', goals: 'achievements.json', trinkets: 'trinkets.json', text: `text.${language}.json` };
  const out = {};
  await Promise.all(
    Object.entries(names).map(async ([key, file]) => {
      const res = await fetch('content/' + file);
      if (!res.ok) throw new Error('Missing content pack: ' + file);
      out[key] = await res.json();
    })
  );
  return prepareContent(out);
}

function readSlot(n) {
  const key = 'slot' + n;
  const texts = [storage.load(key)];
  if (texts[0] === null) return null;
  for (let b = 1; b <= storage.backups; b++) texts.push(storage.loadBackup(key, b));
  for (const text of texts) {
    if (!text) continue;
    try {
      return { profile: game.migrate(JSON.parse(text), app.content) };
    } catch (e) {
      if (e instanceof game.FutureSaveError) return { error: 'future' };
      // fall through to the next rolling backup
    }
  }
  return { error: 'broken' };
}

function refreshSlots() {
  app.slots = [1, 2, 3].map(readSlot);
}

function saveProfile() {
  const p = app.profile;
  if (!p || p.kind === 'practice') return;
  if (p.kind === 'daily') storage.save('daily', JSON.stringify({ doc: p, solved: app.dailySolved }));
  else storage.save('slot' + p.slot, JSON.stringify(p));
}

function readJson(key, fallback) {
  try {
    const text = storage.load(key);
    return text ? JSON.parse(text) : fallback;
  } catch (e) {
    return fallback;
  }
}

function addToBook(roster) {
  const before = app.book.size;
  for (const c of roster) app.book.add(encodeCombo(app.content.traits, c.traits));
  if (app.book.size !== before) storage.save('book', JSON.stringify([...app.book]));
}

const today = () => {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

// Each leg has its own accent; the chrome follows where the player is.
function applyTheme() {
  const p = app.profile;
  const legs = app.content.trail.legs;
  let leg = legs[0];
  if (p && p.kind === 'trail' && app.ui.view === 'game') leg = (p.run && game.legDef(app.content, p.run.legId)) || legs[Math.min(p.camp, legs.length - 1)];
  const theme = app.content.theme.themes[leg.theme];
  const el = document.documentElement;
  el.style.setProperty('--accent', theme.accent);
  el.style.setProperty('--ground', theme.ground);
  el.style.setProperty('--ground-dark', theme.groundDark);
  musicTheme = leg.theme;
  paintStage(leg.theme);
}
let musicTheme = 'meadow';

// The painted backdrop changes only when the kind of screen or the biome
// does, so playing a Stop never repaints it.
let stageKey = '';
function paintStage(theme) {
  const p = app.profile;
  const view = app.ui.view;
  let kind = 'paper';
  if (view === 'title') kind = 'vista';
  else if (view === 'game') kind = { roster: 'vista', party: 'vista', stop: 'stop', summary: 'camp', camp: 'camp', finale: 'home', dailyDone: 'home' }[p.screen] || 'paper';
  // A camp sits at the end of the leg that led to it.
  if (kind === 'camp' && p.camp > 0) theme = app.content.trail.legs[Math.min(p.camp, app.content.trail.legs.length) - 1].theme;
  if (kind === 'home' || view === 'title') theme = 'meadow';
  const key = kind === 'paper' ? kind : `${kind}|${theme}`;
  if (key === stageKey) return;
  stageKey = key;
  stage.innerHTML = kind === 'paper' ? parchment() : scene(kind, app.content.theme.themes[theme]);
}

function applySettings() {
  const s = app.settings;
  const el = document.documentElement;
  el.style.fontSize = 16 * s.textSize + 'px';
  el.dataset.rm = s.reducedMotion ? '1' : '0';
  el.lang = s.language;
  app.palette = app.content.theme.palettes[s.colourSafe ? 'coloursafe' : 'default'];
}

// ---- Store --------------------------------------------------------------------

// Days as whole numbers, so "yesterday" is one less than "today".
const dayNumber = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);

function noteStop(stop, daily) {
  const key = stop.puzzleId + '|' + stop.tier;
  const row = app.record.stops[key] || { played: 0, solved: 0, wrong: 0, seconds: 0 };
  row.played += 1;
  row.solved += stop.status === 'solved' ? 1 : 0;
  row.wrong += stop.wrong;
  row.seconds += Math.min(3600, Math.round((Date.now() - app.ui.stopStarted) / 1000));
  app.record.stops[key] = row;
  if (daily && stop.status === 'solved') {
    // A gentle streak: it grows on consecutive days and simply starts again after a gap.
    const d = app.record.daily;
    const now = dayNumber();
    if (d.last !== now) d.streak = d.last === now - 1 ? d.streak + 1 : 1;
    d.last = now;
    d.best = Math.max(d.best, d.streak);
  }
  storage.save('record', JSON.stringify(app.record));
}

function dispatch(ev) {
  const screen = app.profile.screen;
  const before = app.profile.stop;
  const r = game.reduce(app.profile, ev, app.content);
  if (r.profile !== app.profile) {
    const p = (app.profile = r.profile);
    if (ev.type === 'STOP_CONTINUE' && before) noteStop(before, p.kind === 'daily');
    // A daily Stop counts once, when its result is first recorded.
    if (p.kind === 'daily' && ev.type === 'STOP_CONTINUE' && p.result && p.result.status === 'solved') app.dailySolved += 1;
    saveProfile();
  }
  if (app.profile.screen !== screen) app.ui.inspect = null;
  syncStopUi();
  if (app.profile.stop === null || !app.profile.stop.queue.includes(app.ui.sel)) app.ui.sel = null;
  render();
  for (const e of r.events) bus.emit(e);
}

// Per-Stop interface state (food basket, convoy, switch settings) starts
// fresh with each new Stop and never holds creatures that have left.
function syncStopUi() {
  const stop = app.profile && app.profile.stop;
  const key = stop ? `${app.profile.kind}|${app.profile.run.stopIndex}|${stop.puzzleId}|${stop.tier}` : '';
  if (key !== app.ui.stopKey) {
    app.ui.stopKey = key;
    app.ui.stopStarted = Date.now();
    app.ui.basket = 0;
    app.ui.convoy = [];
    app.ui.dirs = stop && stop.extra.dirs ? stop.extra.dirs.slice() : [0, 0, 0];
  }
  if (stop) app.ui.convoy = app.ui.convoy.filter((id) => stop.queue.includes(id));
}

function render() {
  const ui = app.ui;
  applyTheme();
  let html;
  if (ui.view === 'title') html = view.titleView(app);
  else if (ui.view === 'slots') html = view.slotsView(app);
  else if (ui.view === 'credits') html = view.creditsView(app);
  else if (ui.view === 'settings') html = view.settingsView(app);
  else if (ui.view === 'book') html = view.bookView(app);
  else if (ui.view === 'practice') html = extras.practiceView(app);
  else if (ui.view === 'photo') html = extras.photoView(app);
  else if (ui.view === 'record') html = extras.recordView(app);
  else html = view.gameView(app);
  if (ui.view === 'game') {
    if (ui.paused) html += view.pauseSheet(app);
    if (ui.inspect) html += view.inspectSheet(app);
  }
  if (ui.newTrail) html += extras.newTrailSheet(app);
  if (ui.confirm) html += view.confirmSheet(app);
  root.innerHTML = html;
  // Music follows the place; it thins out while a Stop is being worked on.
  const inStop = ui.view === 'game' && app.profile.screen === 'stop';
  music.set({ on: app.settings.audio && app.settings.music, tune: app.content.theme.themes[musicTheme].music, calm: inStop });
  if (mapZoom > 1) setZoom(mapZoom);
  const stop = app.profile && app.profile.stop;
  const overlay = [ui.view, ui.paused, ui.inspect, !!ui.confirm, stop && stop.status].join('|');
  if (overlay === lastOverlay) for (const el of root.querySelectorAll('.scrim')) el.classList.add('still');
  lastOverlay = overlay;
  // The Trail Map is taller than its window: keep the selected camp centred
  // (a re-render would otherwise jump back to the top).
  const on = root.querySelector('.campnode.on');
  const body = root.querySelector('.mapbody');
  if (on && body) {
    const r = on.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    body.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
  }
}

let lastOverlay = '';
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function flash(selector, cls) {
  const el = root.querySelector(selector);
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}

// Which sentence explains a miss.
function missKey(fb) {
  if ('at' in fb) return fb.at === 0 ? 'stop.fork1' : 'stop.fork2';
  if ('rowOk' in fb) return fb.rowOk ? 'stop.rowOk' : fb.colOk ? 'stop.colOk' : 'stop.neither';
  if ('dir' in fb) return fb.dir < 0 ? 'stop.lineFront' : 'stop.lineBack';
  if ('cell' in fb) return 'stop.tossMiss';
  if ('bad' in fb) return 'stop.seatMiss';
  if ('kind' in fb) return 'stop.tradeBad';
  if ('marks' in fb) return 'stop.signalMiss';
  if ('refl' in fb) return 'stop.pondMiss';
  if ('exits' in fb) return 'stop.railMiss';
  return 'stop.rejected';
}

// The screen's own subscription to gameplay feedback.
bus.on((e) => {
  // Where on the board an event happened.
  const spot = (ev) => ev.target || (ev.action && ev.action.keeper !== undefined ? 'k' + ev.action.keeper : 'rail');
  if (e.type === 'accepted') flash(`[data-target="${spot(e)}"]`, 'yes');
  if (e.type === 'rejected') {
    flash(`[data-target="${spot(e)}"]`, 'no');
    const fb = e.fb;
    toast(app.t(missKey(fb), { n: e.delivered.length }));
  }
  if (e.type === 'info') toast(app.t('stop.tradeMore'));
  if (e.type === 'stranded') toast(app.t('toast.stranded', { n: e.ids.length }));
  if (e.type === 'rescued') toast(app.t('toast.rescued'));
  if (e.type === 'rescueMiss') toast(app.t('toast.rescueMiss', { n: e.shared, need: app.content.trail.rescueSharedTraits }));
  if (e.type === 'assist' && e.kind === 'freeHint') toast(app.t('assist.freeHint'));
  if (e.type === 'goal') toast(app.t('toast.goal', { goal: app.t('goal.' + e.id) }));
  if (e.type === 'trinket') toast(app.t('toast.trinket', { name: app.t('trinket.' + e.id) }));
  if (e.type === 'hint') {
    // A hint is either a slot name or a small fact with its own sentence.
    const vars = e.say ? Object.fromEntries(Object.entries(e.say.vars).map(([k, v]) => [k, typeof v === 'string' && v in app.content.text ? app.t(v) : v])) : null;
    toast(e.noTokens ? app.t('stop.noHint') : e.say ? app.t(e.say.key, vars) : e.slot ? app.t('stop.hintIs', { slot: app.t('slot.' + e.slot) }) : app.t('stop.noMoreHints'));
  }
});

// ---- Actions --------------------------------------------------------------------

function openGame(profile) {
  app.profile = profile;
  app.ui.stopKey = '';
  syncStopUi();
  app.ui = { ...app.ui, view: 'game', sel: null, inspect: null, paused: false, filter: {}, campTab: 'ready' };
  if (profile.kind === 'trail') {
    if (profile.options.assist !== app.settings.assist) app.profile = game.reduce(profile, { type: 'OPTION', assist: app.settings.assist }, app.content).profile;
    if (profile.screen !== 'roster') addToBook(profile.roster);
  }
  saveProfile();
  render();
}

function toTitle() {
  app.profile = null;
  refreshSlots();
  app.ui = { ...app.ui, view: 'title', paused: false, inspect: null, sel: null, confirm: null };
  render();
}

function ask(text, yes) {
  app.ui.confirm = { text, yes };
  render();
}

// Opens the choices for a new Trail (how many creatures, Hard Trail or not).
function newTrail(slot) {
  app.ui.newTrail = { slot, size: app.content.trail.rosterSizes[0], hard: false };
  render();
}

function toggleRider(id) {
  const stop = app.profile.stop;
  if (app.ui.convoy.includes(id)) app.ui.convoy = app.ui.convoy.filter((x) => x !== id);
  else if (app.ui.convoy.length < Math.min(stop.setup.size, stop.queue.length)) app.ui.convoy.push(id);
}

function offer(keeper) {
  if (!app.ui.basket) return toast(app.t('stop.basketEmpty'));
  const action = { keeper, items: app.ui.basket };
  app.ui.basket = 0;
  dispatch({ type: 'ATTEMPT', action });
}

const actions = {
  'title-continue'() {
    const live = app.slots.map((s, i) => (s && s.profile ? i + 1 : 0)).filter(Boolean);
    const blocked = app.slots.some((s) => s && s.error);
    if (live.length === 1 && !blocked) return openGame(app.slots[live[0] - 1].profile);
    app.ui.view = 'slots';
    app.ui.slotsMode = 'continue';
    render();
  },
  'title-new'() {
    app.ui.view = 'slots';
    app.ui.slotsMode = 'new';
    render();
  },
  'slot-open': (el) => openGame(app.slots[el.dataset.slot - 1].profile),
  'slot-new'(el) {
    const n = Number(el.dataset.slot);
    if (!app.slots[n - 1]) return newTrail(n);
    ask(app.t('slots.overwrite'), () => {
      storage.remove('slot' + n);
      newTrail(n);
    });
  },
  'slot-delete'(el) {
    const n = Number(el.dataset.slot);
    ask(app.t('slots.deleteConfirm'), () => {
      storage.remove('slot' + n);
      refreshSlots();
      if (!app.slots.some(Boolean)) app.ui.view = 'title';
      render();
    });
  },
  'to-title': toTitle,
  'open-book'() {
    app.ui.view = 'book';
    app.ui.filter = {};
    render();
  },
  // One seeded Stop a day; a Stop already started today is resumed.
  'open-daily'() {
    const saved = readJson('daily', null);
    let doc = null;
    try {
      if (saved && saved.doc && saved.doc.date === today() && saved.doc.schemaVersion === game.SCHEMA_VERSION) doc = saved.doc;
    } catch (e) {
      doc = null;
    }
    openGame(doc || game.newDaily(app.content, today()));
  },
  'open-credits'() {
    app.ui.view = 'credits';
    render();
  },
  'nt-size'(el) {
    app.ui.newTrail.size = Number(el.dataset.size);
    render();
  },
  'nt-cancel'() {
    app.ui.newTrail = null;
    render();
  },
  'nt-start'() {
    const { slot, size, hard } = app.ui.newTrail;
    app.ui.newTrail = null;
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    openGame(game.newProfile(app.content, seed, slot, { assist: app.settings.assist, hardTrail: hard, rosterSize: size }));
  },
  'open-practice'() {
    app.profile = null;
    app.ui.view = 'practice';
    render();
  },
  'practice-tier'(el) {
    app.ui.practiceTier = el.dataset.tier;
    render();
  },
  'practice-start': (el) => openGame(game.newDaily(app.content, today(), { puzzleId: el.dataset.puzzle, tier: app.ui.practiceTier })),
  'open-record'() {
    app.ui.view = 'record';
    render();
  },
  'open-settings-back'() {
    app.ui.view = 'settings';
    render();
  },
  'record-erase'() {
    ask(app.t('record.eraseConfirm'), () => {
      app.record = { stops: {}, daily: { last: 0, streak: 0, best: 0 } };
      storage.save('record', JSON.stringify(app.record));
      render();
    });
  },
  trinket: (el) => dispatch({ type: 'TRINKET', id: app.ui.inspect, trinket: el.dataset.trinket || null }),
  'open-photo'() {
    const leg = app.content.trail.legs[Math.min(app.profile.camp, app.content.trail.legs.length - 1)];
    app.ui.photo = { scene: 'stop|' + leg.theme, stickers: [], pick: null };
    app.ui.inspect = null;
    app.ui.view = 'photo';
    render();
  },
  'photo-back'() {
    app.ui.view = 'game';
    render();
  },
  'photo-scene'(el) {
    app.ui.photo.scene = el.dataset.scene;
    render();
  },
  'photo-pick'(el) {
    app.ui.photo.pick = app.ui.photo.pick === el.dataset.sticker ? null : el.dataset.sticker;
    render();
  },
  'photo-clear'() {
    app.ui.photo.stickers = [];
    render();
  },
  'photo-place'(el, e) {
    const ph = app.ui.photo;
    if (!ph.pick || ph.stickers.length >= 24) return;
    const box = el.querySelector('svg').getBoundingClientRect();
    // Keyboard users get stickers dropped in a tidy row.
    const x = e && e.clientX ? ((e.clientX - box.left) / box.width) * 390 : 40 + (ph.stickers.length % 8) * 44;
    const y = e && e.clientY ? ((e.clientY - box.top) / box.height) * 488 : 60 + Math.floor(ph.stickers.length / 8) * 44;
    ph.stickers.push({ k: ph.pick, x: Math.round(x), y: Math.round(y) });
    render();
  },
  'photo-save': savePhoto,
  'open-settings'() {
    app.ui.back = app.ui.view;
    app.ui.view = 'settings';
    render();
  },
  'settings-back'() {
    app.ui.view = app.ui.back;
    render();
  },
  'confirm-yes'() {
    const yes = app.ui.confirm.yes;
    app.ui.confirm = null;
    yes();
  },
  'confirm-no'() {
    app.ui.confirm = null;
    render();
  },

  reroll: () => dispatch({ type: 'REROLL' }),
  'roster-ok'() {
    addToBook(app.profile.roster);
    dispatch({ type: 'ROSTER_OK' });
  },
  'select-camp': (el) => dispatch({ type: 'SELECT_CAMP', camp: Number(el.dataset.camp) }),
  'suggest-yes'() {
    const leg = app.content.trail.legs[app.profile.camp];
    const order = app.content.puzzles.tierOrder;
    dispatch({ type: 'SET_TIER', legId: leg.id, tier: order[order.indexOf(app.profile.legs[leg.id].tier) + 1] });
  },
  'suggest-no': () => dispatch({ type: 'DISMISS_SUGGEST' }),
  'rescue-friend': (el) => dispatch({ type: 'RESCUE', id: app.ui.inspect, friendId: el.dataset.id }),
  'rescue-token': () => dispatch({ type: 'RESCUE', id: app.ui.inspect, token: true }),
  'rescue-free': () => dispatch({ type: 'RESCUE', id: app.ui.inspect }),
  goto(el) {
    app.ui.filter = {};
    dispatch({ type: 'GOTO', screen: el.dataset.screen });
  },
  'set-tier': (el) => dispatch({ type: 'SET_TIER', legId: app.content.trail.legs[app.profile.camp].id, tier: el.dataset.tier }),
  'end-trail'() {
    const n = app.profile.roster.length - game.countStatus(app.profile, 'delivered');
    ask(app.t('map.endConfirm', { n }), () => dispatch({ type: 'GOTO', screen: 'finale' }));
  },
  'party-toggle': (el) => dispatch({ type: 'PARTY_TOGGLE', id: el.dataset.id }),
  'party-fill': () => dispatch({ type: 'PARTY_FILL', ids: view.filteredAvailable(app).map((c) => c.id) }),
  'party-clear': () => dispatch({ type: 'PARTY_CLEAR' }),
  'start-leg': (el) => dispatch({ type: 'START_LEG', branch: el.dataset.branch }),

  tray(el) {
    const id = el.dataset.id;
    // On the rails a tap adds a rider to the convoy, or takes it out again.
    if (app.profile.stop.family === 'switch_run') toggleRider(id);
    else app.ui.sel = app.ui.sel === id ? null : id;
    // Each creature has a little call of its own, set by its feet.
    if (app.settings.audio) voice(app.profile.roster.find((c) => c.id === id).traits);
    render();
  },
  target(el) {
    const stop = app.profile.stop;
    const target = el.dataset.target;
    if (target === 'rail') return;
    if (app.ui.sel) dispatch({ type: 'ATTEMPT', action: { id: app.ui.sel, target } });
    // Tapping a taken seat with nobody picked lifts whoever sits there.
    else if (family(stop.family).kind === 'seat' && stop.extra.seats[Number(target.slice(1))]) dispatch({ type: 'ATTEMPT', action: { lift: target } });
  },
  item(el) {
    app.ui.basket ^= 1 << Number(el.dataset.item);
    render();
  },
  keeper: (el) => offer(Number(el.dataset.keeper)),
  switch(el) {
    app.ui.dirs[Number(el.dataset.switch)] ^= 1;
    render();
  },
  launch() {
    const action = { dirs: app.ui.dirs.slice(), convoy: app.ui.convoy.slice() };
    app.ui.convoy = [];
    dispatch({ type: 'ATTEMPT', action });
    if (app.profile.stop && app.profile.stop.extra.dirs) app.ui.dirs = app.profile.stop.extra.dirs.slice();
    render();
  },
  hint: () => dispatch({ type: 'HINT' }),
  pause() {
    app.ui.paused = true;
    render();
  },
  resume() {
    app.ui.paused = false;
    render();
  },
  'stop-continue': () => dispatch({ type: 'STOP_CONTINUE' }),
  'summary-ok': () => dispatch({ type: 'SUMMARY_OK' }),
  'camp-tab'(el) {
    app.ui.campTab = el.dataset.tab;
    render();
  },

  inspect(el) {
    app.ui.inspect = el.dataset.id;
    render();
  },
  'close-inspect'() {
    app.ui.inspect = null;
    render();
  },
  fav: () => dispatch({ type: 'FAVOURITE', id: app.ui.inspect }),
  park() {
    const id = app.ui.inspect;
    app.ui.inspect = null;
    dispatch({ type: 'PARK', id });
  },
  retrieve() {
    const id = app.ui.inspect;
    app.ui.inspect = null;
    dispatch({ type: 'RETRIEVE', id });
  },
};

const changes = {
  async setting(el) {
    const key = el.dataset.key;
    app.settings[key] = el.type === 'checkbox' ? el.checked : key === 'textSize' ? Number(el.value) : el.value;
    storage.save('settings', JSON.stringify(app.settings));
    if (key === 'language') app.content = await loadContent(app.settings.language);
    if (key === 'assist' && app.profile && app.profile.kind === 'trail') {
      app.profile = game.reduce(app.profile, { type: 'OPTION', assist: app.settings.assist }, app.content).profile;
      saveProfile();
    }
    applySettings();
    render();
  },
  'nt-hard'(el) {
    app.ui.newTrail.hard = el.checked;
    render();
  },
  filter(el) {
    if (el.value === '') delete app.ui.filter[el.dataset.slot];
    else app.ui.filter[el.dataset.slot] = el.value;
    render();
  },
  nickname: (el) => dispatch({ type: 'NICKNAME', id: app.ui.inspect, name: el.value }),
};

// ---- Input ------------------------------------------------------------------------

let suppressClick = false;

root.addEventListener('click', (e) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  let el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  // A scrim only closes when the scrim itself is tapped, not its sheet.
  if (el.classList.contains('scrim') && e.target !== el) return;
  // With a creature picked, tapping anywhere on a target sends it there.
  if (el.dataset.act === 'inspect' && app.ui.sel && el.closest('[data-target]')) el = el.closest('[data-target]');
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

root.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el);
});

root.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
    e.preventDefault();
    e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});

// Drag to send (tap-then-tap is the click path above); long-press inspects.
const DRAG_SLOP = 10;
const LONG_PRESS_MS = 480;
let drag = null;

function endDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  if (drag.ghost) drag.ghost.remove();
  if (drag.over) drag.over.classList.remove('over');
  drag = null;
}

function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('[data-target]') : null;
}

root.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.kin, .basket');
  if (!el || !e.isPrimary || e.button > 0) return;
  endDrag();
  const playing = app.profile && app.profile.stop && app.profile.stop.status === 'playing';
  const basket = el.classList.contains('basket');
  const canDrag = playing && (basket ? app.ui.basket > 0 : el.classList.contains('tray-kin'));
  drag = { id: el.dataset.id, basket, el, x: e.clientX, y: e.clientY, canDrag, ghost: null, over: null, pointer: e.pointerId };
  drag.timer = setTimeout(() => {
    if (!drag || drag.ghost || drag.basket) return;
    const id = drag.id;
    endDrag();
    suppressClick = true;
    app.ui.inspect = id;
    render();
  }, LONG_PRESS_MS);
});

window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_SLOP;
  if (!drag.ghost) {
    if (!far) return;
    clearTimeout(drag.timer);
    if (!drag.canDrag) return endDrag();
    drag.ghost = drag.el.cloneNode(true);
    drag.ghost.className = (drag.basket ? 'basket' : 'kin') + ' ghost';
    document.body.appendChild(drag.ghost);
    drag.el.classList.add('lifted');
  }
  drag.ghost.style.transform = `translate(${e.clientX - 32}px, ${e.clientY - 48}px)`;
  const over = targetAt(e.clientX, e.clientY);
  if (over !== drag.over) {
    if (drag.over) drag.over.classList.remove('over');
    if (over) over.classList.add('over');
    drag.over = over;
  }
});

window.addEventListener('pointerup', (e) => {
  // The click that follows a long-press or drag is swallowed; never let the
  // flag outlive that one gesture.
  setTimeout(() => (suppressClick = false), 60);
  if (!drag || e.pointerId !== drag.pointer) return;
  const dragged = !!drag.ghost;
  const { id, el, basket } = drag;
  endDrag();
  if (!dragged) return;
  suppressClick = true;
  el.classList.remove('lifted');
  const over = targetAt(e.clientX, e.clientY);
  if (!over) return;
  if (basket) {
    if (over.dataset.keeper !== undefined) offer(Number(over.dataset.keeper));
  } else if (app.profile.stop.family === 'switch_run') {
    if (over.dataset.target === 'rail' && !app.ui.convoy.includes(id)) toggleRider(id);
    render();
  } else dispatch({ type: 'ATTEMPT', action: { id, target: over.dataset.target } });
});

window.addEventListener('pointercancel', () => {
  if (drag && drag.el) drag.el.classList.remove('lifted');
  endDrag();
});
root.addEventListener('contextmenu', (e) => e.preventDefault());

// Saves the picture as a PNG: to the gallery on Android, as a download on the web.
function savePhoto() {
  const svg = new XMLSerializer().serializeToString(root.querySelector('.photo-svg'));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1170;
    canvas.height = 1464;
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/png');
    if (window.PathkinNative && window.PathkinNative.savePicture) {
      toast(app.t(window.PathkinNative.savePicture(data.split(',')[1]) ? 'photo.saved' : 'photo.failed'));
    } else {
      const link = document.createElement('a');
      link.href = data;
      link.download = 'pathkin-trail.png';
      link.click();
      toast(app.t('photo.saved'));
    }
  };
  img.onerror = () => toast(app.t('photo.failed'));
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Gestures (never the only way to do anything): double-tap or pinch to zoom
// the Trail Map, swipe sideways to change Camp tab.
let mapZoom = 1;
const fingers = new Map();
let pinchStart = 0;
let swipeStart = null;
function setZoom(z) {
  mapZoom = Math.max(1, Math.min(2.2, z));
  const map = root.querySelector('.map');
  if (map) map.style.width = mapZoom * 100 + '%';
}
root.addEventListener('dblclick', (e) => {
  if (e.target.closest('.mapbody') && !e.target.closest('[data-act]')) setZoom(mapZoom > 1 ? 1 : 1.7);
});
root.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.mapbody')) fingers.set(e.pointerId, e);
  if (fingers.size === 2) {
    const [a, b] = [...fingers.values()];
    pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / mapZoom;
  }
  swipeStart = app.ui.view === 'game' && app.profile.screen === 'camp' && !e.target.closest('.kin, .sheet, .actions') ? { x: e.clientX, y: e.clientY } : null;
});
root.addEventListener('pointermove', (e) => {
  if (!fingers.has(e.pointerId)) return;
  fingers.set(e.pointerId, e);
  if (fingers.size === 2 && pinchStart) {
    const [a, b] = [...fingers.values()];
    setZoom(Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinchStart);
  }
});
const liftFinger = (e) => {
  fingers.delete(e.pointerId);
  if (fingers.size < 2) pinchStart = 0;
  if (swipeStart && e.type === 'pointerup') {
    const dx = e.clientX - swipeStart.x;
    if (Math.abs(dx) > 70 && Math.abs(e.clientY - swipeStart.y) < 50) {
      const tabs = [...root.querySelectorAll('[data-act="camp-tab"]')].map((el) => el.dataset.tab);
      const at = tabs.indexOf(root.querySelector('.tab.on').dataset.tab);
      const next = tabs[at + (dx < 0 ? 1 : -1)];
      if (next) {
        app.ui.campTab = next;
        render();
      }
    }
  }
  swipeStart = null;
};
root.addEventListener('pointerup', liftFinger);
root.addEventListener('pointercancel', liftFinger);

// Android back button. Returns false when the app should close.
window.pathkinBack = () => {
  const ui = app.ui;
  if (ui.confirm) actions['confirm-no']();
  else if (ui.inspect) actions['close-inspect']();
  else if (ui.view === 'settings') actions['settings-back']();
  else if (ui.newTrail) actions['nt-cancel']();
  else if (ui.view === 'photo') actions['photo-back']();
  else if (ui.view === 'record') actions['open-settings-back']();
  else if (ui.view === 'slots' || ui.view === 'credits' || ui.view === 'book' || ui.view === 'practice') toTitle();
  else if (ui.view === 'game') {
    const screen = app.profile.screen;
    if (screen === 'stop') {
      ui.paused = !ui.paused;
      render();
    } else if (screen === 'party' || screen === 'camp' || screen === 'goals') dispatch({ type: 'GOTO', screen: 'map' });
    else toTitle();
  } else return false;
  return true;
};

// ---- Boot ---------------------------------------------------------------------------

async function boot() {
  try {
    const saved = storage.load('settings');
    if (saved) app.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch (e) {
    /* keep defaults */
  }
  if (!LANGUAGES.includes(app.settings.language)) app.settings.language = 'en';
  app.content = await loadContent(app.settings.language);
  applySettings();
  attachSenses(() => app.settings);
  app.book = new Set(readJson('book', []));
  app.dailySolved = (readJson('daily', {}) || {}).solved || 0;
  const rec = readJson('record', null);
  if (rec && rec.stops && rec.daily) app.record = rec;
  refreshSlots();
  render();
  // The splash shows for at most a second and a half.
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 400);
  }
  // The web build works offline once it has been opened.
  if (!window.PathkinNative && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch((e) => {
  root.textContent = 'Pathkin Trail could not start: ' + e.message;
});

// For automated UI tests.
window.__pathkin = app;
app.render = render;
