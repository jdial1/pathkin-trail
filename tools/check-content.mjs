// Content-pack gate. Fails the build on a schema violation, a missing or
// mismatched localisation key, an unknown puzzle family or rule form, a
// reference-game name anywhere in the project, or an asset-ledger gap.
// Usage: node tools/check-content.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { FAMILIES } from '../app/src/main/assets/www/js/core/families.js';
import { prepareContent } from '../app/src/main/assets/www/js/core/content.js';
import { hypotheses } from '../app/src/main/assets/www/js/core/runtime.js';
import { newProfile } from '../app/src/main/assets/www/js/core/game.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const www = join(repo, 'app/src/main/assets/www');
const json = (p) => JSON.parse(readFileSync(join(www, 'content', p), 'utf8'));
const problems = [];
const need = (ok, msg) => ok || problems.push(msg);
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

const raw = { traits: json('traits.json'), puzzles: json('puzzles.json'), trail: json('trail.json'), theme: json('theme.json'), goals: json('achievements.json') };
const { traits, trail, theme, goals } = raw;
const slotIds = traits.slots.map((s) => s.id);
let content = null;
try {
  content = prepareContent(raw);
} catch (e) {
  problems.push('puzzles.json: ' + e.message);
}

// ---- Schema ----
need(Number.isInteger(traits.rosterSize) && traits.rosterSize > 0, 'traits.rosterSize');
need(traits.partyMax >= 1 && traits.partyMax <= traits.rosterSize, 'traits.partyMax');
for (const s of traits.slots) need(Array.isArray(s.values) && new Set(s.values).size === s.values.length && s.values.length >= 2, `slot ${s.id} values`);
need(traits.slots.reduce((n, s) => n * s.values.length, 1) >= traits.rosterSize, 'not enough trait combinations for the roster');

if (content) {
  const pack = content.puzzles;
  const ids = new Set();
  for (const p of pack.puzzles) {
    need(/^p_[a-z0-9_]+$/.test(p.id) && !ids.has(p.id), `puzzle id ${p.id}`);
    ids.add(p.id);
    need(FAMILIES[p.family], `puzzle ${p.id}: unknown family ${p.family}`);
    need(new Set(p.slots).size === slotIds.length && p.slots.every((s) => slotIds.includes(s)), `puzzle ${p.id}: slots must list every slot once`);
    if (!FAMILIES[p.family]) continue;
    for (const tier of pack.tierOrder) {
      const t = p.tiers[tier];
      need(t.patience >= 1 && Array.isArray(t.sends) && t.sends[0] <= t.sends[1], `puzzle ${p.id}/${tier}: patience and sends band`);
      need(Number.isInteger(t.examples) && t.examples >= 0, `puzzle ${p.id}/${tier}: examples`);
      need(t.slots.length >= (p.family === 'gate_sort' && p.params.gates === 2 ? 1 : 2), `puzzle ${p.id}/${tier}: too few slots`);
      try {
        const n = hypotheses({ def: p, traits }, tier).length;
        need(n >= 12, `puzzle ${p.id}/${tier}: only ${n} possible rules`);
      } catch (e) {
        problems.push(`puzzle ${p.id}/${tier}: ${e.message}`);
      }
    }
  }
  // Tiers get harder in patience, never easier.
  const pat = pack.tierOrder.map((t) => pack.tiers[t].patience);
  need(pat.every((v, i) => i === 0 || v <= pat[i - 1]), 'tier patience must not rise with difficulty');

  need(trail.camps.length === trail.legs.length + 1, 'trail.camps must be one longer than trail.legs');
  trail.legs.forEach((leg, i) => {
    need(leg.from === i && leg.to === i + 1, `leg ${leg.id}: must lead from camp ${i} to ${i + 1}`);
    need(theme.themes[leg.theme], `leg ${leg.id}: unknown theme`);
    need(leg.branches.length >= 1 && new Set(leg.branches.map((b) => b.id)).size === leg.branches.length, `leg ${leg.id}: branches`);
    for (const b of leg.branches) {
      need(b.stops.length === leg.branches[0].stops.length && b.stops.length >= 1, `leg ${leg.id}/${b.id}: every branch needs the same number of Stops`);
      for (const id of b.stops) need(ids.has(id), `leg ${leg.id}/${b.id}: unknown stop ${id}`);
    }
  });
  const used = trail.legs.flatMap((l) => l.branches.flatMap((b) => b.stops));
  need(new Set(used).size === used.length, 'a puzzle is used by more than one Stop');
  for (const id of ids) need(used.includes(id), `puzzle ${id} is not on the Trail`);
  need(pack.tierOrder.includes(trail.daily.tier) && trail.daily.partySize >= 2 && trail.daily.partySize <= traits.partyMax, 'trail.daily');
  for (const id of trail.daily.puzzles) need(ids.has(id), `daily: unknown puzzle ${id}`);
  need(trail.rescueSharedTraits >= 1 && trail.rescueSharedTraits <= slotIds.length && trail.strandAfterReturns >= 1, 'trail rescue settings');

  const stats = newProfile(content, 1, 1).stats;
  const goalIds = new Set();
  for (const g of goals.goals) {
    need(!goalIds.has(g.id) && g.stat in stats && g.atLeast >= 1, `goal ${g.id}`);
    goalIds.add(g.id);
  }
  need(goals.goals.filter((g) => g.stat === 'delivered').every((g) => g.atLeast <= traits.rosterSize), 'a "delivered" goal exceeds the roster size');
  need(goals.goals.filter((g) => g.stat === 'branchesSeen').every((g) => g.atLeast <= trail.legs.reduce((n, l) => n + l.branches.length, 0)), 'a "branchesSeen" goal exceeds the number of branches');
}
for (const [name, pal] of Object.entries(theme.palettes)) need(pal.length === traits.slots.find((s) => s.id === 'tint').values.length, `palette ${name} size`);

