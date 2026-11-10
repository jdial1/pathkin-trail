import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { family } from '../app/src/main/assets/www/js/core/families.js';
import * as runtime from '../app/src/main/assets/www/js/core/runtime.js';

const dir = fileURLToPath(new URL('../app/src/main/assets/www/content/', import.meta.url));
const load = (name) => JSON.parse(readFileSync(dir + name, 'utf8'));

export const content = {
  traits: load('traits.json'),
  puzzles: load('puzzles.json'),
  trail: load('trail.json'),
  theme: load('theme.json'),
  text: load('text.en.json'),
};

// Bots return [creatureId, target] for the current stop state.
export const bots = {
  random(state, ctx, rng) {
    const targets = family(state.family).targets(ctx.def);
    return [rng.pick(state.queue), rng.pick(targets).id];
  },
  // Takes the first creature in line, sends it where most candidates agree.
  greedy(state, ctx) {
    return [state.queue[0], vote(state, ctx, state.queue[0]).target];
  },
  // Sends the creature whose placement is most certain; ties cost nothing and
  // every answer still narrows the rule.
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
  const fam = family(state.family);
  const cands = runtime.candidates(state, ctx);
  const tally = {};
  for (const h of cands) {
    const t = fam.place(h, ctx.creatures[id]);
    tally[t] = (tally[t] || 0) + 1;
  }
  const [target, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return { target, share: n / cands.length };
}
