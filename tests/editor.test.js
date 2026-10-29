import { describe, expect, it } from 'vitest';
import { lineCells } from '../src/ui/editor.js';

const key = (cells) => cells.map(({ c, r }) => `${c},${r}`).join(' ');

describe('lineCells', () => {
  it('fills straight runs', () => {
    expect(key(lineCells({ c: 2, r: 5 }, { c: 6, r: 5 }))).toBe('3,5 4,5 5,5 6,5');
    expect(key(lineCells({ c: 4, r: 4 }, { c: 4, r: 1 }))).toBe('4,3 4,2 4,1');
    expect(lineCells({ c: 1, r: 1 }, { c: 1, r: 1 })).toEqual([]);
  });

  it('keeps diagonals 4-connected so painted roads stay walkable', () => {
    const cells = [{ c: 0, r: 0 }, ...lineCells({ c: 0, r: 0 }, { c: 5, r: 3 })];
    for (let i = 1; i < cells.length; i++) {
      const d = Math.abs(cells[i].c - cells[i - 1].c) + Math.abs(cells[i].r - cells[i - 1].r);
      expect(d).toBe(1);
    }
    expect(cells.at(-1)).toEqual({ c: 5, r: 3 });
    expect(cells).toHaveLength(9);
  });
});
