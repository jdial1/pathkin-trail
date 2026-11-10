import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { buildRoster, comboCount, STATUSES } from '../app/src/main/assets/www/js/core/traits.js';
import { has, anyOf, count, and, or, not, evaluate, ruleSlots, describeRule } from '../app/src/main/assets/www/js/core/rules.js';
import { family } from '../app/src/main/assets/www/js/core/families.js';
import * as runtime from '../app/src/main/assets/www/js/core/runtime.js';
import * as game from '../app/src/main/assets/www/js/core/game.js';
import { content, bots } from './helpers.mjs';

const SEEDS = Number(process.env.SEEDS || 10000);
const c = { crest: 'fin', eyes: 'wide', mark: 'ring', feet: 'webs', tint: 2 };

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
  assert.deepEqual(ruleSlots(and(has('crest', 'fin'), not(anyOf('feet', ['paws'])))), ['crest', 'feet']);
  assert.deepEqual(ruleSlots(count(1, terms)), ['crest', 'mark', 'feet']);
  const t = (k, v) => k + (v ? JSON.stringify(v) : '');
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

function makeCtx(def, roster) {
  const creatures = {};
  for (const x of roster) creatures[x.id] = x.traits;
  return { def, traits: content.traits, creatures };
}

function bruteCandidates(state, ctx) {
  const fam = family(state.family);
  return runtime.hypotheses(ctx, state.tier).filter((h) =>
    state.observations.every((o) => JSON.stringify(fam.feedback(h, ctx.creatures[o.id], o.target)) === JSON.stringify(o.fb))
  );
}

function play(def, tier, seed, bot) {
  const rng = makeRng(seed);
  const roster = buildRoster(content.traits, seed);
  const size = 2 + rng.int(15);
  const party = rng.shuffle(roster).slice(0, size).map((x) => x.id);
  const ctx = makeCtx(def, roster);
  let { state } = runtime.generate(ctx, tier, rng.state, party);
  const start = runtime.candidates(state, ctx).length;
  let attempts = 0;
  let removed = 0;
  while (state.status === 'playing') {
    const before = runtime.candidates(state, ctx).length;
    const [id, target] = bot(state, ctx, rng);
    const r = runtime.attempt(state, ctx, id, target);
    state = r.state;
    attempts++;
    removed += before - runtime.candidates(state, ctx).length;
    assert.ok(attempts <= 200, 'stop never ended');
  }
  return { state, ctx, party, attempts, removed, start };
}

for (const def of content.puzzles.puzzles) {
  for (const tier of content.puzzles.tierOrder) {
    test(`${def.family}/${tier}: ${SEEDS} seeds solvable, solver agrees with brute force`, () => {
      const lengths = [];
      let solved = 0;
      let gain = 0;
      let gainRuns = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { state, ctx, party, attempts, removed } = play(def, tier, seed, bots.optimal);
        const fam = family(def.family);
        // The true rule is never eliminated, and the incremental candidate
        // list matches a from-scratch brute-force filter.
        const brute = bruteCandidates(state, ctx);
        assert.ok(brute.includes(state.hyp));
        assert.deepEqual(runtime.candidates(state, ctx), brute);
        if (state.status === 'solved') {
          solved++;
          lengths.push(attempts);
          // Everyone got through, each to its correct place, and at that
          // point every surviving candidate agrees on all of them.
          assert.equal(Object.keys(state.placed).length, party.length);
          for (const id of party) {
            assert.equal(state.placed[id], fam.place(state.hyp, ctx.creatures[id]));
            const obs = state.observations.some((o) => o.id === id && o.fb.ok);
            if (!obs) for (const h of brute) assert.equal(fam.place(h, ctx.creatures[id]), state.placed[id]);
          }
        } else {
          assert.equal(state.patience, 0);
          assert.ok(state.queue.length > 0);
        }
        if (seed <= 1000) {
          gain += removed / attempts;
          gainRuns++;
        }
      }
      lengths.sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)];
      const rate = solved / SEEDS;
      console.log(`  ${def.family}/${tier}: optimal bot solves ${(rate * 100).toFixed(1)}%, median ${median} sends, info gain ${(gain / gainRuns).toFixed(2)} rules/attempt`);
      // Deduction must be enough: the optimal bot nearly always gets through.
      assert.ok(rate >= 0.95, `optimal bot only solved ${rate}`);
      // Content gate: an attempt removes at least one candidate rule on average.
      assert.ok(gain / gainRuns >= 1, 'information gain below 1');
      assert.ok(median >= 2 && median <= 12, 'median solve length out of band: ' + median);
    });

    test(`${def.family}/${tier}: guessing is clearly worse than deducing`, () => {
      let failed = 0;
      let wrongRandom = 0;
      let wrongOptimal = 0;
      const runs = 2000;
      for (let seed = 1; seed <= runs; seed++) {
        const r = play(def, tier, seed, bots.random).state;
        if (r.status === 'failed') failed++;
        wrongRandom += r.wrong;
        wrongOptimal += play(def, tier, seed, bots.optimal).state.wrong;
      }
      const ratio = wrongRandom / wrongOptimal;
      console.log(`  ${def.family}/${tier}: random bot fails ${((failed / runs) * 100).toFixed(1)}%, makes ${ratio.toFixed(1)}x the wrong sends of the optimal bot`);
      // Not trivial: a guesser wastes far more patience than a deducer at
      // every tier, and above the welcoming gentle tier it often fails.
      assert.ok(ratio >= 1.3, 'random bot is nearly as good as deduction: ' + ratio);
      if (tier !== 'gentle') assert.ok(failed / runs >= 0.2, 'random bot failed only ' + failed / runs);
    });
  }
}

