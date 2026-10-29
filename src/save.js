import { LEVELS } from './sim/data/levels.js';
import { PERKS } from './sim/data/perks.js';

const KEY = 'cinderhold.save.v1';
const MAX_CUSTOM_MAPS = 40;

export const DEFAULT_SETTINGS = {
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  muted: false,
  quality: 'high',
  showFps: false,
  reduceMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

function fresh() {
  return {
    version: 1,
    levels: {}, // id -> { stars, heroic, bestEndless, wins }
    perks: [],
    seen: [], // enemy types already introduced to the player
    tutorialDone: false,
    difficulty: 'normal',
    settings: { ...DEFAULT_SETTINGS },
    playSeconds: 0,
    feats: [],
    daily: {}, // date -> { won, lives, maxLives, wavesCleared, attempts }
    customMaps: [], // { id, name, theme, tier, waves, rows, updated, wins }
    totals: { kills: 0, built: 0, battles: 0, wins: 0, byType: {} },
  };
}

// Progress lives in localStorage. Storage can be unavailable (private mode,
// blocked cookies); the game then simply runs without persistence.
export class Save {
  constructor() {
    this.data = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) {
          const base = fresh();
          this.data = {
            ...base,
            ...parsed,
            settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
            totals: { ...base.totals, ...parsed.totals },
          };
        }
      }
    } catch {
      // ignore: start fresh
    }
    // Drop perks that no longer exist or no longer fit the star budget.
    this.data.perks = this.data.perks.filter((id) => PERKS.some((p) => p.id === id));
    while (this.starsSpent() > this.starsEarned()) this.data.perks.pop();
  }

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // ignore
    }
  }

  get settings() {
    return this.data.settings;
  }

  level(id) {
    return this.data.levels[id] || { stars: 0, heroic: false, bestEndless: 0, wins: 0 };
  }

  isUnlocked(idx) {
    if (idx === 0) return true;
    return this.level(LEVELS[idx - 1].id).stars > 0;
  }

  endlessUnlocked() {
    return this.level(LEVELS[2].id).stars > 0;
  }

  campaignDone() {
    return this.level(LEVELS[LEVELS.length - 1].id).stars > 0;
  }

  starsEarned() {
    return LEVELS.reduce((sum, l) => sum + this.level(l.id).stars, 0);
  }

  starsSpent() {
    return this.data.perks.reduce((sum, id) => sum + (PERKS.find((p) => p.id === id)?.cost || 0), 0);
  }

  starsFree() {
    return this.starsEarned() - this.starsSpent();
  }

  hasPerk(id) {
    return this.data.perks.includes(id);
  }

  togglePerk(id) {
    const perk = PERKS.find((p) => p.id === id);
    if (!perk) return false;
    if (this.hasPerk(id)) {
      this.data.perks = this.data.perks.filter((p) => p !== id);
    } else {
      if (this.starsFree() < perk.cost) return false;
      this.data.perks.push(id);
    }
    this.persist();
    return true;
  }

  // Records a finished campaign battle. Returns what changed for the UI.
  recordWin(id, stars, difficulty, time) {
    const prev = this.level(id);
    const next = { ...prev, wins: (prev.wins || 0) + 1 };
    if (time && (!prev.bestTime || time < prev.bestTime)) next.bestTime = time;
    next.stars = Math.max(prev.stars, stars);
    if (difficulty === 'heroic') next.heroic = true;
    this.data.levels[id] = next;
    this.persist();
    return { newStars: next.stars - prev.stars, firstWin: prev.stars === 0, heroic: difficulty === 'heroic' && !prev.heroic };
  }

  recordEndless(id, wave) {
    const prev = this.level(id);
    const best = Math.max(prev.bestEndless || 0, wave);
    this.data.levels[id] = { ...prev, bestEndless: best };
    this.persist();
    return best > (prev.bestEndless || 0);
  }

  markSeen(type) {
    if (this.data.seen.includes(type)) return false;
    this.data.seen.push(type);
    this.persist();
    return true;
  }

  hasFeat(id) {
    return this.data.feats.includes(id);
  }

  addFeat(id) {
    if (this.hasFeat(id)) return false;
    this.data.feats.push(id);
    this.persist();
    return true;
  }

  // Adds a finished battle's numbers to the lifetime totals.
  addTotals(stats, won) {
    const t = this.data.totals;
    t.kills += stats.kills;
    t.byType = t.byType || {};
    for (const [type, n] of Object.entries(stats.killsByType || {})) t.byType[type] = (t.byType[type] || 0) + n;
    t.built += stats.built;
    t.battles += 1;
    if (won) t.wins += 1;
  }

  addPlayTime(sec) {
    this.data.playSeconds += sec;
  }

  // ---------------------------------------------------------------- daily trial

  dailyResult(date) {
    return this.data.daily[date] || null;
  }

  // Keeps the best attempt for the day: a win beats a loss, more lives or
  // more waves beat fewer.
  recordDaily(date, { won, lives, maxLives, wavesCleared }) {
    const prev = this.data.daily[date];
    const attempts = (prev?.attempts || 0) + 1;
    const better = !prev || (won && !prev.won) || (won === prev.won && (won ? lives > prev.lives : wavesCleared > prev.wavesCleared));
    this.data.daily[date] = better ? { won, lives, maxLives, wavesCleared, attempts } : { ...prev, attempts };
    // Old trials are only needed for the streak; keep two months.
    const dates = Object.keys(this.data.daily).sort();
    for (const d of dates.slice(0, Math.max(0, dates.length - 60))) delete this.data.daily[d];
    this.persist();
    return better;
  }

  // ---------------------------------------------------------------- custom maps

  listMaps() {
    return [...this.data.customMaps].sort((a, b) => b.updated - a.updated);
  }

  getMap(id) {
    return this.data.customMaps.find((m) => m.id === id) || null;
  }

  // Inserts or updates a map; returns its id.
  saveMap(map) {
    const now = Date.now();
    const id = map.id || `m${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const entry = { ...this.getMap(id), ...map, id, rows: [...map.rows], updated: now };
    entry.wins = entry.wins || 0;
    this.data.customMaps = [...this.data.customMaps.filter((m) => m.id !== id), entry];
    if (this.data.customMaps.length > MAX_CUSTOM_MAPS) this.data.customMaps = this.listMaps().slice(0, MAX_CUSTOM_MAPS);
    this.persist();
    return id;
  }

  deleteMap(id) {
    this.data.customMaps = this.data.customMaps.filter((m) => m.id !== id);
    this.persist();
  }

  recordMapWin(id) {
    const m = this.getMap(id);
    if (!m) return;
    m.wins = (m.wins || 0) + 1;
    this.persist();
  }

  // Save transfer between browsers: a plain JSON string.
  exportString() {
    return JSON.stringify(this.data);
  }

  importString(str) {
    let parsed;
    try {
      parsed = JSON.parse(str);
    } catch {
      return false;
    }
    if (!parsed || parsed.version !== 1 || typeof parsed.levels !== 'object') return false;
    const base = fresh();
    this.data = {
      ...base,
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      totals: { ...base.totals, ...parsed.totals },
    };
    this.persist();
    return true;
  }

  reset() {
    const settings = this.data.settings;
    this.data = fresh();
    this.data.settings = settings;
    this.persist();
  }
}
