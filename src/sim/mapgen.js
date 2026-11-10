import { createRng } from './rng.js';
import { MAP_H, MAP_W, validateMap } from './mapcodec.js';
import { THEME_IDS } from './data/themes.js';

// Random maps for the Map Workshop. The road is a self-avoiding walk on a
// coarse lattice (every second tile), so separate stretches of road always
// have at least one open tile between them and can never short-circuit.

const LAT_W = Math.floor((MAP_W - 1) / 2) + 1; // lattice columns at x = 0, 2, ... 16
const LAT_H = Math.floor((MAP_H - 1) / 2) + 1; // lattice rows at y = 0, 2, ... 10
const MIN_STEPS = 14;
const MAX_STEPS = 30;
const ATTEMPTS = 60;

// Depth-first walk from the left edge to the right edge with shuffled
// neighbours; gives up on paths that are too long and keeps the first one in
// the target length band.
function walk(rng) {
  const start = { x: 0, y: rng.int(0, LAT_H - 1) };
  const seen = new Set([key(start)]);
  const path = [start];
  let best = null;
  let budget = 4000;

  const step = () => {
    if (--budget < 0 || best) return;
    const cur = path[path.length - 1];
    if (cur.x === LAT_W - 1) {
      if (path.length >= MIN_STEPS) best = [...path];
      return;
    }
    if (path.length >= MAX_STEPS) return;
    const dirs = [[1, 0], [0, 1], [0, -1], [-1, 0]];
    // Shuffle, but lean rightwards so walks finish.
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    dirs.sort((a, b) => (b[0] === 1) - (a[0] === 1) + (rng.next() - 0.5) * 1.5);
    for (const [dx, dy] of dirs) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (n.x < 0 || n.y < 0 || n.x >= LAT_W || n.y >= LAT_H || seen.has(key(n))) continue;
      seen.add(key(n));
      path.push(n);
      step();
      if (best) return;
      path.pop();
      seen.delete(key(n));
    }
  };
  step();
  return best;
}

function key(p) {
  return p.y * 100 + p.x;
}

// Draws the lattice path onto a tile grid: S at the first node, E one tile
// past the last node on the right edge.
function draw(path) {
  const g = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('.'));
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    for (let t = 0; t <= 2; t++) {
      const x = a.x * 2 + (b.x - a.x) * t;
      const y = a.y * 2 + (b.y - a.y) * t;
      g[y][x] = '#';
    }
  }
  const s = path[0];
  const e = path[path.length - 1];
  g[s.y * 2][0] = 'S';
  g[e.y * 2][MAP_W - 1] = 'E';
  for (let x = e.x * 2 + 1; x < MAP_W - 1; x++) g[e.y * 2][x] = '#';
  return g;
}

// Scatters trees, rocks and a pond or two on open ground away from the road.
function decorate(g, rng, theme) {
  const nearRoad = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = g[y + dy]?.[x + dx];
        if (ch === '#' || ch === 'S' || ch === 'E') return true;
      }
    }
    return false;
  };
  const props = theme === 'desert' ? ['R', 'R', 'T'] : theme === 'volcanic' ? ['R', 'T', '~'] : ['T', 'T', 'R'];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (g[y][x] !== '.' || nearRoad(x, y)) continue;
      if (rng.next() < 0.1) g[y][x] = rng.pick(props);
    }
  }
  const ponds = rng.int(0, 2);
  for (let p = 0; p < ponds; p++) {
    const cx = rng.int(1, MAP_W - 3);
    const cy = rng.int(1, MAP_H - 3);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (g[cy + dy][cx + dx] === '.' && !nearRoad(cx + dx, cy + dy)) g[cy + dy][cx + dx] = '~';
    }
  }
}

export function randomMap(seed, { theme } = {}) {
  const rng = createRng(seed);
  const biome = theme || rng.pick(THEME_IDS);
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const path = walk(rng);
    if (!path) continue;
    const g = draw(path);
    decorate(g, rng, biome);
    const rows = g.map((r) => r.join(''));
    if (!validateMap(rows).ok) continue;
    return {
      name: `Wilds #${(seed >>> 0) % 10000}`,
      theme: biome,
      tier: 'standard',
      waves: 15,
      rows,
    };
  }
  throw new Error('could not generate a map');
}
