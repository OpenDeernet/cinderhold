import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Game, TICK } from '../src/sim/game.js';
import { Bot } from '../src/sim/bot.js';

// Plays every level with the bot. This is the balance and stability guard:
// every level must be beatable on Normal, and nothing may throw or stall.
function play(level, idx, opts = {}, limit = 3600) {
  const game = new Game({ level, levelIdx: idx, ...opts });
  const bot = new Bot(game);
  while (!game.isOver() && game.time < limit) {
    bot.update(TICK);
    game.update(TICK);
    game.drainEvents();
  }
  return game;
}

describe('campaign playthrough', () => {
  let total = 0;
  for (const [idx, level] of LEVELS.entries()) {
    it(`bot beats ${level.name} on Normal`, () => {
      const game = play(level, idx);
      expect(game.status).toBe('won');
      expect(game.stats.wavesCleared).toBe(level.waves);
      total += game.time;
      for (const e of game.enemies) expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
    });
  }

  it('lasts well over thirty minutes of game time', () => {
    expect(total).toBeGreaterThan(60 * 60);
  });

  it('endless mode keeps going and eventually ends', () => {
    const game = play(LEVELS[3], 3, { endless: true }, 3 * 3600);
    expect(game.status).toBe('lost');
    expect(game.waveIndex).toBeGreaterThan(20);
  });
});
