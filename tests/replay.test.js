import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Game, TICK } from '../src/sim/game.js';
import { Bot } from '../src/sim/bot.js';
import { dailyTrial } from '../src/sim/daily.js';
import { makeReplay, ReplayDriver, verifyReplay } from '../src/sim/replay.js';

function playWithBot(opts) {
  const game = new Game(opts);
  const bot = new Bot(game, { seed: 99, skill: 0.7 });
  while (!game.isOver() && game.time < 3600) {
    bot.update(TICK);
    game.update(TICK);
    game.events.length = 0;
  }
  return game;
}

describe('replays', () => {
  it('record every successful command with its tick', () => {
    const g = new Game({ level: LEVELS[0] });
    g.build('bolt', 4, 0);
    g.build('bolt', 1, 1); // road: refused, not recorded
    g.update(1);
    g.upgrade(g.towers[0].id);
    g.cycleTargeting(g.towers[0].id);
    g.callWave();
    expect(g.log.map((e) => e[1])).toEqual(['build', 'upgrade', 'target', 'wave']);
    expect(g.log[0][0]).toBe(0);
    expect(g.log[1][0]).toBe(12); // one update runs at most 12 ticks
  });

  for (const [name, opts] of [
    ['a campaign win', { level: LEVELS[3], levelIdx: 3 }],
    ['a heroic battle with perks', { level: LEVELS[5], levelIdx: 5, difficulty: 'heroic', perks: ['tools', 'darts', 'overcharge'] }],
    ['a daily trial', (() => { const t = dailyTrial('2026-11-10'); return { level: t.level, levelIdx: t.levelIdx, modifiers: t.modifiers }; })()],
  ]) {
    it(`reproduce ${name} exactly`, () => {
      const game = playWithBot(opts);
      const replay = makeReplay(game);
      expect(replay.log.length).toBeGreaterThan(10);
      const roundTrip = JSON.parse(JSON.stringify(replay));
      const v = verifyReplay(roundTrip);
      expect(v.failed).toBe(0);
      expect(v.got).toEqual(v.want);
      expect(v.ok).toBe(true);
    });
  }

  it('notice a tampered log', () => {
    const game = playWithBot({ level: LEVELS[1], levelIdx: 1 });
    const replay = makeReplay(game);
    replay.log = replay.log.filter((e) => e[1] !== 'upgrade');
    expect(verifyReplay(replay).ok).toBe(false);
  });

  it('drive a game tick by tick like the real loop', () => {
    const game = playWithBot({ level: LEVELS[0], levelIdx: 0 });
    const d = new ReplayDriver(makeReplay(game));
    while (!d.game.isOver()) d.game.update(0.25);
    expect(d.game.status).toBe(game.status);
    expect(d.game.stats.kills).toBe(game.stats.kills);
  });

  it('refuse unknown versions', () => {
    expect(() => new ReplayDriver({ v: 99 })).toThrow(/Unsupported/);
  });
});
