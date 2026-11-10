// App state machine. The profile is one serialisable JSON document; every
// screen is a state and every change is reduce(profile, event, content).
// Returns { profile, events } and never touches UI or storage.
//
// The Trail is a chain of camps (0 = start ... last = home). Leg N leads from
// camp N-1 to camp N; some legs fork into branches. Creatures wait at a camp
// (available or parked), travel (party), get stranded (lost, recoverable at
// the next camp) or reach home (delivered).

import { hashSeed } from './rng.js';
import { buildRoster } from './traits.js';
import * as runtime from './runtime.js';

export const SCHEMA_VERSION = 4;

const newStats = () => ({ stopsSolved: 0, flawlessStops: 0, legsCleared: 0, fullParties: 0, delivered: 0, rescued: 0, branchesSeen: 0, legsWithoutHints: 0, homePercent: 0 });
const DEFAULT_OPTIONS = { assist: true, hardTrail: false };

// Forward migrations: MIGRATIONS[n] upgrades a version-n document to n+1.
const MIGRATIONS = {
  // v1 had one leg ending at a camp that counted as home. In v2 the Trail
  // continues: those creatures now wait at camp 1. A Stop in progress is
  // abandoned safely (its party walks back to the start).
  1: (doc) => ({
    ...doc,
    schemaVersion: 2,
    kind: 'trail',
    screen: doc.screen === 'roster' ? 'roster' : 'map',
    roster: doc.roster.map((c) => ({
      ...c,
      status: c.status === 'parked' ? 'parked' : 'available',
      at: c.status === 'delivered' ? 1 : 0,
      history: { ...c.history, returnedBy: {} },
    })),
    camp: 0,
    selection: [],
    run: null,
    stop: null,
    summary: null,
    stats: newStats(),
    goals: {},
    seen: {},
    assist: { window: [], suggest: null },
    options: { assist: true },
  }),
  // v2 had four legs (camps 0 to 4). v3 has three legs of twelve different
  // Stops (camps 0 to 3): the old third camp folds into camp 2 and the old
  // last leg becomes leg 3. A Stop in progress is abandoned safely.
  2: (doc) => {
    if (doc.kind !== 'trail') return { ...doc, schemaVersion: 3 };
    const camp = (c) => [0, 1, 2, 2, 3][c];
    const seen = Object.fromEntries(Object.entries(doc.seen).filter(([key]) => /^leg[12]:/.test(key)));
    return {
      ...doc,
      schemaVersion: 3,
      screen: doc.screen === 'roster' ? 'roster' : 'map',
      roster: doc.roster.map((c) => {
        const out = { ...c, status: c.status === 'party' ? 'available' : c.status, at: camp(c.at) };
        if (c.status === 'lost') {
          out.lostAt = camp(c.lostAt);
          out.at = Math.min(out.at, out.lostAt - 1);
        }
        return out;
      }),
      camp: camp(doc.camp),
      selection: [],
      run: null,
      stop: null,
      summary: null,
      legs: { leg1: doc.legs.leg1, leg2: doc.legs.leg2, leg3: doc.legs.leg4 },
      seen,
      stats: { ...doc.stats, branchesSeen: Object.keys(seen).length },
      assist: { window: [], suggest: null },
    };
  },
  // v4 adds Trail options (Hard Trail, roster size), trinkets and a
  // "share of the roster home" counter. Nothing moves.
  3: (doc) => {
    if (doc.kind !== 'trail') return { ...doc, schemaVersion: 4 };
    const delivered = doc.roster.filter((c) => c.status === 'delivered').length;
    return {
      ...doc,
      schemaVersion: 4,
      options: { ...DEFAULT_OPTIONS, ...doc.options },
      stats: { ...doc.stats, homePercent: Math.round((100 * delivered) / doc.roster.length) },
      trinketsSeen: [],
    };
  },
};

export class FutureSaveError extends Error {}

