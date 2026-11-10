import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareContent } from '../app/src/main/assets/www/js/core/content.js';
import { makeRng } from '../app/src/main/assets/www/js/core/rng.js';
import { buildRoster } from '../app/src/main/assets/www/js/core/traits.js';
import * as runtime from '../app/src/main/assets/www/js/core/runtime.js';
export { bots } from '../app/src/main/assets/www/js/core/bots.js';

const dir = fileURLToPath(new URL('../app/src/main/assets/www/content/', import.meta.url));
const load = (name) => JSON.parse(readFileSync(dir + name, 'utf8'));

export const rawContent = {
  traits: load('traits.json'),
  puzzles: load('puzzles.json'),
  trail: load('trail.json'),
  theme: load('theme.json'),
  goals: load('achievements.json'),
  trinkets: load('trinkets.json'),
  text: load('text.en.json'),
};
export const content = prepareContent(rawContent);

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
  const start = state;
  let attempts = 0;
  while (state.status === 'playing') {
    const action = bot(state, ctx, rng);
    const before = state;
    state = runtime.attempt(state, ctx, action).state;
    if (state === before) throw new Error(`${def.id}/${tier} seed ${seed}: bot made an illegal move ${JSON.stringify(action)}`);
    attempts++;
    if (onAttempt) onAttempt(before, state, ctx);
    if (attempts > 400) throw new Error(`${def.id}/${tier} seed ${seed}: stop never ended`);
  }
  return { state, start, ctx, party, attempts };
}
