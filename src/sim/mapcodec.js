import { isRoad, parseMap } from './map.js';
import { THEME_IDS } from './data/themes.js';

// Custom maps: validation and share codes. A custom map is
//   { name, theme, tier, waves, rows }
// where rows uses the same characters as the campaign maps.

export const MAP_W = 18;
export const MAP_H = 12;
export const TILE_CHARS = ['.', '#', 'S', 'E', 'T', 'R', '~'];
export const TIERS = [
  { id: 'gentle', name: 'Gentle', levelIdx: 2 },
  { id: 'standard', name: 'Standard', levelIdx: 5 },
  { id: 'brutal', name: 'Brutal', levelIdx: 8 },
];
export const WAVE_CHOICES = [10, 15, 20, 25];

const MIN_ROUTE = 12;
const MIN_BUILDABLE = 30;
const MAX_SPAWNS = 3;
const NAME_MAX = 32;

export function blankMap() {
  const rows = [];
  for (let r = 0; r < MAP_H; r++) {
    if (r === 5) rows.push(`S${'#'.repeat(MAP_W - 2)}E`);
    else rows.push('.'.repeat(MAP_W));
  }
  return { name: 'Untitled', theme: 'meadow', tier: 'standard', waves: 15, rows };
}

// Returns { ok, errors, warnings, info }. errors make a map unplayable;
// warnings are worth fixing but do not block play.
export function validateMap(rows) {
  const errors = [];
  const warnings = [];
  const info = { spawns: 0, buildable: 0, routes: [] };
  if (!Array.isArray(rows) || rows.length !== MAP_H || rows.some((r) => typeof r !== 'string' || r.length !== MAP_W)) {
    return { ok: false, errors: [`The map must be ${MAP_W}×${MAP_H} tiles.`], warnings, info };
  }
  const flat = rows.join('');
  const bad = [...flat].find((ch) => !TILE_CHARS.includes(ch));
  if (bad) return { ok: false, errors: [`Unknown tile '${bad}'.`], warnings, info };

  const count = (ch) => [...flat].filter((c) => c === ch).length;
  info.spawns = count('S');
  info.buildable = count('.');
  if (count('E') !== 1) errors.push('Place exactly one Hold (E).');
  if (info.spawns === 0) errors.push('Place at least one portal (S).');
  if (info.spawns > MAX_SPAWNS) errors.push(`At most ${MAX_SPAWNS} portals.`);
  if (info.buildable < MIN_BUILDABLE) errors.push(`Leave at least ${MIN_BUILDABLE} open tiles to build on (${info.buildable} now).`);
  if (errors.length) return { ok: false, errors, warnings, info };

  let map;
  try {
    map = parseMap(rows);
  } catch (e) {
    const msg = String(e.message || e);
    errors.push(msg.includes('no road') ? 'Every portal needs a road to the Hold.' : msg);
    return { ok: false, errors, warnings, info };
  }

  info.routes = map.routes.map((r) => Math.round(r.length * 10) / 10);
  for (const [i, len] of info.routes.entries()) {
    if (len < MIN_ROUTE) errors.push(`Road from portal ${i + 1} is too short (${Math.floor(len)} tiles, need ${MIN_ROUTE}).`);
  }

  const used = new Set();
  for (const route of map.routes) for (const { c, r } of route.cells) used.add(r * MAP_W + c);
  let unused = 0;
  for (let r = 0; r < MAP_H; r++) {
    for (let c = 0; c < MAP_W; c++) if (isRoad(map.tiles[r][c]) && !used.has(r * MAP_W + c)) unused++;
  }
  if (unused) warnings.push(`${unused} road tile${unused > 1 ? 's are' : ' is'} never walked; enemies take the shortest path.`);

  const exitNear = map.routes.some((route) => route.length < 16);
  if (exitNear && !errors.length) warnings.push('A very short road makes the map hard to defend.');
  return { ok: errors.length === 0, errors, warnings, info };
}