export function migrate(doc, content) {
  if (!doc || typeof doc.schemaVersion !== 'number') throw new Error('Not a save document');
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new FutureSaveError(`Save version ${doc.schemaVersion} is newer than this game (${SCHEMA_VERSION})`);
  }
  let out = doc;
  while (out.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[out.schemaVersion];
    if (!step) throw new Error('No migration from save version ' + out.schemaVersion);
    out = step(out);
  }
  // Legs added by newer content packs get default state.
  if (out.kind === 'trail' && content.trail.legs.some((l) => !out.legs[l.id])) {
    const legs = newLegs(content);
    for (const id of Object.keys(legs)) if (out.legs[id]) legs[id] = out.legs[id];
    out = { ...out, legs };
  }
  return out;
}

function newLegs(content) {
  const legs = {};
  for (const leg of content.trail.legs) legs[leg.id] = { tier: content.puzzles.tierOrder[0], fullParties: 0, cleared: 0 };
  return legs;
}

// options: { assist, hardTrail, rosterSize }. A Hard Trail is opt-in: a
// creature that gets stranded there is gone for good.
export function newProfile(content, seed, slot, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, rosterSize: content.traits.rosterSize, ...options };
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'trail',
    slot,
    seed: seed >>> 0,
    rng: hashSeed(seed),
    screen: 'roster',
    roster: buildRoster(content.traits, seed, opts.rosterSize).map((c) => ({ ...c, at: 0, history: { ...c.history, returnedBy: {} } })),
    camp: 0,
    selection: [],
    hintTokens: content.trail.startHintTokens,
    legs: newLegs(content),
    run: null,
    stop: null,
    summary: null,
    stats: newStats(),
    goals: {},
    seen: {},
    assist: { window: [], suggest: null },
    options: opts,
    trinketsSeen: [],
  };
}

// The daily Stop: one seeded puzzle a day, the same for everyone, played
// outside any Trail with its own small party. With `practice` (a puzzle id
// and a tier) the same thing becomes a free practice Stop of the player's choice.
export function newDaily(content, date, practice = null) {
  const cfg = { ...content.trail.daily, ...(practice ? { puzzles: [practice.puzzleId], tier: practice.tier } : {}) };
  const seed = hashSeed(date);
  const roster = buildRoster(content.traits, seed)
    .slice(0, cfg.partySize)
    .map((c) => ({ ...c, status: 'party', at: 0, history: { ...c.history, returnedBy: {} } }));
  const base = {
    schemaVersion: SCHEMA_VERSION,
    kind: practice ? 'practice' : 'daily',
    date,
    seed,
    rng: hashSeed(seed + 1),
    screen: 'stop',
    roster,
    selection: [],
    hintTokens: 1,
    run: { daily: true, puzzleId: cfg.puzzles[date % cfg.puzzles.length], tier: cfg.tier, stopIndex: 0 },
    stop: null,
    result: null,
  };
  return beginStop(base, content, roster.map((c) => c.id));
}

export const HOME = (content) => content.trail.legs.length;
export const puzzleDef = (content, id) => content.puzzles.puzzles.find((p) => p.id === id);
export const legDef = (content, id) => content.trail.legs.find((l) => l.id === id);
export const branchDef = (leg, id) => leg.branches.find((b) => b.id === id);
export const countStatus = (profile, status) => profile.roster.filter((c) => c.status === status).length;
export const readyAt = (profile, camp) => profile.roster.filter((c) => c.status === 'available' && c.at === camp);
export const strandedAt = (profile, camp) => profile.roster.filter((c) => c.status === 'lost' && c.lostAt === camp);
// The Trail is over when everyone who can still come home has done so.
export const goneCount = (profile) => profile.roster.filter((c) => c.gone).length;
export const allHome = (profile) => countStatus(profile, 'delivered') === profile.roster.length - goneCount(profile);
const homePercent = (profile) => Math.round((100 * countStatus(profile, 'delivered')) / profile.roster.length);
// Cosmetic trinkets are unlocked by the profile's counters (content/trinkets.json).
export const unlockedTrinkets = (profile, content) => content.trinkets.trinkets.filter((t) => profile.stats[t.stat] >= t.atLeast).map((t) => t.id);

export function sharedTraits(a, b) {
  return Object.keys(a.traits).filter((slot) => a.traits[slot] === b.traits[slot]).length;
}

