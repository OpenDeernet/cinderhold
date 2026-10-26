# Balance notes

Balance is checked with the built-in bot rather than by feel alone. The bot
places towers on the tiles that cover the most road, builds a fixed rotation
of tower types and upgrades once it has enough towers. It never sells, never
changes targeting and spends gold the moment it has it, so it is efficient
but not clever. "Skill" only widens how many candidate tiles it picks from at
random (1 = always the best tile, 0.3 = any of the best ~7).

Rules of thumb used when tuning:

- Every level must be beatable on Normal by every bot skill. `npm test`
  enforces this for the skill-1 bot.
- A real player spends less efficiently than the bot, so Normal should cost
  the bot a few lives on the later maps, not nothing.
- Heroic should be won by the bot, but with lives lost, on most maps.
- The final level should be the hardest on every difficulty.

## Knobs

| Where | What |
| --- | --- |
| `waves.js` `waveBudget` | threat points per wave, by wave and level |
| `waves.js` `hpScale` | enemy health multiplier, by wave and level |
| `game.js` `DIFFICULTY` | health, wave size, lives and bounty per difficulty |
| `levels.js` `threat` | per-level wave size multiplier (long roads) |
| `levels.js` `startGold` | opening economy |
| `game.js` `spawnEnemy` | bosses scale with `hpScale ^ 0.6` |

## Current sweep

`npm run balance -- --seeds 3` (won % / average lives left when won):

```

CASUAL
level       skill 1         skill 0.6       skill 0.3       
greenreach  100% won 100%hp 100% won 100%hp 100% won 100%hp 
millbrook   100% won 100%hp 100% won 100%hp 100% won 100%hp 
amberwood   100% won 100%hp 100% won 100%hp 100% won 100%hp 
dunewatch   100% won 100%hp 100% won 100%hp 100% won 100%hp 
glasswater  100% won 100%hp 100% won 100%hp 100% won 100%hp 
frostmere   100% won 100%hp 100% won 100%hp 100% won 100%hp 
whitecrown  100% won 100%hp 100% won 100%hp 100% won 100%hp 
mirefen     100% won 100%hp 100% won  98%hp 100% won 100%hp 
caldera     100% won 100%hp 100% won 100%hp 100% won 100%hp 
cinderhold  100% won 100%hp 100% won 100%hp 100% won 100%hp 

NORMAL
level       skill 1         skill 0.6       skill 0.3       
greenreach  100% won 100%hp 100% won 100%hp 100% won 100%hp 
millbrook   100% won 100%hp 100% won 100%hp 100% won 100%hp 
amberwood   100% won 100%hp 100% won 100%hp 100% won 100%hp 
dunewatch   100% won 100%hp 100% won  93%hp 100% won  97%hp 
glasswater  100% won 100%hp 100% won  78%hp 100% won  85%hp 
frostmere   100% won  90%hp 100% won 100%hp 100% won  97%hp 
whitecrown  100% won 100%hp 100% won  97%hp 100% won  88%hp 
mirefen     100% won  90%hp 100% won  77%hp 100% won  80%hp 
caldera     100% won  95%hp 100% won  98%hp 100% won  97%hp 
cinderhold  100% won  90%hp 100% won  90%hp 100% won  82%hp 

HEROIC
level       skill 1         skill 0.6       skill 0.3       
greenreach  100% won 100%hp 100% won 100%hp 100% won 100%hp 
millbrook   100% won 100%hp 100% won  90%hp 100% won 100%hp 
amberwood   100% won 100%hp 100% won 100%hp 100% won 100%hp 
dunewatch   100% won  80%hp 100% won  63%hp  67% won  75%hp 
glasswater  100% won  60%hp  33% won  40%hp  33% won  30%hp 
frostmere   100% won  40%hp 100% won  87%hp 100% won  67%hp 
whitecrown  100% won 100%hp 100% won  50%hp  67% won  30%hp 
mirefen     100% won 100%hp 100% won  60%hp 100% won  67%hp 
caldera     100% won  50%hp 100% won  93%hp 100% won  90%hp 
cinderhold  100% won  80%hp 100% won  80%hp 100% won  63%hp 
```

Known soft spots: the first three maps are easy on every difficulty, which
is intended for the tutorial stretch, and Glasswater Flats on Heroic is the
hardest map for a careless player because fliers arrive before most players
have anti-air in place.
