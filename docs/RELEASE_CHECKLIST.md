# Release checklist

Every exit gate and requirement of the MVP-to-Production specification, with
its state. "Done" means built and covered by an automated check named in the
last column. "Needs people" means it cannot be done by code alone and is still
open. Nothing here is marked done on the strength of a claim.

## Phase gates

| Phase | Gate | State | Evidence or what is missing |
|---|---|---|---|
| 0 | 10,000-seed solvability test green | Done | `tests/core.test.mjs`, every tier set and tier |
| 0 | Save survives a mid-Stop kill | Done | `tests/game.test.mjs` round-trips; `tools/ui-smoke.mjs` reloads mid-Stop |
| 1 | A new player completes a leg unaided in under 15 minutes | Needs people | No playtest has been run |
| 1 | No crash in 100 scripted runs | Done | 100 scripted Trails in `tests/game.test.mjs` |
| 2 | Optimal-bot median inside each tier's band | Done | `tests/core.test.mjs` (bands are in `puzzles.json`) |
| 2 | Three playtesters finish the Trail | Needs people | No playtest has been run |
| 3 | Accessibility audit passed | Needs people | Built for it (labels, 200% text, colour-safe, reduced motion, no timers) but not audited with a screen reader |
| 3 | 60 fps on the low-end device | Needs people | Never run on any physical device |
| 3 | First-session completion 70% or higher in 20 playtests | Needs people | No playtest has been run |
| 4 | Crash-free sessions 99.5% or higher | Needs people | No field data; there is no telemetry by design |
| 4 | Legal and IP review signed | Needs people | See "IP" below |
| 4 | Retention and difficulty metrics reviewed | Needs people | The local play record exists; nobody has reviewed real data |
| 5 | Monthly content without engine changes | Ready | New Stops, biomes, trinkets, goals and languages are data (`docs/EXTENDING.md`) |

## MVP acceptance checklist (specification section 10)

| Item | State | Evidence |
|---|---|---|
| Every Stop solvable by deduction from feedback alone | Done | Deduction-only bot solves at least 97% per tier; a rule-knowing bot finishes every Stop |
| Same seed and inputs reproduce the same run | Done | Determinism tests for every puzzle |
| Mid-Stop quit and relaunch restores exact state | Done | Save round-trip tests; browser reload test |
| Every action has a tap path and a drag path | Done | Sending, seating, offers and convoys all have both; exercised by `tools/ui-smoke.mjs` |
| No shipped name, art, sound or text traces to the reference game; ledger complete | Done by check, review open | Content gate bans the reference name and requires a ledger row per asset; a human IP review is still needed |
| Each trait distinguishable without colour | Done | Every trait has a shape cue; coat has a pattern as well as a colour |

## Feature coverage by specification section

