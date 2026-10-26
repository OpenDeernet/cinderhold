// Achievements ("feats"). Each check receives a context describing what just
// happened and returns true once the feat is earned.
//
// ctx: { event, game, save, battle } where battle holds per-battle counters
// kept by main.js (early calls, peak tower count).

export const FEATS = [
  { id: 'first', name: 'First Light', blurb: 'Win your first battle.', check: (c) => c.event === 'won' },
  {
    id: 'flawless', name: 'Not One Step', blurb: 'Win a campaign battle without a single leak.',
    check: (c) => c.event === 'won' && !c.game.endless && c.game.stats.leaks === 0,
  },
  { id: 'heroic', name: 'Heroic', blurb: 'Win any battle on Heroic.', check: (c) => c.event === 'won' && c.game.difficulty === 'heroic' },
  {
    id: 'campaign', name: 'Ash Breaker', blurb: 'Win the final battle at Cinderhold.',
    check: (c) => c.event === 'won' && c.game.level.id === 'cinderhold' && !c.game.endless,
  },
  { id: 'colossus', name: 'Giant Killer', blurb: 'Bring down an Ashen Colossus.', check: (c) => c.event === 'death' && c.enemy?.type === 'colossus' },
  { id: 'stormwing', name: 'Clear Skies', blurb: 'Bring down a Stormwing.', check: (c) => c.event === 'death' && c.enemy?.type === 'stormwing' },
  { id: 'maxed', name: 'Master Builder', blurb: 'Upgrade a tower to its third tier.', check: (c) => c.event === 'upgrade' && c.tower?.tier === 2 },
  { id: 'architect', name: 'Architect', blurb: 'Have 30 towers standing at once.', check: (c) => c.game.towers.length >= 30 },
  {
    id: 'frugal', name: 'Frugal', blurb: 'Win a campaign battle having built no more than 8 towers.',
    check: (c) => c.event === 'won' && !c.game.endless && c.game.stats.built <= 8,
  },
  { id: 'bugler', name: 'Impatient', blurb: 'Call 10 waves early in one battle.', check: (c) => c.battle.earlyCalls >= 10 },
  { id: 'endless20', name: 'Long Watch', blurb: 'Clear wave 20 in Endless Siege.', check: (c) => c.game.endless && c.game.stats.wavesCleared >= 20 },
  { id: 'endless40', name: 'Eternal Watch', blurb: 'Clear wave 40 in Endless Siege.', check: (c) => c.game.endless && c.game.stats.wavesCleared >= 40 },
  { id: 'stars', name: 'Constellation', blurb: 'Earn all 30 stars.', check: (c) => c.save.starsEarned() >= 30 },
  { id: 'veteran', name: 'Veteran', blurb: 'Slay 10,000 enemies in total.', check: (c) => c.save.data.totals.kills >= 10000 },
];

// Returns the feats newly earned by this context and records them.
export function checkFeats(ctx) {
  const earned = [];
  for (const f of FEATS) {
    if (ctx.save.hasFeat(f.id)) continue;
    let ok = false;
    try {
      ok = f.check(ctx);
    } catch {
      ok = false;
    }
    if (ok && ctx.save.addFeat(f.id)) earned.push(f);
  }
  return earned;
}
