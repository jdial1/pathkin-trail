import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { STATUSES } from '../app/src/main/assets/www/js/core/traits.js';
import { family } from '../app/src/main/assets/www/js/core/families.js';
import * as game from '../app/src/main/assets/www/js/core/game.js';
import { content, bots } from './helpers.mjs';

const HOME = game.HOME(content);
const golden = (name) => JSON.parse(readFileSync(new URL(`./golden/${name}.json`, import.meta.url), 'utf8'));

function checkInvariants(p) {
  for (const x of p.roster) {
    assert.ok(STATUSES.includes(x.status), 'bad status ' + x.status);
    assert.ok(x.at >= 0 && x.at <= HOME);
    assert.equal(x.status === 'delivered', x.at === HOME && x.status !== 'lost', `${x.id} delivered/home mismatch`);
    assert.equal(x.status === 'lost', 'lostAt' in x);
    if (x.status === 'lost') assert.ok(x.lostAt > x.at && x.lostAt <= HOME);
  }
  const partyCount = p.roster.filter((x) => x.status === 'party').length;
  if (p.stop) assert.equal(partyCount, p.stop.queue.length + p.stop.held.length + Object.keys(p.stop.placed).length);
  else assert.equal(partyCount, 0);
  for (const id of p.selection) {
    const x = p.roster.find((y) => y.id === id);
    assert.ok(x.status === 'available' && x.at === p.camp);
  }
  assert.ok(p.hintTokens >= 0 && p.hintTokens <= content.trail.hintTokenCap);
  assert.equal(p.stats.delivered, game.countStatus(p, 'delivered'));
  assert.equal(p.schemaVersion, game.SCHEMA_VERSION);
}

function driver(seed, { roundTrip = false } = {}) {
  const d = { p: game.newProfile(content, seed, 1), log: [], rng: makeRng(seed) };
  d.send = (ev) => {
    const r = game.reduce(d.p, ev, content);
    d.p = r.profile;
    d.log.push(...r.events.map((e) => e.type));
    checkInvariants(d.p);
    if (roundTrip) d.p = game.migrate(JSON.parse(JSON.stringify(d.p)), content);
    return r.events;
  };
  // Plays the current leg run to its summary.
  d.playLeg = (botFor = () => bots.optimal) => {
    while (d.p.screen === 'stop') {
      if (d.p.stop.status === 'playing') {
        const bot = botFor(); // may spend a hint, which can itself end the Stop
        if (d.p.stop.status !== 'playing') continue;
        const before = d.p;
        d.send({ type: 'ATTEMPT', action: bot(d.p.stop, game.stopCtx(d.p, content), d.rng) });
        assert.notEqual(d.p, before, 'bot made an illegal move');
      } else d.send({ type: 'STOP_CONTINUE' });
    }
    assert.equal(d.p.screen, 'summary');
  };
  // Sends waiting creatures to wrong targets until patience runs out. Needs a
  // big party on a hard tier: with few creatures a miss can reveal the rule.
  d.failStop = () => {
    const fam = family(d.p.stop.family);
    while (d.p.stop.status === 'playing') {
      const ctx = game.stopCtx(d.p, content);
      const id = d.p.stop.queue[0];
      const right = fam.place(d.p.stop.hyp, ctx.creatures[id]);
      d.send({ type: 'ATTEMPT', id, target: fam.targets(ctx.def).find((x) => x.id !== right).id });
    }
    assert.equal(d.p.stop.status, 'failed');
  };
  return d;
}

// Tries every way to bring back the creatures stranded at one camp.
function rescueAt(d, camp) {
  d.send({ type: 'SELECT_CAMP', camp });
  for (const lost of game.strandedAt(d.p, camp)) {
    const friend = game.friendsFor(d.p, content, lost).find((f) => game.sharedTraits(f, lost) >= content.trail.rescueSharedTraits);
    if (friend) d.send({ type: 'RESCUE', id: lost.id, friendId: friend.id });
    else if (d.p.hintTokens > 0) d.send({ type: 'RESCUE', id: lost.id, token: true });
    else if (game.canFreeRescue(d.p, content, lost)) d.send({ type: 'RESCUE', id: lost.id });
  }
}

