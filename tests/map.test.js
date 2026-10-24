import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { isRoad, parseMap, routePos, TILE } from '../src/sim/map.js';

describe('parseMap', () => {
  it('finds spawn, exit and the route between them', () => {
    const m = parseMap(['S##.', '..#.', '..##', '...E']);
    expect(m.spawns).toEqual([{ c: 0, r: 0 }]);
    expect(m.exit).toEqual({ c: 3, r: 3 });
    expect(m.routes).toHaveLength(1);
    expect(m.routes[0].cells.map(({ c, r }) => `${c},${r}`)).toEqual(['0,0', '1,0', '2,0', '2,1', '2,2', '3,2', '3,3']);
  });

  it('rejects ragged rows, unknown characters and disconnected spawns', () => {
    expect(() => parseMap(['S#E', '..'])).toThrow(/width/);
    expect(() => parseMap(['S#?E'])).toThrow(/unknown/);
    expect(() => parseMap(['S.#E'])).toThrow(/no road/);
    expect(() => parseMap(['S##.'])).toThrow(/no exit/);
  });

  it('interpolates positions along a route', () => {
    const m = parseMap(['S##E']);
    const route = m.routes[0];
    // The route starts half a tile before the spawn.
    expect(route.points[0]).toEqual({ x: 0, y: 0.5 });
    expect(route.length).toBeCloseTo(3.5);
    const p = routePos(route, 1.75);
    expect(p.x).toBeCloseTo(1.75);
    expect(p.y).toBeCloseTo(0.5);
    expect(routePos(route, 99).x).toBeCloseTo(3.5);
    expect(routePos(route, -1).x).toBeCloseTo(0);
  });
});

describe('campaign maps', () => {
  for (const level of LEVELS) {
    it(`${level.id} is well formed and every road tile is walked`, () => {
      const m = parseMap(level.map);
      const used = new Set();
      for (const route of m.routes) for (const { c, r } of route.cells) used.add(r * m.w + c);
      let roads = 0;
      let ground = 0;
      for (let r = 0; r < m.h; r++) {
        for (let c = 0; c < m.w; c++) {
          if (isRoad(m.tiles[r][c])) {
            roads++;
            expect(used.has(r * m.w + c), `road ${c},${r} unused`).toBe(true);
          }
          if (m.tiles[r][c] === TILE.GROUND) ground++;
        }
      }
      expect(roads).toBe(used.size);
      expect(ground).toBeGreaterThan(80);
      for (const route of m.routes) expect(route.length).toBeGreaterThan(12);
    });
  }
});
