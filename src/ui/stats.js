import { TOWERS } from '../sim/data/towers.js';

// Human-readable stat rows for a tower tier, shared by the HUD and the codex.
export function fmt(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function statLines(type, s) {
  const def = TOWERS[type];
  const lines = [['Damage', fmt(s.damage)], ['Rate', `${fmt(s.rate)}/s`], ['Range', fmt(s.range)]];
  if (s.splash) lines.push(['Blast', fmt(s.splash)]);
  if (s.slow) lines.push(['Slow', `${Math.round((1 - s.slow) * 100)}% · ${fmt(s.slowTime)}s`]);
  if (s.chains) lines.push(['Arcs', String(s.chains)]);
  if (s.burn) lines.push(['Burn', `${Math.round(s.burn)}/s`]);
  if (s.minRange) lines.push(['Min range', fmt(s.minRange)]);
  lines.push(['Targets', def.hitsAir ? (def.hitsGround ? 'Ground & air' : 'Air') : 'Ground']);
  return lines;
}
