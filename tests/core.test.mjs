import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { buildRoster, comboCount, encodeCombo, decodeCombo } from '../app/src/main/assets/www/js/core/traits.js';
import { has, anyOf, count, and, or, not, evaluate, ruleSlots, describeRule } from '../app/src/main/assets/www/js/core/rules.js';
import { family, FAMILIES, share } from '../app/src/main/assets/www/js/core/families.js';
import * as runtime from '../app/src/main/assets/www/js/core/runtime.js';
import { content, bots, play, makeCtx } from './helpers.mjs';

const SEEDS = Number(process.env.SEEDS || 10000);
const c = { crest: 'fin', eyes: 'wide', mark: 'ring', feet: 'webs', tint: 2 };
const t = (k, v) => k + (v ? JSON.stringify(v) : '');
const defOf = (fam) => content.puzzles.puzzles.find((p) => p.family === fam);
const truth = (state) => (family(state.family).truth ? family(state.family).truth(state) : state.hyp);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('rule primitives and combinators', () => {
  assert.equal(evaluate(has('eyes', 'wide'), c), true);
  assert.equal(evaluate(has('eyes', 'slit'), c), false);
  assert.equal(evaluate(has('tint', 2), c), true);
  assert.equal(evaluate(anyOf('feet', ['paws', 'webs']), c), true);
  assert.equal(evaluate(anyOf('feet', ['paws', 'roller']), c), false);
  const terms = [{ slot: 'crest', value: 'fin' }, { slot: 'mark', value: 'ring' }, { slot: 'feet', value: 'paws' }];
  assert.equal(evaluate(count(2, terms), c), true);
  assert.equal(evaluate(count(3, terms), c), false);
  assert.equal(evaluate(and(has('crest', 'fin'), has('mark', 'ring')), c), true);
  assert.equal(evaluate(and(has('crest', 'fin'), has('mark', 'dot')), c), false);
  assert.equal(evaluate(or(has('crest', 'horn'), has('mark', 'ring')), c), true);
  assert.equal(evaluate(or(has('crest', 'horn'), has('mark', 'dot')), c), false);
  assert.equal(evaluate(not(has('feet', 'roller')), c), true);
  assert.throws(() => evaluate({ op: 'nope' }, c));
  assert.throws(() => ruleSlots({ op: 'nope' }));
  assert.throws(() => describeRule({ op: 'nope' }, t));
  assert.deepEqual(ruleSlots(and(has('crest', 'fin'), not(anyOf('feet', ['paws'])))), ['crest', 'feet']);
  assert.deepEqual(ruleSlots(count(1, terms)), ['crest', 'mark', 'feet']);
  for (const r of [has('a', 1), anyOf('a', [1, 2]), count(1, terms), and(has('a', 1), has('b', 2)), or(has('a', 1), has('b', 2)), not(has('a', 1))]) {
    assert.equal(typeof describeRule(r, t), 'string');
  }
});

test('rng is deterministic and serialisable', () => {
  const a = makeRng(42);
  const first = [a.next(), a.next(), a.next()];
  const b = makeRng(42);
  b.next();
  const resumed = makeRng(b.state);
  assert.deepEqual([first[1], first[2]], [resumed.next(), resumed.next()]);
});

test('roster: 36 unique creatures, same seed same roster; combos encode and decode', () => {
  assert.equal(comboCount(content.traits), 1024);
  for (let seed = 0; seed < 200; seed++) {
    const r = buildRoster(content.traits, seed);
    assert.equal(r.length, 36);
    assert.equal(new Set(r.map((x) => JSON.stringify(x.traits))).size, 36);
    assert.deepEqual(r, buildRoster(content.traits, seed));
  }
  assert.notDeepEqual(buildRoster(content.traits, 1), buildRoster(content.traits, 2));
  for (let n = 0; n < 1024; n += 7) assert.equal(encodeCombo(content.traits, decodeCombo(content.traits, n)), n);
});

test('the Trail uses twelve different puzzle mechanics, one per Stop', () => {
  const stops = content.trail.legs.flatMap((l) => l.branches.flatMap((b) => b.stops));
  assert.equal(stops.length, 12);
  const kinds = stops.map((id) => {
    const p = content.puzzles.puzzles.find((x) => x.id === id);
    return p.tierSet || p.family;
  });
  assert.equal(new Set(kinds).size, 12, 'every Stop on the Trail is a different mechanic');
  // A run plays nine of the twelve.
  assert.equal(content.trail.legs.reduce((n, l) => n + l.branches[0].stops.length, 0), 9);
});

