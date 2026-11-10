// Trail options and extras: Hard Trail, roster size, trinkets, practice
// Stops, and the version 3 save migration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { family } from '../app/src/main/assets/www/js/core/families.js';
import * as game from '../app/src/main/assets/www/js/core/game.js';
import { content, bots } from './helpers.mjs';

const HOME = game.HOME(content);

function driver(seed, options) {
  const d = { p: game.newProfile(content, seed, 1, options), rng: makeRng(seed), log: [] };
  d.send = (ev) => {
    const r = game.reduce(d.p, ev, content);
    d.p = r.profile;
    d.log.push(...r.events.map((e) => e.type));
    return r.events;
  };
  d.playLeg = (bot = bots.optimal) => {
    while (d.p.screen === 'stop') {
      if (d.p.stop.status === 'playing') d.send({ type: 'ATTEMPT', action: bot(d.p.stop, game.stopCtx(d.p, content), d.rng) });
      else d.send({ type: 'STOP_CONTINUE' });
    }
  };
  d.failStop = () => {
    const fam = family(d.p.stop.family);
    while (d.p.stop.status === 'playing') {
      const ctx = game.stopCtx(d.p, content);
      const id = d.p.stop.queue[0];
      const right = fam.place(d.p.stop.hyp, ctx.creatures[id]);
      d.send({ type: 'ATTEMPT', action: { id, target: fam.targets(ctx.def).find((x) => x.id !== right).id } });
    }
  };
  return d;
}

test('a Trail can be started with 100 creatures, all different', () => {
  const d = driver(5, { rosterSize: 100 });
  assert.equal(d.p.roster.length, 100);
  assert.equal(new Set(d.p.roster.map((c) => JSON.stringify(c.traits))).size, 100);
  assert.equal(d.p.options.rosterSize, 100);
  d.send({ type: 'REROLL' });
  assert.equal(d.p.roster.length, 100, 'rolling again keeps the chosen size');
  d.send({ type: 'ROSTER_OK' });
  // "Half home" and "all home" goals follow the share of the roster, not a fixed count.
  for (let camp = 0; camp < HOME; camp++) {
    d.send({ type: 'SELECT_CAMP', camp });
    d.send({ type: 'PARTY_FILL' });
    d.send({ type: 'START_LEG' });
    d.playLeg(bots.perfect);
    d.send({ type: 'SUMMARY_OK' });
  }
  assert.equal(d.p.stats.delivered, 16);
  assert.equal(d.p.stats.homePercent, 16);
  assert.ok(d.p.goals.first_home && !d.p.goals.half_home && !d.p.goals.all_home);
});

test('Hard Trail is opt-in: a stranded creature is gone, cannot be rescued, and the Trail still ends', () => {
  assert.equal(game.newProfile(content, 1, 1).options.hardTrail, false, 'off unless asked for');
  const d = driver(21, { hardTrail: true });
  d.send({ type: 'ROSTER_OK' });
  d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'expert' });
  for (let i = 0; i < 3; i++) {
    d.send({ type: 'PARTY_FILL' });
    d.send({ type: 'START_LEG' });
    d.failStop();
    d.send({ type: 'STOP_CONTINUE' });
    d.send({ type: 'SUMMARY_OK' });
  }
  const gone = d.p.roster.filter((c) => c.gone);
  assert.equal(gone.length, 16);
  assert.ok(gone.every((c) => c.status === 'lost' && !('lostAt' in c)));
  assert.equal(game.goneCount(d.p), 16);
  for (let camp = 0; camp <= HOME; camp++) {
    assert.equal(game.strandedAt(d.p, camp).length, 0, 'nobody waits to be rescued');
    d.send({ type: 'SELECT_CAMP', camp });
    d.send({ type: 'RESCUE', id: gone[0].id, token: true });
    d.send({ type: 'RESCUE', id: gone[0].id });
  }
  assert.equal(d.p.roster.find((c) => c.id === gone[0].id).status, 'lost');
  // The other twenty can all be brought home, and that ends the Trail.
  d.send({ type: 'SET_TIER', legId: 'leg1', tier: 'gentle' });
  for (let legs = 0; legs < 40 && !game.allHome(d.p); legs++) {
    const camp = content.trail.legs.map((l) => l.from).find((n) => game.readyAt(d.p, n).length > 0);
    d.send({ type: 'SELECT_CAMP', camp });
    d.send({ type: 'PARTY_FILL' });
    d.send({ type: 'START_LEG' });
    d.playLeg(bots.perfect);
    d.send({ type: 'SUMMARY_OK' });
  }
  assert.equal(game.countStatus(d.p, 'delivered'), 20);
  assert.equal(d.p.screen, 'finale');
  assert.ok(!d.p.goals.all_home, 'not everyone came home');
});

