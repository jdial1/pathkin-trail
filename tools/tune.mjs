// Difficulty tuning aid: bot results for every tier set and tier.
// Usage: node tools/tune.mjs [runs] [tierSet] [key=v1,v2,...]
//   e.g. node tools/tune.mjs 400 echo_match examples=0,1,2,4
// With a key, shows how changing that tier setting moves the results.
import { content, bots, play } from '../tests/helpers.mjs';

const runs = Number(process.argv[2] || 300);
const only = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3] : null;
const sweep = process.argv[4] ? process.argv[4].split('=') : null;
const values = sweep ? sweep[1].split(',').map(Number) : [null];
const seen = new Set();
for (const def of content.puzzles.puzzles) {
  const set = def.tierSet || def.family;
  if (seen.has(set) || (only && set !== only)) continue;
  seen.add(set);
  for (const tier of content.puzzles.tierOrder) {
    const line = [];
    for (const v of values) {
      const d = v === null ? def : { ...def, id: `${def.id}#${sweep[0]}${v}`, tiers: { ...def.tiers, [tier]: { ...def.tiers[tier], [sweep[0]]: v } } };
      let solved = 0, failR = 0, wrong = 0, t0 = Date.now();
      const sends = [];
      for (let seed = 1; seed <= runs; seed++) {
        const o = play(d, tier, seed, bots.optimal);
        wrong += o.state.wrong;
        if (o.state.status === 'solved') { solved++; sends.push(o.attempts); }
        if (seed <= runs / 3 && play(d, tier, seed, bots.random).state.status === 'failed') failR++;
      }
      sends.sort((a, b) => a - b);
      line.push(`${v === null ? '' : v + ': '}solve ${((solved / runs) * 100).toFixed(1)}%  median ${sends[sends.length >> 1] ?? '-'}  wrong/run ${(wrong / runs).toFixed(2)}  random fails ${Math.round((failR / Math.floor(runs / 3)) * 100)}%  (${Date.now() - t0}ms)`);
    }
    console.log(`${set}/${tier}: ${line.join(' | ')}`);
  }
}
