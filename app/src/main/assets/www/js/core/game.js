// App state machine. The profile is one serialisable JSON document; every
// screen is a state and every change is reduce(profile, event, content).
// Returns { profile, events } and never touches UI or storage.

import { hashSeed } from './rng.js';
import { buildRoster } from './traits.js';
import * as runtime from './runtime.js';

export const SCHEMA_VERSION = 1;

// Forward migrations: MIGRATIONS[n] upgrades a version-n document to n+1.
const MIGRATIONS = {};

export class FutureSaveError extends Error {}

export function migrate(doc) {
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
  return out;
}

export function newProfile(content, seed, slot) {
  const legs = {};
  for (const leg of content.trail.legs) legs[leg.id] = { tier: content.puzzles.tierOrder[0], fullParties: 0, cleared: 0 };
  return {
    schemaVersion: SCHEMA_VERSION,
    slot,
    seed: seed >>> 0,
    rng: hashSeed(seed),
    screen: 'roster',
    roster: buildRoster(content.traits, seed),
    selection: [],
    hintTokens: content.trail.startHintTokens,
    legs,
    run: null,
    stop: null,
    summary: null,
  };
}

export const puzzleDef = (content, id) => content.puzzles.puzzles.find((p) => p.id === id);
export const legDef = (content, id) => content.trail.legs.find((l) => l.id === id);
export const countStatus = (profile, status) => profile.roster.filter((c) => c.status === status).length;

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
  const leg = legDef(content, profile.run.legId);
  const def = puzzleDef(content, leg.stops[profile.run.stopIndex]);
  const creatures = {};
  for (const c of profile.roster) creatures[c.id] = c.traits;
  const gen = runtime.generate({ def, traits: content.traits, creatures }, profile.legs[leg.id].tier, profile.rng, partyIds);
  return { ...profile, rng: gen.rngState, stop: gen.state, screen: 'stop' };
}

