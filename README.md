# Cinderhold

A 3D tower-defense game for the browser, built with [Three.js](https://threejs.org/).

The ash tide is rolling down the valley. Build towers along the roads, break the
waves before they reach the Hold, and push all the way to the furnace at the
heart of the ash.

- **10-level campaign** across six biomes (meadow, autumn woods, desert, snow,
  fen and volcanic caldera), 10 to 25 waves each, with two boss types.
- **6 towers, 3 tiers each**: Bolt Turret, Ember Cannon, Rime Spire, Storm Coil,
  Siege Mortar and Cinder Brazier. Each has its own role: anti-air, splash,
  slow, armor-piercing chains, long-range artillery, area burn.
- **10 enemy types** with distinct mechanics: armor, regenerating shields,
  healers, fliers, units that split on death, and two bosses.
- **Targeting modes** per tower (first, last, strongest, closest), selling,
  early-wave bonuses, 1×/2×/3× speed.
- **Three difficulties**, star ratings, and a **War Council** of ten perks
  bought with stars (refundable at any time).
- **Endless Siege** on any cleared map, with its own escalating roster.
- **Codex** of towers and enemies, an in-game tutorial on the first level,
  and a live bot-played battle behind the title screen.
- All models are built from primitives in code, all sound effects and music
  are synthesised at runtime with the Web Audio API, and icons are
  hand-written SVG. No external assets, no network calls, no API keys.

A full campaign run takes well over an hour on Normal; the automated
playthrough below covers about 110 minutes of game time with an efficient bot
that calls every wave early.

## Running

Requires Node.js 18 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
```

Production build:

```sh
npm run build      # outputs dist/
npm run preview    # serves dist/ on http://localhost:4173
```

`dist/` is a static site and can be hosted anywhere. Progress is saved to the
browser's localStorage.

## Controls

| Input | Action |
| --- | --- |
| Left click | Build the chosen tower / select a tower |
| 1 – 6 | Choose a tower to build |
| Shift + click | Keep building the same tower |
| Right drag | Rotate the camera |
| Wheel / pinch | Zoom |
| Middle drag, WASD, arrow keys | Pan |
| Space | Send the next wave (early calls pay a bonus) |
| U / X / T | Upgrade / sell / cycle targeting of the selected tower |
| F | Cycle game speed |
| Esc / P | Cancel, deselect, pause |
| M | Mute |

Touch: tap to build or select, one-finger drag pans, two fingers zoom and
rotate.

## Project layout

```
src/
  sim/            deterministic rules engine (no rendering, runs in Node)
    data/         towers, enemies, levels, perks
    map.js        ASCII map parsing and enemy routes
    waves.js      seeded wave generator
    game.js       the game state machine (fixed 30 Hz ticks)
    bot.js        auto-player used by tests, the playthrough script and the title demo
  render/         Three.js scene: board, models, effects, camera
  audio/          Web Audio sound effects and generative music
  ui/             HUD and menu screens (plain DOM)
  assets/icons/   SVG icons
  save.js         localStorage persistence
  main.js         game loop, input and glue
tests/            Vitest suites
scripts/          headless campaign playthrough
```

The simulation is separate from rendering: the renderer reads game state and
consumes an event stream (`fire`, `impact`, `death`, `leak`, …) after each
update. This keeps the rules testable in Node and lets the same code drive
both the browser and the headless playthrough.

## Tests

```sh
npm test               # unit tests + bot plays every level on Normal
npm run playthrough    # per-level report: result, lives, kills, game time
npm run playthrough -- --difficulty heroic
npm run playthrough -- --endless
```

The campaign test fails if any level cannot be beaten on Normal, if the run
stalls, or if the whole campaign takes less than an hour of game time.

## License

MIT. See [LICENSE](LICENSE).