// ---- Localisation: every key the content and code use exists in every
// language, and all languages have the same keys and placeholders. ----
const usedKeys = new Set();
const ref = (s) => usedKeys.add(String(s).replace(/^loc:/, ''));
for (const s of traits.slots) {
  ref('slot.' + s.id);
  for (const v of s.values) ref(`${s.id}.${v}`);
}
for (const tier of raw.puzzles.tierOrder) ref('tier.' + tier);
for (const p of raw.puzzles.puzzles) [p.title, p.blurb].forEach(ref);
for (const leg of trail.legs) {
  ref(leg.name);
  for (const b of leg.branches) ref(b.name);
}
trail.camps.forEach(ref);
for (const g of goals.goals) ref('goal.' + g.id);
for (const file of walk(join(www, 'js'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.')) usedKeys.add(m[1]);
  for (const m of src.matchAll(/'((?:target|camp|stop|rule|slots|inspect|finale|coach|summary|daily|assist|toast|lang)\.[a-zA-Z0-9]+)'/g)) usedKeys.add(m[1]);
}
const langFiles = readdirSync(join(www, 'content')).filter((f) => /^text\.[a-z-]+\.json$/.test(f));
const texts = Object.fromEntries(langFiles.map((f) => [f, json(f)]));
const holes = (s) => [...String(s).matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]).sort().join(',');
const base = texts['text.en.json'];
need(base, 'text.en.json is missing');
for (const [f, text] of Object.entries(texts)) {
  for (const key of usedKeys) need(typeof text[key] === 'string' && text[key].length > 0, `${f}: missing key ${key}`);
  if (!base || text === base) continue;
  for (const key of Object.keys(base)) need(key in text, `${f}: missing key ${key} (present in English)`);
  for (const key of Object.keys(text)) {
    need(key in base, `${f}: extra key ${key}`);
    if (key in base) need(holes(text[key]) === holes(base[key]), `${f}: placeholders differ for ${key}`);
  }
}
for (const lang of langFiles.map((f) => f.split('.')[1])) need(base && base['lang.' + lang], `no language name for ${lang}`);

// ---- IP safety: the reference game's name must not appear anywhere. ----
const banned = String.fromCharCode(122, 111, 111, 109, 98, 105, 110);
const skip = /[\\/](node_modules|build|dist|\.git|\.gradle|golden)[\\/]/;
for (const file of walk(repo)) {
  if (skip.test(file) || !/\.(js|mjs|cjs|json|html|css|md|java|xml|kts|properties|txt)$/.test(file)) continue;
  need(!readFileSync(file, 'utf8').toLowerCase().includes(banned), `reference-game name found in ${relative(repo, file)}`);
}

// ---- Asset ledger: every shipped file under assets/ and res/ has a row. ----
const ledger = readFileSync(join(repo, 'ASSET_LEDGER.md'), 'utf8');
const rows = [...ledger.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gm)].map((m) => ({ pattern: m[1], cells: m.slice(2, 6).map((c) => c.trim()) }));
for (const r of rows) need(r.cells.every(Boolean), `ledger row ${r.pattern} has an empty cell`);
const covered = (path) => rows.some((r) => (r.pattern.endsWith('/') ? path.startsWith(r.pattern) : path === r.pattern));
for (const dir of ['app/src/main/assets', 'app/src/main/res']) {
  for (const file of walk(join(repo, dir))) {
    const rel = relative(repo, file).replaceAll('\\', '/');
    need(covered(rel), `asset ledger gap: ${rel}`);
  }
}

if (problems.length) {
  console.error('Content gate FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Content gate passed: ${raw.puzzles.puzzles.length} puzzles, ${usedKeys.size} text keys x ${langFiles.length} languages, ${goals.goals.length} goals, ${rows.length} ledger rows.`);