test('every rule of every tier describes itself', () => {
  for (const def of content.puzzles.puzzles) {
    const fam = family(def.family);
    for (const tier of content.puzzles.tierOrder) {
      const roster = buildRoster(content.traits, 3);
      const ctx = makeCtx(def, roster);
      const { state } = runtime.generate(ctx, tier, 5, roster.slice(0, 12).map((x) => x.id));
      const hyps = runtime.hypotheses(ctx, tier, state.setup);
      assert.ok(hyps.length >= 1, `${def.id}/${tier} has no rules`);
      const env = runtime.envOf(state, ctx);
      // Families whose rule changes each round describe the whole Stop at once.
      const sample = fam.truth ? [state.hyp] : hyps.filter((_, i) => i % Math.max(1, Math.floor(hyps.length / 25)) === 0);
      for (const h of sample) {
        const lines = fam.describe(h, t, state.setup, env);
        assert.ok(lines.length >= 1 && lines.every((l) => typeof l === 'string' && l.length > 0), `${def.id}/${tier}`);
        if (fam.slots) assert.ok(fam.slots(h).every((s) => def.tiers[tier].slots.includes(s)), `${def.id}/${tier} slot outside tier`);
      }
      assert.ok(fam.targets(def, state).length >= 1);
    }
  }
  assert.throws(() => family('nope'));
  assert.throws(() => FAMILIES.gate_sort.hyps({ params: { gates: 2 } }, { forms: ['nope'], slots: ['crest'] }, content.traits));
});

// From-scratch reference for the table-based candidate tracking of sorting Stops.
function bruteCandidates(state, ctx) {
  const fam = family(state.family);
  const traits = (id) => ctx.creatures[id] || state.examples[id];
  return runtime.hypotheses(ctx, state.tier).filter(
    (h) =>
      state.hints.every((s) => fam.slots(h).includes(s)) &&
      state.observations.every((o) => fam.key(fam.feedback(fam.place(h, traits(o.action.id)), o.action.target)) === fam.key(o.fb))
  );
}

const tierSets = [...new Set(content.puzzles.puzzles.map((p) => p.tierSet || p.family))];