function scriptedRun(seed, opts) {
  const d = driver(seed, opts);
  const { rng } = d;
  // Every fifth Trail is led by a careless player who mostly guesses, so
  // that failed legs, stranding and rescue all really happen.
  const clumsy = seed % 5 === 0;
  if (rng.int(2)) d.send({ type: 'REROLL' });
  d.send({ type: 'ROSTER_OK' });
  let legs = 0;
  while (game.countStatus(d.p, 'delivered') < d.p.roster.length && legs < 400) {
    legs++;
    for (let camp = 1; camp <= HOME; camp++) if (game.strandedAt(d.p, camp).length) rescueAt(d, camp);
    if (d.p.screen === 'finale') break;
    const camp = content.trail.legs.map((l) => l.from).find((n) => game.readyAt(d.p, n).length > 0);
    if (camp === undefined) {
      // Only parked or stranded creatures remain: wake the parked ones.
      for (const x of d.p.roster.filter((y) => y.status === 'parked')) d.send({ type: 'RETRIEVE', id: x.id });
      continue;
    }
    d.send({ type: 'SELECT_CAMP', camp });
    const leg = content.trail.legs[camp];
    if (rng.int(3) === 0) d.send({ type: 'SET_TIER', legId: leg.id, tier: rng.pick(content.puzzles.tierOrder) });
    d.send({ type: 'GOTO', screen: 'party' });
    const ready = game.readyAt(d.p, camp);
    if (rng.int(5) === 0 && ready.length > 2) d.send({ type: 'PARK', id: ready[0].id });
    d.send({ type: 'PARTY_FILL' });
    if (d.p.selection.length > 3 && rng.int(2)) d.send({ type: 'PARTY_TOGGLE', id: d.p.selection[0] });
    d.send({ type: 'START_LEG', branch: rng.pick(leg.branches).id });
    assert.equal(d.p.screen, 'stop');
    d.playLeg(() => {
      if (d.p.stop.status === 'playing' && rng.int(12) === 0) d.send({ type: 'HINT' });
      return d.p.stop.status === 'playing' && rng.int(clumsy ? 3 : 5) < (clumsy ? 2 : 1) ? bots.random : bots.optimal;
    });
    d.send({ type: 'SUMMARY_OK' });
  }
  return d;
}

test('100 scripted Trails: no crash, statuses stay valid, everyone can always be brought home', () => {
  const seen = new Set();
  let stranded = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { p, log } = scriptedRun(seed);
    assert.equal(game.countStatus(p, 'delivered'), p.roster.length, `seed ${seed} did not finish`);
    assert.equal(p.screen, 'finale');
    for (const key of Object.keys(p.seen)) seen.add(key);
    stranded += log.filter((e) => e === 'stranded').length;
    assert.ok(p.goals.all_home && p.goals.first_leg);
  }
  // Every leg and both branches of the fork get played, and stranding really happens.
  assert.equal(seen.size, 4);
  assert.ok(stranded > 0, 'no creature was ever stranded, rescue path untested');
});

test('save round-trip after every event (mid-Stop resume) changes nothing', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const a = scriptedRun(seed);
    const b = scriptedRun(seed, { roundTrip: true });
    assert.equal(JSON.stringify(a.p), JSON.stringify(b.p));
    assert.deepEqual(a.log, b.log);
  }
});

