import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game.js';
import { coverageMap, sampleRoads, tileScore } from '../src/sim/coverage.js';

const LEVEL = {
  id: 'cov', name: 'Cov', theme: 'meadow', startGold: 2000, lives: 20, waves: 1,
  towers: ['bolt', 'mortar', 'banner'],
  pool: [{ type: 'grunt', from: 0 }],
  map: [
    '..........',
    'S########E',
    '..........',
    '..........',
    '..........',
    '..........',
  ],
};

describe('coverage', () => {
  it('samples every half tile along the road', () => {
    const g = new Game({ level: LEVEL });
    expect(sampleRoads(g.map)).toHaveLength(Math.ceil(g.map.routes[0].length / 0.5));
  });

  it('scores tiles next to the road above tiles far from it', () => {
    const g = new Game({ level: LEVEL });
    const s = sampleRoads(g.map);
    expect(tileScore(g, s, 'bolt', 4, 2)).toBeGreaterThan(tileScore(g, s, 'bolt', 4, 5));
    expect(tileScore(g, s, 'bolt', 4, 2)).toBeGreaterThan(tileScore(g, s, 'bolt', 0, 5));
  });

  it('respects a mortar minimum range', () => {
    const g = new Game({ level: LEVEL });
    const s = sampleRoads(g.map);
    // Right next to the road a mortar loses the stretch inside its min range.
    expect(tileScore(g, s, 'mortar', 4, 3)).toBeGreaterThan(tileScore(g, s, 'mortar', 4, 2));
  });

  it('scores banners by the towers they would cover', () => {
    const g = new Game({ level: LEVEL });
    const s = sampleRoads(g.map);
    expect(tileScore(g, s, 'banner', 4, 3)).toBe(0);
    g.build('bolt', 4, 2);
    g.build('bolt', 5, 2);
    expect(tileScore(g, s, 'banner', 4, 3)).toBe(80);
  });

  it('builds a normalised map with unbuildable tiles marked', () => {
    const g = new Game({ level: LEVEL });
    g.build('bolt', 2, 0);
    const { scores, best } = coverageMap(g, 'bolt');
    expect(best).toBeGreaterThan(0);
    expect(scores[1 * 10 + 3]).toBe(-1); // road
    expect(scores[0 * 10 + 2]).toBe(-1); // occupied
    expect(Math.max(...scores)).toBe(1);
  });
});