for (const set of tierSets) {
  const defs = content.puzzles.puzzles.filter((p) => (p.tierSet || p.family) === set);
  const fam = family(defs[0].family);
  for (const tier of content.puzzles.tierOrder) {
    test(`${set}/${tier}: ${SEEDS} seeds solvable by deduction`, () => {
      const lengths = [];
      let solved = 0;
      let gain = 0;
      let gainRuns = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const def = defs[seed % defs.length];
        const deep = seed % 97 === 0;
        // The true rule is never ruled out, at any point of any sampled run.
        const watch = deep ? (before, after, ctx) => assert.ok(runtime.candidates(before, ctx).some((h) => same(h, truth(before))), `${def.id}/${tier} seed ${seed}: truth eliminated`) : null;
        const { state, start, ctx, party, attempts } = play(def, tier, seed, bots.optimal, watch);
        if (state.status === 'solved') {
          solved++;
          lengths.push(attempts);
          assert.equal(Object.keys(state.placed).length, party.length, 'a solved Stop lets everyone through');
          assert.equal(state.queue.length + state.held.length, 0);
          if (fam.kind === 'sort') {
            const cands = runtime.candidates(state, ctx);
            if (deep) assert.deepEqual(cands, bruteCandidates(state, ctx));
            for (const id of party) {
              assert.equal(state.placed[id], fam.place(state.hyp, ctx.creatures[id]));
              // Creatures waved through at "rule found" are placed the same
              // way by every surviving candidate.
              const sent = state.observations.some((o) => o.action.id === id && o.fb.ok);
              if (!sent && deep) for (const h of cands) assert.equal(fam.place(h, ctx.creatures[id]), state.placed[id]);
            }
          }
        } else {
          assert.equal(state.patience, 0);
          assert.ok(state.queue.length > 0);
          assert.equal(Object.keys(state.placed).length + state.queue.length, party.length);
        }
        const size = runtime.hypotheses(ctx, tier, start.setup).length;
        // Measured where there is a real rule space to narrow (20 or more rules).
        if (seed <= 500 && size >= 20 && !fam.relevant && state.observations.length) {
          // Rules ruled out per observation (starting clues and moves alike).
          gain += (size - runtime.candidates(state, ctx).length) / state.observations.length;
          gainRuns++;
        }
      }
      lengths.sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)];
      const rate = solved / SEEDS;
      const [lo, hi] = defs[0].tiers[tier].sends;
      const info = gainRuns ? (gain / gainRuns).toFixed(1) : 'n/a';
      console.log(`  ${set}/${tier}: optimal bot solves ${(rate * 100).toFixed(1)}%, median ${median} moves, info gain ${info} rules/observation`);
      // Deduce, don't guess: deduction alone nearly always gets through.
      assert.ok(rate >= 0.97, `optimal bot only solved ${rate}`);
      // Content gate: an observation removes at least one candidate rule on average.
      if (gainRuns) assert.ok(gain / gainRuns >= 1, 'information gain below 1');
      assert.ok(median >= lo && median <= hi, `median solve length ${median} outside ${lo}-${hi}`);
    });

    test(`${set}/${tier}: guessing is clearly worse than deducing`, () => {
      let failed = 0;
      let wrongRandom = 0;
      let wrongOptimal = 0;
      const runs = Math.min(1500, SEEDS);
      for (let seed = 1; seed <= runs; seed++) {
        const def = defs[seed % defs.length];
        const r = play(def, tier, seed, bots.random).state;
        if (r.status === 'failed') failed++;
        wrongRandom += r.wrong;
        wrongOptimal += play(def, tier, seed, bots.optimal).state.wrong;
      }
      const ratio = wrongRandom / Math.max(1, wrongOptimal);
      console.log(`  ${set}/${tier}: random bot fails ${((failed / runs) * 100).toFixed(1)}%, makes ${ratio.toFixed(1)}x the wrong moves of the optimal bot`);
      // Not trivial: a guesser wastes far more patience than a deducer at
      // every tier, and above the welcoming gentle tier it often fails.
      assert.ok(ratio >= 1.3, 'random bot is nearly as good as deduction: ' + ratio);
      if (tier !== 'gentle') assert.ok(failed / runs >= 0.15, 'random bot failed only ' + failed / runs);
    });
  }
}

test('a solution always exists: knowing the rule, every Stop can be finished with no wrong move', () => {
  for (const def of content.puzzles.puzzles)
    for (const tier of content.puzzles.tierOrder)
      for (let seed = 1; seed <= 80; seed++) {
        const { state, party } = play(def, tier, seed, bots.perfect);
        assert.equal(state.status, 'solved', `${def.id}/${tier} seed ${seed}`);
        assert.equal(Object.keys(state.placed).length, party.length);
        // Rail switches can force an imperfect convoy; everything else is clean.
        if (def.family !== 'switch_run') assert.equal(state.wrong, 0, `${def.id}/${tier} seed ${seed} cost patience`);
      }
});

test('generation: starting clues are honest and never give the rule away', () => {
  for (const def of content.puzzles.puzzles) {
    const fam = family(def.family);
    for (const tier of content.puzzles.tierOrder)
      for (let seed = 1; seed <= 40; seed++) {
        const roster = buildRoster(content.traits, seed);
        const ctx = makeCtx(def, roster);
        const party = roster.slice(0, 2 + (seed % 15)).map((x) => x.id);
        const { state } = runtime.generate(ctx, tier, seed, party);
        const label = `${def.id}/${tier} seed ${seed}`;
        assert.equal(state.status, 'playing', label);
        assert.equal(state.patience, content.puzzles.tiers[tier].patience);
        assert.equal(state.queue.length + state.held.length, party.length, label);
        assert.ok(runtime.candidates(state, ctx).some((h) => same(h, truth(state))), label + ': truth not among the rules');
        assert.ok(state.observations.every((o) => o.guide), label);
        // Replaying each starting clue under the true rule gives the same feedback.
        const env = runtime.envOf(state, ctx);
        for (const o of state.observations) assert.equal(fam.key(fam.outcome(truth(state), o.action, o.pre, env).fb), fam.key(o.fb), label);
        if (fam.kind === 'sort') {
          assert.equal(runtime.isDetermined(state, ctx), false, label + ' starts already solved');
          const used = new Set(party.map((id) => fam.place(state.hyp, ctx.creatures[id])));
          const possible = runtime.hypotheses(ctx, tier).some((h) => new Set(party.map((id) => fam.place(h, ctx.creatures[id]))).size > 1);
          if (possible) assert.ok(used.size >= 2, label + ': rule does not split the party');
        } else {
          const s = fam.settle(state, env, runtime.candidates(state, ctx));
          assert.ok(!s, label + ' starts already solved');
        }
      }
  }
});

