// Parses an ASCII level map into tiles and enemy routes.
//
//   .  buildable ground      #  road
//   S  spawn (road)          E  the Hold (road, exit)
//   T  tree                  R  rock
//   ~  water
//
// Each spawn gets a route: the shortest road walk from that spawn to E.

export const TILE = {
  GROUND: 0,
  ROAD: 1,
  SPAWN: 2,
  EXIT: 3,
  TREE: 4,
  ROCK: 5,
  WATER: 6,
};

const CHAR_TO_TILE = {
  '.': TILE.GROUND,
  '#': TILE.ROAD,
  S: TILE.SPAWN,
  E: TILE.EXIT,
  T: TILE.TREE,
  R: TILE.ROCK,
  '~': TILE.WATER,
};

export function isRoad(t) {
  return t === TILE.ROAD || t === TILE.SPAWN || t === TILE.EXIT;
}

export function parseMap(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const tiles = [];
  const spawns = [];
  let exit = null;
  for (let r = 0; r < h; r++) {
    if (rows[r].length !== w) {
      throw new Error(`map row ${r} has width ${rows[r].length}, expected ${w}`);
    }
    const row = [];
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c];
      const t = CHAR_TO_TILE[ch];
      if (t === undefined) throw new Error(`unknown map char '${ch}' at ${c},${r}`);
      if (t === TILE.SPAWN) spawns.push({ c, r });
      if (t === TILE.EXIT) {
        if (exit) throw new Error('map has more than one exit');
        exit = { c, r };
      }
      row.push(t);
    }
    tiles.push(row);
  }
  if (!exit) throw new Error('map has no exit');
  if (spawns.length === 0) throw new Error('map has no spawn');

  const routes = spawns.map((s) => buildRoute(tiles, w, h, s, exit));
  return { w, h, tiles, spawns, exit, routes };
}

function buildRoute(tiles, w, h, from, to) {
  const key = (c, r) => r * w + c;
  const prev = new Map();
  prev.set(key(from.c, from.r), -1);
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur.c === to.c && cur.r === to.r) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = cur.c + dc;
      const r = cur.r + dr;
      if (c < 0 || r < 0 || c >= w || r >= h) continue;
      if (!isRoad(tiles[r][c])) continue;
      const k = key(c, r);
      if (prev.has(k)) continue;
      prev.set(k, key(cur.c, cur.r));
      queue.push({ c, r });
    }
  }
  if (!prev.has(key(to.c, to.r))) {
    throw new Error(`spawn at ${from.c},${from.r} has no road to the exit`);
  }
  const cells = [];
  let k = key(to.c, to.r);
  while (k !== -1) {
    cells.push({ c: k % w, r: Math.floor(k / w) });
    k = prev.get(k);
  }
  cells.reverse();

  // Enemies walk through tile centres. Start half a tile outside the spawn so
  // they visibly emerge from the portal, and end in the middle of the Hold.
  const points = cells.map(({ c, r }) => ({ x: c + 0.5, y: r + 0.5 }));
  if (points.length > 1) {
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    points.unshift({ x: points[0].x + dx * 0.5, y: points[0].y + dy * 0.5 });
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { cells, points, cum, length: cum[cum.length - 1] };
}

// Position along a route at distance d. `hint` is a segment index to start
// searching from; enemies only move forward so this keeps lookups O(1).
export function routePos(route, d, hint = 0) {
  const { points, cum } = route;
  if (d <= 0) return { x: points[0].x, y: points[0].y, seg: 0, dir: segDir(points, 0) };
  const last = points.length - 1;
  if (d >= route.length) {
    return { x: points[last].x, y: points[last].y, seg: last - 1, dir: segDir(points, last - 1) };
  }
  let i = Math.min(Math.max(hint, 0), last - 1);
  while (i > 0 && cum[i] > d) i--;
  while (i < last - 1 && cum[i + 1] < d) i++;
  const seg = cum[i + 1] - cum[i];
  const t = seg > 0 ? (d - cum[i]) / seg : 0;
  return {
    x: points[i].x + (points[i + 1].x - points[i].x) * t,
    y: points[i].y + (points[i + 1].y - points[i].y) * t,
    seg: i,
    dir: segDir(points, i),
  };
}

function segDir(points, i) {
  const a = points[i];
  const b = points[i + 1] || a;
  return Math.atan2(b.y - a.y, b.x - a.x);
}