// Who at this camp can go and fetch a stranded creature.
export function friendsFor(profile, content, lost) {
  const home = lost.lostAt === HOME(content);
  return profile.roster.filter((c) => c.at === lost.lostAt && c.status === (home ? 'delivered' : 'available'));
}

// Nobody is ever stuck for good: when no friend here matches and nobody is
// left further back to bring one, the creature may simply be called in.
export function canFreeRescue(profile, content, lost) {
  const need = content.trail.rescueSharedTraits;
  if (friendsFor(profile, content, lost).some((f) => sharedTraits(f, lost) >= need)) return false;
  return !profile.roster.some((c) => ['available', 'parked', 'party'].includes(c.status) && c.at < lost.lostAt);
}

export function stopCtx(profile, content) {
  const creatures = {};
  for (const c of profile.roster) creatures[c.id] = c.traits;
  return { def: puzzleDef(content, profile.stop.puzzleId), traits: content.traits, creatures };
}

function withRoster(profile, ids, change) {
  const set = new Set(ids);
  return profile.roster.map((c) => (set.has(c.id) ? change(c) : c));
}

function beginStop(profile, content, partyIds) {
  const run = profile.run;
  let puzzleId = run.puzzleId;
  let tier = run.tier;
  if (!run.daily) {
    const leg = legDef(content, run.legId);
    puzzleId = branchDef(leg, run.branch).stops[run.stopIndex];
    tier = profile.legs[leg.id].tier;
  }
  const creatures = {};
  for (const c of profile.roster) creatures[c.id] = c.traits;
  const gen = runtime.generate({ def: puzzleDef(content, puzzleId), traits: content.traits, creatures }, tier, profile.rng, partyIds);
  return { ...profile, rng: gen.rngState, stop: gen.state, screen: 'stop' };
}

function finishLeg(profile, content, arrivedIds) {
  const run = profile.run;
  const leg = legDef(content, run.legId);
  const home = leg.to === HOME(content);
  const legState = { ...profile.legs[run.legId] };
  const cap = content.trail.hintTokenCap;
  const cleared = arrivedIds.length > 0;
  const earned = Math.min(run.flawlessStops + (cleared ? 1 : 0), Math.max(0, cap - profile.hintTokens));
  const fullParty = arrivedIds.length === content.traits.partyMax;
  const stats = { ...profile.stats };
  const seen = { ...profile.seen };
  let tierUp = null;
  if (cleared) {
    legState.cleared += 1;
    stats.legsCleared += 1;
    if (run.hintsUsed === 0) stats.legsWithoutHints += 1;
    if (home) stats.delivered += arrivedIds.length;
    const key = `${run.legId}:${run.branch}`;
    if (!seen[key]) {
      seen[key] = true;
      stats.branchesSeen += 1;
    }
  }
  if (fullParty) {
    legState.fullParties += 1;
    stats.fullParties += 1;
    const order = content.puzzles.tierOrder;
    const at = order.indexOf(legState.tier);
    if (legState.fullParties % content.trail.fullPartiesToRaiseTier === 0 && at < order.length - 1) {
      legState.tier = tierUp = order[at + 1];
    }
  }
  const roster = withRoster(profile, arrivedIds, (c) => ({ ...c, status: home ? 'delivered' : 'available', at: leg.to }));
  stats.homePercent = homePercent({ roster });
  return {
    ...profile,
    roster,
    hintTokens: profile.hintTokens + earned,
    legs: { ...profile.legs, [run.legId]: legState },
    stats,
    seen,
    camp: cleared ? leg.to : leg.from,
    summary: {
      legId: run.legId,
      branch: run.branch,
      to: leg.to,
      home,
      arrived: arrivedIds.length,
      returned: run.returned.length,
      stranded: run.stranded.length,
      flawlessStops: run.flawlessStops,
      tokensEarned: earned,
      fullParty,
      tierUp,
    },
    run: null,
    stop: null,
    selection: [],
    screen: 'summary',
  };
}

