import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Game, TICK } from '../src/sim/game.js';
import { generateWave, waveSummary } from '../src/sim/waves.js';

const TEST_LEVEL = {
  id: 'test',
  name: 'Test',
  theme: 'meadow',
  startGold: 1000,
  lives: 20,
  waves: 2,
  towers: ['bolt', 'cannon', 'frost', 'tesla', 'mortar', 'ember'],
  pool: [{ type: 'grunt', from: 0 }],
  map: [
    '..........',
    'S########E',
    '..........',
  ],
};

function run(game, seconds) {
  for (let t = 0; t < seconds && !game.isOver(); t += TICK) game.update(TICK);
}

describe('economy', () => {
  it('refunds in full before the first wave and right after building', () => {
    const g = new Game({ level: TEST_LEVEL });
    const t = g.build('bolt', 2, 0);
    expect(g.sellValue(t)).toBe(50);
    g.callWave();
    expect(g.sellValue(t)).toBe(50);
    run(g, 6);
    expect(g.sellValue(t)).toBe(35);
    g.upgrade(t.id);
    expect(g.sellValue(t)).toBe(115);
  });

  it('charges for building and upgrading, refunds 70% on sale', () => {
    const g = new Game({ level: TEST_LEVEL });
    g.status = 'playing';
    g.time = 100;
    const t = g.build('bolt', 2, 0);
    g.time = 110;
    expect(t).toBeTruthy();
    expect(g.gold).toBe(950);
    expect(g.upgrade(t.id)).toBe(true);
    expect(g.gold).toBe(885);
    expect(t.tier).toBe(1);
    g.time = 120;
    expect(g.sell(t.id)).toBe(true);
    expect(g.gold).toBe(885 + Math.floor(115 * 0.7));
    expect(g.towers).toHaveLength(0);
  });

  it('refuses to build on roads, occupied tiles, out of bounds or without gold', () => {
    const g = new Game({ level: TEST_LEVEL });
    expect(g.build('bolt', 3, 1)).toBeNull();
    expect(g.build('bolt', 3, 0)).toBeTruthy();
    expect(g.build('cannon', 3, 0)).toBeNull();
    expect(g.build('bolt', -1, 0)).toBeNull();
    g.gold = 10;
    expect(g.build('bolt', 4, 0)).toBeNull();
  });

  it('applies perks', () => {
    const g = new Game({ level: TEST_LEVEL, perks: ['tools', 'salvage', 'purse', 'walls', 'overcharge'] });
    expect(g.gold).toBe(1050);
    expect(g.lives).toBe(25);
    expect(g.buildCost('bolt')).toBe(46);
    const t = g.build('tesla', 2, 0);
    expect(t.s.chains).toBe(4);
    g.status = 'playing';
    g.time = 60;
    const before = g.gold;
    g.sell(t.id);
    expect(g.gold - before).toBe(Math.floor(t.invested * 0.85));
  });

  it('applies range and burn perks', () => {
    const g = new Game({ level: TEST_LEVEL, perks: ['spyglass', 'kindling'] });
    expect(g.towerStats('bolt', 0).range).toBeCloseTo(3.24);
    expect(g.towerStats('ember', 0).burn).toBeCloseTo(12.5);
    expect(g.towerStats('ember', 0).range).toBeCloseTo(1.9 * 1.08);
  });

  it('pays a bonus for calling a wave early', () => {
    const g = new Game({ level: { ...TEST_LEVEL, waves: 3 } });
    g.build('tesla', 3, 0);
    g.build('tesla', 6, 2);
    g.callWave();
    for (let i = 0; i < 3000 && g.countdown === null; i++) g.update(TICK);
    expect(g.countdown).not.toBeNull();
    const gold = g.gold;
    const bonus = g.callWave();
    expect(bonus).toBeGreaterThan(0);
    expect(g.gold).toBe(gold + bonus);
  });
});

