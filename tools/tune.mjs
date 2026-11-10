// Difficulty tuning aid: for each tier set and tier, shows how the number of
// trail guides (examples) changes bot results. Usage: node tools/tune.mjs [runs]
import { content, bots, play } from '../tests/helpers.mjs';

const runs = Number(process.argv[2] || 400);
const seen = new Set();
for (const def of content.puzzles.puzzles) {
  const set = def.tierSet || def.family;
  if (seen.has(set)) continue;
  seen.add(set);
  for (const tier of content.puzzles.tierOrder) {
    const base = def.tiers[tier];
    const line = [];
    for (const examples of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12]) {
      const d = { ...def, id: `${def.id}#${examples}`, tiers: { ...def.tiers, [tier]: { ...base, examples } } };
      let solved = 0, failR = 0, sends = [];
      for (let seed = 1; seed <= runs; seed++) {
        const o = play(d, tier, seed, bots.optimal);
        if (o.state.status === 'solved') { solved++; sends.push(o.attempts); }
        if (seed <= runs / 4 && play(d, tier, seed, bots.random).state.status === 'failed') failR++;
      }
      sends.sort((a, b) => a - b);
      line.push(`${examples}:${Math.round((solved / runs) * 100)}%/m${sends[sends.length >> 1] ?? '-'}/r${Math.round((failR / (runs / 4)) * 100)}`);
    }
    console.log(`${set}/${tier} (cfg ${base.examples}, ${base.slots.length} slots): ${line.join('  ')}`);
  }
}
