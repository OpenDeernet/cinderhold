import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Game, TICK } from '../src/sim/game.js';
import { Bot } from '../src/sim/bot.js';
import { blankMap, customLevel, decodeMap, encodeMap, MAP_H, MAP_W, validateMap } from '../src/sim/mapcodec.js';

const withTile = (rows, c, r, ch) => rows.map((row, i) => (i === r ? row.slice(0, c) + ch + row.slice(c + 1) : row));

describe('validateMap', () => {
  it('accepts the blank map and every campaign map', () => {
    expect(validateMap(blankMap().rows).ok).toBe(true);
    for (const l of LEVELS) expect(validateMap(l.map).errors).toEqual([]);
  });

  it('rejects wrong sizes and unknown tiles', () => {
    expect(validateMap(['S#E']).ok).toBe(false);
    expect(validateMap(withTile(blankMap().rows, 3, 3, 'X')).errors[0]).toMatch(/Unknown/);
  });

  it('needs one Hold, 1-3 portals and a connected road', () => {
    const rows = blankMap().rows;
    expect(validateMap(withTile(rows, 17, 5, '#')).errors).toContain('Place exactly one Hold (E).');
    expect(validateMap(withTile(rows, 0, 5, '#')).errors).toContain('Place at least one portal (S).');
    const cut = withTile(rows, 8, 5, '.');
    expect(validateMap(cut).errors).toContain('Every portal needs a road to the Hold.');
    let many = rows;
    for (const r of [0, 2, 9, 11]) many = withTile(many, 0, r, 'S');
    expect(validateMap(many).errors).toContain('At most 3 portals.');
  });

  it('rejects roads that are too short and warns about unused road', () => {
    let rows = Array.from({ length: MAP_H }, () => '.'.repeat(MAP_W));
    rows = withTile(rows, 0, 0, 'S');
    for (let c = 1; c < 6; c++) rows = withTile(rows, c, 0, '#');
    rows = withTile(rows, 6, 0, 'E');
    expect(validateMap(rows).errors[0]).toMatch(/too short/);
    const spur = withTile(withTile(blankMap().rows, 5, 4, '#'), 5, 3, '#');
    const v = validateMap(spur);
    expect(v.ok).toBe(true);
    expect(v.warnings[0]).toMatch(/2 road tiles are never walked/);
  });

  it('needs room to build', () => {
    const rows = Array.from({ length: MAP_H }, (_, r) => (r === 5 ? `S${'#'.repeat(16)}E` : '~'.repeat(MAP_W)));
    expect(validateMap(rows).errors[0]).toMatch(/open tiles/);
  });
});

describe('share codes', () => {
  it('round-trip a map', () => {
    const m = { ...blankMap(), name: 'Twin Fords', theme: 'snow', tier: 'brutal', waves: 20, rows: LEVELS[6].map };
    const code = encodeMap(m);
    expect(code.startsWith('CH1.')).toBe(true);
    expect(code.length).toBeLessThan(200);
    expect(decodeMap(code)).toEqual(m);
  });

  it('clean up names and unknown settings', () => {
    const code = encodeMap({ ...blankMap(), name: '  <b>Fort|Ash</b>  ', theme: 'mars', waves: 99 });
    const m = decodeMap(code);
    expect(m.name).toBe('bFortAshb');
    expect(m.theme).toBe('meadow');
    expect(m.waves).toBe(15);
  });

  it('keeps supplementary letters intact at the name limit', () => {
    const name = 'A'.repeat(31) + '𐐀';
    expect(decodeMap(encodeMap({ ...blankMap(), name })).name).toBe(name);
    expect(decodeMap(encodeMap({ ...blankMap(), name: name + 'B' })).name).toBe(name);
  });

  it('reject garbage with a readable error', () => {
    expect(() => decodeMap('hello')).toThrow(/Not a Cinderhold map/);
    expect(() => decodeMap('CH1.!!!')).toThrow(/damaged/);
    expect(() => decodeMap(`CH1.${btoa('a|b|c|d|5.')}`)).toThrow(/damaged/);
  });

  it('refuse codes for unplayable maps', () => {
    const bad = encodeMap({ ...blankMap(), rows: withTile(blankMap().rows, 8, 5, '.') });
    expect(() => decodeMap(bad)).toThrow(/cannot be played/);
  });
});

describe('customLevel', () => {
  it('builds a level the bot can play to the end', () => {
    const m = { ...blankMap(), waves: 10, tier: 'gentle', rows: LEVELS[2].map };
    const { level, levelIdx } = customLevel(m, 'abc');
    expect(level.id).toBe('custom:abc');
    const game = new Game({ level, levelIdx });
    const bot = new Bot(game);
    while (!game.isOver() && game.time < 3600) {
      bot.update(TICK);
      game.update(TICK);
      game.events.length = 0;
    }
    expect(game.status).toBe('won');
  });

  it('adds a boss to long custom maps', () => {
    expect(customLevel({ ...blankMap(), waves: 25 }, 'x').level.bosses).toEqual([{ wave: 24, type: 'colossus' }]);
    expect(customLevel({ ...blankMap(), waves: 10 }, 'x').level.bosses).toEqual([]);
  });
});
