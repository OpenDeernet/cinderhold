import { beforeEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Game } from '../src/sim/game.js';
import { Save } from '../src/save.js';
import { checkFeats, FEATS } from '../src/achievements.js';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
});

const ctx = (save, game, extra = {}) => ({ save, game, battle: { earlyCalls: 0 }, ...extra });

describe('feats', () => {
  it('have unique ids', () => {
    expect(new Set(FEATS.map((f) => f.id)).size).toBe(FEATS.length);
  });

  it('award a win once', () => {
    const save = new Save();
    const game = new Game({ level: LEVELS[0] });
    game.status = 'won';
    game.stats.leaks = 2;
    game.stats.built = 12;
    const got = checkFeats(ctx(save, game, { event: 'won' })).map((f) => f.id);
    expect(got).toEqual(['first']);
    expect(checkFeats(ctx(save, game, { event: 'won' }))).toEqual([]);
  });

  it('notice flawless, frugal and heroic wins', () => {
    const save = new Save();
    const game = new Game({ level: LEVELS[0], difficulty: 'heroic' });
    game.stats.built = 5;
    const got = checkFeats(ctx(save, game, { event: 'won' })).map((f) => f.id);
    expect(got).toEqual(expect.arrayContaining(['first', 'flawless', 'heroic', 'frugal']));
  });

  it('track boss kills and max upgrades from events', () => {
    const save = new Save();
    const game = new Game({ level: LEVELS[0] });
    expect(checkFeats(ctx(save, game, { event: 'death', enemy: { type: 'colossus' } })).map((f) => f.id)).toEqual(['colossus']);
    expect(checkFeats(ctx(save, game, { event: 'upgrade', tower: { tier: 1 } }))).toEqual([]);
    expect(checkFeats(ctx(save, game, { event: 'upgrade', tower: { tier: 2 } })).map((f) => f.id)).toEqual(['maxed']);
  });

  it('accumulate lifetime totals', () => {
    const save = new Save();
    save.addTotals({ kills: 6000, built: 10 }, true);
    save.addTotals({ kills: 4000, built: 3 }, false);
    expect(save.data.totals).toEqual({ kills: 10000, built: 13, battles: 2, wins: 1, byType: {} });
    save.addTotals({ kills: 3, built: 0, killsByType: { grunt: 2, wisp: 1 } }, false);
    save.addTotals({ kills: 1, built: 0, killsByType: { grunt: 1 } }, false);
    expect(save.data.totals.byType).toEqual({ grunt: 3, wisp: 1 });
    const game = new Game({ level: LEVELS[0] });
    expect(checkFeats(ctx(save, game, { event: 'tick' })).map((f) => f.id)).toEqual(['veteran']);
  });
});
