# Pathkin Trail

An original deduction-puzzle journey game for phones and tablets. You lead a
roster of 36 Pathkins along a Trail of four legs to their new home. Every Stop
hides a rule about their traits, and every attempt tells you something.

Current version: **0.2.0-alpha** (specification phases 0 to 2, plus the
engine-level parts of phases 3 and 4).

## What is in the game

- **The Trail**: four legs of three Stops, camps between them, and a fork in
  legs two and three (a run plays 12 of the 18 Stops).
- **Four puzzle families**: `gate_sort` (two or three gates), `bridge_pair`,
  `pattern_grid`, `tour_path`. Eighteen Stops, all defined as data.
- **Four difficulty tiers per leg** (gentle, steady, hard, expert). A leg
  rises one tier after three full parties; the player can set any tier at any
  time.
- **Trail guides**: each Stop starts with a few example creatures already
  standing where they belong, so the first send can be a deduction.
- **Patience and hints**: wrong sends cost patience; hint tokens reveal one
  trait the rule looks at.
- **Camps**: rest and wake creatures, and bring in stranded ones. A creature
  that walks back from the same Stop three times is stranded near the next
  camp; a friend who shares two traits, a hint token, or (when nobody is left
  to help) a free call brings it back. Nothing is ever lost for good.
- **Gentle help** (adaptive assist): a free hint after two failed Stops, an
  offer to go up a tier after three flawless ones. Never changes a Stop in
  progress; can be switched off.
- **Goals**, a **Daily Stop** (one seeded puzzle a day), and a **Collection
  Book** of every trait combination met.
- **Accessibility**: tap and drag paths for every action, shape cues for every
  trait, colour-safe palette, text up to 200%, reduced motion, screen-reader
  labels, no timers.
- **Languages**: English and Spanish.
- **Saves**: three slots, written after every event, three rolling backups,
  versioned with forward migration (version 1 saves still load).

## Layout

| Path | What it is |
|---|---|
| `app/src/main/assets/www/js/core/` | Rules core: seeded RNG, traits, rule predicates, puzzle families, puzzle runtime, app state machine. Pure functions, no I/O, no platform APIs. |
| `app/src/main/assets/www/content/` | Content packs: traits, puzzles and tiers, trail, themes, goals, text per language. |
| `app/src/main/assets/www/js/app/` | Presentation: screens, creature art, feedback bus (audio, haptics), storage, input. |
| `app/src/main/java/` | Android host: WebView, atomic saves with 3 rolling backups, haptics, back button. |
| `tests/` | Node tests for the core (no device needed); `tests/golden/` holds saves from older versions. |
| `tools/` | `check-content.mjs` (content gate), `tune.mjs` (difficulty tuning), `serve.mjs` (desktop web build), `ui-smoke.mjs` (browser play-through). |
| `ASSET_LEDGER.md` | Provenance row for every shipped asset. |

## Commands

```
npm test                    # all core tests (about 5 minutes at 10,000 seeds)
SEEDS=1000 npm test         # quicker pass
npm run check-content       # schema, localisation, reference-name ban, asset ledger
node tools/tune.mjs         # how guide counts change bot results per tier
node tools/serve.mjs        # play in a desktop browser at http://127.0.0.1:8765
node tools/ui-smoke.mjs     # headless play-through of the real UI (needs Chrome; npm install first)
gradlew.bat assembleDebug   # APK at app/build/outputs/apk/debug/app-debug.apk
```

## Quality gates

| Gate | Where | What it checks |
|---|---|---|
| Solvable by deduction | `tests/core.test.mjs` | 10,000 seeds per family and tier: a bot that only deduces solves at least 97%; the true rule is never eliminated; candidate tracking matches a brute-force solver. |
| Not trivial | `tests/core.test.mjs` | A random bot makes at least 1.3x the wrong sends and, above gentle, fails at least 15% of Stops. |
| Informative | `tests/core.test.mjs` | Each observation rules out at least one candidate rule on average; median solve length sits in the tier's band. |
| Honest generation | `tests/core.test.mjs` | Guides are truthful, never give the rule away, and the rule always splits the party. |
| Whole game | `tests/game.test.mjs` | 100 scripted Trails reach "everyone home" with valid statuses throughout; every fork branch is played; stranding and all rescue paths; assist; goals; daily Stop. |
| Saves | `tests/game.test.mjs` | Round-trip after every event changes nothing; version 1 golden saves migrate and play on; future versions are refused. |
| Content | `tools/check-content.mjs` | Pack schema, every text key in every language with matching placeholders, no reference-game names anywhere, asset ledger complete. |
| Real UI | `tools/ui-smoke.mjs` | Chrome play-through of all four legs by tap and drag, mid-Stop reload, rescue, daily, book, Spanish, large text, version 1 save. |

## How the puzzles work

Each family lists every hidden rule a tier allows. The runtime keeps the set of
rules still consistent with what the player has seen; the Stop announces "Rule
found" when every remaining rule sends every waiting Pathkin to the same place.

- `gate_sort`: gate one admits a hidden rule, the last gate takes everyone
  else; with three gates, gate two has its own rule for those turned away.
- `bridge_pair`: two bridges with complementary rules.
- `pattern_grid`: a 2x2 field; one trait splits the rows, another the columns.
  A miss shows an arrow toward the right patch.
- `tour_path`: the trail forks twice, each fork with its own rule. A creature
  is turned back at the first fork that disagrees, so a miss only tells you
  about the forks it reached.

Adding a Stop in an existing family is a `puzzles.json` entry, a `trail.json`
slot and a title string. Adding a family means one entry in `families.js`
(targets, hypotheses, place, feedback, slots, describe) and a target layout in
`screens.js`.

## Not done yet

- Never run on a physical device or emulator; only the web bundle has been
  driven, in desktop Chrome.
- Production art, music and animation (creatures are placeholder shapes,
  sounds are synthesised tones).
- Post-MVP families `echo_match`, `signal_guess`, `queue_route`,
  `trade_ledger`, `fold_sequence`.
- Photo mode, opt-in Hard Trail mode, cosmetic trinkets, map pinch-zoom,
  three more languages, iOS build, store assets, privacy and legal review.
