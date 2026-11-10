# Pathkin Trail

An original deduction-puzzle journey game for phones and tablets. You lead a
roster of 36 Pathkins along a Trail of three legs to their new home. Every
Stop is a different kind of puzzle, and every attempt tells you something.

Current version: **0.3.0-alpha** (specification phases 0 to 2, the puzzle
families of phase 4, and the engine-level parts of phase 3).

## What is in the game

- **The Trail**: three legs of three Stops, camps between them, and a fork in
  the middle leg. Twelve Stops, each a different mechanic; a run plays nine.
- **Twelve puzzle mechanics** (see the table below), all defined as data, plus
  three more that appear as Daily Stops.
- **Four difficulty tiers per leg** (gentle, steady, hard, expert). A leg
  rises one tier after three full parties; the player can set any tier at any
  time.
- **Starting clues**: each Stop begins with a few examples (trail guides
  already in place, earlier offers, earlier convoys, seated anchors), so the
  first move can be a deduction.
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
  versioned with forward migration (version 1 and 2 saves still load).

## Layout

| Path | What it is |
|---|---|
| `app/src/main/assets/www/js/core/` | Rules core: seeded RNG, traits, rule predicates, puzzle families, puzzle runtime, app state machine. Pure functions, no I/O, no platform APIs. |
| `app/src/main/assets/www/content/` | Content packs: traits, puzzles and tiers, trail, themes, goals, text per language. |
| `app/src/main/assets/www/js/app/` | Presentation: screens, creature art, feedback bus (audio, haptics), storage, input. |
| `app/src/main/java/` | Android host: WebView, atomic saves with 3 rolling backups, haptics, back button. |
| `tests/` | Node tests for the core (no device needed); `tests/golden/` holds saves from older versions. |
| `app/src/main/assets/www/js/core/bots.js` | Simulation bots (random, deduction-only, rule-knowing) used by every gate. |
| `tools/` | `check-content.mjs` (content gate), `tune.mjs` (difficulty tuning), `serve.mjs` (desktop web build), `ui-smoke.mjs` (browser play-through). |
| `ASSET_LEDGER.md` | Provenance row for every shipped asset. |

## Commands

```
npm test                    # all core tests (10,000 seeds per tier set and tier; takes a while)
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
| Solvable by deduction | `tests/core.test.mjs` | 10,000 seeds per tier set and tier (15 x 4): a bot that only deduces solves at least 97%; the true rule is never eliminated; table-based tracking matches a brute-force solver. |
| A solution exists | `tests/core.test.mjs` | A bot that knows the rule finishes every Stop of every tier, with no wrong move. |
| Not trivial | `tests/core.test.mjs` | A random bot makes at least 1.3x the wrong sends and, above gentle, fails at least 15% of Stops. |
| Informative | `tests/core.test.mjs` | Each observation rules out at least one candidate rule on average; median solve length sits in the tier's band. |
| Honest generation | `tests/core.test.mjs` | Guides are truthful, never give the rule away, and the rule always splits the party. |
| Whole game | `tests/game.test.mjs` | 100 scripted Trails (some led carelessly) reach "everyone home" with valid statuses throughout; every branch is played; stranding and all rescue paths; assist; goals; daily Stop. |
| Saves | `tests/game.test.mjs` | Round-trip after every event changes nothing; version 1 and version 2 golden saves migrate and play on; future versions are refused. |
| Content | `tools/check-content.mjs` | Pack schema, every text key in every language with matching placeholders, no reference-game names anywhere, asset ledger complete. |
| Real UI | `tools/ui-smoke.mjs` | Chrome play-through of all twelve Stops by tap and drag, mid-Stop reload, rescue, daily, book, Spanish, large text, version 1 and 2 saves. |

## The twelve Stops

Every Stop is an original mechanic built on the same engine: the runtime keeps
the set of hidden rules still consistent with everything the player has seen.

| Leg | Stop | Family | What the player does | What is hidden |
|---|---|---|---|---|
| 1 | Twin Bridges | `bridge_pair` | Send each creature over one of two bridges | The rule that splits them |
| 1 | Forked Ledge | `tour_path` | Send each creature to one of four exits past two forks | A rule at each fork; a miss only shows the forks reached |
| 1 | The Picky Keepers | `trade_ledger` | Offer sets of trail foods to keepers | Each keeper's exact wish |
| 2a | Raft Benches | `bench_link` | Seat everyone so linked neighbours share a trait | Which traits count |
| 2a | The Signal Stone | `signal_guess` | Guess which creature the stone calls for | The creature; misses are graded |
| 2a | Rope Web | `link_web` | Seat everyone on a web of lettered ropes | Which trait each rope letter stands for |
| 2b | Glyph Posts | `totem_match` | Send each creature to one of four glyph posts | Which trait value each glyph means |
| 2b | Burrow Rooms | `pattern_grid` | Place creatures in a 2x4 block of rooms | The trait behind rows and the one behind columns |
| 2b | Seed Toss | `toss_plot` | Aim creatures at a 4x4 plot | Row and column orderings; a miss shows where it landed |
| 3 | The Long Line | `rank_line` | Put each creature in its place in line | The ordering; a miss says nearer the front or further back |
| 3 | The Still Pond | `echo_match` | Find who casts the reflection shown | How the pond changes traits |
| 3 | Rail Switches | `switch_run` | Set three switches and send convoys to four sheds | Which traits flip each switch |

Daily Stops also draw on `gate_sort` (two gates), its three-gate variant, and
a 2x2 `pattern_grid`.

There are three kinds of family, which is what the screens and bots key on:
**sort** (every creature has one correct target), **seat** (creatures sit on
linked seats and can be lifted again for free) and **probe** (the player acts
on something else and creatures pass as a result).

Adding a Stop in an existing family is a `puzzles.json` entry, a `trail.json`
slot and a title string. Adding a family means one entry in `families.js`
and a board in `screens.js`; the runtime, saves, hints and tests pick it up.

## Not done yet

- Never run on a physical device or emulator; only the web bundle has been
  driven, in desktop Chrome.
- Production art, music and animation (creatures are placeholder shapes,
  sounds are synthesised tones).
- The specification's `queue_route` and `fold_sequence` families.
- Photo mode, opt-in Hard Trail mode, cosmetic trinkets, map pinch-zoom,
  three more languages, iOS build, store assets, privacy and legal review.
