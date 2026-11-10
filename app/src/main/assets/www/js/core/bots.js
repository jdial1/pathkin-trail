// Simulation bots. They play a Stop through the same runtime the player
// uses and are what the quality gates measure:
//   random   picks any legal action
//   optimal  deduces only from what the player can see (the candidate rules)
//   perfect  knows the hidden rule (used to script play-throughs)
// Each returns one action for the current Stop state.

import { family } from './families.js';
import * as runtime from './runtime.js';

const truthOf = (state) => {
  const fam = family(state.family);
  return fam.truth ? fam.truth(state) : state.hyp;
};

// ---- Sorting ----
function vote(state, ctx, id) {
  const { targets, tally, total } = runtime.votes(state, ctx, id);
  let top = 0;
  for (let i = 1; i < tally.length; i++) if (tally[i] > tally[top]) top = i;
  return { target: targets[top], share: tally[top] / total };
}
// Sends the creature whose placement is most certain; every answer, right
// or wrong, still narrows the rule.
function sortOptimal(state, ctx) {
  let best = null;
  for (const id of state.queue) {
    const v = vote(state, ctx, id);
    if (!best || v.share > best.share) best = { id, ...v };
  }
  return { id: best.id, target: best.target };
}

// ---- Seating ----
// Plans a full seating by depth-first search. A link counts as usable when
// at least `floor` of the candidate rules allow it; the bot first looks for
// a plan that every candidate allows, then relaxes.
function seatPlan(state, ctx, cands, floor) {
  const fam = family(state.family);
  const { seats, edges } = state.setup;
  const memo = new Map();
  const frac = (kind, a, b) => {
    const key = kind + a + b;
    if (!memo.has(key)) memo.set(key, cands.filter((h) => fam.linkOk(h, kind, ctx.creatures[a], ctx.creatures[b])).length / cands.length);
    return memo.get(key);
  };
  const at = { ...state.extra.seats };
  const left = state.queue.slice();
  const touching = Array.from({ length: seats }, () => []);
  for (const [a, b, kind] of edges) {
    touching[a].push([b, kind]);
    touching[b].push([a, kind]);
  }
  const fits = (s, id) => touching[s].every(([other, kind]) => !at[other] || frac(kind, id, at[other]) >= floor);
  let budget = 20000;
  const plan = [];
  const dfs = () => {
    // Most constrained seat first: the empty seat with the fewest creatures that fit.
    let seat = -1;
    let options = null;
    for (let s = 0; s < seats; s++) {
      if (at[s]) continue;
      const can = left.filter((id) => fits(s, id));
      if (!options || can.length < options.length) {
        seat = s;
        options = can;
        if (can.length === 0) return false;
      }
    }
    if (seat < 0) return true;
    if (--budget < 0) return false;
    for (const id of options) {
      at[seat] = id;
      left.splice(left.indexOf(id), 1);
      plan.push({ id, target: 's' + seat });
      if (dfs()) return true;
      plan.pop();
      left.push(id);
      delete at[seat];
    }
    return false;
  };
  return dfs() ? plan : null;
}

function seatAction(state, ctx, cands) {
  for (const floor of [1, 0.5, 0.0001]) {
    const plan = seatPlan(state, ctx, cands, floor);
    if (plan) return plan[0];
  }
  // No way to finish around what is seated: lift someone (free) and re-plan.
  const seated = Object.keys(state.extra.seats);
  if (seated.length) return { lift: 's' + seated[seated.length - 1] };
  return { id: state.queue[0], target: 's0' };
}

// ---- Probes ----
// Splits the candidates by what each would answer to an action.
function split(state, ctx, cands, action) {
  const fam = family(state.family);
  const groups = new Map();
  let ok = 0;
  let cost = 0;
  for (const h of cands) {
    const out = runtime.outcomeUnder(h, action, state, ctx);
    const key = fam.key(out.fb);
    groups.set(key, (groups.get(key) || 0) + 1);
    if (out.fb.ok) ok++;
    if (out.cost) cost++;
  }
  let left = 0;
  for (const n of groups.values()) left += n * n;
  const N = cands.length;
  return { pOk: ok / N, pCost: cost / N, left: left / (N * N) };
}

function tradeAction(state, ctx, cands) {
  const n = state.setup.items.length;
  let best = null;
  state.extra.fed.forEach((fed, keeper) => {
    if (fed) return;
    let maybe = 0;
    let sure = (1 << n) - 1;
    for (const h of cands) {
      maybe |= h.sets[keeper];
      sure &= h.sets[keeper];
    }
    for (let items = 1; items < 1 << n; items++) {
      if (items & ~maybe || (sure & ~items) !== 0) continue;
      const s = split(state, ctx, cands, { keeper, items });
      // An offer that can neither succeed nor teach anything is pointless.
      if (s.pOk === 0 && s.left === 1) continue;
      const score = s.pOk * 1.5 + (1 - s.left) - s.pCost * (state.patience <= 2 ? 2.5 : 1.2);
      if (!best || score > best.score) best = { score, action: { keeper, items } };
    }
  });
  return best.action;
}

function signalAction(state, ctx, cands) {
  if (cands.length === 1) return { id: cands[0], target: 'stone' };
  let best = null;
  for (const id of state.queue) {
    const s = split(state, ctx, cands, { id, target: 'stone' });
    const score = s.left - (cands.includes(id) ? 0.001 : 0);
    if (!best || score < best.score) best = { score, id };
  }
  return { id: best.id, target: 'stone' };
}