test('legs chain through camps; forks need a valid branch; party comes from the selected camp', () => {
  const d = driver(11);
  d.send({ type: 'ROSTER_OK' });
  d.send({ type: 'SELECT_CAMP', camp: 1 });
  d.send({ type: 'PARTY_FILL' });
  assert.equal(d.p.selection.length, 0, 'nobody is at camp 1 yet');
  d.send({ type: 'START_LEG' });
  assert.equal(d.p.run, null);
  d.send({ type: 'SELECT_CAMP', camp: 0 });
  d.send({ type: 'PARTY_FILL' });
  assert.equal(d.p.selection.length, 16);
  d.send({ type: 'PARTY_TOGGLE', id: d.p.roster.find((x) => !d.p.selection.includes(x.id)).id });
  assert.equal(d.p.selection.length, 16, 'party is capped at 16');
  d.send({ type: 'START_LEG', branch: 'nope' });
  assert.equal(d.p.run, null);
  d.send({ type: 'START_LEG' });
  d.playLeg();
  assert.equal(d.p.summary.to, 1);
  const arrived = d.p.summary.arrived;
  d.send({ type: 'SUMMARY_OK' });
  assert.equal(d.p.screen, 'camp');
  assert.equal(d.p.camp, 1);
  assert.equal(game.readyAt(d.p, 1).length, arrived);
  assert.equal(game.countStatus(d.p, 'delivered'), 0, 'camp 1 is not home');
  // Leg 2 is a fork.
  d.send({ type: 'PARTY_FILL' });
  d.send({ type: 'START_LEG', branch: 'b' });
  assert.equal(d.p.stop.puzzleId, content.trail.legs[1].branches[1].stops[0]);
  d.playLeg();
  assert.equal(d.p.summary.home, false);
  d.send({ type: 'SUMMARY_OK' });
  assert.equal(d.p.camp, 2);
  d.send({ type: 'PARTY_FILL' });
  d.send({ type: 'START_LEG' });
  d.playLeg();
  assert.equal(d.p.summary.home, true);
  d.send({ type: 'SUMMARY_OK' });
  assert.ok(game.countStatus(d.p, 'delivered') > 0);
  assert.equal(d.p.camp, HOME);
  d.send({ type: 'GOTO', screen: 'party' });
  assert.notEqual(d.p.screen, 'party', 'no leg leaves home');
  assert.ok(d.p.stats.legsCleared >= 3 && d.p.goals.first_home);
  // Nine Stops were played: three per leg.
  assert.ok(d.p.stats.stopsSolved <= 9);
});

test('failing a Stop three times strands a creature; a friend, a token or a free call brings it back', () => {
  const d = driver(21);
  d.send({ type: 'ROSTER_OK' });
  d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'expert' });
  const victim = d.p.roster[0].id;
  const helper = d.p.roster[20].id;
  const get = (id) => d.p.roster.find((x) => x.id === id);
  for (let i = 1; i <= 3; i++) {
    d.send({ type: 'PARTY_FILL' });
    assert.ok(d.p.selection.includes(victim) && !d.p.selection.includes(helper));
    d.send({ type: 'START_LEG' });
    d.failStop();
    const events = d.send({ type: 'STOP_CONTINUE' });
    assert.equal(d.p.summary.arrived, 0);
    assert.equal(d.p.summary.stranded, i === 3 ? 16 : 0);
    assert.equal(events.some((e) => e.type === 'stranded'), i === 3);
    d.send({ type: 'SUMMARY_OK' });
    assert.equal(d.p.camp, 0, 'a failed leg leaves you at the camp you started from');
    assert.equal(get(victim).status, i === 3 ? 'lost' : 'available');
  }
  assert.equal(get(victim).lostAt, 1);
  assert.equal(get(victim).history.timesReturned, 3);

  // Rescue must happen at the camp it is stranded near.
  d.send({ type: 'RESCUE', id: victim, token: true });
  assert.equal(get(victim).status, 'lost');
  d.send({ type: 'SELECT_CAMP', camp: 1 });
  assert.equal(game.canFreeRescue(d.p, content, get(victim)), false, 'others can still come and help');
  d.send({ type: 'RESCUE', id: victim });
  assert.equal(get(victim).status, 'lost');
  d.send({ type: 'RESCUE', id: victim, friendId: helper });
  assert.equal(get(victim).status, 'lost', 'a friend who is not at this camp cannot help');

  // Token rescue.
  const tokens = d.p.hintTokens;
  assert.ok(tokens >= 1);
  const ev = d.send({ type: 'RESCUE', id: victim, token: true });
  assert.equal(ev[0].type, 'rescued');
  assert.equal(get(victim).status, 'available');
  assert.equal(get(victim).at, 1);
  assert.equal(d.p.hintTokens, tokens - 1);
  assert.equal(d.p.stats.rescued, 1);
  assert.ok(d.p.goals.rescuer);
});

