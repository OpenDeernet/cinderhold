import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { ENEMIES } from '../src/sim/data/enemies.js';
import { ENDLESS_POOL, generateWave, waveSummary } from '../src/sim/waves.js';
import { Game } from '../src/sim/game.js';

describe('endless waves', () => {
  it('use the endless roster regardless of map', () => {
    const level = LEVELS[0];
    const types = new Set();
    for (let w = 0; w < 30; w++) for (const { type } of waveSummary(generateWave(level, 0, w, 1, { endless: true }))) types.add(type);
    for (const p of ENDLESS_POOL) expect(types.has(p.type), p.type).toBe(true);
  });

  it('bring a boss every tenth wave, alternating', () => {
    const bosses = [];
    for (let w = 0; w < 40; w++) {
      const boss = waveSummary(generateWave(LEVELS[2], 2, w, 1, { endless: true })).find((s) => ENEMIES[s.type].boss);
      if (boss) bosses.push(`${w}:${boss.type}`);
    }
    expect(bosses).toEqual(['9:colossus', '19:stormwing', '29:colossus', '39:stormwing']);
  });

  it('stop growing in size but keep growing in health', () => {
    // Head count depends on the mix (one brute vs. a cloud of cinderlings),
    // so compare total threat, ignoring bosses.
    const threat = (w) => generateWave(LEVELS[0], 0, w, 1, { endless: true }).groups
      .filter((g) => !ENEMIES[g.type].boss)
      .reduce((n, g) => n + g.count * ENEMIES[g.type].threat, 0);
    const hp = (w) => generateWave(LEVELS[0], 0, w, 1, { endless: true }).hpScale;
    expect(threat(61)).toBeLessThan(threat(31) * 1.25);
    expect(hp(60)).toBeGreaterThan(hp(30) * 4);
  });

  it('allow every tower and never end in victory', () => {
    const g = new Game({ level: LEVELS[0], endless: true });
    expect(g.towerAllowed('mortar')).toBe(true);
    expect(g.totalWaves).toBe(Infinity);
    expect(g.nextWave()).not.toBeNull();
  });
});
