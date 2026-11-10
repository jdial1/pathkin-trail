// Puzzle families. Each family turns a declarative puzzle definition into:
//   targets(def)                 the places a creature can be sent
//   hypotheses(def, tier, traits) every hidden rule the tier allows
//   place(hyp, traits)           the one correct target for a creature
//   feedback(hyp, traits, target) what the player is told for an attempt
//   slots(hyp)                   slots the hidden rule looks at (for hints)
//   describe(hyp, t)             plain-words lines shown once the Stop ends
// New puzzles in an existing family are data only (content/puzzles.json).

import { has, anyOf, and, or, evaluate, ruleSlots, describeRule } from './rules.js';

const slotValues = (traits, id) => traits.slots.find((s) => s.id === id).values;

function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  return out;
}

// All ways to pick half of a slot's values (the other half is the complement).
function halves(traits, slot) {
  return pairs(slotValues(traits, slot)).map((values) => anyOf(slot, values));
}

function singleRules(traits, slots, maxTerms) {
  const atoms = slots.flatMap((slot) => slotValues(traits, slot).map((v) => has(slot, v)));
  const out = atoms.slice();
  if (maxTerms >= 2) {
    for (const [a, b] of pairs(atoms)) {
      if (a.slot === b.slot) continue;
      out.push(and(a, b), or(a, b));
    }
  }
  return out;
}

const twoWay = (ids) => ({
  targets: () => ids.map((id) => ({ id, label: 'target.' + id })),
  place: (hyp, traits) => (evaluate(hyp.rule, traits) ? ids[0] : ids[1]),
  feedback(hyp, traits, target) {
    return { ok: this.place(hyp, traits) === target };
  },
  slots: (hyp) => ruleSlots(hyp.rule),
  describe: (hyp, t) => [
    t('rule.goes', { target: t('target.' + ids[0]), rule: describeRule(hyp.rule, t) }),
    t('rule.rest', { target: t('target.' + ids[1]) }),
  ],
});

export const FAMILIES = {
  // Two gates; gate one admits the hidden rule, gate two admits everyone else.
  gate_sort: {
    ...twoWay(['gateA', 'gateB']),
    hypotheses: (def, tier, traits) => singleRules(traits, tier.slots, tier.maxTerms).map((rule) => ({ rule })),
  },

  // Two bridges; one hidden slot is split in half, each bridge holds one half.
  bridge_pair: {
    ...twoWay(['bridge1', 'bridge2']),
    hypotheses: (def, tier, traits) => tier.slots.flatMap((slot) => halves(traits, slot)).map((rule) => ({ rule })),
  },

  // A 2x2 field. One slot splits the rows, a different slot splits the columns.
  pattern_grid: {
    targets(def) {
      const out = [];
      for (let r = 0; r < def.params.rows; r++)
        for (let c = 0; c < def.params.cols; c++) out.push({ id: `r${r}c${c}`, label: 'target.cell', row: r, col: c });
      return out;
    },
    hypotheses(def, tier, traits) {
      const out = [];
      for (const rowSlot of tier.slots)
        for (const colSlot of tier.slots) {
          if (rowSlot === colSlot) continue;
          for (const row of halves(traits, rowSlot)) for (const col of halves(traits, colSlot)) out.push({ row, col });
        }
      return out;
    },
    place: (hyp, traits) => `r${evaluate(hyp.row, traits) ? 0 : 1}c${evaluate(hyp.col, traits) ? 0 : 1}`,
    feedback(hyp, traits, target) {
      const want = this.place(hyp, traits);
      const rowOk = want[1] === target[1];
      const colOk = want[3] === target[3];
      return { ok: rowOk && colOk, rowOk, colOk };
    },
    slots: (hyp) => [...ruleSlots(hyp.row), ...ruleSlots(hyp.col)],
    describe: (hyp, t) => [
      t('rule.rows', { rule: describeRule(hyp.row, t) }),
      t('rule.cols', { rule: describeRule(hyp.col, t) }),
    ],
  },
};

export function family(id) {
  const f = FAMILIES[id];
  if (!f) throw new Error('Unknown puzzle family: ' + id);
  return f;
}
