import { TOWERS } from './data/towers.js';
import { ENEMIES } from './data/enemies.js';
import { createRng } from './rng.js';
import { sampleRoads, tileScore } from './coverage.js';

// A simple auto-player. It drives the title-screen demo and the headless
// playthrough that checks every level can be beaten and runs cleanly.
//
// It is deliberately not optimal: it scores build tiles by how much road they
// cover, builds a rotation of tower types, and upgrades once it has enough
// towers out.
export class Bot {
  constructor(game, { seed = 7, skill = 1, callEarly = true } = {}) {
    this.game = game;
    this.rng = createRng(seed);
    this.skill = skill;
    this.callEarly = callEarly;
    this.think = 0;
    this.samples = sampleRoads(game.map);
    this.needsAir = game.level.pool.some((p) => ENEMIES[p.type].air) ||
      (game.level.bosses || []).some((b) => ENEMIES[b.type].air) || game.endless;
    this.rotation = this.makeRotation();
    this.built = 0;
  }

  makeRotation() {
    const base = this.needsAir
      ? ['bolt', 'cannon', 'bolt', 'frost', 'tesla', 'ember', 'mortar', 'banner', 'bolt', 'tesla', 'cannon']
      : ['bolt', 'cannon', 'frost', 'cannon', 'tesla', 'ember', 'mortar', 'banner', 'bolt', 'tesla', 'cannon'];
    return base.filter((t) => this.game.towerAllowed(t));
  }

  coverage(c, r, type) {
    // The bot plans with base stats, like a player reading the build bar.
    return tileScore(this.game, this.samples, type, c, r, TOWERS[type].tiers[0]);
  }

  bestTile(type) {
    const g = this.game;
    const options = [];
    for (let r = 0; r < g.map.h; r++) {
      for (let c = 0; c < g.map.w; c++) {
        if (!g.canBuildAt(c, r)) continue;
        options.push({ c, r, score: this.coverage(c, r, type) });
      }
    }
    if (!options.length) return null;
    options.sort((a, b) => b.score - a.score);
    // Lower skill picks from a wider pool of decent tiles.
    const k = Math.max(1, Math.round(1 + (1 - this.skill) * 8));
    return options[Math.floor(this.rng.next() * Math.min(k, options.length))];
  }

  update(dt) {
    const g = this.game;
    if (g.isOver()) return;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.4;

    // Spend money: build until there are enough towers for this stage of the
    // level, then alternate between upgrades and new towers.
    for (let guard = 0; guard < 4; guard++) {
      if (!this.act()) break;
    }

    if (g.status === 'ready') {
      g.callWave();
      return;
    }
    if (this.callEarly && g.countdown !== null && g.countdown < 13) g.callWave();
  }

  act() {
    const g = this.game;
    const wantTowers = 3 + Math.floor(g.waveIndex * 0.7);
    const upgradable = g.towers
      .filter((t) => g.upgradeCost(t) !== null)
      .sort((a, b) => a.tier - b.tier || b.damage - a.damage);
    const preferUpgrade = g.towers.length >= wantTowers && upgradable.length > 0;

    if (preferUpgrade) {
      const t = upgradable[0];
      if (g.gold >= g.upgradeCost(t)) return g.upgrade(t.id);
      return false;
    }
    const type = this.rotation[this.built % this.rotation.length];
    if (g.gold < g.buildCost(type)) return false;
    const tile = this.bestTile(type);
    if (!tile) {
      if (upgradable.length && g.gold >= g.upgradeCost(upgradable[0])) return g.upgrade(upgradable[0].id);
      return false;
    }
    const t = g.build(type, tile.c, tile.r);
    if (t) {
      this.built++;
      if (type === 'tesla') g.setTargeting(t.id, 'strong');
    }
    return !!t;
  }
}