export function sanitizeMeta(m) {
  return {
    name: [...String(m.name || 'Untitled').replace(/[^\p{L}\p{N} '\-!.,]/gu, '').trim()].slice(0, NAME_MAX).join('') || 'Untitled',
    theme: THEME_IDS.includes(m.theme) ? m.theme : 'meadow',
    tier: TIERS.some((t) => t.id === m.tier) ? m.tier : 'standard',
    waves: WAVE_CHOICES.includes(m.waves) ? m.waves : 15,
  };
}

// ---------------------------------------------------------------- share codes

// Run-length encode the tile string: "......" -> "6." Single tiles stay bare.
function rle(str) {
  let out = '';
  for (let i = 0; i < str.length; ) {
    let j = i;
    while (j < str.length && str[j] === str[i]) j++;
    const n = j - i;
    out += n > 1 ? `${n}${str[i]}` : str[i];
    i = j;
  }
  return out;
}

function unrle(str) {
  let out = '';
  let num = '';
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      num += ch;
      continue;
    }
    const n = num ? Number(num) : 1;
    if (n > MAP_W * MAP_H) throw new Error('bad run length');
    out += ch.repeat(n);
    num = '';
  }
  if (num) throw new Error('dangling run length');
  return out;
}

const PREFIX = 'CH1.';

function toBase64Url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeMap(m) {
  const meta = sanitizeMeta(m);
  const payload = [meta.name, meta.theme, meta.tier, meta.waves, rle(m.rows.join(''))].join('|');
  return PREFIX + toBase64Url(payload);
}

// Throws with a readable message when the code is not a valid map.
export function decodeMap(code) {
  const s = String(code || '').trim();
  if (!s.startsWith(PREFIX)) throw new Error('Not a Cinderhold map code.');
  let payload;
  try {
    payload = fromBase64Url(s.slice(PREFIX.length));
  } catch {
    throw new Error('The map code is damaged.');
  }
  const parts = payload.split('|');
  if (parts.length !== 5) throw new Error('The map code is damaged.');
  const [name, theme, tier, waves, tiles] = parts;
  let flat;
  try {
    flat = unrle(tiles);
  } catch {
    throw new Error('The map code is damaged.');
  }
  if (flat.length !== MAP_W * MAP_H) throw new Error('The map code is damaged.');
  const rows = [];
  for (let r = 0; r < MAP_H; r++) rows.push(flat.slice(r * MAP_W, (r + 1) * MAP_W));
  const map = { ...sanitizeMeta({ name, theme, tier, waves: Number(waves) }), rows };
  const v = validateMap(rows);
  if (!v.ok) throw new Error(`That map cannot be played: ${v.errors[0]}`);
  return map;
}

// Builds a playable level definition from a custom map.
export function customLevel(m, id) {
  const meta = sanitizeMeta(m);
  const tier = TIERS.find((t) => t.id === meta.tier);
  return {
    level: {
      id: `custom:${id}`,
      name: meta.name,
      theme: meta.theme,
      intro: 'A battlefield of your own making.',
      startGold: 280 + tier.levelIdx * 10,
      lives: 20,
      waves: meta.waves,
      towers: ['bolt', 'cannon', 'frost', 'tesla', 'mortar', 'ember', 'banner'],
      pool: CUSTOM_POOL,
      bosses: meta.waves >= 20 ? [{ wave: meta.waves - 1, type: meta.waves >= 25 ? 'colossus' : 'stormwing' }] : [],
      map: m.rows,
    },
    levelIdx: tier.levelIdx,
  };
}

const CUSTOM_POOL = [
  { type: 'grunt', from: 0 },
  { type: 'runner', from: 0 },
  { type: 'swarm', from: 1 },
  { type: 'brute', from: 3 },
  { type: 'wisp', from: 4 },
  { type: 'warden', from: 6 },
  { type: 'mender', from: 7 },
  { type: 'splitter', from: 9 },
];
