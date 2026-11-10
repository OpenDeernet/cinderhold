import { THEMES } from '../render/themes.js';
import { TILE } from '../sim/map.js';
import { TOWER_COLORS } from '../render/models.js';
import { h } from './dom.js';

const SCALE = 8;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// A small top-down map of the battle. The terrain is drawn once per level
// into an offscreen canvas; towers and enemies are redrawn a few times a
// second on top of it. Clicking moves the camera to that spot.
export class Minimap {
  constructor(onJump) {
    this.canvas = h('canvas.minimap', { width: 1, height: 1, title: 'Click to look there (M toggles)' });
    this.ctx2d = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.timer = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.game) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.game.map.w;
      const y = ((e.clientY - rect.top) / rect.height) * this.game.map.h;
      onJump(x, y);
    });
  }

  attach(game) {
    this.game = game;
    const { w, h: hgt, tiles } = game.map;
    const theme = THEMES[game.level.theme] || THEMES.meadow;
    for (const c of [this.canvas, this.base]) {
      c.width = w * SCALE;
      c.height = hgt * SCALE;
    }
    const g = this.base.getContext('2d');
    for (let r = 0; r < hgt; r++) {
      for (let c = 0; c < w; c++) {
        const t = tiles[r][c];
        let col = theme.ground;
        if (t === TILE.ROAD || t === TILE.SPAWN || t === TILE.EXIT) col = theme.road;
        else if (t === TILE.WATER) col = theme.water;
        else if (t === TILE.TREE) col = theme.foliage[0];
        else if (t === TILE.ROCK) col = theme.rock;
        g.fillStyle = hex(col);
        g.fillRect(c * SCALE, r * SCALE, SCALE, SCALE);
      }
    }
    for (const s of game.map.spawns) this.marker(g, s.c, s.r, '#ff6a2a');
    this.marker(g, game.map.exit.c, game.map.exit.r, '#f6eadb');
    this.timer = 0;
    this.draw();
  }

  marker(g, c, r, color) {
    g.fillStyle = color;
    g.fillRect(c * SCALE + 1, r * SCALE + 1, SCALE - 2, SCALE - 2);
  }

  // Redraws at about 10 Hz; cheap enough to leave on all the time.
  update(dt) {
    if (!this.game || this.canvas.hidden) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.draw();
  }

  draw() {
    const g = this.ctx2d;
    g.drawImage(this.base, 0, 0);
    for (const t of this.game.towers) {
      g.fillStyle = hex(TOWER_COLORS[t.type] || 0xffffff);
      g.fillRect(t.c * SCALE + 1.5, t.r * SCALE + 1.5, SCALE - 3, SCALE - 3);
    }
    for (const e of this.game.enemies) {
      if (e.hidden) continue;
      g.fillStyle = e.boss ? '#ff2a1a' : e.air ? '#9fd8ff' : '#ff6a5a';
      g.beginPath();
      g.arc(e.x * SCALE, e.y * SCALE, e.boss ? 4 : 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}
