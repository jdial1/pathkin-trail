import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { buildRoster, comboCount } from '../app/src/main/assets/www/js/core/traits.js';
import { has, anyOf, count, and, or, not, evaluate, ruleSlots, describeRule } from '../app/src/main/assets/www/js/core/rules.js';
import { family, feedbackKey, FAMILIES } from '../app/src/main/assets/www/js/core/families.js';
import * as runtime from '../app/src/main/assets/www/js/core/runtime.js';
import { content, bots, play, makeCtx } from './helpers.mjs';

const SEEDS = Number(process.env.SEEDS || 10000);
const c = { crest: 'fin', eyes: 'wide', mark: 'ring', feet: 'webs', tint: 2 };
const t = (k, v) => k + (v ? JSON.stringify(v) : '');

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

test('roster: 36 unique creatures, same seed same roster', () => {
  assert.equal(comboCount(content.traits), 1024);
  for (let seed = 0; seed < 200; seed++) {
    const r = buildRoster(content.traits, seed);
    assert.equal(r.length, 36);
    assert.equal(new Set(r.map((x) => JSON.stringify(x.traits))).size, 36);
    assert.deepEqual(r, buildRoster(content.traits, seed));
  }
  assert.notDeepEqual(buildRoster(content.traits, 1), buildRoster(content.traits, 2));
});

test('every rule shape of every tier describes itself and names its slots', () => {
  for (const def of content.puzzles.puzzles) {
    const fam = family(def.family);
    for (const tier of content.puzzles.tierOrder) {
      const hyps = runtime.hypotheses(makeCtx(def, []), tier);
      assert.ok(hyps.length >= 12, `${def.id}/${tier} has only ${hyps.length} rules`);
      for (let i = 0; i < hyps.length; i += Math.max(1, Math.floor(hyps.length / 40))) {
        const lines = fam.describe(hyps[i], t);
        assert.ok(lines.length >= 2 && lines.every((l) => typeof l === 'string' && l.length > 0));
        const slots = fam.slots(hyps[i]);
        assert.ok(slots.length >= 1 && slots.every((s) => def.tiers[tier].slots.includes(s)), `${def.id}/${tier} slot outside tier`);
        assert.ok(fam.targets(def).some((x) => x.id === fam.place(hyps[i], c)));
      }
    }
  }
  assert.throws(() => family('nope'));
  assert.throws(() => FAMILIES.gate_sort.hypotheses({ params: { gates: 2 } }, { forms: ['nope'], slots: ['crest'] }, content.traits));
});

// From-scratch reference for the incremental candidate tracking.
function bruteCandidates(state, ctx) {
  const fam = family(state.family);
  const traits = (id) => ctx.creatures[id] || state.examples[id];
  return runtime.hypotheses(ctx, state.tier).filter(
    (h) =>
      state.hints.every((s) => fam.slots(h).includes(s)) &&
      state.observations.every((o) => feedbackKey(fam.feedback(fam.place(h, traits(o.id)), o.target)) === feedbackKey(o.fb))
  );
}

const tierSets = [...new Set(content.puzzles.puzzles.map((p) => p.tierSet || p.family))];

