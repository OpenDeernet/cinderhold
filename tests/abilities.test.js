import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { ABILITIES, chestGold, meteorDamage } from '../src/sim/data/abilities.js';
import { Game, TICK } from '../src/sim/game.js';
import { makeReplay, verifyReplay } from '../src/sim/replay.js';

const LEVEL = {
  id: 'abil', name: 'Abil', theme: 'meadow', startGold: 500, lives: 20, waves: 3,
  towers: ['bolt'], pool: [{ type: 'grunt', from: 0 }],
  map: ['..........', 'S########E', '..........'],
};

function run(g, s) {
  for (let t = 0; t < s && !g.isOver(); t += TICK) g.update(TICK);
}

describe('abilities', () => {
  it('unlock through the campaign and are all open elsewhere', () => {
    expect(new Game({ level: LEVELS[0], levelIdx: 0 }).abilityAllowed('meteor')).toBe(false);
    expect(new Game({ level: LEVELS[2], levelIdx: 2 }).abilityAllowed('meteor')).toBe(true);
    expect(new Game({ level: LEVELS[2], levelIdx: 2 }).abilityAllowed('nova')).toBe(false);
    expect(new Game({ level: LEVELS[9], levelIdx: 9 }).abilityAllowed('chest')).toBe(true);
    expect(new Game({ level: LEVELS[0], levelIdx: 0, endless: true }).abilityAllowed('chest')).toBe(true);
    expect(new Game({ level: { ...LEVEL, id: 'custom:x' } }).abilityAllowed('nova')).toBe(true);
  });

  it('only work during a battle and then go on cooldown', () => {
    const g = new Game({ level: LEVEL });
    expect(g.cast('chest')).toBe(false);
    g.callWave();
    const gold = g.gold;
    expect(g.cast('chest')).toBe(true);
    expect(g.gold).toBe(gold + chestGold(1));
    expect(g.cast('chest')).toBe(false);
    expect(g.abilityReadyIn('chest')).toBeCloseTo(ABILITIES.chest.cooldown);
    run(g, 5);
    expect(g.abilityReadyIn('chest')).toBeCloseTo(ABILITIES.chest.cooldown - 5, 0);
  });

  it('drop a meteor after a short delay on ground enemies in range', () => {
    const g = new Game({ level: LEVEL });
    g.callWave();
    const near = g.spawnEnemy('brute', 0, 1, 0, 0, 5);
    const far = g.spawnEnemy('brute', 0, 1, 0, 0, 9);
    const air = g.spawnEnemy('wisp', 0, 1, 0, 0, 5);
    for (const e of [near, far, air]) e.speed = 0;
    expect(g.cast('meteor', near.x, near.y)).toBe(true);
    expect(near.hp).toBe(near.maxHp);
    run(g, 1);
    expect(near.maxHp - near.hp).toBeCloseTo(meteorDamage(1));
    expect(far.hp).toBe(far.maxHp);
    expect(air.hp).toBe(air.maxHp);
  });

  it('slow everything with a frost nova, bosses less', () => {
    const g = new Game({ level: LEVEL });
    g.callWave();
    const grunt = g.spawnEnemy('grunt', 0, 1, 0, 0, 3);
    const boss = g.spawnEnemy('colossus', 0, 1, 0, 0, 2);
    g.cast('nova');
    expect(grunt.slowMul).toBeCloseTo(0.45);
    expect(boss.slowMul).toBeGreaterThan(0.45);
    expect(boss.slowMul).toBeLessThan(1);
  });

  it('are recorded and replay exactly', () => {
    const g = new Game({ level: { ...LEVEL, id: 'custom:r' } });
    g.build('bolt', 4, 0);
    g.callWave();
    run(g, 3);
    g.cast('meteor', 4.5, 1.5);
    g.cast('nova');
    run(g, 2);
    g.cast('chest');
    while (!g.isOver()) {
      g.update(TICK);
      if (g.countdown !== null) g.callWave();
    }
    const v = verifyReplay(makeReplay(g));
    expect(v.failed).toBe(0);
    expect(v.ok).toBe(true);
  });
});