test('trinkets unlock from play, are announced once, and only unlocked ones can be worn', () => {
  const d = driver(8);
  d.send({ type: 'ROSTER_OK' });
  const id = d.p.roster[0].id;
  assert.deepEqual(game.unlockedTrinkets(d.p, content), []);
  d.send({ type: 'TRINKET', id, trinket: 'scarf' });
  assert.ok(!d.p.roster[0].trinket, 'a locked trinket cannot be worn');
  // Three flawless Stops unlock the flower.
  d.send({ type: 'PARTY_FILL' });
  d.send({ type: 'START_LEG' });
  d.playLeg(bots.perfect);
  assert.ok(game.unlockedTrinkets(d.p, content).includes('flower'));
  assert.equal(d.log.filter((e) => e === 'trinket').length, d.p.trinketsSeen.length);
  const before = d.log.length;
  d.send({ type: 'SUMMARY_OK' });
  assert.ok(!d.log.slice(before).includes('trinket'), 'announced only once');
  d.send({ type: 'TRINKET', id, trinket: 'flower' });
  assert.equal(d.p.roster[0].trinket, 'flower');
  d.send({ type: 'TRINKET', id, trinket: null });
  assert.equal(d.p.roster[0].trinket, null);
  d.send({ type: 'TRINKET', id, trinket: 'nope' });
  assert.equal(d.p.roster[0].trinket, null);
  for (const t of content.trinkets.trinkets) assert.ok(t.stat in d.p.stats, 'trinket ' + t.id + ' uses a real counter');
});

test('practice Stops: any puzzle at any tier, playable to the end, never touching a Trail', () => {
  for (const def of content.puzzles.puzzles)
    for (const tier of content.puzzles.tierOrder) {
      let p = game.newDaily(content, 20261110, { puzzleId: def.id, tier });
      assert.equal(p.kind, 'practice');
      assert.equal(p.stop.puzzleId, def.id);
      assert.equal(p.stop.tier, tier);
      const rng = makeRng(3);
      for (let i = 0; i < 200 && p.stop.status === 'playing'; i++) p = game.reduce(p, { type: 'ATTEMPT', action: bots.perfect(p.stop, game.stopCtx(p, content), rng) }, content).profile;
      assert.equal(p.stop.status, 'solved', def.id + '/' + tier);
      p = game.reduce(p, { type: 'STOP_CONTINUE' }, content).profile;
      assert.equal(p.screen, 'dailyDone');
      assert.equal(game.reduce(p, { type: 'GOTO', screen: 'map' }, content).profile, p);
    }
  assert.equal(game.newDaily(content, 20261110).kind, 'daily');
});

test('golden saves: a version 3 save gains options, trinket state and the home share, and plays on', () => {
  const old = JSON.parse(readFileSync(new URL('./golden/save-v3-midstop.json', import.meta.url), 'utf8'));
  assert.equal(old.schemaVersion, 3);
  let p = game.migrate(old, content);
  assert.equal(p.schemaVersion, game.SCHEMA_VERSION);
  assert.deepEqual(p.options, { assist: old.options.assist, hardTrail: false });
  assert.deepEqual(p.trinketsSeen, []);
  assert.equal(p.stats.homePercent, Math.round((100 * old.stats.delivered) / old.roster.length));
  // Nothing else moves: the Stop in progress is still there, move for move.
  assert.deepEqual(p.stop, old.stop);
  assert.deepEqual(p.roster, old.roster);
  assert.ok(p.roster.some((c) => c.nickname === 'Fern'));
  const rng = makeRng(2);
  for (let i = 0; i < 200 && p.screen === 'stop'; i++) {
    const ev = p.stop.status === 'playing' ? { type: 'ATTEMPT', action: bots.optimal(p.stop, game.stopCtx(p, content), rng) } : { type: 'STOP_CONTINUE' };
    p = game.reduce(p, ev, content).profile;
  }
  assert.equal(p.screen, 'summary');
  // Trinkets earned before the update are announced on the first move after it.
  assert.ok(p.trinketsSeen.length >= 1);
});
