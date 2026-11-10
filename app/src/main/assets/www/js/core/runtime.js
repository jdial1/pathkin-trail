// Puzzle runtime: generate a Stop, validate attempts, emit feedback events.
// Pure: every function returns a new state plus a list of typed events
// (accepted, rejected, hint, solved, failed). Nothing here touches UI or I/O.
//
// For speed, each puzzle+tier keeps a table: for every distinct trait
// combination, the correct target under every allowed rule. Candidate rules
// are then tracked as index lists into that table.

import { makeRng } from './rng.js';
import { family, feedbackKey } from './families.js';
import { comboCount, decodeCombo } from './traits.js';

const tables = new Map();
const candCache = new WeakMap();

// ctx = { def, traits, creatures: { id -> trait values } }
function table(ctx, tier) {
  const key = ctx.def.id + '|' + tier;
  let tb = tables.get(key);
  if (!tb) {
    const fam = family(ctx.def.family);
    const targets = fam.targets(ctx.def).map((t) => t.id);
    // keys[c][t]: feedback for a creature that belongs at c and was sent to t.
    const keys = targets.map((c) => targets.map((t) => feedbackKey(fam.feedback(c, t))));
    tb = { fam, targets, keys, hyps: fam.hypotheses(ctx.def, ctx.def.tiers[tier], ctx.traits), rows: new Map() };
    tables.set(key, tb);
  }
  return tb;
}

function rowFor(tb, traits) {
  const key = Object.values(traits).join(',');
  let row = tb.rows.get(key);
  if (!row) {
    row = new Uint8Array(tb.hyps.length);
    for (let h = 0; h < row.length; h++) row[h] = tb.targets.indexOf(tb.fam.place(tb.hyps[h], traits));
    tb.rows.set(key, row);
  }
  return row;
}

const traitsOf = (state, ctx, id) => ctx.creatures[id] || state.examples[id];

export function hypotheses(ctx, tier) {
  return table(ctx, tier).hyps;
}

function narrow(tb, list, traits, target, fb) {
  const row = rowFor(tb, traits);
  const t = tb.targets.indexOf(target);
  const key = feedbackKey(fb);
  return list.filter((h) => tb.keys[row[h]][t] === key);
}

function candidateIndexes(state, ctx) {
  let list = candCache.get(state);
  if (list) return list;
  const tb = table(ctx, state.tier);
  list = Array.from({ length: tb.hyps.length }, (_, i) => i);
  if (state.hints.length) list = list.filter((h) => state.hints.every((slot) => tb.fam.slots(tb.hyps[h]).includes(slot)));
  for (const o of state.observations) list = narrow(tb, list, traitsOf(state, ctx, o.id), o.target, o.fb);
  candCache.set(state, list);
  return list;
}

// Hidden rules still consistent with everything the player has seen.
export function candidates(state, ctx) {
  const tb = table(ctx, state.tier);
  return candidateIndexes(state, ctx).map((h) => tb.hyps[h]);
}

// How many candidates would send this creature to each target.
export function votes(state, ctx, id) {
  const tb = table(ctx, state.tier);
  const row = rowFor(tb, traitsOf(state, ctx, id));
  const tally = new Array(tb.targets.length).fill(0);
  const list = candidateIndexes(state, ctx);
  for (const h of list) tally[row[h]]++;
  return { targets: tb.targets, tally, total: list.length };
}

// The solvability proof: the rule is "found" once every remaining candidate
// sends every waiting creature to the same place.
export function isDetermined(state, ctx) {
  const tb = table(ctx, state.tier);
  const list = candidateIndexes(state, ctx);
  return state.queue.every((id) => {
    const row = rowFor(tb, traitsOf(state, ctx, id));
    const first = row[list[0]];
    return list.every((h) => row[h] === first);
  });
}

export function isSolved(state) {
  return state.status === 'solved';
}

// Pick a hidden rule the current party can actually tell apart (prefer rules
// that use as many different targets as possible for this party), then seed
// the Stop with trail guides: example creatures already standing where they
// belong, so the very first send can be a deduction rather than a guess.
export function generate(ctx, tier, rngState, partyIds) {
  const tb = table(ctx, tier);
  const cfg = ctx.def.tiers[tier];
  const rng = makeRng(rngState);
  const rows = partyIds.map((id) => rowFor(tb, ctx.creatures[id]));
  let best = [];
  let bestSpread = -1;
  for (let h = 0; h < tb.hyps.length; h++) {
    let mask = 0;
    for (const row of rows) mask |= 1 << row[h];
    let spread = 0;
    for (; mask; mask >>= 1) spread += mask & 1;
    if (spread > bestSpread) {
      bestSpread = spread;
      best = [h];
    } else if (spread === bestSpread) best.push(h);
  }
  const hypIndex = rng.pick(best);
  let state = {
    puzzleId: ctx.def.id,
    family: ctx.def.family,
    tier,
    hyp: tb.hyps[hypIndex],
    queue: partyIds.slice(),
    placed: {},
    examples: {},
    observations: [],
    hints: [],
    badges: {},
    patience: cfg.patience,
    wrong: 0,
    status: 'playing',
  };
  const combos = comboCount(ctx.traits);
  for (let tries = 0, made = 0; made < cfg.examples && tries < cfg.examples * 4; tries++) {
    const traits = decodeCombo(ctx.traits, rng.int(combos));
    const id = 'x_' + (made + 1);
    const target = tb.targets[rowFor(tb, traits)[hypIndex]];
    const next = {
      ...state,
      examples: { ...state.examples, [id]: traits },
      observations: [...state.observations, { id, target, fb: tb.fam.feedback(target, target) }],
    };
    // A guide that would give the whole rule away is left out.
    if (isDetermined(next, ctx)) continue;
    state = next;
    made++;
  }
  return { state, rngState: rng.state };
}

function trueTarget(state, ctx, id) {
  const tb = table(ctx, state.tier);
  return tb.fam.place(state.hyp, traitsOf(state, ctx, id));
}

function settle(state, ctx, events) {
  if (state.queue.length === 0) {
    state.status = 'solved';
    events.push({ type: 'solved', auto: [] });
  } else if (state.patience <= 0) {
    state.status = 'failed';
    events.push({ type: 'failed', returned: state.queue.slice() });
  } else if (isDetermined(state, ctx)) {
    const auto = state.queue.slice();
    for (const id of auto) state.placed[id] = trueTarget(state, ctx, id);
    state.queue = [];
    state.status = 'solved';
    events.push({ type: 'solved', auto });
  }
}

export function attempt(prev, ctx, creatureId, target) {
  if (prev.status !== 'playing' || !prev.queue.includes(creatureId)) return { state: prev, events: [] };
  const tb = table(ctx, prev.tier);
  if (!tb.targets.includes(target)) return { state: prev, events: [] };
  const fb = tb.fam.feedback(trueTarget(prev, ctx, creatureId), target);
  const state = {
    ...prev,
    queue: prev.queue.slice(),
    placed: { ...prev.placed },
    badges: { ...prev.badges },
    observations: [...prev.observations, { id: creatureId, target, fb }],
  };
  // Narrow the previous candidate list instead of re-checking every rule.
  candCache.set(state, narrow(tb, candidateIndexes(prev, ctx), ctx.creatures[creatureId], target, fb));
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