for (const set of tierSets) {
  const defs = content.puzzles.puzzles.filter((p) => (p.tierSet || p.family) === set);
  for (const tier of content.puzzles.tierOrder) {
    test(`${set}/${tier}: ${SEEDS} seeds solvable by deduction, solver agrees with brute force`, () => {
      const lengths = [];
      let solved = 0;
      let gain = 0;
      let gainRuns = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const def = defs[seed % defs.length];
        const { state, ctx, party, attempts } = play(def, tier, seed, bots.optimal);
        const fam = family(def.family);
        const cands = runtime.candidates(state, ctx);
        // The true rule is never eliminated.
        assert.ok(cands.includes(state.hyp));
        if (seed % 97 === 0) assert.deepEqual(cands, bruteCandidates(state, ctx));
        if (state.status === 'solved') {
          solved++;
          lengths.push(attempts);
          // Everyone got through, each to its correct place; creatures waved
          // through at the "rule found" moment are placed the same way by
          // every surviving candidate.
          assert.equal(Object.keys(state.placed).length, party.length);
          for (const id of party) {
            assert.equal(state.placed[id], fam.place(state.hyp, ctx.creatures[id]));
            const sent = state.observations.some((o) => o.id === id && o.fb.ok);
            if (!sent && seed % 97 === 0) for (const h of cands) assert.equal(fam.place(h, ctx.creatures[id]), state.placed[id]);
          }
        } else {
          assert.equal(state.patience, 0);
          assert.ok(state.queue.length > 0);
        }
        if (seed <= 1000) {
          // Rules ruled out per observation (trail guides and sends alike).
          gain += (runtime.hypotheses(ctx, tier).length - cands.length) / state.observations.length;
          gainRuns++;
        }
      }
      lengths.sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)];
      const rate = solved / SEEDS;
      const [lo, hi] = content.puzzles.tiers[tier].sends;
      console.log(`  ${set}/${tier}: optimal bot solves ${(rate * 100).toFixed(1)}%, median ${median} sends, info gain ${(gain / gainRuns).toFixed(1)} rules/observation`);
      // Deduce, don't guess: deduction alone nearly always gets through.
      assert.ok(rate >= 0.97, `optimal bot only solved ${rate}`);
      // Content gate: an observation removes at least one candidate rule on average.
      assert.ok(gain / gainRuns >= 1, 'information gain below 1');
      assert.ok(median >= lo && median <= hi, `median solve length ${median} outside ${lo}-${hi}`);
    });

    test(`${set}/${tier}: guessing is clearly worse than deducing`, () => {
      let failed = 0;
      let wrongRandom = 0;
      let wrongOptimal = 0;
      const runs = Math.min(2000, SEEDS);
      for (let seed = 1; seed <= runs; seed++) {
        const def = defs[seed % defs.length];
        const r = play(def, tier, seed, bots.random).state;
        if (r.status === 'failed') failed++;
        wrongRandom += r.wrong;
        wrongOptimal += play(def, tier, seed, bots.optimal).state.wrong;
      }
      const ratio = wrongRandom / Math.max(1, wrongOptimal);
      console.log(`  ${set}/${tier}: random bot fails ${((failed / runs) * 100).toFixed(1)}%, makes ${ratio.toFixed(1)}x the wrong sends of the optimal bot`);
      // Not trivial: a guesser wastes far more patience than a deducer at
      // every tier, and above the welcoming gentle tier it often fails.
      assert.ok(ratio >= 1.3, 'random bot is nearly as good as deduction: ' + ratio);
      if (tier !== 'gentle') assert.ok(failed / runs >= 0.15, 'random bot failed only ' + failed / runs);
    });
  }
}

test('generation: guides are honest, never give the rule away, and the party can tell the rule apart', () => {
  for (const def of content.puzzles.puzzles)
    for (const tier of content.puzzles.tierOrder)
      for (let seed = 1; seed <= 60; seed++) {
        const roster = buildRoster(content.traits, seed);
        const ctx = makeCtx(def, roster);
        const party = roster.slice(0, 2 + (seed % 15)).map((x) => x.id);
        const { state } = runtime.generate(ctx, tier, seed, party);
        const fam = family(def.family);
        const guides = Object.keys(state.examples);
        assert.ok(guides.length <= def.tiers[tier].examples);
        assert.equal(state.observations.length, guides.length);
        for (const o of state.observations) {
          assert.equal(o.fb.ok, true);
          assert.equal(o.target, fam.place(state.hyp, state.examples[o.id]));
        }
        assert.equal(runtime.isDetermined(state, ctx), false, `${def.id}/${tier} seed ${seed} starts already solved`);
        assert.equal(state.patience, content.puzzles.tiers[tier].patience);
        const used = new Set(party.map((id) => fam.place(state.hyp, ctx.creatures[id])));
        const possible = runtime.hypotheses(ctx, tier).some((h) => new Set(party.map((id) => fam.place(h, ctx.creatures[id]))).size > 1);
        if (possible) assert.ok(used.size >= 2, 'rule does not split the party');
      }
});

