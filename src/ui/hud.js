import { TOWERS, TOWER_ORDER } from '../sim/data/towers.js';
import { ENEMIES } from '../sim/data/enemies.js';
import { waveSummary } from '../sim/waves.js';
import { clear, h, icon } from './dom.js';

const MODE_LABEL = { first: 'First', last: 'Last', strong: 'Strongest', close: 'Closest' };

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function statLines(type, s) {
  const def = TOWERS[type];
  const lines = [['Damage', fmt(s.damage)], ['Rate', `${fmt(s.rate)}/s`], ['Range', fmt(s.range)]];
  if (s.splash) lines.push(['Blast', fmt(s.splash)]);
  if (s.slow) lines.push(['Slow', `${Math.round((1 - s.slow) * 100)}% · ${fmt(s.slowTime)}s`]);
  if (s.chains) lines.push(['Arcs', String(s.chains)]);
  if (s.burn) lines.push(['Burn', `${s.burn}/s`]);
  if (s.minRange) lines.push(['Min range', fmt(s.minRange)]);
  lines.push(['Targets', def.hitsAir ? (def.hitsGround ? 'Ground & air' : 'Air') : 'Ground']);
  return lines;
}

// The in-battle heads-up display: resources, build bar, wave control, the
// selected tower panel, announcements and the level 1 tutorial.
export class Hud {
  constructor(container, ctx) {
    this.el = container;
    this.ctx = ctx;
    this.cache = {};
    this.build();
  }

  build() {
    const a = this.ctx.actions;
    this.lives = h('span.val');
    this.gold = h('span.val');
    this.waveTxt = h('span.val');
    this.fps = h('div.fps');
    this.top = h('div.hud-top',
      h('div.res', { title: 'Lives' }, icon('heart', 'icon'), this.lives),
      h('div.res', { title: 'Gold' }, icon('coin', 'icon'), this.gold),
      h('div.res', { title: 'Wave' }, icon('wave', 'icon'), this.waveTxt),
      h('div.spacer'),
      this.fps,
    );
    this.speedBtns = [1, 2, 3].map((n) => h('button.hbtn.speed', {
      title: `Speed ×${n} (F)`,
      onclick: () => {
        this.ctx.audio.play('click');
        a.setSpeed(n);
      },
    }, `${n}×`));
    this.pauseBtn = h('button.hbtn', { title: 'Pause (P)', onclick: () => a.togglePause() }, 'II');
    this.top.append(h('div.speeds', this.speedBtns), this.pauseBtn);

    // Wave control
    this.preview = h('div.preview');
    this.waveBtn = h('button.wave-btn', { onclick: () => a.callWave() });
    this.waveBox = h('div.wave-box', this.waveBtn, this.preview);

    // Build bar
    this.buildBtns = {};
    this.bar = h('div.build-bar');
    for (const [i, type] of TOWER_ORDER.entries()) {
      const cost = h('span.cost');
      const b = h('button.tower-btn', {
        onclick: () => a.selectBuild(type),
        onmouseenter: () => this.showTip(type, b),
        onmouseleave: () => this.hideTip(),
      }, h('span.hotkey', String(i + 1)), icon(type, 'icon'), cost);
      this.buildBtns[type] = { b, cost };
      this.bar.appendChild(b);
    }
    this.tip = h('div.tip');
    this.tip.hidden = true;

    // Selected tower
    this.panel = h('div.tower-panel');
    this.panel.hidden = true;

    this.announceEl = h('div.announce');
    this.cards = h('div.cards');
    this.hint = h('div.hint');
    this.hint.hidden = true;
    this.vignette = h('div.vignette');

    this.el.append(this.vignette, this.top, this.waveBox, this.bar, this.tip, this.panel, this.announceEl, this.cards, this.hint);
  }

  attach(game, { tutorial }) {
    this.game = game;
    this.cache = {};
    this.selected = null;
    this.buildType = null;
    this.panel.hidden = true;
    clear(this.cards);
    clear(this.announceEl);
    for (const type of TOWER_ORDER) {
      const allowed = game.towerAllowed(type);
      this.buildBtns[type].b.hidden = !allowed;
    }
    this.tutorial = tutorial ? 0 : -1;
    this.updateTutorial();
    this.el.hidden = false;
  }

  detach() {
    this.game = null;
    this.el.hidden = true;
    this.hideTip();
    this.hint.hidden = true;
  }

  // ---------------------------------------------------------------- per frame

