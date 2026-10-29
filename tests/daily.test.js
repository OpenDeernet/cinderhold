import { beforeEach, describe, expect, it } from 'vitest';
import { MODIFIERS } from '../src/sim/data/modifiers.js';
import { dailyTrial, dateKey, streak } from '../src/sim/daily.js';
import { Game, TICK } from '../src/sim/game.js';
import { Bot } from '../src/sim/bot.js';
import { Save } from '../src/save.js';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
});

describe('daily trial', () => {
  it('is the same for the same date and differs across dates', () => {
    expect(dailyTrial('2026-10-29')).toEqual(dailyTrial('2026-10-29'));
    const seen = new Set();
    for (let d = 1; d <= 28; d++) seen.add(JSON.stringify(dailyTrial(`2026-02-${String(d).padStart(2, '0')}`).modifiers));
    expect(seen.size).toBeGreaterThan(10);
  });

  it('picks two distinct modifiers that do not clash', () => {
    for (let d = 1; d <= 60; d++) {
      const date = dateKey(new Date(2026, 0, d));
      const { modifiers, level } = dailyTrial(date);
      expect(modifiers).toHaveLength(2);
      expect(new Set(modifiers).size).toBe(2);
      const [a, b] = modifiers.map((id) => MODIFIERS.find((m) => m.id === id));
      expect(a.clash || []).not.toContain(b.id);
      expect(level.waves).toBeLessThanOrEqual(15);
      expect(level.bosses.every((x) => x.wave < level.waves)).toBe(true);
    }
  });

  it('formats dates as local YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('can be won by the bot on a typical day', () => {
    const t = dailyTrial('2026-10-29');
    const g = new Game({ level: t.level, levelIdx: t.levelIdx, modifiers: t.modifiers });
    const bot = new Bot(g);
    while (!g.isOver() && g.time < 3600) {
      bot.update(TICK);
      g.update(TICK);
      g.events.length = 0;
    }
    expect(g.isOver()).toBe(true);
  });
});

describe('daily results', () => {
  it('keep the best attempt and count attempts', () => {
    const s = new Save();
    expect(s.recordDaily('2026-10-29', { won: false, lives: 0, maxLives: 20, wavesCleared: 6 })).toBe(true);
    expect(s.recordDaily('2026-10-29', { won: false, lives: 0, maxLives: 20, wavesCleared: 4 })).toBe(false);
    expect(s.recordDaily('2026-10-29', { won: true, lives: 7, maxLives: 20, wavesCleared: 15 })).toBe(true);
    expect(s.dailyResult('2026-10-29')).toEqual({ won: true, lives: 7, maxLives: 20, wavesCleared: 15, attempts: 3 });
  });

  it('count a streak of won days', () => {
    const r = { '2026-10-27': { won: true }, '2026-10-28': { won: true }, '2026-10-26': { won: false } };
    expect(streak(r, '2026-10-29')).toBe(2);
    expect(streak({ ...r, '2026-10-29': { won: true } }, '2026-10-29')).toBe(3);
    expect(streak(r, '2026-10-31')).toBe(0);
  });

  it('forget trials older than two months', () => {
    const s = new Save();
    for (let d = 0; d < 70; d++) s.recordDaily(dateKey(new Date(2026, 0, 1 + d)), { won: true, lives: 1, maxLives: 20, wavesCleared: 15 });
    expect(Object.keys(s.data.daily)).toHaveLength(60);
  });
});
