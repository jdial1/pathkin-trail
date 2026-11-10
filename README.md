# Pathkin Trail

An original deduction-puzzle journey game for phones and tablets. You lead a
roster of 36 Pathkins along a Trail of three legs to their new home. Every
Stop is a different kind of puzzle, and every attempt tells you something.

Current version: **1.0.0-rc1**. Everything in the specification that can be
built and checked by code is in. What still needs people (real devices,
playtests, audits, legal review) is listed in `docs/RELEASE_CHECKLIST.md`.

## What is in the game

- **The Trail**: three legs of three Stops, camps between them, and a fork in
  the middle leg. Twelve Stops, each a different mechanic; a run plays nine.
- **Fifteen puzzle families** and seventeen puzzles, all defined as data: the
  twelve on the Trail (see the table below) and five more that appear as
  Daily Stops and in Practice.
- **Practice**: any puzzle at any tier, with nothing at stake.
- **Trail choices**: 36 or 100 Pathkins, and an opt-in Hard Trail on which a
  stranded creature is lost for good.
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
- **Goals**, **trinkets** to wear, a **Daily Stop** with a gentle streak, a
  **Collection Book**, a **picture maker** with stickers, and a **play
  record** that never leaves the device.
- **Sound**: a generated tune per biome that thins out during a Stop, a
  distinct cue per kind of feedback, and a small call per creature.
- **Accessibility**: tap and drag paths for every action, shape cues for every
  trait, colour-safe palette, text up to 200%, reduced motion, screen-reader
  labels, no timers.
- **Languages**: English, Spanish, French, German and Portuguese.
- **Gestures**: drag, long-press, double-tap or pinch to zoom the map, swipe
  between Camp tabs; none is the only way to do anything.
- **Saves**: three slots, written after every event, three rolling backups,
  versioned with forward migration (saves from versions 1, 2 and 3 still load).

## Look and feel

The game is presented as a storybook, not as an app:

- A painted scene fills the screen behind everything: meadow, canyon or peak
  for the leg being played, a dusk camp with tents and a fire, a village at
  journey's end, and worn parchment for the map and journal screens. Scenes
  are drawn by code (`js/app/art/`) in a cut-paper style with ragged edges
  and paper grain, and are painted once per change of screen, never while
  playing.
- Puzzles are things in the world: plank bridges, cave mouths, stall keepers,
  log seats joined by ropes, a standing stone, carved posts, burrow doors,
  tilled soil, stepping stones, a pond, rail sheds and switch levers.
- Pathkins are drawn with a shadow side, a face and a little life: those
  waiting on the grassy ledge bob and blink.
- Controls are wooden plaques and paper scraps; lettering is chunky and
  outlined so it reads over any scene; patience is a row of lanterns.
- Two openly licensed fonts are bundled (see `ASSET_LEDGER.md`). All art is
  original; nothing is traced or taken from any other game.
- The reduced-motion setting stills the scenes and the creatures.

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
| `schemas/` | JSON Schemas for the content packs. |
| `docs/` | `RELEASE_CHECKLIST.md` (every specification gate and its state), `EXTENDING.md`, `ART_DIRECTION.md`. |
| `store/` | Draft store listing and privacy policy. |
| `.github/workflows/ci.yml` | Runs every gate and an Android build on each push. |
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
gradlew.bat assembleRelease # runs the content gate first; signed if keystore.properties exists
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
| Content | `tools/check-content.mjs` | JSON Schemas for every pack, every text key in every language with matching placeholders, no reference-game names anywhere, asset ledger complete. |
| Real UI | `tools/ui-smoke.mjs` | Chrome play-through of all twelve Stops by tap and drag, mid-Stop reload, rescue, daily, practice, trinkets, saving a picture, map zoom, play record, Spanish, large text, older saves. |

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

Daily Stops and Practice also offer `gate_sort` (two gates), its three-gate
variant, a 2x2 `pattern_grid`, `queue_route` (riders board a cart in a hidden
order) and `fold_sequence` (stepping pads that follow a repeating pattern).

There are three kinds of family, which is what the screens and bots key on:
**sort** (every creature has one correct target), **seat** (creatures sit on
linked seats and can be lifted again for free) and **probe** (the player acts
on something else and creatures pass as a result).

Adding a Stop in an existing family is a `puzzles.json` entry, a `trail.json`
slot and a title string. Adding a family means one entry in `families.js`
and a board in `screens.js`; the runtime, saves, hints and tests pick it up.

## Not done yet

See `docs/RELEASE_CHECKLIST.md` for the full list against the specification.
In short:

- Never run on a physical device or emulator; only the web bundle has been
  driven, in desktop Chrome. Frame rate, start time and memory are unmeasured.
- No playtests, accessibility audit, translation review or legal review.
- The art is drawn by code and the sound is synthesised; there is no
  artist-made art, recorded music or voice. Scenes do not move in parallax.
- No iOS store build (the web build installs to a home screen and works
  offline), no release signing key, and the CI workflow has not yet run.