test('rescue by a friend needs enough shared traits and reports how close a miss was', () => {
  const d = driver(22);
  d.send({ type: 'ROSTER_OK' });
  // Hand-place creatures: one stranded near camp 1, two possible friends there.
  const [lost, a, b] = d.p.roster;
  const far = { crest: 'tuft', eyes: 'round', mark: 'dot', feet: 'paws', tint: 0 };
  const near = { crest: 'tuft', eyes: 'round', mark: 'ring', feet: 'webs', tint: 3 };
  d.p = {
    ...d.p,
    camp: 1,
    hintTokens: 0,
    roster: d.p.roster.map((x) =>
      x.id === lost.id
        ? { ...x, status: 'lost', lostAt: 1, traits: { crest: 'tuft', eyes: 'round', mark: 'none', feet: 'roller', tint: 1 } }
        : x.id === a.id
          ? { ...x, at: 1, traits: { ...far, crest: 'horn', eyes: 'slit' } }
          : x.id === b.id
            ? { ...x, at: 1, traits: near }
            : x
    ),
  };
  let ev = d.send({ type: 'RESCUE', id: lost.id, friendId: a.id });
  assert.deepEqual(ev, [{ type: 'rescueMiss', id: lost.id, shared: 0 }]);
  ev = d.send({ type: 'RESCUE', id: lost.id, token: true });
  assert.deepEqual(ev, [], 'no tokens to spend');
  ev = d.send({ type: 'RESCUE', id: lost.id, friendId: b.id });
  assert.equal(ev[0].type, 'rescued');
  assert.equal(d.p.roster[0].status, 'available');
});

test('nobody is ever stuck: with no helper left anywhere, a stranded creature can be called in', () => {
  const d = driver(23);
  d.send({ type: 'ROSTER_OK' });
  const lostId = d.p.roster[0].id;
  d.p = {
    ...d.p,
    camp: HOME,
    hintTokens: 0,
    stats: { ...d.p.stats, delivered: 35 },
    roster: d.p.roster.map((x, i) =>
      i === 0 ? { ...x, status: 'lost', at: 3, lostAt: HOME } : { ...x, status: 'delivered', at: HOME, traits: { crest: 'bare', eyes: 'slit', mark: 'none', feet: 'paws', tint: 0 } }
    ),
  };
  d.p.roster[0].traits = { crest: 'fin', eyes: 'wide', mark: 'ring', feet: 'webs', tint: 2 };
  assert.equal(game.canFreeRescue(d.p, content, d.p.roster[0]), true);
  const ev = d.send({ type: 'RESCUE', id: lostId });
  assert.equal(ev[0].type, 'rescued');
  assert.equal(d.p.roster[0].status, 'delivered');
  assert.equal(d.p.screen, 'finale');
  assert.ok(d.p.goals.all_home);
});