test('same seed and inputs give identical outcomes, for every puzzle', () => {
  for (const def of content.puzzles.puzzles) {
    const a = play(def, 'hard', 77, bots.optimal);
    const b = play(def, 'hard', 77, bots.optimal);
    assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
    // And a state survives a save round-trip mid-Stop.
    const roster = buildRoster(content.traits, 78);
    const ctx = makeCtx(def, roster);
    let { state } = runtime.generate(ctx, 'steady', 78, roster.slice(0, 10).map((x) => x.id));
    let copy = JSON.parse(JSON.stringify(state));
    for (let i = 0; i < 60 && state.status === 'playing'; i++) {
      const action = bots.optimal(state, ctx);
      assert.deepEqual(bots.optimal(copy, ctx), action, def.id + ': a reloaded state plays differently');
      state = runtime.attempt(state, ctx, action).state;
      copy = JSON.parse(JSON.stringify(runtime.attempt(copy, ctx, action).state));
      assert.deepEqual(copy, JSON.parse(JSON.stringify(state)));
    }
  }
});

test('hints: every family gives one, it is free of error, and the rule survives it', () => {
  for (const def of content.puzzles.puzzles) {
    const roster = buildRoster(content.traits, 5);
    const ctx = makeCtx(def, roster);
    for (const tier of ['steady', 'expert']) {
      let { state } = runtime.generate(ctx, tier, 9, roster.slice(0, 16).map((x) => x.id));
      const before = runtime.candidates(state, ctx).length;
      for (let i = 0; i < 8 && state.status === 'playing'; i++) {
        const r = runtime.hint(state, ctx);
        assert.equal(r.events[0].type, 'hint');
        if (!r.used) {
          assert.equal(r.state, state);
          break;
        }
        assert.ok(r.events[0].slot || r.events[0].say, def.id);
        state = r.state;
        if (state.status === 'playing') {
          assert.ok(runtime.candidates(state, ctx).some((h) => same(h, truth(state))), def.id + ': hint ruled out the truth');
          assert.ok(runtime.candidates(state, ctx).length <= before);
        }
        assert.equal(state.wrong, 0);
      }
    }
  }
  const def = defOf('bridge_pair');
  const roster = buildRoster(content.traits, 5);
  const ctx = makeCtx(def, roster);
  const { state } = runtime.generate(ctx, 'steady', 9, roster.slice(0, 16).map((x) => x.id));
  const r = runtime.hint(state, ctx);
  assert.equal(r.events[0].slot, family('bridge_pair').slots(state.hyp)[0]);
  assert.deepEqual(runtime.candidates(r.state, ctx), bruteCandidates(r.state, ctx));
  assert.equal(runtime.hint({ ...state, status: 'solved' }, ctx).used, false);
});

test('illegal actions are ignored', () => {
  for (const def of content.puzzles.puzzles) {
    const roster = buildRoster(content.traits, 5);
    const ctx = makeCtx(def, roster);
    const { state } = runtime.generate(ctx, 'steady', 9, roster.slice(0, 8).map((x) => x.id));
    const outsider = roster[20].id;
    for (const action of [null, {}, { id: 'nope', target: 'gateA' }, { id: outsider, target: 'gateA' }, { id: state.queue[0], target: 'nowhere' }, { id: 'x_1', target: 's0' }, { lift: 's99' }, { keeper: 9, items: 1 }, { keeper: 0, items: 0 }, { dirs: [0, 0], convoy: [state.queue[0]] }, { dirs: [0, 0, 0], convoy: [outsider] }, { dirs: [0, 0, 0], convoy: [] }]) {
      assert.equal(runtime.attempt(state, ctx, action).state, state, `${def.id} accepted ${JSON.stringify(action)}`);
    }
    assert.equal(runtime.attempt({ ...state, status: 'failed' }, ctx, bots.perfect(state, ctx)).events.length, 0);
    assert.equal(runtime.isSolved(state), false);
  }
});

// ---- Family-specific behaviour ----

