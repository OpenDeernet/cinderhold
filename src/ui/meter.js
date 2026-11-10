import { TOWERS } from '../sim/data/towers.js';
import { TOWER_COLORS } from '../render/models.js';
import { clear, h, icon } from './dom.js';

const ROWS = 8;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Damage meter (K): the towers that have done the most damage this battle,
// with bars relative to the leader. Refreshed twice a second.
export class DamageMeter {
  constructor() {
    this.el = h('div.meter');
    this.el.hidden = true;
    this.timer = 0;
  }

  toggle(on = this.el.hidden) {
    this.el.hidden = !on;
    this.timer = 0;
    return on;
  }

  update(game, dt) {
    if (this.el.hidden || !game) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const ranked = game.towers
      .filter((t) => t.damage > 0)
      .sort((a, b) => b.damage - a.damage)
      .slice(0, ROWS);
    clear(this.el).appendChild(h('div.meter-head', 'Damage this battle'));
    if (!ranked.length) {
      this.el.appendChild(h('div.meter-empty', 'No damage dealt yet.'));
      return;
    }
    const top = ranked[0].damage;
    const total = game.towers.reduce((n, t) => n + t.damage, 0);
    for (const t of ranked) {
      const pct = Math.round((t.damage / total) * 100);
      this.el.appendChild(h('div.meter-row',
        icon(t.type, 'icon small'),
        h('div.meter-bar', h('div.meter-fill', { style: { width: `${(t.damage / top) * 100}%`, background: hex(TOWER_COLORS[t.type]) } }),
          h('span.meter-label', `${TOWERS[t.type].name} ${'I'.repeat(t.tier + 1)}${t.rank ? ` ${'★'.repeat(t.rank)}` : ''}`)),
        h('span.meter-val', `${pct}%`),
      ));
    }
  }
}
