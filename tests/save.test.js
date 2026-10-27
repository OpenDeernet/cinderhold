import { beforeEach, describe, expect, it } from 'vitest';
import { LEVELS } from '../src/sim/data/levels.js';
import { Save } from '../src/save.js';

const KEY = 'cinderhold.save.v1';

function mockStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

describe('Save', () => {
  let store;
  beforeEach(() => {
    store = mockStorage();
  });

  it('starts fresh with only the first level unlocked', () => {
    const s = new Save();
    expect(s.isUnlocked(0)).toBe(true);
    expect(s.isUnlocked(1)).toBe(false);
    expect(s.starsEarned()).toBe(0);
    expect(s.endlessUnlocked()).toBe(false);
  });

  it('records wins, keeps the best star count and unlocks the next level', () => {
    const s = new Save();
    const first = s.recordWin(LEVELS[0].id, 2, 'normal');
    expect(first).toEqual({ newStars: 2, firstWin: true, heroic: false });
    expect(s.isUnlocked(1)).toBe(true);
    const worse = s.recordWin(LEVELS[0].id, 1, 'normal');
    expect(worse.newStars).toBe(0);
    expect(s.level(LEVELS[0].id).stars).toBe(2);
    expect(s.level(LEVELS[0].id).wins).toBe(2);
    expect(s.recordWin(LEVELS[0].id, 3, 'heroic')).toEqual({ newStars: 1, firstWin: false, heroic: true });
  });

  it('persists across instances', () => {
    const a = new Save();
    a.recordWin(LEVELS[0].id, 3, 'normal');
    a.settings.music = 0.1;
    a.persist();
    const b = new Save();
    expect(b.level(LEVELS[0].id).stars).toBe(3);
    expect(b.settings.music).toBe(0.1);
  });

  it('only lets you adopt perks you can afford, and refunds them', () => {
    const s = new Save();
    expect(s.togglePerk('tools')).toBe(false);
    s.recordWin(LEVELS[0].id, 3, 'normal');
    expect(s.togglePerk('tools')).toBe(true);
    expect(s.starsFree()).toBe(0);
    expect(s.togglePerk('purse')).toBe(false);
    expect(s.togglePerk('tools')).toBe(true);
    expect(s.starsFree()).toBe(3);
    expect(s.togglePerk('nonsense')).toBe(false);
  });

  it('drops perks it no longer knows or can no longer afford', () => {
    store.set(KEY, JSON.stringify({ version: 1, perks: ['ghost', 'tools'], levels: { [LEVELS[0].id]: { stars: 2 } } }));
    const s = new Save();
    expect(s.data.perks).toEqual([]);
  });

  it('survives corrupt or unavailable storage', () => {
    store.set(KEY, '{not json');
    expect(new Save().starsEarned()).toBe(0);
    globalThis.localStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new Save();
    expect(() => s.recordWin(LEVELS[0].id, 3, 'normal')).not.toThrow();
  });

  it('keeps settings when progress is reset', () => {
    const s = new Save();
    s.recordWin(LEVELS[0].id, 3, 'normal');
    s.settings.quality = 'low';
    s.reset();
    expect(s.starsEarned()).toBe(0);
    expect(s.settings.quality).toBe('low');
  });

  it('exports and imports progress', () => {
    const a = new Save();
    a.recordWin(LEVELS[0].id, 3, 'normal');
    const text = a.exportString();
    a.reset();
    expect(a.starsEarned()).toBe(0);
    expect(a.importString(text)).toBe(true);
    expect(a.starsEarned()).toBe(3);
    expect(a.importString('garbage')).toBe(false);
    expect(a.importString('{"version":2}')).toBe(false);
    expect(a.starsEarned()).toBe(3);
  });

  it('remembers the best endless wave', () => {
    const s = new Save();
    expect(s.recordEndless(LEVELS[0].id, 12)).toBe(true);
    expect(s.recordEndless(LEVELS[0].id, 8)).toBe(false);
    expect(s.level(LEVELS[0].id).bestEndless).toBe(12);
  });
});