test('tour_path: a miss only reveals the forks the creature reached', () => {
  const f = family('tour_path');
  assert.deepEqual(f.feedback('e01', 'e01'), { ok: true });
  assert.deepEqual(f.feedback('e01', 'e00'), { ok: false, at: 1 });
  assert.deepEqual(f.feedback('e01', 'e11'), { ok: false, at: 0 }, 'turned back at the first fork, second fork unseen');
  const hyp = { root: anyOf('crest', ['fin', 'horn']), left: anyOf('feet', ['webs', 'paws']), right: anyOf('eyes', ['slit', 'round']) };
  assert.equal(f.place(hyp, c), 'e00');
  assert.equal(f.place(hyp, { ...c, crest: 'bare' }), 'e11');
  assert.deepEqual(f.slots(hyp), ['crest', 'feet', 'eyes']);
});

test('gate_sort with three gates: second rule applies to those turned away, third takes the rest', () => {
  const f = family('gate_sort');
  const hyp = { rules: [has('crest', 'fin'), has('mark', 'dot')] };
  assert.equal(f.place(hyp, c), 'gateA');
  assert.equal(f.place(hyp, { ...c, crest: 'bare', mark: 'dot' }), 'gateB');
  assert.equal(f.place(hyp, { ...c, crest: 'bare' }), 'gateC');
  assert.equal(f.targets({ params: { gates: 3 } }).length, 3);
  assert.equal(f.describe(hyp, t).length, 3);
});

test('pattern_grid: 2x2 splits and 2x4 rooms; feedback says which of row and column fit', () => {
  const f = family('pattern_grid');
  assert.deepEqual(f.feedback('r0c1', 'r0c0'), { ok: false, rowOk: true, colOk: false });
  assert.deepEqual(f.feedback('r0c1', 'r1c0'), { ok: false, rowOk: false, colOk: false });
  assert.deepEqual(f.feedback('r0c3', 'r0c3'), { ok: true, rowOk: true, colOk: true });
  const rooms = { row: anyOf('tint', [1, 2]), col: { slot: 'feet', order: ['roller', 'paws', 'webs', 'hooves'] } };
  assert.equal(f.place(rooms, c), 'r0c2');
  assert.equal(f.targets({ params: { rows: 2, cols: 4 } }).length, 8);
  assert.equal(f.describe(rooms, t).length, 2);
});

test('rank_line: a miss says whether the creature belongs nearer the front or further back', () => {
  const f = family('rank_line');
  const hyp = { slot: 'feet', order: ['paws', 'webs', 'hooves', 'roller'] };
  assert.equal(f.place(hyp, c), 'k1');
  assert.deepEqual(f.feedback('k1', 'k1'), { ok: true });
  assert.deepEqual(f.feedback('k1', 'k3'), { ok: false, dir: -1 });
  assert.deepEqual(f.feedback('k1', 'k0'), { ok: false, dir: 1 });
});

test('totem_match and toss_plot: hidden orderings map traits to posts and patches', () => {
  const totem = family('totem_match');
  assert.equal(totem.place({ slot: 'mark', order: ['none', 'dot', 'stripe', 'ring'] }, c), 't3');
  assert.equal(totem.place({ row: anyOf('crest', ['fin', 'tuft']), col: anyOf('eyes', ['slit', 'round']) }, c), 't1');
  const toss = family('toss_plot');
  const hyp = { row: { slot: 'crest', order: ['bare', 'fin', 'horn', 'tuft'] }, col: { slot: 'eyes', order: ['wide', 'slit', 'round', 'lidded'] } };
  assert.equal(toss.place(hyp, c), 'r1c0');
  assert.deepEqual(toss.feedback('r1c0', 'r2c2'), { ok: false, cell: 'r1c0' }, 'a miss shows where it landed');
  assert.equal(toss.targets().length, 16);
});

