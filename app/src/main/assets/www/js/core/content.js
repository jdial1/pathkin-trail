// Content preparation: resolves each puzzle's tier settings from its family's
// tier set, so a puzzle definition only has to list its slots in order.

export function prepareContent(content) {
  const pack = content.puzzles;
  const puzzles = pack.puzzles.map((def) => {
    const set = pack.tierSets[def.tierSet || def.family];
    if (!set) throw new Error(`Puzzle ${def.id}: no tier set`);
    const tiers = {};
    for (const tier of pack.tierOrder) {
      const cfg = set[tier];
      if (!cfg) throw new Error(`Puzzle ${def.id}: tier set has no ${tier}`);
      tiers[tier] = { ...pack.tiers[tier], ...cfg, slots: def.slots.slice(0, cfg.slotCount) };
    }
    return { ...def, tiers };
  });
  return { ...content, puzzles: { ...pack, puzzles } };
}
