import { LEVELS } from './data/levels.js';
import { MODIFIERS } from './data/modifiers.js';
import { createRng, hashString } from './rng.js';

// The Daily Trial: one campaign map with two modifiers, chosen from the date
// so every player gets the same trial on the same day.

const TRIAL_WAVES = 15;
const TRIAL_GOLD = 80;
const FIRST_MAP = 2; // the first two maps are too gentle to be a trial

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dailyTrial(date) {
  const rng = createRng(hashString(`daily:${date}`));
  const levelIdx = rng.int(FIRST_MAP, LEVELS.length - 1);
  const base = LEVELS[levelIdx];

  const modifiers = [];
  let guard = 0;
  while (modifiers.length < 2 && guard++ < 100) {
    const m = rng.pick(MODIFIERS);
    if (modifiers.includes(m.id)) continue;
    if (modifiers.some((id) => m.clash?.includes(id))) continue;
    modifiers.push(m.id);
  }

  const level = {
    ...base,
    id: `daily:${date}`,
    name: `Trial of ${base.name}`,
    intro: 'Today’s trial. Everyone faces the same map and the same twists.',
    waves: Math.min(base.waves, TRIAL_WAVES),
    // Two modifiers usually hurt the opening; a little extra gold evens it.
    startGold: base.startGold + TRIAL_GOLD,
    towers: ['bolt', 'cannon', 'frost', 'tesla', 'mortar', 'ember', 'banner'],
    bosses: (base.bosses || []).filter((b) => b.wave < TRIAL_WAVES),
  };
  return { date, levelIdx, level, modifiers };
}

// Consecutive days, ending today or yesterday, with a won trial.
export function streak(results, today) {
  let n = 0;
  const d = new Date(`${today}T12:00:00`);
  if (!results[today]?.won) d.setDate(d.getDate() - 1);
  while (results[dateKey(d)]?.won) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
