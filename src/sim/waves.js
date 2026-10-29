import { ENEMIES } from './data/enemies.js';
import { createRng, hashString } from './rng.js';

const SPAWN_INTERVAL = {
  grunt: 0.75,
  runner: 0.5,
  swarm: 0.22,
  brute: 1.5,
  wisp: 0.8,
  mender: 1.6,
  warden: 1.4,
  splitter: 1.4,
  colossus: 0,
  stormwing: 0,
};

// Per-wave threat budget. Grows roughly quadratically so that late waves
// demand upgraded defences, not just more of them.
export function waveBudget(w, levelIdx) {
  return (8 + 3 * w + 0.11 * w * w) * (1 + 0.1 * levelIdx);
}

// Hit point multiplier for wave w on level levelIdx.
export function hpScale(w, levelIdx) {
  return (1 + 0.085 * w + 0.003 * w * w) * (1 + 0.11 * levelIdx);
}

// A wave is a list of groups. Each group spawns `count` enemies of one type,
// `interval` seconds apart, starting `delay` seconds after the wave begins.
export function generateWave(level, levelIdx, w, spawnCount, opts = {}) {
  const rng = createRng(hashString(`${level.id}:${w}:${opts.endless ? 'e' : 'c'}`));
  const pool = opts.endless ? ENDLESS_POOL : level.pool;
  const available = pool.filter((p) => p.from <= w).map((p) => p.type);
  const fresh = pool.filter((p) => p.from === w && w > 0).map((p) => p.type);
  const bosses = opts.endless
    ? endlessBosses(w)
    : (level.bosses || []).filter((b) => b.wave === w).map((b) => b.type);

  // Endless waves stop growing in head count after wave 30 and grow in
  // toughness instead, which keeps entity counts sane.
  const bw = opts.endless ? Math.min(w, ENDLESS_COUNT_CAP) : w;
  // `threat` lets a level with a very long road field bigger waves.
  let budget = waveBudget(bw, levelIdx) * (opts.budgetScale || 1) * (opts.endless ? 1 : level.threat || 1);
  const groups = [];
  let delay = 0;

  for (const type of bosses) {
    groups.push({ type, count: 1, interval: 0, delay: 0, spawn: groups.length % spawnCount });
    budget *= 0.55;
  }

  // Pick a handful of types for this wave; newly introduced enemies always
  // headline the wave they first appear in.
  const kinds = Math.min(available.length, w < 2 ? 1 : w < 6 ? 2 : 3);
  const chosen = [...fresh];
  let guard = 0;
  while (chosen.length < kinds && guard++ < 50) {
    const t = rng.pick(available);
    if (!chosen.includes(t)) chosen.push(t);
  }
  if (chosen.length === 0) chosen.push(available[0]);

  const weights = chosen.map((t, i) => (fresh.includes(t) ? 1.2 : 1) * (1 + rng.next() * 0.6) / (1 + i * 0.25));

  // Daily Trial modifiers: Skyborne adds a flight of wisps to every wave,
  // Frenzy packs every group twice as tightly.
  const mods = opts.modifiers || new Set();
  if (mods.has('skyborne') && !chosen.includes('wisp')) {
    chosen.push('wisp');
    weights.push(0.5);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const packing = mods.has('frenzy') ? 0.5 : 1;

  chosen.forEach((type, i) => {
    const share = (budget * weights[i]) / total;
    const count = Math.max(1, Math.round(share / ENEMIES[type].threat));
    const interval = SPAWN_INTERVAL[type] * packing;
    // Large groups are split across spawns so multi-road maps stay busy.
    if (spawnCount > 1 && count >= 6) {
      const per = Math.ceil(count / spawnCount);
      for (let s = 0; s < spawnCount; s++) {
        groups.push({ type, count: per, interval, delay, spawn: s });
      }
      delay += per * interval * 0.7 + 1.5;
    } else {
      groups.push({ type, count, interval, delay, spawn: rng.int(0, spawnCount - 1) });
      delay += count * interval * 0.7 + 1.5;
    }
  });

  const extra = opts.endless ? endlessHp(w) * (waveBudget(w, levelIdx) / budgetBase(bw, levelIdx)) : 1;
  return { index: w, groups, hpScale: hpScale(w, levelIdx) * extra };
}

function endlessBosses(w) {
  if (w > 0 && w % 10 === 9) return [w % 20 === 9 ? 'colossus' : 'stormwing'];
  return [];
}

const ENDLESS_COUNT_CAP = 30;

// Endless mode ignores the level's own roster and introduces everything.
export const ENDLESS_POOL = [
  { type: 'grunt', from: 0 },
  { type: 'runner', from: 1 },
  { type: 'swarm', from: 3 },
  { type: 'brute', from: 5 },
  { type: 'wisp', from: 7 },
  { type: 'mender', from: 10 },
  { type: 'warden', from: 13 },
  { type: 'splitter', from: 16 },
];

function budgetBase(bw, levelIdx) {
  return waveBudget(bw, levelIdx);
}

function endlessHp(w) {
  return Math.pow(1.045, Math.max(0, w - 12));
}

export function waveSummary(wave) {
  const counts = {};
  for (const g of wave.groups) counts[g.type] = (counts[g.type] || 0) + g.count;
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}
