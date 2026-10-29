import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { MODIFIERS } from '../src/sim/data/modifiers.js';
import { Game, TICK } from '../src/sim/game.js';
import { generateWave, waveSummary } from '../src/sim/waves.js';

const LEVEL = {
  id: 'mods', name: 'Mods', theme: 'meadow', startGold: 500, lives: 20, waves: 3,
  towers: ['bolt', 'cannon', 'frost', 'tesla', 'mortar', 'ember'],
  pool: [{ type: 'grunt', from: 0 }],
  map: ['..........', 'S########E', '..........'],
};

const game = (modifiers) => new Game({ level: LEVEL, modifiers });

describe('modifiers', () => {
  it('all have names and blurbs, and clashes are symmetric', () => {
    for (const m of MODIFIERS) {
      expect(m.name && m.blurb).toBeTruthy();
      for (const c of m.clash || []) expect(MODIFIERS.find((x) => x.id === c).clash).toContain(m.id);
    }
  });

  it('change enemy speed, armor and health', () => {
    const plain = game([]).spawnEnemy('grunt', 0, 1, 0);
    expect(game(['swift']).spawnEnemy('grunt', 0, 1, 0).speed).toBeCloseTo(plain.speed * 1.2);
    expect(game(['ironclad']).spawnEnemy('grunt', 0, 1, 0).armor).toBe(3);
    expect(game(['stubborn']).spawnEnemy('grunt', 0, 1, 0).maxHp).toBe(Math.round(plain.maxHp * 1.4));
  });

  it('change the economy', () => {
    expect(game(['lean']).gold).toBe(650);
    expect(game(['dear']).buildCost('bolt')).toBe(57);
    expect(game(['lean']).bountyMod()).toBeCloseTo(0.65);
    expect(game(['stubborn']).bountyMod()).toBeCloseTo(1.2);
  });

  it('cap the Hold at 8 lives with Fragile Walls', () => {
    expect(game(['fragile']).maxLives).toBe(8);
  });

  it('forbid selling once the battle starts with No Retreat', () => {
    const g = game(['nosell']);
    const t = g.build('bolt', 2, 0);
    expect(g.canSell()).toBe(true);
    g.callWave();
    expect(g.canSell()).toBe(false);
    expect(g.sell(t.id)).toBe(false);
    expect(g.towers).toHaveLength(1);
  });

  it('add wisps and pack waves tighter', () => {
    const level = LEVELS[0];
    const plain = generateWave(level, 0, 2, 1);
    const sky = generateWave(level, 0, 2, 1, { modifiers: new Set(['skyborne']) });
    expect(waveSummary(plain).some((s) => s.type === 'wisp')).toBe(false);
    expect(waveSummary(sky).some((s) => s.type === 'wisp')).toBe(true);
    const frenzy = generateWave(level, 0, 2, 1, { modifiers: new Set(['frenzy']) });
    expect(frenzy.groups[0].interval).toBeCloseTo(plain.groups[0].interval / 2);
  });

  it('still produce a game that runs to the end', () => {
    const g = game(MODIFIERS.map((m) => m.id).filter((id) => id !== 'ironclad' && id !== 'dear'));
    for (let c = 1; c < 9; c++) g.build('tesla', c, 0);
    g.callWave();
    for (let i = 0; i < 30000 && !g.isOver(); i++) g.update(TICK);
    expect(g.isOver()).toBe(true);
  });
});
