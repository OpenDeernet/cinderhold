import { THEMES } from '../render/themes.js';
import { THEME_NAMES } from '../sim/data/themes.js';
import { parseMap } from '../sim/map.js';
import { MAP_H, MAP_W, TIERS, WAVE_CHOICES, encodeMap, sanitizeMeta, validateMap } from '../sim/mapcodec.js';
import { clear, h } from './dom.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export const TOOLS = [
  { ch: '.', name: 'Ground', key: '1' },
  { ch: '#', name: 'Road', key: '2' },
  { ch: 'S', name: 'Portal', key: '3' },
  { ch: 'E', name: 'Hold', key: '4' },
  { ch: 'T', name: 'Tree', key: '5' },
  { ch: 'R', name: 'Rock', key: '6' },
  { ch: '~', name: 'Water', key: '7' },
];

const HISTORY_MAX = 100;
const ROUTE_COLORS = ['#ffcf5a', '#7fd3ff', '#ff8ad0'];

// A tile painter for custom maps. Lives inside a Screens panel; call
// destroy() when the panel goes away so the key listener is removed.
export class MapEditor {
  constructor(map, { onChange } = {}) {
    this.map = { ...map, rows: [...map.rows] };
    this.tool = '#';
    this.history = [];
    this.future = [];
    this.onChange = onChange;
    this.painting = false;
    this.lastCell = null;

    this.canvas = h('canvas.editor-canvas', { width: MAP_W * 40, height: MAP_H * 40 });
    this.ctx2d = this.canvas.getContext('2d');
    this.status = h('div.editor-status');
    this.toolbar = h('div.editor-tools');
    this.buildToolbar();

    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', () => this.endStroke());
    this.canvas.addEventListener('pointerleave', () => this.endStroke());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);

    this.refresh();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- tools

  buildToolbar() {
    clear(this.toolbar);
    for (const t of TOOLS) {
      const theme = THEMES[this.map.theme];
      const b = h(`button.tool-btn${this.tool === t.ch ? '.on' : ''}`, {
        title: `${t.name} (${t.key})`,
        onclick: () => {
          this.tool = t.ch;
          this.buildToolbar();
        },
      },
      h('span.swatch', { style: { background: this.tileColor(t.ch, theme, 0, 0) } }),
      h('span', t.name),
      h('span.tool-key', t.key));
      this.toolbar.appendChild(b);
    }
  }

  key(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const t = TOOLS.find((x) => x.key === e.key);
    if (t) {
      this.tool = t.ch;
      this.buildToolbar();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    }
  }

  // ---------------------------------------------------------------- painting

  cellAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * MAP_W);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * MAP_H);
    if (c < 0 || r < 0 || c >= MAP_W || r >= MAP_H) return null;
    return { c, r };
  }

  pointerDown(e) {
    const cell = this.cellAt(e);
    if (!cell) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pushHistory();
    this.painting = e.button === 2 ? '.' : this.tool;
    this.lastCell = null;
    this.paint(cell);
  }

  pointerMove(e) {
    if (!this.painting) return;
    const cell = this.cellAt(e);
    if (!cell) return;
    // Fast drags skip cells between pointer events; fill the gap.
    const from = this.lastCell;
    if (from) for (const p of lineCells(from, cell)) this.paint(p);
    else this.paint(cell);
  }

  endStroke() {
    if (!this.painting) return;
    this.painting = false;
    this.lastCell = null;
    this.refresh();
  }

  paint({ c, r }) {
    if (this.lastCell && this.lastCell.c === c && this.lastCell.r === r) return;
    this.lastCell = { c, r };
    const ch = this.painting;
    // There is only one Hold: placing it moves it.
    if (ch === 'E') this.map.rows = this.map.rows.map((row) => row.replace('E', '#'));
    const row = this.map.rows[r];
    if (row[c] === ch) return;
    this.map.rows[r] = row.slice(0, c) + ch + row.slice(c + 1);
    this.draw();
  }

  set(rows) {
    this.map.rows = [...rows];
    this.refresh();
  }

  pushHistory() {
    this.history.push([...this.map.rows]);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.future = [];
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push([...this.map.rows]);
    this.set(prev);
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push([...this.map.rows]);
    this.set(next);
  }

  clearAll() {
    this.pushHistory();
    this.set(Array.from({ length: MAP_H }, () => '.'.repeat(MAP_W)));
  }

  setMeta(patch) {
    this.map = { ...this.map, ...sanitizeMeta({ ...this.map, ...patch }) };
    this.buildToolbar();
    this.refresh();
  }

  // ---------------------------------------------------------------- drawing

  tileColor(ch, theme, c, r) {
    const alt = (c + r) % 2 === 0;
    switch (ch) {
      case '#':
        return hex(theme.road);
      case 'S':
        return '#ff6a2a';
      case 'E':
        return '#d9cfbf';
      case 'T':
        return hex(theme.foliage[0]);
      case 'R':
        return hex(theme.rock);
      case '~':
        return hex(theme.water);
      default:
        return hex(alt ? theme.ground : theme.groundAlt);
    }
  }

  draw() {
    const g = this.ctx2d;
    const theme = THEMES[this.map.theme] || THEMES.meadow;
    const s = this.canvas.width / MAP_W;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let r = 0; r < MAP_H; r++) {
      for (let c = 0; c < MAP_W; c++) {
        const ch = this.map.rows[r][c];
        g.fillStyle = this.tileColor(ch, theme, c, r);
        g.fillRect(c * s, r * s, s, s);
        if (ch === 'T' || ch === 'R') {
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.beginPath();
          g.arc(c * s + s / 2, r * s + s / 2, s * (ch === 'T' ? 0.32 : 0.26), 0, Math.PI * 2);
          g.fill();
        }
        if (ch === 'S' || ch === 'E') {
          g.fillStyle = '#1a1210';
          g.font = `bold ${Math.round(s * 0.5)}px system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(ch === 'S' ? '◆' : '♜', c * s + s / 2, r * s + s / 2 + 1);
        }
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (let c = 1; c < MAP_W; c++) {
      g.beginPath();
      g.moveTo(c * s + 0.5, 0);
      g.lineTo(c * s + 0.5, this.canvas.height);
      g.stroke();
    }
    for (let r = 1; r < MAP_H; r++) {
      g.beginPath();
      g.moveTo(0, r * s + 0.5);
      g.lineTo(this.canvas.width, r * s + 0.5);
      g.stroke();
    }
    this.drawRoutes(g, s);
  }

  // Shows the path enemies will actually take from each portal.
  drawRoutes(g, s) {
    let map;
    try {
      map = parseMap(this.map.rows);
    } catch {
      return;
    }
    map.routes.forEach((route, i) => {
      g.strokeStyle = ROUTE_COLORS[i % ROUTE_COLORS.length];
      g.lineWidth = Math.max(2, s * 0.08);
      g.setLineDash([s * 0.2, s * 0.15]);
      g.beginPath();
      route.cells.forEach(({ c, r }, k) => {
        const x = c * s + s / 2 + (i - 1) * 3;
        const y = r * s + s / 2 + (i - 1) * 3;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
    });
  }

  refresh() {
    this.draw();
    const v = validateMap(this.map.rows);
    this.valid = v.ok;
    clear(this.status);
    for (const e of v.errors) this.status.appendChild(h('div.err', e));
    for (const w of v.warnings) this.status.appendChild(h('div.warn', w));
    if (v.ok) {
      const roads = v.info.routes.map((l) => Math.floor(l)).join(', ');
      this.status.appendChild(h('div.ok', `Playable · ${v.info.spawns} portal${v.info.spawns > 1 ? 's' : ''} · road ${roads} tiles · ${v.info.buildable} build tiles`));
    }
    this.onChange?.(this.map, v);
  }

  shareCode() {
    return encodeMap(this.map);
  }

  // ---------------------------------------------------------------- settings controls

  controls() {
    const select = (label, value, options, key, parse = (x) => x) => h('label.editor-field', h('span', label),
      h('select', {
        onchange: (e) => this.setMeta({ [key]: parse(e.target.value) }),
      }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text))));
    return h('div.editor-fields',
      h('label.editor-field', h('span', 'Name (up to 32 characters)'), h('input', {
        // HTML limits UTF-16 units; allow two per code point before sanitizing.
        type: 'text', maxLength: 64, value: this.map.name,
        onchange: (e) => this.setMeta({ name: e.target.value }),
      })),
      select('Biome', this.map.theme, Object.entries(THEME_NAMES), 'theme'),
      select('Enemies', this.map.tier, TIERS.map((t) => [t.id, t.name]), 'tier'),
      select('Waves', String(this.map.waves), WAVE_CHOICES.map((w) => [String(w), `${w}${w >= 20 ? ' + boss' : ''}`]), 'waves', Number),
    );
  }
}

// Grid cells on the line from a to b (Bresenham), excluding a.
export function lineCells(a, b) {
  const out = [];
  let { c, r } = a;
  const dc = Math.abs(b.c - c);
  const dr = -Math.abs(b.r - r);
  const sc = c < b.c ? 1 : -1;
  const sr = r < b.r ? 1 : -1;
  let err = dc + dr;
  while (c !== b.c || r !== b.r) {
    const e2 = 2 * err;
    // Step one axis at a time so painted roads stay 4-connected.
    if (e2 >= dr && c !== b.c && (e2 <= dc ? Math.abs(err + dr) <= Math.abs(err + dc) : true)) {
      err += dr;
      c += sc;
    } else {
      err += dc;
      r += sr;
    }
    out.push({ c, r });
  }
  return out;
}

// Draws a small preview of a map into a new canvas (workshop list).
export function mapThumbnail(map, scale = 6) {
  const canvas = h('canvas.map-thumb', { width: MAP_W * scale, height: MAP_H * scale });
  const g = canvas.getContext('2d');
  const theme = THEMES[map.theme] || THEMES.meadow;
  const ed = MapEditor.prototype;
  for (let r = 0; r < MAP_H; r++) {
    for (let c = 0; c < MAP_W; c++) {
      g.fillStyle = ed.tileColor(map.rows[r][c], theme, c, r);
      g.fillRect(c * scale, r * scale, scale, scale);
    }
  }
  return canvas;
}
