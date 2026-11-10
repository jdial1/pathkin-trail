# Art direction

## What we are aiming for

The feel of an illustrated puzzle adventure from the mid-1990s: you are
looking into a place, not at an app.

Studying screenshots of games of that kind, the look comes from a few things:

1. **The scene is the screen.** A painted place fills the whole display. It is
   lit like a stage: a glowing sky, saturated ground, deep violet shadows, and
   dark shapes (trunks, rocks) framing the edges.
2. **No panels.** There is no title bar, text box or tray. The party stands as
   a loose crowd on the ground in the scene.
3. **Puzzles are built into the place**, with depth: bridges recede across a
   chasm, doors sit in a hillside.
4. **A few round glowing buttons** in a corner are the only controls.
5. **Small creatures, many of them**, each with a clear silhouette and a face.
6. **Almost no text.** Rules are shown, not explained.

## What we take, and what we do not

We take the six points above. They are a style, shared by many games.

We do not take any character, creature, scene, puzzle staging, name, sound or
layout from any particular game. Every drawing here was made for this project:
the Pathkins (bean-bodied, with a crest, a brow mark, a patterned coat and one
of four kinds of feet), the keepers, and every place.

## How it is built

- `js/app/art/scenes.js` paints the backdrop from a biome's entry in
  `content/theme.json` (sky, ridges, landmarks, light, frame). It is painted
  once per change of screen and never while playing.
- `js/app/creature.js` composes a creature from one layer per trait.
- Puzzle pieces are drawn with CSS and small inline SVGs in
  `css/style.css`, `js/app/screens.js` and `js/app/extras.js`.
- Texture comes from two shared SVG filters: ragged edges and paper grain.

## Where we deliberately differ from point 6

The specification asks for text at about a grade-3 reading level, screen
reader labels and no reliance on sound. So each Stop shows one short sentence
until the first move, and keeps it on the pause sheet.

## Known gaps

- The art is drawn by code. It is consistent, but it is not illustration.
- Scenes are still images: no parallax, no weather.
- Creatures bob and blink, but do not walk; puzzle characters do not react.
- Each biome has one clearing; Stops in the same leg share a backdrop.
