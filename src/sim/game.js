import { ENEMIES } from './data/enemies.js';
import { TOWERS, TARGET_MODES, towerTier, towerInvested } from './data/towers.js';
import { parseMap, routePos, TILE } from './map.js';
import { generateWave } from './waves.js';

export const TICK = 1 / 30;
const AUTO_WAVE_DELAY = 14;
const SHIELD_REGEN_DELAY = 2.5;
const MAX_TICKS_PER_UPDATE = 12;
const FREE_SELL_WINDOW = 5;
const TIMELINE_STEP = 3;
const TIMELINE_MAX = 600;

export const DIFFICULTY = {
  casual: { label: 'Casual', hp: 0.75, lives: 1.5, bounty: 1.1 },
  normal: { label: 'Normal', hp: 1, lives: 1, bounty: 1 },
  // Heroic leans hardest on the early maps, which are otherwise a formality,
  // and eases off on the late ones, which are already brutal.
  heroic: { label: 'Heroic', hp: 1.45, hpPerLevel: -0.05, budget: 1.3, budgetPerLevel: -0.03, lives: 0.5, bounty: 0.9 },
};

// The whole rules engine. It knows nothing about rendering: the renderer and
// audio read state and drain `events` after each update.
export class Game {
  constructor({ level, levelIdx = 0, difficulty = 'normal', perks = [], endless = false, modifiers = [] }) {
    this.modifiers = new Set(modifiers);
    this.level = level;
    this.levelIdx = levelIdx;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'normal';
    const d = DIFFICULTY[this.difficulty];
    this.diff = {
      ...d,
      hp: d.hp + (d.hpPerLevel || 0) * levelIdx,
      budget: (d.budget || 1) + (d.budgetPerLevel || 0) * levelIdx,
    };
    this.perks = new Set(perks);
    this.endless = endless;
    this.map = parseMap(level.map);

    this.maxLives = Math.round(level.lives * this.diff.lives) + (this.perks.has('walls') ? 5 : 0);
    if (this.modifiers.has('fragile')) this.maxLives = Math.min(this.maxLives, 8);
    this.lives = this.maxLives;
    this.gold = level.startGold + (this.perks.has('purse') ? 50 : 0) + (endless ? 150 : 0) + (this.modifiers.has('lean') ? 150 : 0);

    this.totalWaves = endless ? Infinity : level.waves;
    this.waveIndex = 0; // next wave to launch
    this.waveCache = new Map();
    this.spawners = [];
    this.enemies = [];
    this.enemyById = new Map();
    this.towers = [];
    this.projectiles = [];
    this.events = [];
    this.occupied = new Map();

    this.time = 0;
    this.ticks = 0;
    this.acc = 0;
    // Every successful player command, stamped with the tick it happened
    // before. The simulation is deterministic, so this is a full replay.
    this.log = [];
    this.beforeTick = null;
    this.nextId = 1;
    this.countdown = null;
    this.status = 'ready'; // ready | playing | won | lost
    // Sampled every few seconds for the post-battle chart.
    this.timeline = [];
    this.nextSample = 0;
    this.stats = { kills: 0, leaks: 0, goldEarned: 0, goldSpent: 0, built: 0, wavesCleared: 0, killsByType: {} };
  }

  // ---------------------------------------------------------------- queries

  wave(i) {
    if (!this.waveCache.has(i)) {
      this.waveCache.set(i, generateWave(this.level, this.levelIdx, i, this.map.routes.length, {
        endless: this.endless,
        budgetScale: this.diff.budget,
        modifiers: this.modifiers,
      }));
    }
    return this.waveCache.get(i);
  }

  nextWave() {
    return this.waveIndex < this.totalWaves ? this.wave(this.waveIndex) : null;
  }

  isOver() {
    return this.status === 'won' || this.status === 'lost';
  }

  priceFactor() {
    return (this.perks.has('tools') ? 0.92 : 1) * (this.modifiers.has('dear') ? 1.15 : 1);
  }

  buildCost(type) {
    return Math.round(TOWERS[type].tiers[0].cost * this.priceFactor());
  }

  upgradeCost(tower) {
    const def = TOWERS[tower.type];
    if (tower.tier >= def.tiers.length - 1) return null;
    return Math.round(def.tiers[tower.tier + 1].cost * this.priceFactor());
  }

