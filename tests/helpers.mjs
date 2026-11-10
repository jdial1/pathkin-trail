import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareContent } from '../app/src/main/assets/www/js/core/content.js';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { buildRoster } from '../app/src/main/assets/www/js/core/traits.js';
import * as runtime from '../app/src/main/assets/www/js/core/runtime.js';

const dir = fileURLToPath(new URL('../app/src/main/assets/www/content/', import.meta.url));
const load = (name) => JSON.parse(readFileSync(dir + name, 'utf8'));

export const rawContent = {
  traits: load('traits.json'),
  puzzles: load('puzzles.json'),
  trail: load('trail.json'),
  theme: load('theme.json'),
  goals: load('achievements.json'),
  text: load('text.en.json'),
};
export const content = prepareContent(rawContent);

// Bots return [creatureId, target] for the current stop state.
export const bots = {
  random(state, ctx, rng) {
    const { targets } = runtime.votes(state, ctx, state.queue[0]);
    return [rng.pick(state.queue), rng.pick(targets)];
  },
  // Takes the first creature in line, sends it where most candidates agree.
  greedy(state, ctx) {
    return [state.queue[0], vote(state, ctx, state.queue[0]).target];
  },
  // Sends the creature whose placement is most certain; every answer,
  // right or wrong, still narrows the rule.
  optimal(state, ctx) {
    let best = null;
    for (const id of state.queue) {
      const v = vote(state, ctx, id);
      if (!best || v.share > best.share) best = { id, ...v };
    }
    return [best.id, best.target];
  },
};

function vote(state, ctx, id) {
  const { targets, tally, total } = runtime.votes(state, ctx, id);
  let top = 0;
  for (let i = 1; i < tally.length; i++) if (tally[i] > tally[top]) top = i;
  return { target: targets[top], share: tally[top] / total };
}

export function makeCtx(def, roster) {
  const creatures = {};
  for (const x of roster) creatures[x.id] = x.traits;
  return { def, traits: content.traits, creatures };
}

// One Stop played by a bot with a seeded party of 2 to 16 creatures.
export function play(def, tier, seed, bot, onAttempt) {
  const rng = makeRng(seed);
  const roster = buildRoster(content.traits, seed);
  const size = 2 + rng.int(15);
  const party = rng.shuffle(roster).slice(0, size).map((x) => x.id);
  const ctx = makeCtx(def, roster);
  let { state } = runtime.generate(ctx, tier, rng.state, party);
  let attempts = 0;
  while (state.status === 'playing') {
    const [id, target] = bot(state, ctx, rng);
    const before = state;
    state = runtime.attempt(state, ctx, id, target).state;
    attempts++;
    if (onAttempt) onAttempt(before, state, ctx);
    if (attempts > 300) throw new Error('stop never ended');
  }
  return { state, ctx, party, attempts };
}
