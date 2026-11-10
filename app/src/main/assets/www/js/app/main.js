// App shell: loads content packs, owns the single store, saves after every
// event, renders the current screen and turns touches into game events.

import * as game from '../core/game.js';
import { prepareContent } from '../core/content.js';
import { encodeCombo } from '../core/traits.js';
import { storage } from './storage.js';
import { bus, attachSenses } from './feedback.js';
import * as view from './screens.js';

const LANGUAGES = ['en', 'es'];
const DEFAULT_SETTINGS = { audio: true, haptics: true, reducedMotion: false, colourSafe: false, assist: true, textSize: 1, language: 'en' };

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');

const app = {
  content: null,
  settings: { ...DEFAULT_SETTINGS },
  languages: LANGUAGES,
  profile: null,
  slots: [null, null, null],
  palette: [],
  book: new Set(), // trait combinations met so far, across all Trails
  dailySolved: 0,
  ui: { view: 'title', back: 'title', slotsMode: 'continue', sel: null, inspect: null, paused: false, confirm: null, campTab: 'ready', filter: {} },
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
  const names = { traits: 'traits.json', puzzles: 'puzzles.json', trail: 'trail.json', theme: 'theme.json', goals: 'achievements.json', text: `text.${language}.json` };
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
  if (!p) return;
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
  el.style.setProperty('--accent-ink', theme.accentInk);
  el.style.setProperty('--paper', theme.paper);
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

function dispatch(ev) {
  const screen = app.profile.screen;
  const r = game.reduce(app.profile, ev, app.content);
  if (r.profile !== app.profile) {
    const p = (app.profile = r.profile);
    // A daily Stop counts once, when its result is first recorded.
    if (p.kind === 'daily' && ev.type === 'STOP_CONTINUE' && p.result && p.result.status === 'solved') app.dailySolved += 1;
    saveProfile();
  }
  if (app.profile.screen !== screen) app.ui.inspect = null;
  if (app.profile.stop === null || !app.profile.stop.queue.includes(app.ui.sel)) app.ui.sel = null;
  render();
  for (const e of r.events) bus.emit(e);
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
  else html = view.gameView(app);
  if (ui.view === 'game') {
    if (ui.paused) html += view.pauseSheet(app);
    if (ui.inspect) html += view.inspectSheet(app);
  }
  if (ui.confirm) html += view.confirmSheet(app);
  root.innerHTML = html;
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

// The screen's own subscription to gameplay feedback.
bus.on((e) => {
  if (e.type === 'accepted') flash(`[data-target="${e.target}"]`, 'yes');
  if (e.type === 'rejected') {
    flash(`[data-target="${e.target}"]`, 'no');
    const fb = e.fb;
    toast('at' in fb ? app.t(fb.at === 0 ? 'stop.fork1' : 'stop.fork2') : !('rowOk' in fb) ? app.t('stop.rejected') : fb.rowOk ? app.t('stop.rowOk') : fb.colOk ? app.t('stop.colOk') : app.t('stop.neither'));
  }
  if (e.type === 'stranded') toast(app.t('toast.stranded', { n: e.ids.length }));
  if (e.type === 'rescued') toast(app.t('toast.rescued'));
  if (e.type === 'rescueMiss') toast(app.t('toast.rescueMiss', { n: e.shared, need: app.content.trail.rescueSharedTraits }));
  if (e.type === 'assist' && e.kind === 'freeHint') toast(app.t('assist.freeHint'));
  if (e.type === 'goal') toast(app.t('toast.goal', { goal: app.t('goal.' + e.id) }));
  if (e.type === 'hint') {
    toast(e.noTokens ? app.t('stop.noHint') : e.slot ? app.t('stop.hintIs', { slot: app.t('slot.' + e.slot) }) : app.t('stop.noMoreHints'));
  }
});

// ---- Actions --------------------------------------------------------------------

function openGame(profile) {
  app.profile = profile;
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

function newTrail(slot) {
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  openGame(game.newProfile(app.content, seed, slot));
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
      if (saved && saved.doc && saved.doc.date === today()) doc = game.migrate(saved.doc, app.content);
    } catch (e) {
      doc = null;
    }
    openGame(doc || game.newDaily(app.content, today()));
  },
  'open-credits'() {
    app.ui.view = 'credits';
    render();
  },
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
    app.ui.sel = app.ui.sel === el.dataset.id ? null : el.dataset.id;
    render();
  },
  target(el) {
    if (app.ui.sel) dispatch({ type: 'ATTEMPT', id: app.ui.sel, target: el.dataset.target });
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
  if (fn) fn(el);
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
  const el = e.target.closest('.kin');
  if (!el || !e.isPrimary || e.button > 0) return;
  endDrag();
  const canDrag = el.classList.contains('tray-kin') && app.profile && app.profile.stop && app.profile.stop.status === 'playing';
  drag = { id: el.dataset.id, el, x: e.clientX, y: e.clientY, canDrag, ghost: null, over: null, pointer: e.pointerId };
  drag.timer = setTimeout(() => {
    if (!drag || drag.ghost) return;
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
    drag.ghost.className = 'kin ghost';
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
  const id = drag.id;
  const el = drag.el;
  endDrag();
  if (!dragged) return;
  suppressClick = true;
  el.classList.remove('lifted');
  const over = targetAt(e.clientX, e.clientY);
  if (over) dispatch({ type: 'ATTEMPT', id, target: over.dataset.target });
});

window.addEventListener('pointercancel', () => {
  if (drag && drag.el) drag.el.classList.remove('lifted');
  endDrag();
});
root.addEventListener('contextmenu', (e) => e.preventDefault());

// Android back button. Returns false when the app should close.
window.pathkinBack = () => {
  const ui = app.ui;
  if (ui.confirm) actions['confirm-no']();
  else if (ui.inspect) actions['close-inspect']();
  else if (ui.view === 'settings') actions['settings-back']();
  else if (ui.view === 'slots' || ui.view === 'credits' || ui.view === 'book') toTitle();
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
  refreshSlots();
  render();
}

boot().catch((e) => {
  root.textContent = 'Pathkin Trail could not start: ' + e.message;
});

// For automated UI tests.
window.__pathkin = app;
app.render = render;
