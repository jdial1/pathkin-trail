# Pathkin Trail (MVP)

An original deduction-puzzle journey game for phones and tablets, built from
the MVP-to-Production specification (phases 0
and 1). You lead a roster of 36 Pathkins through one leg of three Stops; each
Stop hides a rule about their traits, and every attempt tells you something.

## Layout

| Path | What it is |
|---|---|
| `app/src/main/assets/www/js/core/` | Rules core: seeded RNG, traits, rule predicates, puzzle families, puzzle runtime, app state machine. Pure functions, no I/O, no platform APIs. |
| `app/src/main/assets/www/content/` | Content packs (traits, puzzles, trail, theme, text). New puzzles in an existing family are data only. |
| `app/src/main/assets/www/js/app/` | Presentation: screens, creature art, feedback bus (audio, haptics), storage, input. |
| `app/src/main/java/` | Android host: WebView, atomic saves with 3 rolling backups, haptics, back button. |
| `tests/` | Node tests for the core (no device needed). |
| `tools/` | `check-content.mjs` (content gate), `serve.mjs` (desktop web build), `ui-smoke.mjs` (browser play-through). |
| `ASSET_LEDGER.md` | Provenance row for every shipped asset. |

## Commands

```
npm test                    # core tests: 10,000 seeds per family and tier, bots, saves, 100 scripted runs
npm run check-content       # schema, localisation keys, asset ledger
node tools/serve.mjs        # play in a desktop browser at http://127.0.0.1:8765
node tools/ui-smoke.mjs     # headless play-through of the real UI (needs Chrome; npm install first)
gradlew.bat assembleDebug   # APK at app/build/outputs/apk/debug/app-debug.apk
```

`SEEDS=1000 npm test` runs a quicker pass.

## How the puzzles work

Each family lists every hidden rule a tier allows. The runtime keeps the set of
rules still consistent with what the player has seen; the Stop announces "Rule
found" when every remaining rule sends every waiting Pathkin to the same place.
A wrong send costs one patience and marks the Pathkin; at zero patience the
rest walk back to the start, safe.

- `gate_sort`: gate one admits a hidden rule, gate two takes everyone else.
- `bridge_pair`: one hidden trait is split in half, one half per bridge.
- `pattern_grid`: a 2x2 field; one trait splits the rows, another the columns.
  A miss shows an arrow toward the right patch.
