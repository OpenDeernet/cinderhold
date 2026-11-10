import { describe, expect, it } from 'vitest';
import { randomMap } from '../src/sim/mapgen.js';
import { MAP_H, MAP_W, validateMap } from '../src/sim/mapcodec.js';
import { parseMap } from '../src/sim/map.js';

describe('randomMap', () => {
  it('always produces a playable map', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const m = randomMap(seed);
      const v = validateMap(m.rows);
      expect(v.errors, `seed ${seed}`).toEqual([]);
      expect(v.warnings.filter((w) => w.includes('never walked')), `seed ${seed}`).toEqual([]);
      expect(m.rows).toHaveLength(MAP_H);
      expect(m.rows[0]).toHaveLength(MAP_W);
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    expect(randomMap(42)).toEqual(randomMap(42));
    const shapes = new Set();
    for (let seed = 1; seed <= 20; seed++) shapes.add(randomMap(seed).rows.join(''));
    expect(shapes.size).toBe(20);
  });

  it('makes roads long enough to defend', () => {
    for (let seed = 100; seed < 130; seed++) {
      const len = parseMap(randomMap(seed).rows).routes[0].length;
      expect(len).toBeGreaterThan(26);
    }
  });

  it('honours a requested biome', () => {
    expect(randomMap(7, { theme: 'snow' }).theme).toBe('snow');
  });
});