test('greedy bot also finishes every Stop state cleanly', () => {
  for (const def of content.puzzles.puzzles)
    for (const tier of content.puzzles.tierOrder)
      for (let seed = 1; seed <= 300; seed++) {
        const { state } = play(def, tier, seed, bots.greedy);
        assert.ok(['solved', 'failed'].includes(state.status));
      }
});

test('same seed and inputs give identical outcomes', () => {
  for (const def of content.puzzles.puzzles) {
    const a = play(def, 'steady', 77, bots.optimal);
    const b = play(def, 'steady', 77, bots.optimal);
    assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  }
});

test('hints reveal a slot, narrow candidates, and run out', () => {
  const def = content.puzzles.puzzles[2];
  const roster = buildRoster(content.traits, 5);
  const ctx = makeCtx(def, roster);
  let { state } = runtime.generate(ctx, 'steady', 9, roster.slice(0, 16).map((x) => x.id));
  const before = runtime.candidates(state, ctx).length;
  const slots = family(def.family).slots(state.hyp);
  let r = runtime.hint(state, ctx);
  assert.equal(r.used, true);
  assert.equal(r.events[0].slot, slots[0]);
  assert.ok(runtime.candidates(r.state, ctx).length < before);
  assert.ok(runtime.candidates(r.state, ctx).includes(state.hyp));
  r = runtime.hint(r.state, ctx);
  assert.equal(r.events[0].slot, slots[1]);
  if (r.state.status === 'playing') {
    r = runtime.hint(r.state, ctx);
    assert.equal(r.used, false);
    assert.equal(r.events[0].slot, null);
  }
});

test('attempts on bad ids or finished stops are ignored', () => {
  const def = content.puzzles.puzzles[0];
  const roster = buildRoster(content.traits, 5);
  const ctx = makeCtx(def, roster);
  const { state } = runtime.generate(ctx, 'gentle', 9, [roster[0].id, roster[1].id, roster[2].id]);
  assert.equal(runtime.attempt(state, ctx, 'nope', 'gateA').state, state);
  assert.equal(runtime.attempt(state, ctx, roster[0].id, 'nowhere').state, state);
  assert.equal(runtime.attempt(state, ctx, roster[9].id, 'gateA').state, state);
  assert.throws(() => family('nope'));
});

// ---- App state machine -------------------------------------------------

function checkInvariants(p) {
  for (const x of p.roster) assert.ok(STATUSES.includes(x.status), 'bad status ' + x.status);
  const partyCount = p.roster.filter((x) => x.status === 'party').length;
  if (p.stop) {
    const inStop = p.stop.queue.length + Object.keys(p.stop.placed).length;
    assert.equal(partyCount, inStop);
  } else assert.equal(partyCount, 0);
  for (const id of p.selection) assert.equal(p.roster.find((x) => x.id === id).status, 'available');
  assert.ok(p.hintTokens >= 0 && p.hintTokens <= content.trail.hintTokenCap);
}