function echoAction(state, ctx, cands) {
  let best = null;
  for (const id of state.queue) {
    const { pOk } = split(state, ctx, cands, { id, target: 'pond' });
    if (!best || pOk > best.pOk) best = { pOk, id };
  }
  return { id: best.id, target: 'pond' };
}

// Tries every switch setting. For each it searches for a convoy in which
// every rider reaches its own shed under (nearly) all candidate trigger
// rules; failing that it takes the convoy expected to deliver the most.
function switchAction(state, ctx, cands) {
  const fam = family(state.family);
  const full = state.queue.length > state.setup.size;
  const sizes = full ? [state.setup.size] : Array.from({ length: state.queue.length }, (_, i) => state.queue.length - i);
  const step = Math.max(1, Math.floor(cands.length / 40));
  const sample = cands.filter((_, i) => i % step === 0);
  const hitsAt = (dirs, convoy, pos) => {
    const riders = convoy.map((x) => ctx.creatures[x]);
    const want = ctx.creatures[convoy[pos]].tint;
    let hits = 0;
    for (const h of sample) if (state.setup.sheds[fam.run(h, dirs, riders).exits[pos]] === want) hits++;
    return hits / sample.length;
  };
  let best = null;
  const consider = (dirs, convoy, score) => {
    if (!best || score > best.score) best = { score, action: { dirs, convoy: convoy.slice() } };
  };
  for (const size of sizes) {
    for (const floor of [1, 0.75]) {
      for (let code = 0; code < 8; code++) {
        const dirs = [code & 1, (code >> 1) & 1, (code >> 2) & 1];
        const convoy = [];
        let budget = 1500;
        const dfs = (sum) => {
          if (convoy.length === size) {
            consider(dirs, convoy, sum + size * 2 * floor);
            return floor === 1;
          }
          for (const id of state.queue) {
            if (convoy.includes(id) || --budget < 0) continue;
            convoy.push(id);
            const p = hitsAt(dirs, convoy, convoy.length - 1);
            if (p >= floor && dfs(sum + p)) return true;
            convoy.pop();
          }
          return false;
        };
        if (dfs(0)) return best.action;
      }
      if (best) return best.action;
    }
  }
  // Nothing reliable: greedy, rider by rider.
  for (let code = 0; code < 8; code++) {
    const dirs = [code & 1, (code >> 1) & 1, (code >> 2) & 1];
    const convoy = [];
    let score = 0;
    for (let pos = 0; pos < sizes[0]; pos++) {
      let pick = null;
      for (const id of state.queue) {
        if (convoy.includes(id)) continue;
        const p = hitsAt(dirs, [...convoy, id], pos);
        if (!pick || p > pick.p) pick = { id, p };
      }
      convoy.push(pick.id);
      score += pick.p;
    }
    consider(dirs, convoy, score);
  }
  return best.action;
}

// Sends the creature most candidate rules agree can go next; among equals,
// the one the candidates rank earliest, which keeps a cart load growing.
function nextAction(target) {
  return (state, ctx, cands) => {
    const fam = family(state.family);
    let best = null;
    for (const id of state.queue) {
      const { pOk } = split(state, ctx, cands, { id, target });
      const early = fam.rank ? -cands.reduce((n, h) => n + fam.rank(h, ctx.creatures[id]), 0) / cands.length : 0;
      if (!best || pOk > best.pOk || (pOk === best.pOk && early > best.early)) best = { pOk, early, id };
    }
    return { id: best.id, target };
  };
}

const PLAYERS = {
  queue_route: nextAction('cart'),
  fold_sequence: nextAction('pad'),
  sort: sortOptimal,
  seat: seatAction,
  trade_ledger: tradeAction,
  signal_guess: signalAction,
  echo_match: echoAction,
  switch_run: switchAction,
};
const playerFor = (state) => PLAYERS[state.family] || PLAYERS[family(state.family).kind];

export const bots = {
  random(state, ctx, rng) {
    const fam = family(state.family);
    const targets = fam.targets(ctx.def, state).map((t) => t.id);
    if (state.family === 'trade_ledger') {
      const open = state.extra.fed.map((f, k) => (f ? -1 : k)).filter((k) => k >= 0);
      return { keeper: rng.pick(open), items: 1 + rng.int((1 << state.setup.items.length) - 1) };
    }
    if (state.family === 'switch_run') {
      const size = Math.min(state.setup.size, state.queue.length);
      return { dirs: [rng.int(2), rng.int(2), rng.int(2)], convoy: rng.shuffle(state.queue).slice(0, size) };
    }
    if (fam.kind === 'seat') {
      const free = targets.filter((t) => !state.extra.seats[Number(t.slice(1))]);
      return { id: rng.pick(state.queue), target: rng.pick(free) };
    }
    return { id: rng.pick(state.queue), target: rng.pick(targets) };
  },
  // Sorting only: takes the first creature in line.
  greedy(state, ctx) {
    if (family(state.family).kind !== 'sort') return bots.optimal(state, ctx);
    return { id: state.queue[0], target: vote(state, ctx, state.queue[0]).target };
  },
  optimal: (state, ctx) => playerFor(state)(state, ctx, family(state.family).kind === 'sort' ? null : runtime.candidates(state, ctx)),
  // Plays as if the hidden rule were known.
  perfect(state, ctx) {
    const fam = family(state.family);
    if (fam.kind === 'sort') return { id: state.queue[0], target: fam.place(state.hyp, ctx.creatures[state.queue[0]]) };
    return playerFor(state)(state, ctx, [truthOf(state)]);
  },
};