test('seating: linked neighbours must match; a bad seat bounces and names the links; lifting is free', () => {
  for (const id of ['bench_link', 'link_web']) {
    const def = defOf(id);
    const roster = buildRoster(content.traits, 12);
    const ctx = makeCtx(def, roster);
    let { state } = runtime.generate(ctx, 'steady', 3, roster.slice(0, 12).map((x) => x.id));
    const fam = family(id);
    assert.equal(state.setup.seats, 12);
    assert.ok(state.setup.edges.length > 0 && state.held.length > 0);
    // Every link really joins two different seats of the grid.
    for (const [a, b, kind] of state.setup.edges) assert.ok(a !== b && a < 12 && b < 12 && kind < state.setup.kinds);
    // Find a placement the true rule rejects.
    let bad = null;
    for (const cid of state.queue) {
      for (let s = 0; s < 12 && !bad; s++) {
        const out = runtime.outcomeUnder(state.hyp, { id: cid, target: 's' + s }, state, ctx);
        if (out && !out.fb.ok) bad = { id: cid, target: 's' + s, links: out.fb.bad };
      }
    }
    assert.ok(bad, id + ': no rejecting placement found');
    let r = runtime.attempt(state, ctx, bad);
    assert.equal(r.events[0].type, 'rejected');
    assert.deepEqual(r.events[0].fb.bad, bad.links);
    assert.equal(r.state.patience, state.patience - 1);
    assert.ok(r.state.queue.includes(bad.id));
    // Lifting an anchor is free and puts it back in the tray.
    const seat = Object.keys(state.extra.seats)[0];
    const sitter = state.extra.seats[seat];
    r = runtime.attempt(state, ctx, { lift: 's' + seat });
    assert.equal(r.state.patience, state.patience);
    assert.ok(r.state.queue.includes(sitter) && !r.state.held.includes(sitter));
    assert.equal(r.state.observations.length, state.observations.length, 'lifting teaches nothing and records nothing');
    assert.equal(runtime.attempt(state, ctx, { id: state.queue[0], target: 's' + seat }).state, state, 'a taken seat cannot be used');
    // When patience runs out, whoever is seated still gets through.
    let s2 = state;
    while (s2.status === 'playing') s2 = runtime.attempt(s2, ctx, bad).state;
    assert.equal(s2.status, 'failed');
    assert.deepEqual(Object.keys(s2.placed).sort(), state.held.slice().sort());
    assert.equal(fam.describe(state.hyp, t).length >= 1, true);
  }
});

test('trade_ledger: disliked food is refused, a partial offer asks for more, an exact offer feeds the keeper', () => {
  const def = defOf('trade_ledger');
  const roster = buildRoster(content.traits, 8);
  const ctx = makeCtx(def, roster);
  let { state } = runtime.generate(ctx, 'steady', 4, roster.slice(0, 10).map((x) => x.id));
  assert.equal(state.setup.keepers, 2);
  const liked = state.hyp.sets;
  assert.ok(liked.every(Boolean) && (liked[0] & liked[1]) === 0, 'keepers want different things');
  const n = state.setup.items.length;
  const disliked = [...Array(n).keys()].find((i) => !(liked[0] & (1 << i)));
  let r = runtime.attempt(state, ctx, { keeper: 0, items: liked[0] | (1 << disliked) });
  assert.deepEqual([r.events[0].type, r.events[0].fb.kind, r.state.patience], ['rejected', 'bad', state.patience - 1]);
  const first = liked[0] & -liked[0];
  if (first !== liked[0]) {
    r = runtime.attempt(state, ctx, { keeper: 0, items: first });
    assert.deepEqual([r.events[0].type, r.events[0].fb.kind, r.state.patience], ['info', 'more', state.patience]);
  }
  r = runtime.attempt(state, ctx, { keeper: 0, items: liked[0] });
  assert.equal(r.events[0].type, 'accepted');
  assert.equal(Object.keys(r.state.placed).length, 5, 'one of two keepers fed lets half the party through');
  assert.deepEqual(r.state.extra.fed, [true, false]);
  assert.equal(runtime.attempt(r.state, ctx, { keeper: 0, items: liked[0] }).state, r.state, 'a fed keeper takes no more');
  r = runtime.attempt(r.state, ctx, { keeper: 1, items: liked[1] });
  assert.equal(r.state.status, 'solved');
  assert.equal(Object.keys(r.state.placed).length, 10);
});