test('adaptive assist: free hint after two failed Stops, tier-up offer after three flawless, off when disabled', () => {
  const twoFails = (assist) => {
    const d = driver(31);
    d.send({ type: 'ROSTER_OK' });
    d.send({ type: 'OPTION', assist });
    d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'expert' });
    const before = d.p.hintTokens;
    const events = [];
    for (let i = 0; i < 2; i++) {
      d.send({ type: 'PARTY_FILL' });
      d.send({ type: 'START_LEG' });
      d.failStop();
      events.push(...d.send({ type: 'STOP_CONTINUE' }));
      d.send({ type: 'SUMMARY_OK' });
      d.send({ type: 'GOTO', screen: 'map' });
    }
    return { gained: d.p.hintTokens - before, events };
  };
  const on = twoFails(true);
  assert.equal(on.gained, 1);
  assert.deepEqual(on.events.filter((e) => e.type === 'assist'), [{ type: 'assist', kind: 'freeHint' }]);
  const off = twoFails(false);
  assert.equal(off.gained, 0);
  assert.equal(off.events.filter((e) => e.type === 'assist').length, 0);

  // Three flawless Stops in a row suggest the next tier.
  const d = driver(32);
  d.send({ type: 'ROSTER_OK' });
  d.send({ type: 'PARTY_FILL' });
  d.send({ type: 'START_LEG' });
  d.playLeg(() => bots.perfect);
  assert.equal(d.p.summary.flawlessStops, 3);
  assert.ok(d.log.includes('assist'));
  assert.equal(d.p.assist.suggest, 'leg1');
  assert.equal(d.p.legs.leg1.tier, 'gentle', 'assist only offers; it never changes the tier itself');
  d.send({ type: 'SUMMARY_OK' });
  d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'steady' });
  assert.equal(d.p.assist.suggest, null);
  // On the top tier there is nothing higher to offer.
  const e = driver(33);
  e.send({ type: 'ROSTER_OK' });
  e.send({ type: 'SET_TIER', legId: 'leg1', tier: 'expert' });
  e.send({ type: 'PARTY_FILL' });
  e.send({ type: 'START_LEG' });
  e.playLeg(() => bots.perfect);
  assert.equal(e.p.assist.suggest, null);
});

test('a leg rises one tier after three full parties, and the player can lower it again', () => {
  const d = driver(41);
  d.send({ type: 'ROSTER_OK' });
  d.p = { ...d.p, legs: { ...d.p.legs, leg1: { ...d.p.legs.leg1, fullParties: 2 } } };
  let full = false;
  for (let tries = 0; tries < 2 && !full; tries++) {
    d.send({ type: 'SELECT_CAMP', camp: 0 });
    d.send({ type: 'PARTY_FILL' });
    d.send({ type: 'START_LEG' });
    d.playLeg();
    full = d.p.summary.fullParty;
    if (full) {
      assert.equal(d.p.summary.tierUp, 'steady');
      assert.equal(d.p.legs.leg1.tier, 'steady');
      assert.ok(d.p.goals.full_party);
    }
    d.send({ type: 'SUMMARY_OK' });
  }
  assert.ok(full, 'no full party arrived');
  d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'gentle' });
  assert.equal(d.p.legs.leg1.tier, 'gentle');
  d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'nope' });
  assert.equal(d.p.legs.leg1.tier, 'gentle');
});

test('hint tokens: earned for flawless Stops and cleared legs, capped, spent by hints', () => {
  const d = driver(51);
  d.send({ type: 'ROSTER_OK' });
  d.send({ type: 'PARTY_FILL' });
  d.send({ type: 'START_LEG' });
  d.p = { ...d.p, hintTokens: 0 };
  assert.deepEqual(d.send({ type: 'HINT' }), [{ type: 'hint', slot: null, noTokens: true }]);
  d.p = { ...d.p, hintTokens: 1 };
  const ev = d.send({ type: 'HINT' });
  assert.equal(ev[0].type, 'hint');
  assert.equal(d.p.hintTokens, 0);
  assert.equal(d.p.run.hintsUsed, 1);
  d.playLeg();
  assert.equal(d.p.hintTokens, d.p.summary.tokensEarned);
  assert.ok(d.p.summary.tokensEarned >= 1 && d.p.hintTokens <= content.trail.hintTokenCap);
  assert.equal(d.p.stats.legsWithoutHints, 0);
});