function finishLeg(profile, content, deliveredIds) {
  const run = profile.run;
  const legState = { ...profile.legs[run.legId] };
  const cap = content.trail.hintTokenCap;
  const cleared = deliveredIds.length > 0;
  const earned = Math.min(run.flawlessStops + (cleared ? 1 : 0), Math.max(0, cap - profile.hintTokens));
  const fullParty = deliveredIds.length === content.traits.partyMax;
  let tierUp = null;
  if (cleared) legState.cleared += 1;
  if (fullParty) {
    legState.fullParties += 1;
    const order = content.puzzles.tierOrder;
    const at = order.indexOf(legState.tier);
    if (legState.fullParties % content.trail.fullPartiesToRaiseTier === 0 && at < order.length - 1) {
      legState.tier = tierUp = order[at + 1];
    }
  }
  return {
    ...profile,
    roster: withRoster(profile, deliveredIds, (c) => ({ ...c, status: 'delivered' })),
    hintTokens: profile.hintTokens + earned,
    legs: { ...profile.legs, [run.legId]: legState },
    summary: {
      legId: run.legId,
      delivered: deliveredIds.length,
      returned: run.returned.length,
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

export function reduce(profile, ev, content) {
  const none = { profile, events: [] };
  const idle = !profile.run;
  switch (ev.type) {
    case 'REROLL': {
      if (profile.screen !== 'roster') return none;
      const seed = hashSeed(profile.seed + 1);
      return { profile: { ...newProfile(content, seed, profile.slot) }, events: [] };
    }
    case 'ROSTER_OK':
      return profile.screen === 'roster' ? { profile: { ...profile, screen: 'map' }, events: [] } : none;

    case 'GOTO': {
      if (!idle || !['map', 'party', 'camp', 'finale'].includes(ev.screen)) return none;
      if (profile.screen === 'roster') return none;
      return { profile: { ...profile, screen: ev.screen, summary: null }, events: [] };
    }
    case 'SET_TIER': {
      if (!idle || !content.puzzles.tierOrder.includes(ev.tier) || !profile.legs[ev.legId]) return none;
      return { profile: { ...profile, legs: { ...profile.legs, [ev.legId]: { ...profile.legs[ev.legId], tier: ev.tier } } }, events: [] };
    }

    case 'PARTY_TOGGLE': {
      if (!idle) return none;
      const c = profile.roster.find((x) => x.id === ev.id);
      if (!c || c.status !== 'available') return none;
      const has = profile.selection.includes(ev.id);
      if (!has && profile.selection.length >= content.traits.partyMax) return none;
      const selection = has ? profile.selection.filter((id) => id !== ev.id) : [...profile.selection, ev.id];
      return { profile: { ...profile, selection }, events: [] };
    }
    case 'PARTY_FILL': {
      if (!idle) return none;
      const pool = (ev.ids || profile.roster.map((c) => c.id)).filter((id) => {
        const c = profile.roster.find((x) => x.id === id);
        return c && c.status === 'available' && !profile.selection.includes(id);
      });
      const room = content.traits.partyMax - profile.selection.length;
      return { profile: { ...profile, selection: [...profile.selection, ...pool.slice(0, room)] }, events: [] };
    }
    case 'PARTY_CLEAR':
      return idle ? { profile: { ...profile, selection: [] }, events: [] } : none;

    case 'START_LEG': {
      if (!idle || profile.selection.length < 1 || !legDef(content, ev.legId)) return none;
      const party = profile.selection.slice();
      const next = {
        ...profile,
        roster: withRoster(profile, party, (c) => ({ ...c, status: 'party' })),
        selection: [],
        summary: null,
        run: { legId: ev.legId, stopIndex: 0, startSize: party.length, flawlessStops: 0, returned: [] },
      };
      return { profile: beginStop(next, content, party), events: [] };
    }

    case 'ATTEMPT': {
      if (!profile.stop) return none;
      const r = runtime.attempt(profile.stop, stopCtx(profile, content), ev.id, ev.target);
      return { profile: { ...profile, stop: r.state }, events: r.events };
    }
    case 'HINT': {
      if (!profile.stop || profile.stop.status !== 'playing') return none;
      if (profile.hintTokens < 1) return { profile, events: [{ type: 'hint', slot: null, noTokens: true }] };
      const r = runtime.hint(profile.stop, stopCtx(profile, content));
      return {
        profile: { ...profile, stop: r.state, hintTokens: profile.hintTokens - (r.used ? 1 : 0) },
        events: r.events,
      };
    }

    case 'STOP_CONTINUE': {
      const stop = profile.stop;
      if (!stop || stop.status === 'playing') return none;
      const through = Object.keys(stop.placed);
      const back = stop.queue;
      let next = {
        ...profile,
        roster: profile.roster.map((c) => {
          if (back.includes(c.id)) {
            return { ...c, status: 'available', history: { ...c.history, timesReturned: c.history.timesReturned + 1 } };
          }
          if (through.includes(c.id)) return { ...c, history: { ...c.history, stopsCleared: c.history.stopsCleared + 1 } };
          return c;
        }),
        run: {
          ...profile.run,
          returned: [...profile.run.returned, ...back],
          flawlessStops: profile.run.flawlessStops + (stop.status === 'solved' && stop.wrong === 0 ? 1 : 0),
        },
      };
      const leg = legDef(content, next.run.legId);
      const last = next.run.stopIndex >= leg.stops.length - 1;
      if (through.length === 0 || last) return { profile: finishLeg(next, content, last ? through : []), events: [] };
      next = { ...next, run: { ...next.run, stopIndex: next.run.stopIndex + 1 } };
      return { profile: beginStop(next, content, through), events: [] };
    }

    case 'SUMMARY_OK': {
      if (profile.screen !== 'summary') return none;
      const all = countStatus(profile, 'delivered') === profile.roster.length;
      return { profile: { ...profile, screen: all ? 'finale' : 'camp', summary: null }, events: [] };
    }

    case 'PARK':
    case 'RETRIEVE': {
      if (!idle) return none;
      const from = ev.type === 'PARK' ? 'available' : 'parked';
      const to = ev.type === 'PARK' ? 'parked' : 'available';
      const c = profile.roster.find((x) => x.id === ev.id);
      if (!c || c.status !== from) return none;
      return {
        profile: {
          ...profile,
          roster: withRoster(profile, [ev.id], (x) => ({ ...x, status: to })),
          selection: profile.selection.filter((id) => id !== ev.id),
        },
        events: [],
      };
    }
    case 'NICKNAME': {
      const name = String(ev.name || '').trim().slice(0, 16) || null;
      return { profile: { ...profile, roster: withRoster(profile, [ev.id], (c) => ({ ...c, nickname: name })) }, events: [] };
    }
    case 'FAVOURITE':
      return {
        profile: { ...profile, roster: withRoster(profile, [ev.id], (c) => ({ ...c, favourite: !c.favourite })) },
        events: [],
      };

    default:
      return none;
  }
}