test('signal_guess: wrong answers are graded; later wanted creatures are not let through early', () => {
  const def = defOf('signal_guess');
  const roster = buildRoster(content.traits, 6);
  const ctx = makeCtx(def, roster);
  for (const [tier, pattern] of [['steady', /^[01]{5}$/], ['hard', /^[0-5]$/]]) {
    let { state } = runtime.generate(ctx, tier, 2, roster.slice(0, 12).map((x) => x.id));
    const targets = state.hyp.targets;
    assert.equal(new Set(targets).size, 3);
    const wrongId = state.queue.find((id) => id !== targets[0]);
    let r = runtime.attempt(state, ctx, { id: wrongId, target: 'stone' });
    assert.equal(r.events[0].type, 'rejected');
    assert.match(r.events[0].fb.marks, pattern);
    assert.equal(r.state.extra.round, 0);
    r = runtime.attempt(state, ctx, { id: targets[0], target: 'stone' });
    assert.equal(r.events[0].type, 'accepted');
    assert.equal(r.state.extra.round, 1);
    assert.ok(r.state.placed[targets[0]]);
    assert.ok(r.state.queue.includes(targets[1]) && r.state.queue.includes(targets[2]), 'wanted creatures wait for their round');
    // What is carved on the stone is true of the wanted creature.
    const fam = family('signal_guess');
    for (const slot of fam.carved(state)) assert.ok(runtime.candidates(state, ctx).every((id) => ctx.creatures[id][slot] === ctx.creatures[targets[0]][slot]));
  }
  assert.deepEqual(share(['a', 'b', 'c', 'd', 'e', 'f'], 3, ['d'], ['a', 'f']).map((x) => x.id), ['d', 'b']);
});

test('echo_match: the pond changes traits by a hidden rule; a wrong pick shows that creature’s own reflection', () => {
  const def = defOf('echo_match');
  const roster = buildRoster(content.traits, 9);
  const ctx = makeCtx(def, roster);
  const fam = family('echo_match');
  const { state } = runtime.generate(ctx, 'steady', 6, roster.slice(0, 12).map((x) => x.id));
  const target = fam.current(state);
  const refl = fam.reflect(state.hyp, ctx.creatures[target], ctx.traits);
  assert.notDeepEqual(refl, ctx.creatures[target], 'the reflection differs from the creature');
  const changed = Object.keys(refl).filter((s) => refl[s] !== ctx.creatures[target][s]);
  assert.deepEqual(changed, fam.slots(state.hyp).filter((s) => changed.includes(s)));
  const other = state.queue.find((id) => id !== target);
  let r = runtime.attempt(state, ctx, { id: other, target: 'pond' });
  assert.equal(r.events[0].type, 'rejected');
  assert.equal(r.events[0].fb.refl, Object.values(fam.reflect(state.hyp, ctx.creatures[other], ctx.traits)).join(','));
  r = runtime.attempt(state, ctx, { id: target, target: 'pond' });
  assert.equal(r.events[0].type, 'accepted');
  assert.ok(r.state.placed[target]);
});

test('switch_run: switches flip after trigger traits pass; riders reach the shed of their coat or bounce', () => {
  const fam = family('switch_run');
  const h = [has('crest', 'fin'), has('feet', 'webs'), has('eyes', 'slit')];
  const plain = { crest: 'bare', eyes: 'round', mark: 'none', feet: 'paws', tint: 0 };
  // Rider 1 (fin, webs) flips the first switch and the left one; rider 2 then goes right.
  assert.deepEqual(fam.run(h, [0, 0, 0], [c, plain, plain]), { exits: [0, 2, 2], dirs: [1, 1, 0] });
  assert.deepEqual(fam.run(h, [1, 0, 1], [plain]).exits, [3]);
  const def = defOf('switch_run');
  const roster = buildRoster(content.traits, 14);
  const ctx = makeCtx(def, roster);
  const { state } = runtime.generate(ctx, 'steady', 8, roster.slice(0, 9).map((x) => x.id));
  assert.equal(state.setup.size, 3);
  assert.equal(state.setup.triggers.filter((x) => !x).length, 2, 'two triggers are hidden at this tier');
  assert.deepEqual(state.setup.sheds.slice().sort(), [0, 1, 2, 3]);
  assert.equal(runtime.attempt(state, ctx, { dirs: [0, 0, 0], convoy: state.queue.slice(0, 2) }).state, state, 'a full convoy is required while enough riders wait');
  const r = runtime.attempt(state, ctx, { dirs: [0, 1, 0], convoy: state.queue.slice(0, 3) });
  const ev = r.events[0];
  assert.equal(ev.fb.exits.length, 3);
  for (const id of ev.delivered) assert.equal(state.setup.sheds[Number(r.state.placed[id][1])], ctx.creatures[id].tint);
  assert.equal(r.state.patience, state.patience - (ev.delivered.length === 3 ? 0 : 1));
  // The last riders may go in a smaller convoy.
  const few = { ...state, queue: state.queue.slice(0, 2) };
  assert.notEqual(runtime.attempt(few, ctx, { dirs: [0, 0, 0], convoy: few.queue.slice(0, 1) }).state, few);
});