// Adaptive assist: looks only at finished Stops and only changes what is
// offered between Stops, never a puzzle in progress.
function assistAfterStop(profile, content, stop, events) {
  const cfg = content.trail.assist;
  let window = [...profile.assist.window, { failed: stop.status === 'failed', flawless: stop.status === 'solved' && stop.wrong === 0 }].slice(-cfg.window);
  let next = { ...profile, assist: { ...profile.assist, window } };
  if (!profile.options.assist) return next;
  const lastAre = (n, key) => window.length >= n && window.slice(-n).every((w) => w[key]);
  if (lastAre(cfg.failsForFreeHint, 'failed') && profile.hintTokens < content.trail.hintTokenCap) {
    next = { ...next, hintTokens: profile.hintTokens + 1, assist: { ...next.assist, window: [] } };
    events.push({ type: 'assist', kind: 'freeHint' });
  } else if (lastAre(cfg.flawlessForTierUp, 'flawless')) {
    const order = content.puzzles.tierOrder;
    const legId = profile.run.legId;
    if (order.indexOf(profile.legs[legId].tier) < order.length - 1) {
      next = { ...next, assist: { window: [], suggest: legId } };
      events.push({ type: 'assist', kind: 'tierUp' });
    }
  }
  return next;
}

function reduceDaily(profile, ev, content) {
  const none = { profile, events: [] };
  if (ev.type === 'STOP_CONTINUE') {
    if (!profile.stop || profile.stop.status === 'playing') return none;
    const stop = profile.stop;
    return {
      profile: { ...profile, screen: 'dailyDone', result: { status: stop.status, wrong: stop.wrong, through: Object.keys(stop.placed).length } },
      events: [],
    };
  }
  return none;
}