  update(session, fps) {
    const g = this.game;
    if (!g) return;
    const set = (key, val, fn) => {
      if (this.cache[key] !== val) {
        this.cache[key] = val;
        fn(val);
      }
    };
    set('lives', g.lives, (v) => {
      this.lives.textContent = String(v);
      this.lives.parentElement.classList.toggle('low', v <= Math.max(3, g.maxLives * 0.25));
    });
    set('gold', g.gold, (v) => (this.gold.textContent = String(v)));
    set('wave', `${g.waveIndex}|${g.totalWaves}`, () => {
      this.waveTxt.textContent = g.endless ? `${g.waveIndex}` : `${g.waveIndex} / ${g.totalWaves}`;
    });
    set('speed', session.speed, (v) => this.speedBtns.forEach((b, i) => b.classList.toggle('on', i + 1 === v)));
    set('fps', this.ctx.save.settings.showFps ? Math.round(fps) : -1, (v) => {
      this.fps.textContent = v >= 0 ? `${v} fps` : '';
    });

    for (const type of TOWER_ORDER) {
      const cost = g.buildCost(type);
      const { b, cost: c } = this.buildBtns[type];
      set(`cost-${type}`, cost, (v) => (c.textContent = String(v)));
      set(`afford-${type}`, g.gold >= cost, (v) => b.classList.toggle('poor', !v));
      set(`sel-${type}`, this.buildType === type, (v) => b.classList.toggle('on', v));
    }

    // Wave button text: state + countdown/bonus.
    const done = g.waveIndex >= g.totalWaves;
    let label;
    if (done) label = 'Final wave';
    else if (g.status === 'ready') label = 'Send first wave';
    else if (g.countdown !== null) label = `Next wave in ${Math.ceil(g.countdown)}s`;
    else label = 'Send next wave early';
    const bonus = this.bonusPreview(g);
    set('waveBtn', `${label}|${bonus}|${done}`, () => {
      clear(this.waveBtn).append(
        h('span.wave-label', label),
        !done ? h('span.wave-key', 'Space') : null,
        bonus > 0 ? h('span.bonus', `+${bonus}`, icon('coin', 'icon tiny')) : null,
      );
      this.waveBtn.disabled = done;
    });
    set('preview', g.waveIndex, () => this.renderPreview(g));

    if (this.selected) this.updatePanel();
  }

  bonusPreview(g) {
    if (g.status !== 'playing' || g.waveIndex >= g.totalWaves) return 0;
    let b = 0;
    if (g.countdown !== null) b = Math.ceil(g.countdown);
    else if (g.enemies.length || g.spawners.length) b = 10 + g.waveIndex;
    return g.perks.has('bugle') ? b * 2 : b;
  }

  renderPreview(g) {
    clear(this.preview);
    const wave = g.nextWave();
    if (!wave) return;
    const boss = wave.groups.some((x) => ENEMIES[x.type].boss);
    this.preview.append(h('span.preview-label', boss ? 'Boss wave' : `Wave ${wave.index + 1}`));
    for (const { type, count } of waveSummary(wave)) {
      this.preview.append(h(`span.preview-item${ENEMIES[type].boss ? '.boss' : ''}`, { title: ENEMIES[type].name }, icon(type, 'icon small'), `×${count}`));
    }
    this.preview.classList.toggle('boss', boss);
  }

  // ---------------------------------------------------------------- build tooltip

  showTip(type) {
    if (!this.game) return;
    const t = TOWERS[type];
    const s = this.game.towerStats(type, 0);
    clear(this.tip).append(
      h('div.tip-head', icon(type, 'icon'), h('div', h('div.tip-name', t.name), h('div.tip-cost', icon('coin', 'icon tiny'), String(this.game.buildCost(type))))),
      h('div.tip-blurb', t.blurb),
      h('table.tip-stats', statLines(type, s).map(([k, v]) => h('tr', h('td', k), h('td', v)))),
    );
    this.tip.hidden = false;
  }

  hideTip() {
    this.tip.hidden = true;
  }

  setBuild(type) {
    this.buildType = type;
  }

  // ---------------------------------------------------------------- tower panel

  select(tower) {
    this.selected = tower;
    this.panelKey = null;
    this.panel.hidden = !tower;
    if (tower) this.updatePanel();
  }

