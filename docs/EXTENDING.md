# Extending the game

Most additions are data. Run `npm run check-content` after any change: it
validates every pack against its schema in `schemas/`, checks that every text
key exists in every language with matching placeholders, and checks the asset
ledger.

| To add | Change | Code needed |
|---|---|---|
| A Stop in an existing family | An entry in `content/puzzles.json` (id, family, slot order), a slot in `content/trail.json` (a leg branch or the daily list), a title in every `text.*.json` | None |
| A difficulty setting | The family's entry under `tierSets` in `puzzles.json`. `node tools/tune.mjs 400 <tierSet> <key>=v1,v2` shows how the bots fare | None |
| A biome | An entry under `themes` in `content/theme.json` (colours, `scene`, `music`), then name it in a leg | None, unless it needs a new landmark or frame shape (`js/app/art/scenes.js`) |
| A seasonal skin | Swap the `palettes` and `themes` of `theme.json` | None |
| A goal | An entry in `content/achievements.json` (a counter and a threshold) and `goal.<id>` text | None |
| A trinket | An entry in `content/trinkets.json`, `trinket.<id>` text, and its drawing in `js/app/creature.js` | A few lines of SVG |
| A language | `content/text.<code>.json` with every key, the code in `LANGUAGES` in `js/app/main.js`, and `lang.<code>` in every pack | One line |
| A trait value | The value in `content/traits.json`, its drawing in `js/app/creature.js`, and its text | A few lines of SVG. Saved games keep working; rosters are drawn from the larger set |
| A trait slot | The slot in `traits.json`, drawings, text, a bump of `SCHEMA_VERSION` in `js/core/game.js` and a migration that gives old creatures a value | Yes |
| A puzzle family | One entry in `js/core/families.js` and a board in `js/app/screens.js` or `extras.js`. The runtime, saves, hints, bots' random player and every test loop pick it up; add a deduction player in `js/core/bots.js` | Yes |

## Writing a family

A family is an object with:

- `kind`: `sort` (send a creature to a target), `seat` (place on linked seats)
  or `probe` (any other action).
- `targets(def, state)`: what the player can act on.
- `hyps(def, cfg, traits, setup)`: every hidden rule the tier allows.
- `outcome(h, action, pre, env)`: what would happen if rule `h` were true.
  It must be a pure function, because the runtime calls it for every candidate
  rule to work out which ones are still possible.
- `key(fb)`, `describe(h, t, setup, env)`, and where needed `create`, `pre`,
  `after`, `follow`, `alive`, `relevant`, `truth`, `settle`, `onFail`,
  `slots` or `hint`.

Sorting families only need `targets`, `hypotheses`, `place`, `feedback`,
`slots` and `describe`; wrap them with `sorter`.

Then check it: the core tests run every puzzle through the deduction bot, the
random bot and the rule-knowing bot at 10,000 seeds per tier.