describe('combat', () => {
  it('kills enemies and pays bounties', () => {
    const g = new Game({ level: TEST_LEVEL });
    for (let c = 1; c < 9; c++) g.build('bolt', c, 0);
    g.callWave();
    run(g, 200);
    expect(g.status).toBe('won');
    expect(g.stats.kills).toBeGreaterThan(5);
    expect(g.stats.leaks).toBe(0);
    expect(g.lives).toBe(20);
    expect(g.stars()).toBe(3);
  });

  it('counts cleared waves even when they overlap', () => {
    const g = new Game({ level: { ...TEST_LEVEL, waves: 4 } });
    for (let c = 1; c < 9; c++) g.build('tesla', c, 0);
    g.callWave();
    g.callWave();
    g.callWave();
    expect(g.stats.wavesCleared).toBe(0);
    for (let i = 0; i < 9000 && g.countdown === null && !g.isOver(); i++) g.update(TICK);
    expect(g.stats.wavesCleared).toBe(3);
    g.callWave();
    run(g, 300);
    expect(g.status).toBe('won');
    expect(g.stats.wavesCleared).toBe(4);
  });

  it('loses lives when enemies reach the Hold and ends at zero', () => {
    const g = new Game({ level: { ...TEST_LEVEL, lives: 3 } });
    g.callWave();
    run(g, 200);
    expect(g.status).toBe('lost');
    expect(g.lives).toBe(0);
  });

  it('armor blunts physical damage but not energy damage', () => {
    const g = new Game({ level: TEST_LEVEL });
    const e = g.spawnEnemy('brute', 0, 1, 0);
    g.damage(e, 10, 'physical', null);
    expect(e.maxHp - e.hp).toBe(5);
    g.damage(e, 10, 'energy', null);
    expect(e.maxHp - e.hp).toBe(15);
    g.damage(e, 2, 'physical', null);
    expect(e.maxHp - e.hp).toBeCloseTo(15.4);
  });

  it('shields absorb damage first and regrow when left alone', () => {
    const g = new Game({ level: TEST_LEVEL });
    const e = g.spawnEnemy('warden', 0, 1, 0);
    g.damage(e, 50, 'energy', null);
    expect(e.shield).toBe(60);
    expect(e.hp).toBe(e.maxHp);
    g.status = 'playing';
    run(g, 5);
    expect(e.shield).toBeGreaterThan(60);
  });

  it('splitters burst into cinderlings', () => {
    const g = new Game({ level: TEST_LEVEL });
    const e = g.spawnEnemy('splitter', 0, 1, 0, 0, 3);
    g.damage(e, 1e6, 'energy', null);
    g.reap();
    expect(g.enemies.filter((x) => x.type === 'swarm')).toHaveLength(3);
  });

  it('menders heal wounded allies nearby', () => {
    const g = new Game({ level: TEST_LEVEL });
    const m = g.spawnEnemy('mender', 0, 1, 0, 0, 3);
    const hurt = g.spawnEnemy('grunt', 0, 1, 0, 0, 3.2);
    hurt.hp = 10;
    g.status = 'playing';
    run(g, 2);
    expect(hurt.hp).toBeGreaterThan(10);
    expect(m.dead).toBe(false);
  });

  it('cannons cannot hit fliers', () => {
    const g = new Game({ level: TEST_LEVEL });
    const t = g.build('cannon', 4, 0);
    const wisp = g.spawnEnemy('wisp', 0, 1, 0, 0, 4);
    expect(g.findTarget(t)).toBeNull();
    const bolt = g.build('bolt', 5, 0);
    expect(g.findTarget(bolt)).toBe(wisp);
  });

  it('mortars ignore enemies inside their minimum range', () => {
    const g = new Game({ level: TEST_LEVEL });
    const t = g.build('mortar', 4, 0);
    const close = g.spawnEnemy('grunt', 0, 1, 0, 0, 4.5);
    expect(g.findTarget(t)).toBeNull();
    close.d = 8;
    const far = g.spawnEnemy('grunt', 0, 1, 0, 0, 7.5);
    expect(g.findTarget(t)).toBe(far);
  });

  it('respects targeting modes', () => {
    const g = new Game({ level: TEST_LEVEL });
    const t = g.build('bolt', 4, 0);
    const back = g.spawnEnemy('grunt', 0, 1, 0, 0, 3);
    const front = g.spawnEnemy('grunt', 0, 1, 0, 0, 5);
    front.hp = 5;
    expect(g.findTarget(t)).toBe(front);
    g.cycleTargeting(t.id);
    expect(t.mode).toBe('last');
    expect(g.findTarget(t)).toBe(back);
    g.cycleTargeting(t.id);
    expect(g.findTarget(t)).toBe(back);
  });
});

describe('waves', () => {
  it('are deterministic', () => {
    const a = generateWave(LEVELS[3], 3, 7, 2);
    const b = generateWave(LEVELS[3], 3, 7, 2);
    expect(a).toEqual(b);
  });

  it('only use enemies the level has introduced', () => {
    for (const [idx, level] of LEVELS.entries()) {
      for (let w = 0; w < level.waves; w++) {
        const wave = generateWave(level, idx, w, 2);
        const allowed = new Set([
          ...level.pool.filter((p) => p.from <= w).map((p) => p.type),
          ...(level.bosses || []).filter((b) => b.wave === w).map((b) => b.type),
        ]);
        for (const { type } of waveSummary(wave)) expect(allowed.has(type), `${level.id} w${w} ${type}`).toBe(true);
      }
    }
  });

  it('place every boss on its wave', () => {
    const level = LEVELS.find((l) => l.id === 'cinderhold');
    const last = waveSummary(generateWave(level, 9, 24, 2)).map((s) => s.type);
    expect(last).toContain('colossus');
    expect(last).toContain('stormwing');
  });
});