test('daily Stop: same date same puzzle, different dates differ, and it can be finished', () => {
  const a = game.newDaily(content, 20261110);
  const b = game.newDaily(content, 20261110);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a.stop), JSON.stringify(game.newDaily(content, 20261111).stop));
  assert.equal(a.roster.length, content.trail.daily.partySize);
  const ids = new Set();
  for (let date = 20261101; date < 20261131; date++) {
    let p = game.newDaily(content, date);
    ids.add(p.stop.puzzleId);
    assert.equal(p.stop.tier, content.trail.daily.tier);
    const rng = makeRng(date);
    while (p.stop.status === 'playing') {
      p = game.reduce(p, { type: 'ATTEMPT', action: bots.optimal(p.stop, game.stopCtx(p, content), rng) }, content).profile;
      p = game.migrate(JSON.parse(JSON.stringify(p)), content);
    }
    p = game.reduce(p, { type: 'STOP_CONTINUE' }, content).profile;
    assert.equal(p.screen, 'dailyDone');
    assert.ok(['solved', 'failed'].includes(p.result.status));
    // Trail-only events do nothing to a daily.
    assert.equal(game.reduce(p, { type: 'GOTO', screen: 'map' }, content).profile, p);
  }
  assert.equal(ids.size, content.trail.daily.puzzles.length, 'the daily rotates through its puzzles');
});

test('golden saves: version 1 saves migrate, keep nicknames, and play on', () => {
  for (const name of ['save-v1-camp', 'save-v1-midstop']) {
    const old = golden(name);
    assert.equal(old.schemaVersion, 1);
    let p = game.migrate(old, content);
    checkInvariants(p);
    assert.equal(p.schemaVersion, game.SCHEMA_VERSION);
    assert.equal(p.screen, 'map');
    assert.equal(p.run, null);
    assert.equal(p.stop, null);
    assert.equal(p.hintTokens, old.hintTokens);
    assert.deepEqual(Object.keys(p.legs), content.trail.legs.map((l) => l.id));
    assert.equal(p.legs.leg1.cleared, old.legs.leg1.cleared);
    // Creatures that had reached the old end of the trail now wait at camp 1.
    const reached = old.roster.filter((x) => x.status === 'delivered').map((x) => x.id);
    assert.equal(reached.length, 16);
    assert.deepEqual(game.readyAt(p, 1).map((x) => x.id), reached);
    assert.equal(p.roster.filter((x) => x.status === 'parked').length, 1);
    const pip = p.roster.find((x) => x.nickname === 'Pip');
    assert.ok(pip && pip.favourite);
    // And the migrated Trail is playable.
    const send = (ev) => (p = game.reduce(p, ev, content).profile);
    send({ type: 'SELECT_CAMP', camp: 1 });
    send({ type: 'PARTY_FILL' });
    send({ type: 'START_LEG', branch: 'a' });
    assert.equal(p.screen, 'stop');
    checkInvariants(p);
  }
});

