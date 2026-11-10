// Content-pack gate. Fails the build on a schema violation, a missing
// localisation key, an unknown puzzle family, or an asset-ledger gap.
// Usage: node tools/check-content.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { FAMILIES } from '../app/src/main/assets/www/js/core/families.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const www = join(repo, 'app/src/main/assets/www');
const json = (p) => JSON.parse(readFileSync(join(www, 'content', p), 'utf8'));
const problems = [];
const need = (ok, msg) => ok || problems.push(msg);

const traits = json('traits.json');
const puzzles = json('puzzles.json');
const trail = json('trail.json');
const theme = json('theme.json');
const slotIds = traits.slots.map((s) => s.id);

// Schema
need(Number.isInteger(traits.rosterSize) && traits.rosterSize > 0, 'traits.rosterSize');
need(traits.partyMax >= 1 && traits.partyMax <= traits.rosterSize, 'traits.partyMax');
for (const s of traits.slots) need(Array.isArray(s.values) && new Set(s.values).size === s.values.length && s.values.length >= 2, `slot ${s.id} values`);
need(traits.slots.reduce((n, s) => n * s.values.length, 1) >= traits.rosterSize, 'not enough trait combinations for the roster');
for (const p of puzzles.puzzles) {
  need(/^p_[a-z0-9_]+$/.test(p.id), `puzzle id ${p.id}`);
  need(FAMILIES[p.family], `puzzle ${p.id}: unknown family ${p.family}`);
  for (const tier of puzzles.tierOrder) {
    const t = p.tiers[tier];
    need(t, `puzzle ${p.id}: missing tier ${tier}`);
    if (!t) continue;
    need(t.patience >= 1, `puzzle ${p.id}/${tier}: patience`);
    need(t.slots.length >= 1 && t.slots.every((s) => slotIds.includes(s)), `puzzle ${p.id}/${tier}: slots`);
    if (p.family === 'pattern_grid') need(t.slots.length >= 2 && p.params.rows === 2 && p.params.cols === 2, `puzzle ${p.id}/${tier}: grid needs 2 slots and a 2x2 field`);
  }
}
for (const leg of trail.legs) {
  need(theme.themes[leg.theme], `leg ${leg.id}: unknown theme`);
  for (const id of leg.stops) need(puzzles.puzzles.some((p) => p.id === id), `leg ${leg.id}: unknown stop ${id}`);
}
for (const [name, pal] of Object.entries(theme.palettes)) need(pal.length === traits.slots.find((s) => s.id === 'tint').values.length, `palette ${name} size`);

// Localisation: every key the content and code use exists in every language.
const used = new Set();
for (const s of traits.slots) {
  used.add('slot.' + s.id);
  for (const v of s.values) used.add(`${s.id}.${v}`);
}
for (const tier of puzzles.tierOrder) used.add('tier.' + tier);
for (const p of puzzles.puzzles) for (const ref of [p.title, p.blurb]) used.add(ref.replace(/^loc:/, ''));
for (const leg of trail.legs) used.add(leg.name.replace(/^loc:/, ''));
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
for (const file of walk(join(www, 'js'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);
  for (const m of src.matchAll(/'((?:target|camp|stop|rule|slots|inspect|finale)\.[a-zA-Z0-9]+)'/g)) used.add(m[1]);
}
const langs = readdirSync(join(www, 'content')).filter((f) => /^text\.[a-z-]+\.json$/.test(f));
for (const f of langs) {
  const text = json(f);
  for (const key of used) need(typeof text[key] === 'string' && text[key].length > 0, `${f}: missing key ${key}`);
}

// Asset ledger: every shipped file under assets/ and res/ is covered by a row.
const ledger = readFileSync(join(repo, 'ASSET_LEDGER.md'), 'utf8');
const rows = [...ledger.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gm)].map((m) => ({ pattern: m[1], cells: m.slice(2, 6).map((c) => c.trim()) }));
for (const r of rows) need(r.cells.every(Boolean), `ledger row ${r.pattern} has an empty cell`);
const covered = (path) => rows.some((r) => (r.pattern.endsWith('/') ? path.startsWith(r.pattern) : path === r.pattern));
for (const base of ['app/src/main/assets', 'app/src/main/res']) {
  for (const file of walk(join(repo, base))) {
    const rel = relative(repo, file).replaceAll('\\', '/');
    need(covered(rel), `asset ledger gap: ${rel}`);
  }
}

if (problems.length) {
  console.error('Content gate FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Content gate passed: ${puzzles.puzzles.length} puzzles, ${used.size} text keys x ${langs.length} language(s), ${rows.length} ledger rows.`);