  sellValue(tower) {
    // Misplaced towers can be taken back for free: before the first wave,
    // or within a few seconds of building or upgrading.
    if (this.status === 'ready' || this.time - tower.touchedAt < FREE_SELL_WINDOW) return tower.invested;
    const rate = this.perks.has('salvage') ? 0.85 : 0.7;
    return Math.floor(tower.invested * rate);
  }

  towerAllowed(type) {
    return this.endless || this.level.towers.includes(type);
  }

  canBuildAt(c, r) {
    if (c < 0 || r < 0 || c >= this.map.w || r >= this.map.h) return false;
    if (this.map.tiles[r][c] !== TILE.GROUND) return false;
    return !this.occupied.has(r * this.map.w + c);
  }

  canBuild(type, c, r) {
    return this.towerAllowed(type) && this.canBuildAt(c, r) && this.gold >= this.buildCost(type) && !this.isOver();
  }

  towerAt(c, r) {
    const id = this.occupied.get(r * this.map.w + c);
    return id ? this.towers.find((t) => t.id === id) : null;
  }

  // Effective stats of a tower, with perks applied.
  towerStats(type, tier) {
    const s = towerTier(type, tier);
    if (type === 'bolt' && this.perks.has('darts')) s.damage *= 1.15;
    if ((type === 'cannon' || type === 'mortar') && this.perks.has('powder')) s.splash *= 1.15;
    if (type === 'frost' && this.perks.has('rime')) s.slowTime *= 1.4;
    if (type === 'tesla' && this.perks.has('overcharge')) s.chains += 1;
    if (type === 'ember' && this.perks.has('kindling')) s.burn *= 1.25;
    if (this.perks.has('spyglass')) s.range *= 1.08;
    return s;
  }

  // ---------------------------------------------------------------- commands

  build(type, c, r) {
    if (!this.canBuild(type, c, r)) return null;
    const cost = this.buildCost(type);
    this.gold -= cost;
    this.stats.goldSpent += cost;
    const t = {
      id: this.nextId++,
      type,
      tier: 0,
      c,
      r,
      x: c + 0.5,
      y: r + 0.5,
      cooldown: 0.2,
      aim: -Math.PI / 2,
      target: 0,
      mode: 'first',
      invested: cost,
      touchedAt: this.time,
      kills: 0,
      damage: 0,
      s: this.towerStats(type, 0),
    };
    this.towers.push(t);
    this.occupied.set(r * this.map.w + c, t.id);
    this.stats.built++;
    this.record('build', type, c, r);
    this.emit({ type: 'build', tower: t });
    return t;
  }

  upgrade(id) {
    const t = this.towers.find((x) => x.id === id);
    if (!t || this.isOver()) return false;
    const cost = this.upgradeCost(t);
    if (cost === null || this.gold < cost) return false;
    this.gold -= cost;
    this.stats.goldSpent += cost;
    t.tier++;
    t.invested += cost;
    t.touchedAt = this.time;
    t.s = this.towerStats(t.type, t.tier);
    this.record('upgrade', id);
    this.emit({ type: 'upgrade', tower: t });
    return true;
  }

  canSell() {
    return !this.modifiers.has('nosell') || this.status === 'ready';
  }

  sell(id) {
    const i = this.towers.findIndex((x) => x.id === id);
    if (i < 0 || this.isOver() || !this.canSell()) return false;
    const t = this.towers[i];
    const value = this.sellValue(t);
    this.gold += value;
    this.towers.splice(i, 1);
    this.occupied.delete(t.r * this.map.w + t.c);
    this.record('sell', id);
    this.emit({ type: 'sell', tower: t, value });
    return true;
  }

  cycleTargeting(id) {
    const t = this.towers.find((x) => x.id === id);
    if (!t) return null;
    t.mode = TARGET_MODES[(TARGET_MODES.indexOf(t.mode) + 1) % TARGET_MODES.length];
    this.record('target', id);
    return t.mode;
  }

  setTargeting(id, mode) {
    const t = this.towers.find((x) => x.id === id);
    if (!t || !TARGET_MODES.includes(mode)) return false;
    t.mode = mode;
    this.record('mode', id, mode);
    return true;
  }