test('golden saves: a version 2 save (four legs) folds into the three-leg Trail and plays on', () => {
  const old = golden('save-v2-midstop');
  assert.equal(old.schemaVersion, 2);
  const count = (doc, fn) => doc.roster.filter(fn).length;
  let p = game.migrate(old, content);
  checkInvariants(p);
  assert.equal(p.schemaVersion, game.SCHEMA_VERSION);
  assert.deepEqual(Object.keys(p.legs), ['leg1', 'leg2', 'leg3']);
  assert.deepEqual(p.legs.leg3, old.legs.leg4, 'the old last leg keeps its tier and history');
  assert.equal(p.run, null);
  assert.equal(p.stop, null);
  // Nobody is lost or moved backwards: home stays home, the old third camp
  // and the party that was mid-leg from it now wait at camp 2.
  assert.equal(game.countStatus(p, 'delivered'), count(old, (x) => x.status === 'delivered'));
  assert.equal(count(p, (x) => x.at === 2 && x.status === 'available'), count(old, (x) => (x.at === 2 || x.at === 3) && ['available', 'party'].includes(x.status)));
  assert.equal(count(p, (x) => x.at === 0), count(old, (x) => x.at === 0));
  assert.equal(game.countStatus(p, 'parked'), 1);
  assert.equal(p.roster.length, old.roster.length);
  const lost = p.roster.find((x) => x.status === 'lost');
  assert.ok(lost && lost.lostAt === 2 && lost.at === 1, 'a stranded creature stays recoverable at a real camp');
  assert.ok(p.roster.some((x) => x.nickname === 'Moss'));
  assert.equal(p.hintTokens, old.hintTokens);
  assert.deepEqual(p.goals, old.goals);
  assert.equal(p.stats.branchesSeen, Object.keys(p.seen).length);
  // The migrated Trail can be finished.
  const d = driver(1);
  d.p = p;
  for (let legs = 0; legs < 200 && game.countStatus(d.p, 'delivered') < d.p.roster.length; legs++) {
    for (let camp = 1; camp <= HOME; camp++) if (game.strandedAt(d.p, camp).length) rescueAt(d, camp);
    if (d.p.screen === 'finale') break;
    for (const x of d.p.roster.filter((y) => y.status === 'parked')) d.send({ type: 'RETRIEVE', id: x.id });
    const camp = content.trail.legs.map((l) => l.from).find((n) => game.readyAt(d.p, n).length > 0);
    if (camp === undefined) continue;
    d.send({ type: 'SELECT_CAMP', camp });
    d.send({ type: 'PARTY_FILL' });
    d.send({ type: 'START_LEG' });
    d.playLeg();
    d.send({ type: 'SUMMARY_OK' });
  }
  assert.equal(game.countStatus(d.p, 'delivered'), d.p.roster.length);
});

test('saves: current version is untouched; future versions and junk are refused', () => {
  const p = game.newProfile(content, 3, 1);
  assert.deepEqual(game.migrate(JSON.parse(JSON.stringify(p)), content), p);
  assert.throws(() => game.migrate({ ...p, schemaVersion: game.SCHEMA_VERSION + 1 }, content), game.FutureSaveError);
  assert.throws(() => game.migrate({ ...p, schemaVersion: 0 }, content), /No migration/);
  assert.throws(() => game.migrate({}, content));
  assert.throws(() => game.migrate(null, content));
});

test('nicknames, favourites, parking, and ignored events', () => {
  const d = driver(3);
  const id = d.p.roster[0].id;
  d.send({ type: 'NICKNAME', id, name: '  Pip the Extremely Long Named  ' });
  assert.equal(d.p.roster[0].nickname, 'Pip the Extremel');
  d.send({ type: 'NICKNAME', id, name: '' });
  assert.equal(d.p.roster[0].nickname, null);
  d.send({ type: 'FAVOURITE', id });
  assert.equal(d.p.roster[0].favourite, true);
  let before = d.p;
  for (const ev of [{ type: 'GOTO', screen: 'map' }, { type: 'ATTEMPT', id, target: 'gateA' }, { type: 'STOP_CONTINUE' }, { type: 'START_LEG' }, { type: 'SUMMARY_OK' }, { type: 'WHATEVER' }, { type: 'SELECT_CAMP', camp: 9 }, { type: 'RESCUE', id }]) d.send(ev);
  assert.equal(d.p, before, 'nothing happens before the roster is accepted');
  d.send({ type: 'ROSTER_OK' });
  d.send({ type: 'PARTY_TOGGLE', id });
  d.send({ type: 'PARK', id });
  assert.equal(d.p.roster[0].status, 'parked');
  assert.deepEqual(d.p.selection, [], 'a resting creature leaves the party pick');
  d.send({ type: 'PARTY_FILL' });
  assert.ok(!d.p.selection.includes(id));
  d.send({ type: 'PARTY_CLEAR' });
  d.send({ type: 'RETRIEVE', id });
  assert.equal(d.p.roster[0].status, 'available');
  d.send({ type: 'GOTO', screen: 'goals' });
  assert.equal(d.p.screen, 'goals');
  d.send({ type: 'DISMISS_SUGGEST' });
  assert.equal(d.p.assist.suggest, null);
});
