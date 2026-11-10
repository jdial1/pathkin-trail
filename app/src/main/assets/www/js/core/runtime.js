// Puzzle runtime: generate a Stop, validate attempts, emit feedback events.
// Pure: every function returns a new state plus a list of typed events
// (accepted, rejected, hint, solved, failed). Nothing here touches UI or I/O.

import { makeRng } from './rng.js';
import { family } from './families.js';

const hypCache = new Map();
const candCache = new WeakMap();

// ctx = { def, traits, creatures: { id -> trait values } }
export function hypotheses(ctx, tier) {
  const key = ctx.def.id + '|' + tier;
  if (!hypCache.has(key)) {
    hypCache.set(key, family(ctx.def.family).hypotheses(ctx.def, ctx.def.tiers[tier], ctx.traits));
  }
  return hypCache.get(key);
}

const sameFeedback = (a, b) => a.ok === b.ok && a.rowOk === b.rowOk && a.colOk === b.colOk;

// Hidden rules still consistent with everything the player has seen.
export function candidates(state, ctx) {
  const cached = candCache.get(state);
  if (cached) return cached;
  const fam = family(state.family);
  const list = hypotheses(ctx, state.tier).filter(
    (h) =>
      state.hints.every((slot) => fam.slots(h).includes(slot)) &&
      state.observations.every((o) => sameFeedback(fam.feedback(h, ctx.creatures[o.id], o.target), o.fb))
  );
  candCache.set(state, list);
  return list;
}

// The solvability proof: the rule is "found" once every remaining candidate
// sends every waiting creature to the same place.
export function isDetermined(state, ctx) {
  const fam = family(state.family);
  const cands = candidates(state, ctx);
  return state.queue.every((id) => {
    const first = fam.place(cands[0], ctx.creatures[id]);
    return cands.every((h) => fam.place(h, ctx.creatures[id]) === first);
  });
}

export function isSolved(state) {
  return state.status === 'solved';
}

// Pick a hidden rule the current party can actually tell apart: prefer rules
// that use as many different targets as possible for this party.
export function generate(ctx, tier, rngState, partyIds) {
  const fam = family(ctx.def.family);
  const rng = makeRng(rngState);
  const hyps = hypotheses(ctx, tier);
  let best = [];
  let bestSpread = -1;
  for (const h of hyps) {
    const spread = new Set(partyIds.map((id) => fam.place(h, ctx.creatures[id]))).size;
    if (spread > bestSpread) {
      bestSpread = spread;
      best = [h];
    } else if (spread === bestSpread) best.push(h);
  }
  const hyp = rng.pick(best);
  const state = {
    puzzleId: ctx.def.id,
    family: ctx.def.family,
    tier,
    hyp,
    queue: partyIds.slice(),
    placed: {},
    observations: [],
    hints: [],
    badges: {},
    patience: ctx.def.tiers[tier].patience,
    wrong: 0,
    status: 'playing',
  };
  return { state, rngState: rng.state };
}

function settle(state, ctx, events) {
  if (state.queue.length === 0) {
    state.status = 'solved';
    events.push({ type: 'solved', auto: [] });
  } else if (state.patience <= 0) {
    state.status = 'failed';
    events.push({ type: 'failed', returned: state.queue.slice() });
  } else if (isDetermined(state, ctx)) {
    const fam = family(state.family);
    const auto = state.queue.slice();
    for (const id of auto) state.placed[id] = fam.place(state.hyp, ctx.creatures[id]);
    state.queue = [];
    state.status = 'solved';
    events.push({ type: 'solved', auto });
  }
}

export function attempt(prev, ctx, creatureId, target) {
  if (prev.status !== 'playing' || !prev.queue.includes(creatureId)) return { state: prev, events: [] };
  const fam = family(prev.family);
  if (!fam.targets(ctx.def).some((t) => t.id === target)) return { state: prev, events: [] };
  const fb = fam.feedback(prev.hyp, ctx.creatures[creatureId], target);
  const state = {
    ...prev,
    queue: prev.queue.slice(),
    placed: { ...prev.placed },
    badges: { ...prev.badges },
    observations: [...prev.observations, { id: creatureId, target, fb }],
  };
  // Narrow the previous candidate list instead of re-checking every rule.
  candCache.set(
    state,
    candidates(prev, ctx).filter((h) => sameFeedback(fam.feedback(h, ctx.creatures[creatureId], target), fb))
  );
  const events = [];
  if (fb.ok) {
    state.queue = state.queue.filter((id) => id !== creatureId);
    state.placed[creatureId] = target;
    events.push({ type: 'accepted', id: creatureId, target });
  } else {
    state.wrong += 1;
    state.patience -= 1;
    state.badges[creatureId] = (state.badges[creatureId] || 0) + 1;
    events.push({ type: 'rejected', id: creatureId, target, fb });
  }
  settle(state, ctx, events);
  return { state, events };
}

// Reveal one slot the hidden rule looks at, never the value.
export function hint(prev, ctx) {
  if (prev.status !== 'playing') return { state: prev, events: [], used: false };
  const slot = family(prev.family)
    .slots(prev.hyp)
    .find((s) => !prev.hints.includes(s));
  if (!slot) return { state: prev, events: [{ type: 'hint', slot: null }], used: false };
  const state = { ...prev, queue: prev.queue.slice(), placed: { ...prev.placed }, hints: [...prev.hints, slot] };
  const events = [{ type: 'hint', slot }];
  settle(state, ctx, events);
  return { state, events, used: true };
}