  updatePanel() {
    const g = this.game;
    const t = this.selected;
    if (!g.towers.includes(t)) {
      this.select(null);
      return;
    }
    const up = g.upgradeCost(t);
    const key = `${t.id}|${t.tier}|${t.mode}|${g.gold >= (up ?? Infinity)}|${t.kills}|${Math.round(t.damage / 50)}`;
    if (key === this.panelKey) return;
    this.panelKey = key;
    const a = this.ctx.actions;
    const def = TOWERS[t.type];
    const cur = t.s;
    const next = up !== null ? g.towerStats(t.type, t.tier + 1) : null;
    const rows = statLines(t.type, cur).map(([k, v]) => {
      let delta = null;
      if (next) {
        const nv = statLines(t.type, next).find(([nk]) => nk === k)?.[1];
        if (nv && nv !== v) delta = h('span.delta', `→ ${nv}`);
      }
      return h('tr', h('td', k), h('td', v, delta));
    });
    clear(this.panel).append(
      h('div.panel-top',
        icon(t.type, 'icon'),
        h('div', h('div.tp-name', def.name), h('div.pips', [0, 1, 2].map((i) => h(`span.pip${i <= t.tier ? '.on' : ''}`)))),
        h('button.close', { title: 'Close (Esc)', onclick: () => a.deselect() }, '×'),
      ),
      h('table.tp-stats', rows),
      h('div.tp-record', `${t.kills} kills · ${Math.round(t.damage)} damage`),
      h('div.tp-actions',
        h('button.hbtn.target', { title: 'Targeting (T)', onclick: () => a.cycleTarget() }, `Target: ${MODE_LABEL[t.mode]}`),
        up !== null
          ? h(`button.hbtn.upgrade${g.gold >= up ? '' : '.poor'}`, { title: 'Upgrade (U)', onclick: () => a.upgrade() }, 'Upgrade ', icon('coin', 'icon tiny'), String(up))
          : h('button.hbtn.upgrade', { disabled: true }, 'Max tier'),
        h('button.hbtn.sell', { title: 'Sell (X)', onclick: () => a.sell() }, 'Sell ', icon('coin', 'icon tiny'), String(g.sellValue(t))),
      ),
    );
  }

  // ---------------------------------------------------------------- messages

  announce(text, sub = '', cls = '') {
    const el = h(`div.announce-item${cls ? '.' + cls : ''}`, h('div.big', text), sub ? h('div.sub', sub) : null);
    clear(this.announceEl).appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  enemyCard(type) {
    const e = ENEMIES[type];
    const card = h('div.card', { onclick: () => card.remove() },
      icon(type, 'icon big'),
      h('div', h('div.card-kicker', e.boss ? 'Boss' : 'New enemy'), h('div.card-name', e.name), h('div.card-blurb', e.blurb)),
    );
    this.cards.appendChild(card);
    setTimeout(() => card.classList.add('out'), 9000);
    setTimeout(() => card.remove(), 9600);
  }

  flashDamage() {
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('hit');
  }

  toast(text) {
    const el = h('div.announce-item.small', h('div.sub', text));
    clear(this.announceEl).appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  // ---------------------------------------------------------------- tutorial

  static TUTORIAL = [
    'Choose the <b>Bolt Turret</b> in the bar below (or press <b>1</b>), then click open ground next to the road.',
    'Good. A second tower helps: try an <b>Ember Cannon</b> (<b>2</b>) where the road bends. Then press <b>Send first wave</b> or <b>Space</b>.',
    'Kills pay gold. Click a tower to <b>upgrade</b> it or change what it targets.',
    '<b>Right-drag</b> rotates the view, the <b>wheel</b> zooms and <b>WASD</b> pans. Calling waves early pays a bonus. Good luck!',
  ];

  tutorialEvent(kind) {
    if (this.tutorial < 0) return;
    const step = this.tutorial;
    if (step === 0 && kind === 'build') this.tutorial = 1;
    else if (step === 1 && kind === 'wave') this.tutorial = 2;
    else if (step === 2 && (kind === 'upgrade' || kind === 'cleared2')) {
      this.tutorial = 3;
      setTimeout(() => {
        if (this.tutorial === 3) {
          this.tutorial = -1;
          this.updateTutorial();
          this.ctx.actions.tutorialDone();
        }
      }, 12000);
    }
    if (step !== this.tutorial) this.updateTutorial();
  }

  updateTutorial() {
    if (this.tutorial < 0) {
      this.hint.hidden = true;
      return;
    }
    this.hint.innerHTML = Hud.TUTORIAL[this.tutorial];
    this.hint.hidden = false;
  }
}

