import { TOWERS } from './data/towers.js';

// How much of the road a tower would cover from a given tile. Shared by the
// bot (to choose where to build) and the placement heatmap (to show it).

const SAMPLE_STEP = 0.5;

// Points every half tile along every route.
export function sampleRoads(map) {
  const pts = [];
  for (const route of map.routes) {
    let i = 0;
    for (let d = 0; d < route.length; d += SAMPLE_STEP) {
      while (i < route.points.length - 2 && route.cum[i + 1] < d) i++;
      const a = route.points[i];
      const b = route.points[i + 1];
      const seg = route.cum[i + 1] - route.cum[i];
      const t = seg > 0 ? (d - route.cum[i]) / seg : 0;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return pts;
}

// Score of building `type` on tile (c, r): road samples within range (and
// outside any minimum range). A banner scores the towers it would cover.
export function tileScore(game, samples, type, c, r, stats = null) {
  const s = stats || game.towerStats(type, 0);
  const x = c + 0.5;
  const y = r + 0.5;
  if (TOWERS[type].kind === 'aura') {
    const r2 = s.range * s.range;
    let n = 0;
    for (const t of game.towers) if (TOWERS[t.type].kind !== 'aura' && (t.x - x) ** 2 + (t.y - y) ** 2 <= r2) n++;
    return n * 40;
  }
  const max2 = s.range * s.range;
  const min2 = (s.minRange || 0) ** 2;
  let n = 0;
  for (const p of samples) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 <= max2 && d2 >= min2) n++;
  }
  return n;
}

// Scores for every buildable tile, normalised to 0..1 against the best one.
// Returns { scores: Float32Array(w*h) with -1 for unbuildable, best }.
export function coverageMap(game, type, samples = sampleRoads(game.map)) {
  const { w, h } = game.map;
  const scores = new Float32Array(w * h).fill(-1);
  const stats = game.towerStats(type, 0);
  let best = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!game.canBuildAt(c, r)) continue;
      const v = tileScore(game, samples, type, c, r, stats);
      scores[r * w + c] = v;
      if (v > best) best = v;
    }
  }
  if (best > 0) for (let i = 0; i < scores.length; i++) if (scores[i] > 0) scores[i] /= best;
  return { scores, best };
}
