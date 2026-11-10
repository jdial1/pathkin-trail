// Puzzle runtime: generate a Stop, validate actions, emit feedback events.
// Pure: every function returns a new state plus a list of typed events
// (accepted, rejected, info, hint, solved, failed). Nothing here touches UI
// or I/O.
//
// An action is a plain object. Sorting and seating Stops use
// { id, target }; other families define their own (see families.js).
// The runtime keeps the set of hidden rules still consistent with every
// observation. For sorting families it uses a table (for every distinct
// trait combination, the correct target under every rule) for speed.

import { makeRng } from './rng.js';
import { family, share } from './families.js';
import { comboCount, decodeCombo } from './traits.js';

const spaces = new Map();
const candCache = new WeakMap();

// ctx = { def, traits, creatures: { id -> trait values } }
export function envOf(state, ctx) {
  return { def: ctx.def, cfg: ctx.def.tiers[state.tier], traits: ctx.traits, creatures: ctx.creatures, setup: state.setup, examples: state.examples };
}

function space(ctx, tier, setup) {
  const fam = family(ctx.def.family);
  const key = `${ctx.def.id}|${tier}|${fam.hypKey ? fam.hypKey(setup) : ''}`;
  let sp = spaces.get(key);
  if (!sp) {
    if (spaces.size > 300) spaces.clear();
    sp = { fam, hyps: fam.hyps(ctx.def, ctx.def.tiers[tier], ctx.traits, setup) };
    if (fam.kind === 'sort') {
      sp.targets = fam.targets(ctx.def).map((t) => t.id);
      // keys[c][t]: feedback for a creature that belongs at c and was sent to t.
      sp.keys = sp.targets.map((c) => sp.targets.map((t) => fam.key(fam.feedback(c, t))));
      sp.rows = new Map();
    }
    spaces.set(key, sp);
  }
  return sp;
}

function rowFor(sp, traits) {
  const key = Object.values(traits).join(',');
  let row = sp.rows.get(key);
  if (!row) {
    row = new Uint8Array(sp.hyps.length);
    for (let h = 0; h < row.length; h++) row[h] = sp.targets.indexOf(sp.fam.place(sp.hyps[h], traits));
    sp.rows.set(key, row);
  }
  return row;
}

const traitsOf = (state, ctx, id) => ctx.creatures[id] || state.examples[id];
const truthOf = (state) => {
  const fam = family(state.family);
  return fam.truth ? fam.truth(state) : state.hyp;
};

export function hypotheses(ctx, tier, setup = {}) {
  return space(ctx, tier, setup).hyps;
}

// Keeps the rules that would have produced this observation.
function narrow(sp, list, state, ctx, obs) {
  const fam = sp.fam;
  if (fam.kind === 'sort') {
    const row = rowFor(sp, traitsOf(state, ctx, obs.action.id));
    const t = sp.targets.indexOf(obs.action.target);
    const key = fam.key(obs.fb);
    return list.filter((h) => sp.keys[row[h]][t] === key);
  }
  const env = envOf(state, ctx);
  const key = fam.key(obs.fb);
  return list.filter((h) => {
    const out = fam.outcome(sp.hyps[h], obs.action, obs.pre, env);
    return out && fam.key(out.fb) === key;
  });
}

function candidateIndexes(state, ctx) {
  let list = candCache.get(state);
  if (list) return list;
  const sp = space(ctx, state.tier, state.setup);
  const fam = sp.fam;
  list = Array.from({ length: sp.hyps.length }, (_, i) => i);
  if (state.hints.length) list = list.filter((h) => state.hints.every((slot) => fam.slots(sp.hyps[h]).includes(slot)));
  if (fam.alive) {
    const env = envOf(state, ctx);
    list = list.filter((h) => fam.alive(sp.hyps[h], state, env));
  }
  for (const obs of state.observations) {
    if (fam.relevant && !fam.relevant(obs, state)) continue;
    list = narrow(sp, list, state, ctx, obs);
  }
  candCache.set(state, list);
  return list;
}

// Hidden rules still consistent with everything the player has seen.
export function candidates(state, ctx) {
  const sp = space(ctx, state.tier, state.setup);
  return candidateIndexes(state, ctx).map((h) => sp.hyps[h]);
}

// Sorting Stops: how many candidates would send this creature to each target.
export function votes(state, ctx, id) {
  const sp = space(ctx, state.tier, state.setup);
  const row = rowFor(sp, traitsOf(state, ctx, id));
  const tally = new Array(sp.targets.length).fill(0);
  const list = candidateIndexes(state, ctx);
  for (const h of list) tally[row[h]]++;
  return { targets: sp.targets, tally, total: list.length };
}