test('greedy bot also finishes every Stop cleanly', () => {
  for (const def of content.puzzles.puzzles)
    for (const tier of content.puzzles.tierOrder)
      for (let seed = 1; seed <= 60; seed++) assert.ok(['solved', 'failed'].includes(play(def, tier, seed, bots.greedy).state.status));
});

test('same seed and inputs give identical outcomes', () => {
  for (const def of content.puzzles.puzzles) {
    const a = play(def, 'hard', 77, bots.optimal);
    const b = play(def, 'hard', 77, bots.optimal);
    assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  }
});

test('tour_path: a miss only reveals the forks the creature reached', () => {
  const f = family('tour_path');
  assert.deepEqual(f.feedback('e01', 'e01'), { ok: true });
  assert.deepEqual(f.feedback('e01', 'e00'), { ok: false, at: 1 });
  assert.deepEqual(f.feedback('e01', 'e10'), { ok: false, at: 0 });
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

test('pattern_grid feedback says which of row and column fit', () => {
  const f = family('pattern_grid');
  assert.deepEqual(f.feedback('r0c1', 'r0c0'), { ok: false, rowOk: true, colOk: false });
  assert.deepEqual(f.feedback('r0c1', 'r1c0'), { ok: false, rowOk: false, colOk: false });
  assert.deepEqual(f.feedback('r0c1', 'r0c1'), { ok: true, rowOk: true, colOk: true });
  assert.equal(new Set(['ok', 'no', 'g10', 'g01', 'g00', 'f0', 'f1']).size, 7);
});

test('hints reveal a slot, narrow candidates, and run out', () => {
  const def = content.puzzles.puzzles.find((p) => p.family === 'pattern_grid');
  const roster = buildRoster(content.traits, 5);
  const ctx = makeCtx(def, roster);
  const { state } = runtime.generate(ctx, 'steady', 9, roster.slice(0, 16).map((x) => x.id));
  const before = runtime.candidates(state, ctx).length;
  const slots = family(def.family).slots(state.hyp);
  let r = runtime.hint(state, ctx);
  assert.equal(r.used, true);
  assert.equal(r.events[0].slot, slots[0]);
  assert.ok(runtime.candidates(r.state, ctx).length < before);
  assert.ok(runtime.candidates(r.state, ctx).includes(state.hyp));
  assert.deepEqual(runtime.candidates(r.state, ctx), bruteCandidates(r.state, ctx));
  r = runtime.hint(r.state, ctx);
  assert.equal(r.events[0].slot, slots[1]);
  if (r.state.status === 'playing') {
    r = runtime.hint(r.state, ctx);
    assert.equal(r.used, false);
    assert.equal(r.events[0].slot, null);
  }
  assert.equal(runtime.hint({ ...state, status: 'solved' }, ctx).used, false);
});

test('attempts on bad ids or finished stops are ignored', () => {
  const def = content.puzzles.puzzles[0];
  const roster = buildRoster(content.traits, 5);
  const ctx = makeCtx(def, roster);
  const { state } = runtime.generate(ctx, 'gentle', 9, [roster[0].id, roster[1].id, roster[2].id]);
  assert.equal(runtime.attempt(state, ctx, 'nope', 'gateA').state, state);
  assert.equal(runtime.attempt(state, ctx, roster[0].id, 'nowhere').state, state);
  assert.equal(runtime.attempt(state, ctx, roster[9].id, 'gateA').state, state);
  assert.equal(runtime.attempt(state, ctx, 'x_1', 'gateA').state, state, 'guides cannot be sent');
  assert.equal(runtime.isSolved(state), false);
});