function scriptedRun(seed, { roundTrip = false } = {}) {
  const rng = makeRng(seed);
  let p = game.newProfile(content, seed, 1);
  const log = [];
  const send = (ev) => {
    const r = game.reduce(p, ev, content);
    p = r.profile;
    log.push(...r.events.map((e) => e.type));
    checkInvariants(p);
    if (roundTrip) p = game.migrate(JSON.parse(JSON.stringify(p)));
  };
  if (rng.int(2)) send({ type: 'REROLL' });
  send({ type: 'ROSTER_OK' });
  let legs = 0;
  while (game.countStatus(p, 'delivered') < p.roster.length && legs < 40) {
    legs++;
    if (rng.int(3) === 0) send({ type: 'SET_TIER', legId: 'leg1', tier: rng.pick(content.puzzles.tierOrder) });
    send({ type: 'GOTO', screen: 'party' });
    const avail = p.roster.filter((x) => x.status === 'available');
    if (rng.int(4) === 0 && avail.length > 2) {
      send({ type: 'PARK', id: avail[0].id });
      send({ type: 'RETRIEVE', id: avail[0].id });
    }
    send({ type: 'PARTY_FILL' });
    if (p.selection.length > 3 && rng.int(2)) send({ type: 'PARTY_TOGGLE', id: p.selection[0] });
    send({ type: 'START_LEG', legId: 'leg1' });
    while (p.screen === 'stop') {
      if (p.stop.status === 'playing') {
        if (rng.int(10) === 0) send({ type: 'HINT' });
        if (p.stop.status !== 'playing') continue;
        const bot = rng.int(4) === 0 ? bots.random : bots.optimal;
        const [id, target] = bot(p.stop, game.stopCtx(p, content), rng);
        send({ type: 'ATTEMPT', id, target });
      } else send({ type: 'STOP_CONTINUE' });
    }
    assert.equal(p.screen, 'summary');
    send({ type: 'SUMMARY_OK' });
  }
  return { p, log };
}

test('100 scripted runs: no crash, statuses stay valid, the Trail can be finished', () => {
  let finished = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { p } = scriptedRun(seed);
    if (game.countStatus(p, 'delivered') === p.roster.length) {
      finished++;
      assert.equal(p.screen, 'finale');
    }
  }
  assert.ok(finished >= 90, 'only finished ' + finished);
});

test('save round-trip after every event (mid-Stop resume) changes nothing', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const a = scriptedRun(seed);
    const b = scriptedRun(seed, { roundTrip: true });
    assert.equal(JSON.stringify(a.p), JSON.stringify(b.p));
    assert.deepEqual(a.log, b.log);
  }
});

test('leg rewards: hint tokens capped, full party tracked, returned creatures go back', () => {
  let p = game.newProfile(content, 3, 1);
  const send = (ev) => (p = game.reduce(p, ev, content).profile);
  send({ type: 'ROSTER_OK' });
  send({ type: 'PARTY_FILL' });
  assert.equal(p.selection.length, 16);
  send({ type: 'PARTY_TOGGLE', id: p.roster.find((x) => !p.selection.includes(x.id)).id });
  assert.equal(p.selection.length, 16, 'party is capped at 16');
  send({ type: 'START_LEG', legId: 'leg1' });
  // Burn all patience with deliberately wrong sends.
  const fam = family(p.stop.family);
  while (p.stop.status === 'playing') {
    const id = p.stop.queue[0];
    const right = fam.place(p.stop.hyp, game.stopCtx(p, content).creatures[id]);
    const wrong = fam.targets(game.stopCtx(p, content).def).find((t) => t.id !== right).id;
    send({ type: 'ATTEMPT', id, target: wrong });
  }
  assert.equal(p.stop.status, 'failed');
  const back = p.stop.queue.slice();
  send({ type: 'STOP_CONTINUE' });
  assert.equal(p.screen, 'summary');
  assert.equal(p.summary.delivered, 0);
  for (const id of back) {
    const x = p.roster.find((y) => y.id === id);
    assert.equal(x.status, 'available');
    assert.equal(x.history.timesReturned, 1);
  }
  send({ type: 'SUMMARY_OK' });
  assert.equal(p.screen, 'camp');
});

test('saves: migrate keeps current version, refuses future and junk', () => {
  const p = game.newProfile(content, 3, 1);
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => game.migrate({ ...p, schemaVersion: game.SCHEMA_VERSION + 1 }), game.FutureSaveError);
  assert.throws(() => game.migrate({}));
  assert.throws(() => game.migrate(null));
});

test('nicknames, favourites, and ignored events', () => {
  let p = game.newProfile(content, 3, 1);
  const send = (ev) => (p = game.reduce(p, ev, content).profile);
  const id = p.roster[0].id;
  send({ type: 'NICKNAME', id, name: '  Pip the Extremely Long Named  ' });
  assert.equal(p.roster[0].nickname, 'Pip the Extremel');
  send({ type: 'NICKNAME', id, name: '' });
  assert.equal(p.roster[0].nickname, null);
  send({ type: 'FAVOURITE', id });
  assert.equal(p.roster[0].favourite, true);
  const before = p;
  send({ type: 'GOTO', screen: 'map' });
  send({ type: 'ATTEMPT', id, target: 'gateA' });
  send({ type: 'STOP_CONTINUE' });
  send({ type: 'START_LEG', legId: 'leg1' });
  send({ type: 'WHATEVER' });
  assert.equal(p, before);
});