| Section | Requirement | State |
|---|---|---|
| 3 | Boot, Title, Roster Builder, Trail Map, Party Select, Stop, Leg Summary, Camp, Finale | Done |
| 3 | One to three save slots, versioned, atomic writes, three rolling backups, forward migration | Done (migrations from versions 1, 2 and 3 are tested against saved files) |
| 3 | Settings: audio, haptics, reduced motion, colour-safe, text size, language | Done, plus music and gentle help |
| 3 | Content packs loaded from files | Done |
| 3 | Android phones and tablets | Built, never run on a device |
| 3 | iOS | Not built. The web build is installable to the home screen and works offline; a store build needs a Mac and a developer account |
| 3 | Desktop web as a secondary build | Done (`node tools/serve.mjs`; offline after first visit) |
| 3 | 60 fps, cold start under 3 s, memory under 300 MB, install under 150 MB | Install size is about 1.2 MB; the rest is unmeasured |
| 4 | Five trait slots of four values, declarative rules (has, anyOf, count, and, or, not) | Done |
| 4 | Roster of 36, or 100 or more in production | Done (36 or 100, chosen when a Trail begins). Optional duplicates are not offered |
| 5 | Nine puzzle families | Done, and six more: 15 families, 17 puzzles |
| 5 | Patience, hints, solve moment, tap alternative | Done |
| 6 | Legs with a fork, camps, persistent per-leg tiers, lowering allowed | Done. Three legs and twelve Stops (nine per run), not the four-leg table |
| 6 | Hint tokens, full-party landmark and trinket, stranded creatures recoverable | Done |
| 6 | Opt-in Hard Trail with permanent loss | Done |
| 6 | Adaptive assist, toggleable | Done |
| 6 | Nicknames and favourites, daily puzzle, Collection Book, goals and a gentle streak, photo mode with stickers | Done |
| 7 | Portrait first, 48 dp targets, at most three persistent controls on a Stop | Done |
| 7 | Gestures: drag, long-press, map zoom by double-tap or pinch, swipe between Camp tabs | Done |
| 7 | Landscape on tablets | Partly: Stops reflow; other screens only stretch |
| 7 | Accessibility requirements | Built; not audited |
| 8 | Layered creature parts, a biome per leg, hand-made look | Done in code-drawn art; no artist-made art |
| 8 | Parallax backgrounds | Not done: backdrops are still |
| 8 | Antagonists as a mood | Done lightly: the Hollow Court appears only in the story text |
| 8 | Music per leg with stems that thin during concentration; distinct SFX; wordless calls by trait | Done with synthesised sound; no recorded music |
| 8 | Extension points (trait value, biome, family, seasonal skin) | Done; see `docs/EXTENDING.md` |
| 8 | Asset ledger; release fails on a gap | Done (`assembleRelease` runs the content gate) |
| 9 | Pure rules core with tests that need no device; 90% coverage | Done (99% line coverage) |
| 9 | JSON schemas validated at build time | Done (`schemas/`, checked by the content gate) |
| 9 | Three bots; property tests | Done |
| 9 | Golden-save tests for every prior schema version | Done |
| 9 | Device matrix of six real devices | Needs people |
| 9 | Analytics local-first, opt-in, no personal data | Done as a local play record only; nothing is ever sent |
| 9 | CI on every merge | Workflow written (`.github/workflows/ci.yml`); not yet seen running |
| 9 | Signed reproducible builds | Signing is wired to `keystore.properties`; no release key exists yet, and reproducibility is unverified |
| 9 | Remote config for tier tuning | Not done, on purpose: the game has no network permission. Tuning ships in `puzzles.json` |
| 10 | Localisation, at least five languages | Done: English, Spanish, French, German, Portuguese. The four translations are unreviewed |
| 10 | Store assets, privacy review, soft launch | Drafts in `store/`; review and launch need people |

## IP

- The game uses only abstract mechanics; every name, scene, creature and
  sound was made for this project, and two fonts are used under the SIL Open
  Font License (`ASSET_LEDGER.md`).
- The look deliberately follows the general style of illustrated mid-1990s
  puzzle adventures (a painted scene filling the screen, puzzles built into
  the place, a crowd of small creatures, a few round buttons). That is a
  style, not a copy, but it is exactly the kind of judgement an external
  legal review should confirm before any launch.
- Twelve of the Stops were written to cover the same *kinds* of reasoning as
  the reference game's twelve puzzles, at the owner's request. They do not
  reproduce its puzzles, but a reviewer should look at each side by side.

## Before the first public release

1. Install on at least six real devices (low, mid, high; two tablets) and play
   every Stop. Measure frame rate, cold start and memory.
2. Run the accessibility audit with a screen reader and at 200% text.
3. Run the playtests the phase gates call for.
4. Have a native speaker review each translation.
5. Get the legal, IP and children's-privacy review.
6. Create the release keystore, add `keystore.properties`, and build with
   `gradlew assembleRelease`.
7. Push once and confirm the CI workflow passes on GitHub.