// What an action would do if rule h were the true one (used by bots).
export function outcomeUnder(h, action, state, ctx) {
  const fam = family(state.family);
  const env = envOf(state, ctx);
  return fam.outcome(h, action, fam.pre ? fam.pre(state, env) : null, env);
}

// Sorting Stops' solvability proof: the rule is "found" once every remaining
// candidate sends every waiting creature to the same place.
export function isDetermined(state, ctx) {
  const sp = space(ctx, state.tier, state.setup);
  const list = candidateIndexes(state, ctx);
  return state.queue.every((id) => {
    const row = rowFor(sp, traitsOf(state, ctx, id));
    const first = row[list[0]];
    return list.every((h) => row[h] === first);
  });
}

export function isSolved(state) {
  return state.status === 'solved';
}

function blank(ctx, tier, hyp, queue) {
  return {
    puzzleId: ctx.def.id,
    family: ctx.def.family,
    tier,
    hyp,
    setup: {},
    extra: {},
    queue,
    held: [],
    placed: {},
    examples: {},
    observations: [],
    hints: [],
    badges: {},
    patience: ctx.def.tiers[tier].patience,
    wrong: 0,
    status: 'playing',
  };
}

// Sorting Stops: pick a hidden rule the party can actually tell apart (prefer
// rules that use as many different targets as possible for this party), then
// seed the Stop with trail guides: example creatures already standing where
// they belong, so the very first send can be a deduction rather than a guess.
function generateSort(ctx, tier, rng, partyIds) {
  const sp = space(ctx, tier, {});
  const cfg = ctx.def.tiers[tier];
  const rows = partyIds.map((id) => rowFor(sp, ctx.creatures[id]));
  let best = [];
  let bestSpread = -1;
  for (let h = 0; h < sp.hyps.length; h++) {
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
  let state = blank(ctx, tier, sp.hyps[hypIndex], partyIds.slice());
  const combos = comboCount(ctx.traits);
  for (let tries = 0, made = 0; made < cfg.examples && tries < cfg.examples * 4; tries++) {
    const traits = decodeCombo(ctx.traits, rng.int(combos));
    const id = 'x_' + (made + 1);
    const target = sp.targets[rowFor(sp, traits)[hypIndex]];
    const next = {
      ...state,
      examples: { ...state.examples, [id]: traits },
      observations: [...state.observations, { action: { id, target }, pre: null, fb: sp.fam.feedback(target, target), guide: true }],
    };
    // A guide that would give the whole rule away is left out.
    if (isDetermined(next, ctx)) continue;
    state = next;
    made++;
  }
  return state;
}

export function generate(ctx, tier, rngState, partyIds) {
  const fam = family(ctx.def.family);
  const rng = makeRng(rngState);
  if (fam.kind === 'sort') return { state: generateSort(ctx, tier, rng, partyIds), rngState: rng.state };
  const made = fam.create(ctx, ctx.def.tiers[tier], rng, partyIds);
  const held = made.held || [];
  const base = {
    ...blank(ctx, tier, made.hyp, partyIds.filter((id) => !held.includes(id))),
    setup: made.setup,
    extra: made.extra,
    held,
    examples: made.examples || {},
  };
  // Starting clues, dropping any that would already give the rule away.
  const guides = (made.guides || []).map((g) => ({ ...g, guide: true }));
  let state = { ...base, observations: guides };
  while (state.observations.length && autoSolved(state, ctx)) state = { ...base, observations: state.observations.slice(0, -1) };
  return { state, rngState: rng.state };
}

function autoSolved(state, ctx) {
  const fam = family(state.family);
  const s = fam.settle(state, envOf(state, ctx), candidates(state, ctx));
  return !!(s && s.auto);
}

function deliver(state, list) {
  const ids = list.map((d) => d.id);
  for (const d of list) state.placed[d.id] = d.at;
  state.queue = state.queue.filter((id) => !ids.includes(id));
  state.held = state.held.filter((id) => !ids.includes(id));
}

function settle(state, ctx, events) {
  const fam = family(state.family);
  if (fam.kind === 'sort') {
    if (state.queue.length === 0) {
      state.status = 'solved';
      events.push({ type: 'solved', auto: [] });
    } else if (state.patience <= 0) {
      state.status = 'failed';
      events.push({ type: 'failed', returned: state.queue.slice() });
    } else if (isDetermined(state, ctx)) {
      const auto = state.queue.slice();
      deliver(state, auto.map((id) => ({ id, at: fam.place(state.hyp, ctx.creatures[id]) })));
      state.status = 'solved';
      events.push({ type: 'solved', auto });
    }
    return;
  }
  const s = fam.settle(state, envOf(state, ctx), candidates(state, ctx));
  if (s && s.status === 'solved') {
    deliver(state, s.deliver);
    state.status = 'solved';
    events.push({ type: 'solved', auto: s.auto ? s.deliver.map((d) => d.id) : [] });
  } else if (state.patience <= 0) {
    if (fam.onFail) deliver(state, fam.onFail(state));
    state.status = 'failed';
    events.push({ type: 'failed', returned: state.queue.slice() });
  }
}

export function attempt(prev, ctx, action, legacyTarget) {
  // Accepts attempt(state, ctx, { id, target }) or attempt(state, ctx, id, target).
  if (typeof action === 'string') action = { id: action, target: legacyTarget };
  const none = { state: prev, events: [] };
  if (prev.status !== 'playing' || !action) return none;
  const fam = family(prev.family);
  const sp = space(ctx, prev.tier, prev.setup);
  if (action.id !== undefined && !prev.queue.includes(action.id)) return none;
  if (action.convoy && action.convoy.some((id) => !prev.queue.includes(id))) return none;
  if (fam.kind === 'sort' && !sp.targets.includes(action.target)) return none;
  const env = envOf(prev, ctx);
  const pre = fam.pre ? fam.pre(prev, env) : null;
  const out = fam.outcome(truthOf(prev), action, pre, env);
  if (!out) return none;

  const state = {
    ...prev,
    queue: prev.queue.slice(),
    held: prev.held.slice(),
    placed: { ...prev.placed },
    badges: { ...prev.badges },
    observations: out.silent ? prev.observations : [...prev.observations, { action, pre, fb: out.fb }],
    extra: fam.after ? fam.after(prev, action, out) : prev.extra,
  };
  // Stateless families can narrow the previous candidate list directly.
  if (!out.silent && !fam.alive && !fam.relevant && candCache.has(prev)) {
    candCache.set(state, narrow(sp, candCache.get(prev), state, ctx, { action, pre, fb: out.fb }));
  }
  const delivered = out.share ? share(state.queue, out.share, out.first, fam.reserve ? fam.reserve(prev) : []) : out.deliver;
  deliver(state, delivered);
  for (const id of out.hold || []) {
    state.queue = state.queue.filter((x) => x !== id);
    state.held.push(id);
  }
  for (const id of out.release || []) {
    state.held = state.held.filter((x) => x !== id);
    state.queue.push(id);
  }
  const events = [];
  const base = { id: action.id, target: action.target, action, fb: out.fb };
  if (out.cost) {
    state.wrong += out.cost;
    state.patience -= out.cost;
    if (action.id !== undefined) state.badges[action.id] = (state.badges[action.id] || 0) + 1;
    events.push({ type: 'rejected', ...base, delivered: delivered.map((d) => d.id) });
  } else if (!out.silent) {
    events.push({ type: out.fb.ok ? 'accepted' : 'info', ...base, delivered: delivered.map((d) => d.id) });
  }
  settle(state, ctx, events);
  return { state, events };
}

// A hint never names the answer: it reveals one slot the hidden rule looks
// at, or (for families without slots) one small fact.
export function hint(prev, ctx) {
  if (prev.status !== 'playing') return { state: prev, events: [], used: false };
  const fam = family(prev.family);
  const copy = () => ({ ...prev, queue: prev.queue.slice(), held: prev.held.slice(), placed: { ...prev.placed } });
  let state;
  let event;
  if (fam.hint) {
    const r = fam.hint(prev, envOf(prev, ctx), candidates(prev, ctx));
    if (!r) return { state: prev, events: [{ type: 'hint', slot: null }], used: false };
    state = { ...copy(), observations: r.obs ? [...prev.observations, { ...r.obs, guide: true }] : prev.observations, extra: r.extra || prev.extra };
    event = { type: 'hint', say: r.say };
  } else {
    const slot = fam.slots(prev.hyp).find((s) => !prev.hints.includes(s));
    if (!slot) return { state: prev, events: [{ type: 'hint', slot: null }], used: false };
    state = { ...copy(), hints: [...prev.hints, slot] };
    event = { type: 'hint', slot };
  }
  const events = [event];
  settle(state, ctx, events);
  return { state, events, used: true };
}