  // Launches the next wave now. Calling early (while a countdown is running or
  // enemies are still on the field) pays a bonus.
  callWave() {
    if (this.isOver() || this.waveIndex >= this.totalWaves) return false;
    let bonus = 0;
    if (this.status === 'playing') {
      if (this.countdown !== null) bonus = Math.ceil(this.countdown);
      else if (this.enemies.length > 0 || this.spawners.length > 0) bonus = 10 + this.waveIndex;
      if (this.perks.has('bugle')) bonus *= 2;
    }
    if (bonus > 0) {
      this.gold += bonus;
      this.stats.goldEarned += bonus;
    }
    this.record('wave');
    this.launchWave();
    return bonus;
  }

  record(op, ...args) {
    this.log.push([this.ticks, op, ...args]);
  }

  launchWave() {
    const wave = this.wave(this.waveIndex);
    for (const g of wave.groups) {
      this.spawners.push({ group: g, spawned: 0, timer: g.delay, hpScale: wave.hpScale, wave: wave.index });
    }
    this.emit({ type: 'wave', index: this.waveIndex, boss: wave.groups.some((g) => ENEMIES[g.type].boss) });
    this.waveIndex++;
    this.countdown = null;
    this.status = 'playing';
  }

  // ---------------------------------------------------------------- update

  // Advances the simulation by dt seconds of game time using fixed ticks.
  // Returns the interpolation factor for rendering between ticks.
  update(dt) {
    if (this.isOver()) return 1;
    this.acc += Math.min(dt, TICK * MAX_TICKS_PER_UPDATE);
    let n = 0;
    while (this.acc >= TICK && n < MAX_TICKS_PER_UPDATE) {
      this.beforeTick?.();
      this.tick();
      this.acc -= TICK;
      n++;
      if (this.isOver()) {
        this.acc = 0;
        break;
      }
    }
    return this.acc / TICK;
  }

  tick() {
    const dt = TICK;
    this.ticks++;
    this.time += dt;
    this.updateSpawners(dt);
    this.updateEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.reap();
    this.updateFlow(dt);
    if (this.time >= this.nextSample || this.isOver()) this.sample();
  }

  sample() {
    this.nextSample = this.time + TIMELINE_STEP;
    this.timeline.push({ t: this.time, lives: this.lives, gold: this.gold, enemies: this.enemies.length, wave: this.waveIndex });
    // Long endless runs: halve the resolution instead of growing forever.
    if (this.timeline.length > TIMELINE_MAX) this.timeline = this.timeline.filter((_, i) => i % 2 === 0 || i === this.timeline.length - 1);
  }

  updateSpawners(dt) {
    for (const sp of this.spawners) {
      sp.timer -= dt;
      while (sp.timer <= 0 && sp.spawned < sp.group.count) {
        this.spawnEnemy(sp.group.type, sp.group.spawn % this.map.routes.length, sp.hpScale, sp.wave, -sp.timer);
        sp.spawned++;
        sp.timer += sp.group.interval || 0.01;
      }
    }
    this.spawners = this.spawners.filter((sp) => sp.spawned < sp.group.count);
  }

  spawnEnemy(type, routeIdx, scale, wave, head = 0, d = 0) {
    const def = ENEMIES[type];
    const route = this.map.routes[routeIdx];
    // Bosses already have huge base health; scaling them as hard as the rank
    // and file makes mid-level bosses unkillable.
    if (def.boss) scale = Math.pow(scale, 0.6);
    const hp = Math.round(def.hp * scale * this.diff.hp * (this.modifiers.has('stubborn') ? 1.4 : 1));
    const shield = def.shield ? Math.round(def.shield * scale * this.diff.hp) : 0;
    const e = {
      id: this.nextId++,
      type,
      route: routeIdx,
      d: d + head * def.speed,
      seg: 0,
      x: 0,
      y: 0,
      px: 0,
      py: 0,
      dir: 0,
      hp,
      maxHp: hp,
      shield,
      maxShield: shield,
      armor: (def.armor || 0) + (this.modifiers.has('ironclad') ? 3 : 0),
      speed: def.speed * (this.modifiers.has('swift') ? 1.2 : 1),
      air: !!def.air,
      boss: !!def.boss,
      slowMul: 1,
      slowTime: 0,
      burnDps: 0,
      burnTime: 0,
      lastHit: -99,
      healTimer: def.heal ? def.heal.every : 0,
      wave,
      dead: false,
      leaked: false,
    };
    const p = routePos(route, e.d, 0);
    e.x = e.px = p.x;
    e.y = e.py = p.y;
    e.seg = p.seg;
    e.dir = p.dir;
    this.enemies.push(e);
    this.enemyById.set(e.id, e);
    this.emit({ type: 'spawn', enemy: e });
    return e;
  }

  updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const def = ENEMIES[e.type];
      e.px = e.x;
      e.py = e.y;

      if (e.slowTime > 0) {
        e.slowTime -= dt;
        if (e.slowTime <= 0) e.slowMul = 1;
      }
      if (e.burnTime > 0) {
        e.burnTime -= dt;
        this.damage(e, e.burnDps * dt, 'energy', null, true);
        if (e.burnTime <= 0) e.burnDps = 0;
        if (e.dead) continue;
      }
      if (e.maxShield > 0 && e.shield < e.maxShield && this.time - e.lastHit > SHIELD_REGEN_DELAY) {
        e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.12 * dt);
      }
      if (def.heal) {
        e.healTimer -= dt;
        if (e.healTimer <= 0) {
          e.healTimer += def.heal.every;
          const r2 = def.heal.radius * def.heal.radius;
          let healed = 0;
          for (const o of this.enemies) {
            if (o === e || o.dead || o.boss || o.hp >= o.maxHp) continue;
            if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 > r2) continue;
            o.hp = Math.min(o.maxHp, o.hp + o.maxHp * def.heal.fraction);
            healed++;
          }
          if (healed) this.emit({ type: 'heal', enemy: e });
        }
      }

      const route = this.map.routes[e.route];
      e.d += e.speed * e.slowMul * dt;
      if (e.d >= route.length) {
        e.leaked = true;
        e.dead = true;
        continue;
      }
      const p = routePos(route, e.d, e.seg);
      e.x = p.x;
      e.y = p.y;
      e.seg = p.seg;
      e.dir = p.dir;
    }
  }

  remaining(e) {
    return this.map.routes[e.route].length - e.d;
  }

  findTarget(t) {
    const s = t.s;
    const def = TOWERS[t.type];
    const r2 = s.range * s.range;
    const min2 = s.minRange ? s.minRange * s.minRange : 0;
    let best = null;
    let bestScore = -Infinity;
    for (const e of this.enemies) {
      if (e.dead || e.d < 0) continue;
      if (e.air ? !def.hitsAir : !def.hitsGround) continue;
      const d2 = (e.x - t.x) ** 2 + (e.y - t.y) ** 2;
      if (d2 > r2 || d2 < min2) continue;
      let score;
      switch (t.mode) {
        case 'last':
          score = this.remaining(e);
          break;
        case 'strong':
          score = e.hp + e.shield;
          break;
        case 'close':
          score = -d2;
          break;
        default:
          score = -this.remaining(e);
      }
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  updateTowers(dt) {
    for (const t of this.towers) {
      t.cooldown -= dt;
      if (t.cooldown > 0) continue;
      const s = t.s;
      if (TOWERS[t.type].kind === 'pulse') {
        if (this.pulse(t)) t.cooldown += 1 / s.rate;
        else t.cooldown = 0;
        continue;
      }
      const target = this.findTarget(t);
      if (!target) {
        t.cooldown = 0;
        t.target = 0;
        continue;
      }
      t.target = target.id;
      t.aim = Math.atan2(target.y - t.y, target.x - t.x);
      t.cooldown += 1 / s.rate;
      this.fire(t, target);
    }
  }

  fire(t, target) {
    const s = t.s;
    const def = TOWERS[t.type];
    if (def.kind === 'chain') {
      this.chain(t, target);
      return;
    }
    if (def.kind === 'mortar') {
      // Lead the target by predicting where it will be when the shell lands.
      const route = this.map.routes[target.route];
      const p = routePos(route, target.d + target.speed * target.slowMul * s.flight, target.seg);
      this.projectiles.push({
        id: this.nextId++,
        type: t.type,
        tier: t.tier,
        tower: t.id,
        x: t.x,
        y: t.y,
        sx: t.x,
        sy: t.y,
        tx: p.x,
        ty: p.y,
        px: t.x,
        py: t.y,
        t: 0,
        flight: s.flight,
        damage: s.damage,
        splash: s.splash,
        arc: true,
      });
      this.emit({ type: 'fire', tower: t });
      return;
    }
    this.projectiles.push({
      id: this.nextId++,
      type: t.type,
      tier: t.tier,
      tower: t.id,
      x: t.x,
      y: t.y,
      px: t.x,
      py: t.y,
      tx: target.x,
      ty: target.y,
      target: target.id,
      targetAir: target.air,
      speed: s.projSpeed,
      damage: s.damage,
      splash: s.splash || 0,
      slow: s.slow || 0,
      slowTime: s.slowTime || 0,
      arc: false,
    });
    this.emit({ type: 'fire', tower: t });
  }

  chain(t, first) {
    const s = t.s;
    const hit = new Set();
    const points = [{ x: t.x, y: t.y, air: false }];
    let cur = first;
    let dmg = s.damage;
    const r2 = s.chainRange * s.chainRange;
    for (let i = 0; i < s.chains && cur; i++) {
      hit.add(cur.id);
      points.push({ x: cur.x, y: cur.y, air: cur.air });
      this.damage(cur, dmg, 'energy', t);
      dmg *= s.falloff;
      let next = null;
      let nd = Infinity;
      for (const e of this.enemies) {
        if (e.dead || hit.has(e.id) || e.d < 0) continue;
        const d2 = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
        if (d2 <= r2 && d2 < nd) {
          nd = d2;
          next = e;
        }
      }
      cur = next;
    }
    this.emit({ type: 'chain', tower: t, points });
  }

  pulse(t) {
    const s = t.s;
    const r2 = s.range * s.range;
    let any = false;
    for (const e of this.enemies) {
      if (e.dead || e.air || e.d < 0) continue;
      if ((e.x - t.x) ** 2 + (e.y - t.y) ** 2 > r2) continue;
      any = true;
      this.damage(e, s.damage, 'energy', t);
      if (s.burn >= e.burnDps) {
        e.burnDps = s.burn;
        e.burnTime = s.burnTime;
      } else {
        e.burnTime = Math.max(e.burnTime, s.burnTime * 0.5);
      }
    }
    if (any) this.emit({ type: 'pulse', tower: t });
    return any;
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const p of this.projectiles) {
      p.px = p.x;
      p.py = p.y;
      if (p.arc) {
        p.t += dt;
        const k = Math.min(1, p.t / p.flight);
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        if (k >= 1) {
          this.impact(p, null);
          continue;
        }
        keep.push(p);
        continue;
      }
      const found = p.target ? this.enemyById.get(p.target) : null;
      const target = found && !found.dead ? found : null;
      if (target) {
        p.tx = target.x;
        p.ty = target.y;
      }
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (dist <= step) {
        p.x = p.tx;
        p.y = p.ty;
        this.impact(p, target);
        continue;
      }
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
      keep.push(p);
    }
    this.projectiles = keep;
  }

  impact(p, target) {
    const def = TOWERS[p.type];
    const tower = this.towers.find((t) => t.id === p.tower) || null;
    if (p.splash > 0) {
      const r2 = p.splash * p.splash;
      for (const e of this.enemies) {
        if (e.dead || e.d < 0) continue;
        if (e.air ? !def.hitsAir : !def.hitsGround) continue;
        // Splash from a shell aimed at the ground never reaches fliers, and a
        // frost shard aimed at a flier only splashes other fliers.
        if (p.targetAir !== undefined && e.air !== p.targetAir) continue;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > r2) continue;
        this.damage(e, p.damage, def.damageType, tower);
        if (p.slow) this.applySlow(e, p.slow, p.slowTime);
      }
    } else if (target) {
      this.damage(target, p.damage, def.damageType, tower);
      if (p.slow) this.applySlow(target, p.slow, p.slowTime);
    }
    this.emit({ type: 'impact', proj: p, x: p.x, y: p.y, air: !!p.targetAir });
  }

  applySlow(e, mul, time) {
    const m = e.boss ? 1 - (1 - mul) * 0.5 : mul;
    if (m <= e.slowMul) {
      e.slowMul = m;
      e.slowTime = Math.max(e.slowTime, time);
    } else if (e.slowTime < time * 0.5) {
      e.slowTime = time * 0.5;
    }
  }

  damage(e, amount, type, tower, silent = false) {
    if (e.dead || amount <= 0) return;
    let dmg = amount;
    e.lastHit = this.time;
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, dmg);
      e.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0 && e.shield <= 0 && !silent) this.emit({ type: 'shieldBreak', enemy: e });
      if (dmg <= 0) {
        if (tower) tower.damage += absorbed;
        return;
      }
    }
    if (type === 'physical' && e.armor > 0) dmg = Math.max(dmg * 0.2, dmg - e.armor);
    const dealt = Math.min(dmg, e.hp);
    e.hp -= dmg;
    if (tower) tower.damage += dealt;
    if (e.hp <= 0) {
      e.dead = true;
      e.killedBy = tower ? tower.id : 0;
      if (tower) tower.kills++;
    }
  }

  reap() {
    if (!this.enemies.some((e) => e.dead)) return;
    const alive = [];
    const spawned = [];
    for (const e of this.enemies) {
      if (!e.dead) {
        alive.push(e);
        continue;
      }
      this.enemyById.delete(e.id);
      const def = ENEMIES[e.type];
      if (e.leaked) {
        this.lives = Math.max(0, this.lives - def.lives);
        this.stats.leaks++;
        this.emit({ type: 'leak', enemy: e, lives: def.lives });
        continue;
      }
      const bounty = Math.round(def.bounty * (1 + 0.03 * e.wave) * this.diff.bounty * (this.perks.has('bounty') ? 1.1 : 1) * this.bountyMod());
      this.gold += bounty;
      this.stats.goldEarned += bounty;
      this.stats.kills++;
      this.stats.killsByType[e.type] = (this.stats.killsByType[e.type] || 0) + 1;
      this.emit({ type: 'death', enemy: e, bounty });
      if (def.split) spawned.push(e);
    }
    this.enemies = alive;
    for (const e of spawned) {
      const def = ENEMIES[e.type];
      const scale = e.maxHp / (def.hp * this.diff.hp);
      for (let i = 0; i < def.split.count; i++) {
        const child = this.spawnEnemy(def.split.type, e.route, scale, e.wave, 0, Math.max(0, e.d + (i - 1) * 0.25));
        child.slowMul = e.slowMul;
        child.slowTime = e.slowTime;
      }
    }
  }

  updateFlow(dt) {
    // A wave counts as cleared once none of its enemies (or their splits)
    // remain and it has nothing left to spawn.
    let oldest = this.waveIndex;
    for (const e of this.enemies) if (e.wave < oldest) oldest = e.wave;
    for (const sp of this.spawners) if (sp.wave < oldest) oldest = sp.wave;
    if (oldest > this.stats.wavesCleared) this.stats.wavesCleared = oldest;

    if (this.lives <= 0) {
      this.status = 'lost';
      this.emit({ type: 'lost' });
      return;
    }
    if (this.status !== 'playing') return;
    const fieldClear = this.enemies.length === 0 && this.spawners.length === 0;
    if (!fieldClear) return;
    if (this.waveIndex >= this.totalWaves) {
      this.status = 'won';
      this.emit({ type: 'won' });
      return;
    }
    if (this.countdown === null) {
      this.countdown = AUTO_WAVE_DELAY;
      this.emit({ type: 'cleared', index: this.waveIndex - 1 });
    }
    this.countdown -= dt;
    if (this.countdown <= 0) this.launchWave();
  }

  bountyMod() {
    let m = 1;
    if (this.modifiers.has('lean')) m *= 0.65;
    if (this.modifiers.has('stubborn')) m *= 1.2;
    return m;
  }

  stars() {
    if (this.status !== 'won') return 0;
    const frac = this.lives / this.maxLives;
    return frac >= 0.9 ? 3 : frac >= 0.5 ? 2 : 1;
  }

  emit(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}

export { towerInvested };