function reduceInner(profile, ev, content) {
  const none = { profile, events: [] };
  const idle = !profile.run;
  const daily = profile.kind !== 'trail';
  const home = HOME(content);
  switch (ev.type) {
    // ---- Shared by Trail and daily Stops ----
    case 'ATTEMPT': {
      if (!profile.stop) return none;
      const r = runtime.attempt(profile.stop, stopCtx(profile, content), ev.action || { id: ev.id, target: ev.target });
      return { profile: { ...profile, stop: r.state }, events: r.events };
    }
    case 'HINT': {
      if (!profile.stop || profile.stop.status !== 'playing') return none;
      if (profile.hintTokens < 1) return { profile, events: [{ type: 'hint', slot: null, noTokens: true }] };
      const r = runtime.hint(profile.stop, stopCtx(profile, content));
      const used = r.used ? 1 : 0;
      return {
        profile: { ...profile, stop: r.state, hintTokens: profile.hintTokens - used, run: { ...profile.run, hintsUsed: (profile.run.hintsUsed || 0) + used } },
        events: r.events,
      };
    }
    case 'NICKNAME': {
      const name = String(ev.name || '').trim().slice(0, 16) || null;
      return { profile: { ...profile, roster: withRoster(profile, [ev.id], (c) => ({ ...c, nickname: name })) }, events: [] };
    }
    case 'FAVOURITE':
      return { profile: { ...profile, roster: withRoster(profile, [ev.id], (c) => ({ ...c, favourite: !c.favourite })) }, events: [] };
    // Give a creature one unlocked trinket to wear, or take it off.
    case 'TRINKET': {
      if (profile.kind !== 'trail' || (ev.trinket && !unlockedTrinkets(profile, content).includes(ev.trinket))) return none;
      return { profile: { ...profile, roster: withRoster(profile, [ev.id], (c) => ({ ...c, trinket: ev.trinket || null })) }, events: [] };
    }
  }
  if (daily) return reduceDaily(profile, ev, content);

  switch (ev.type) {
    case 'REROLL': {
      if (profile.screen !== 'roster') return none;
      return { profile: newProfile(content, hashSeed(profile.seed + 1), profile.slot, profile.options), events: [] };
    }
    case 'ROSTER_OK':
      return profile.screen === 'roster' ? { profile: { ...profile, screen: 'map' }, events: [] } : none;

    case 'GOTO': {
      if (!idle || profile.screen === 'roster' || !['map', 'party', 'camp', 'finale', 'goals'].includes(ev.screen)) return none;
      if (ev.screen === 'party' && profile.camp >= home) return none;
      return { profile: { ...profile, screen: ev.screen, summary: null, selection: ev.screen === 'party' ? profile.selection : [] }, events: [] };
    }
    case 'SELECT_CAMP': {
      if (!idle || !Number.isInteger(ev.camp) || ev.camp < 0 || ev.camp > home) return none;
      return { profile: { ...profile, camp: ev.camp, selection: [] }, events: [] };
    }
    case 'SET_TIER': {
      if (!idle || !content.puzzles.tierOrder.includes(ev.tier) || !profile.legs[ev.legId]) return none;
      return {
        profile: {
          ...profile,
          legs: { ...profile.legs, [ev.legId]: { ...profile.legs[ev.legId], tier: ev.tier } },
          assist: { ...profile.assist, suggest: profile.assist.suggest === ev.legId ? null : profile.assist.suggest },
        },
        events: [],
      };
    }
    case 'DISMISS_SUGGEST':
      return { profile: { ...profile, assist: { ...profile.assist, suggest: null } }, events: [] };
    case 'OPTION':
      return { profile: { ...profile, options: { ...profile.options, assist: !!ev.assist } }, events: [] };

    case 'PARTY_TOGGLE': {
      if (!idle) return none;
      const c = profile.roster.find((x) => x.id === ev.id);
      if (!c || c.status !== 'available' || c.at !== profile.camp) return none;
      const has = profile.selection.includes(ev.id);
      if (!has && profile.selection.length >= content.traits.partyMax) return none;
      const selection = has ? profile.selection.filter((id) => id !== ev.id) : [...profile.selection, ev.id];
      return { profile: { ...profile, selection }, events: [] };
    }
    case 'PARTY_FILL': {
      if (!idle) return none;
      const ready = new Set(readyAt(profile, profile.camp).map((c) => c.id));
      const pool = (ev.ids || [...ready]).filter((id) => ready.has(id) && !profile.selection.includes(id));
      const room = content.traits.partyMax - profile.selection.length;
      return { profile: { ...profile, selection: [...profile.selection, ...pool.slice(0, room)] }, events: [] };
    }
    case 'PARTY_CLEAR':
      return idle ? { profile: { ...profile, selection: [] }, events: [] } : none;

    case 'START_LEG': {
      const leg = content.trail.legs[profile.camp];
      if (!idle || !leg || profile.selection.length < 1) return none;
      const branch = branchDef(leg, ev.branch || leg.branches[0].id);
      if (!branch) return none;
      const party = profile.selection.slice();
      const next = {
        ...profile,
        roster: withRoster(profile, party, (c) => ({ ...c, status: 'party' })),
        selection: [],
        summary: null,
        run: { legId: leg.id, branch: branch.id, stopIndex: 0, startSize: party.length, flawlessStops: 0, hintsUsed: 0, returned: [], stranded: [] },
      };
      return { profile: beginStop(next, content, party), events: [] };
    }

    case 'STOP_CONTINUE': {
      const stop = profile.stop;
      if (!stop || stop.status === 'playing') return none;
      const leg = legDef(content, profile.run.legId);
      const through = Object.keys(stop.placed);
      const back = stop.queue;
      const stranded = [];
      const events = [];
      const roster = profile.roster.map((c) => {
        if (back.includes(c.id)) {
          const times = (c.history.returnedBy[stop.puzzleId] || 0) + 1;
          const history = { ...c.history, timesReturned: c.history.timesReturned + 1, returnedBy: { ...c.history.returnedBy, [stop.puzzleId]: times } };
          if (times >= content.trail.strandAfterReturns) {
            stranded.push(c.id);
            // On a Hard Trail a stranded creature cannot be brought back.
            if (profile.options.hardTrail) return { ...c, status: 'lost', gone: true, history: { ...history, returnedBy: {} } };
            return { ...c, status: 'lost', lostAt: leg.to, history: { ...history, returnedBy: {} } };
          }
          return { ...c, status: 'available', history };
        }
        if (through.includes(c.id)) return { ...c, history: { ...c.history, stopsCleared: c.history.stopsCleared + 1 } };
        return c;
      });
      if (stranded.length) events.push({ type: 'stranded', ids: stranded });
      const solved = stop.status === 'solved';
      const flawless = solved && stop.wrong === 0;
      let next = {
        ...profile,
        roster,
        stats: { ...profile.stats, stopsSolved: profile.stats.stopsSolved + (solved ? 1 : 0), flawlessStops: profile.stats.flawlessStops + (flawless ? 1 : 0) },
        run: {
          ...profile.run,
          returned: [...profile.run.returned, ...back],
          stranded: [...profile.run.stranded, ...stranded],
          flawlessStops: profile.run.flawlessStops + (flawless ? 1 : 0),
        },
      };
      next = assistAfterStop(next, content, stop, events);
      const stops = branchDef(leg, next.run.branch).stops;
      const last = next.run.stopIndex >= stops.length - 1;
      if (through.length === 0 || last) return { profile: finishLeg(next, content, last ? through : []), events };
      next = { ...next, run: { ...next.run, stopIndex: next.run.stopIndex + 1 } };
      return { profile: beginStop(next, content, through), events };
    }

    case 'SUMMARY_OK': {
      if (profile.screen !== 'summary') return none;
      return { profile: { ...profile, screen: allHome(profile) ? 'finale' : 'camp', summary: null }, events: [] };
    }

    case 'PARK':
    case 'RETRIEVE': {
      if (!idle) return none;
      const from = ev.type === 'PARK' ? 'available' : 'parked';
      const to = ev.type === 'PARK' ? 'parked' : 'available';
      const c = profile.roster.find((x) => x.id === ev.id);
      if (!c || c.status !== from) return none;
      return {
        profile: { ...profile, roster: withRoster(profile, [ev.id], (x) => ({ ...x, status: to })), selection: profile.selection.filter((id) => id !== ev.id) },
        events: [],
      };
    }

    // The small quest that brings a stranded creature back: send a friend
    // who shares enough traits, spend a hint token, or (when nobody is left
    // to help) simply call it in.
    case 'RESCUE': {
      if (!idle) return none;
      const lost = profile.roster.find((x) => x.id === ev.id);
      if (!lost || lost.status !== 'lost' || lost.lostAt !== profile.camp) return none;
      let hintTokens = profile.hintTokens;
      if (ev.friendId) {
        const friend = friendsFor(profile, content, lost).find((f) => f.id === ev.friendId);
        if (!friend) return none;
        const shared = sharedTraits(friend, lost);
        if (shared < content.trail.rescueSharedTraits) return { profile, events: [{ type: 'rescueMiss', id: lost.id, shared }] };
      } else if (ev.token) {
        if (hintTokens < 1) return none;
        hintTokens -= 1;
      } else if (!canFreeRescue(profile, content, lost)) return none;
      const atHome = lost.lostAt === home;
      const roster = withRoster(profile, [lost.id], ({ lostAt, ...c }) => ({ ...c, status: atHome ? 'delivered' : 'available', at: lostAt }));
      const next = {
        ...profile,
        hintTokens,
        roster,
        stats: { ...profile.stats, rescued: profile.stats.rescued + 1, delivered: profile.stats.delivered + (atHome ? 1 : 0), homePercent: homePercent({ roster }) },
      };
      return { profile: allHome(next) ? { ...next, screen: 'finale' } : next, events: [{ type: 'rescued', id: lost.id }] };
    }

    default:
      return none;
  }
}

// Goals are gentle, data-defined milestones over the profile's counters.
export function reduce(profile, ev, content) {
  const r = reduceInner(profile, ev, content);
  if (r.profile === profile || r.profile.kind !== 'trail') return r;
  let goals = r.profile.goals;
  const events = r.events.slice();
  for (const g of content.goals.goals) {
    if (!goals[g.id] && r.profile.stats[g.stat] >= g.atLeast) {
      goals = { ...goals, [g.id]: true };
      events.push({ type: 'goal', id: g.id });
    }
  }
  // Newly unlocked trinkets are announced once.
  let seen = r.profile.trinketsSeen;
  for (const id of unlockedTrinkets(r.profile, content)) {
    if (!seen.includes(id)) {
      seen = [...seen, id];
      events.push({ type: 'trinket', id });
    }
  }
  const same = goals === r.profile.goals && seen === r.profile.trinketsSeen;
  return { profile: same ? r.profile : { ...r.profile, goals, trinketsSeen: seen }, events };
}
