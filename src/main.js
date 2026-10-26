import './style.css';
import { LEVELS } from './sim/data/levels.js';
import { ENEMIES } from './sim/data/enemies.js';
import { TOWER_ORDER } from './sim/data/towers.js';
import { Game } from './sim/game.js';
import { Bot } from './sim/bot.js';
import { World } from './render/world.js';
import { Audio } from './audio/audio.js';
import { Save } from './save.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';

const save = new Save();
const audio = new Audio(save.settings);
const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');

let world;
try {
  world = new World(stage, overlay, { quality: save.settings.quality });
} catch (err) {
  document.getElementById('nogl').hidden = false;
  throw err;
}

// session: the battle (or title-screen demo) currently running.
let session = null;
let lastFrame = performance.now();
let fpsAvg = 60;

const actions = {
  onTitle: () => {
    if (!session || !session.demo) startDemo();
    audio.setMusic('title');
  },
  startLevel: (idx, difficulty, endless) => startBattle(idx, difficulty, endless),
  restart: () => {
    if (!session || session.demo) return;
    startBattle(session.game.levelIdx, session.game.difficulty, session.game.endless);
  },
  quitToMenu: (where = 'levels') => {
    if (session && !session.demo && !session.recorded) recordResult(true);
    hud.detach();
    startDemo();
    if (where === 'endless') screens.endless();
    else if (where === 'title') screens.title();
    else screens.levels();
  },
  resume: () => setPaused(false),
  togglePause: () => setPaused(!session?.paused),
  setSpeed: (n) => {
    if (session && !session.demo) session.speed = n;
  },
  callWave: () => {
    if (!session || session.demo || session.paused) return;
    const g = session.game;
    if (g.waveIndex >= g.totalWaves || g.isOver()) return;
    const bonus = g.callWave();
    if (bonus > 0) hud.toast(`Early call: +${bonus} gold`);
  },
  selectBuild: (type) => setBuild(session?.buildType === type ? null : type),
  deselect: () => select(null),
  upgrade: () => {
    const t = session?.selected;
    if (!t) return;
    if (!session.game.upgrade(t.id)) audio.play('error');
  },
  sell: () => {
    const t = session?.selected;
    if (!t) return;
    session.game.sell(t.id);
    select(null);
  },
  cycleTarget: () => {
    const t = session?.selected;
    if (!t) return;
    session.game.cycleTargeting(t.id);
    audio.play('click');
  },
  applySettings: () => {
    audio.applyVolumes();
    world.reduceMotion = save.settings.reduceMotion;
    if (world.quality !== save.settings.quality) world.setQuality(save.settings.quality);
  },
  tutorialDone: () => {
    save.data.tutorialDone = true;
    save.persist();
  },
};

world.reduceMotion = save.settings.reduceMotion;

const ctx = { save, audio, actions };
const hud = new Hud(document.getElementById('hud'), ctx);
const screens = new Screens(document.getElementById('screens'), ctx);
hud.detach();

// ---------------------------------------------------------------- sessions

function startDemo() {
  // The title screen plays a real battle in the background with the bot.
  const unlocked = LEVELS.filter((_, i) => save.isUnlocked(i));
  const idx = Math.floor(Math.random() * Math.min(unlocked.length, LEVELS.length));
  const game = new Game({ level: LEVELS[idx], levelIdx: idx, difficulty: 'casual' });
  session = { game, demo: true, bot: new Bot(game, { seed: Date.now() & 0xffff, skill: 0.8 }), speed: 1, paused: false };
  world.load(game);
  world.controls.autoRotate = true;
  world.controls.autoRotateSpeed = 0.35;
  audio.setMusic('title');
}

function startBattle(idx, difficulty, endless) {
  const level = LEVELS[idx];
  const game = new Game({ level, levelIdx: idx, difficulty, perks: save.data.perks, endless });
  session = { game, demo: false, speed: 1, paused: false, buildType: null, selected: null, recorded: false };
  world.controls.autoRotate = false;
  world.load(game);
  screens.hide();
  hud.attach(game, { tutorial: idx === 0 && !endless && !save.data.tutorialDone });
  audio.unlock();
  audio.setMusic(level.theme);
  audio.setIntensity(0);
  hud.announce(level.name, endless ? 'Endless Siege' : level.intro, 'intro');
}

function setPaused(p) {
  if (!session || session.demo || session.game.isOver()) return;
  session.paused = p;
  if (p) {
    setBuild(null);
    screens.pause(session.game);
  } else {
    screens.hide();
  }
}

function setBuild(type) {
  if (!session || session.demo) return;
  if (type && !session.game.towerAllowed(type)) return;
  session.buildType = type;
  hud.setBuild(type);
  if (type) select(null);
  if (!type) world.setGhost(null);
  else if (lastTile) updateCursor();
}

function select(tower) {
  if (!session) return;
  session.selected = tower;
  world.setSelected(tower);
  hud.select(tower);
}

function recordResult(abandoned = false) {
  const g = session.game;
  session.recorded = true;
  save.addPlayTime(g.time);
  if (g.endless) {
    const newBest = save.recordEndless(g.level.id, g.stats.wavesCleared);
    save.persist();
    return { newBest };
  }
  if (g.status === 'won' && !abandoned) return save.recordWin(g.level.id, g.stars(), g.difficulty);
  save.persist();
  return null;
}

// ---------------------------------------------------------------- events

function handleEvents(events) {
  const s = session;
  for (const ev of events) {
    world.handle(ev);
    if (s.demo) continue;
    audio.handle(ev);
    switch (ev.type) {
      case 'wave': {
        const wave = s.game.wave(ev.index);
        if (ev.boss) {
          const boss = wave.groups.find((g) => ENEMIES[g.type].boss);
          hud.announce(ENEMIES[boss.type].name, 'A boss approaches the Hold', 'boss');
        } else {
          hud.announce(`Wave ${ev.index + 1}`, s.game.endless ? '' : `of ${s.game.totalWaves}`);
        }
        for (const g of wave.groups) {
          if (save.markSeen(g.type)) hud.enemyCard(g.type);
        }
        hud.tutorialEvent('wave');
        break;
      }
      case 'build':
      case 'upgrade':
        hud.tutorialEvent(ev.type);
        break;
      case 'cleared':
        if (ev.index >= 1) hud.tutorialEvent('cleared2');
        break;
      case 'leak':
        hud.flashDamage();
        break;
      case 'won':
      case 'lost': {
        setBuild(null);
        select(null);
        const outcome = recordResult();
        audio.play(ev.type === 'won' ? 'win' : 'lose', { force: true });
        audio.setIntensity(0);
        setTimeout(() => {
          if (session === s) screens.result(s.game, outcome);
        }, 1400);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- input

const canvas = world.renderer.domElement;
let down = null;
let lastTile = null;
let lastPointer = null;

function updateCursor() {
  if (!session || session.demo || !lastPointer) return;
  const g = session.game;
  const tile = world.pickTile(lastPointer.x, lastPointer.y);
  lastTile = tile;
  if (!tile) {
    world.setHover(null);
    world.setGhost(null);
    canvas.style.cursor = 'default';
    return;
  }
  if (session.buildType) {
    const ok = g.canBuild(session.buildType, tile.c, tile.r);
    world.setGhost(session.buildType, tile, ok);
    world.setHover(tile, ok ? 0x9dffb0 : 0xff8a8a);
    canvas.style.cursor = ok ? 'copy' : 'not-allowed';
  } else {
    const t = g.towerAt(tile.c, tile.r);
    world.setGhost(null);
    world.setHover(t ? tile : null, 0xffe08a);
    canvas.style.cursor = t ? 'pointer' : 'default';
  }
}

canvas.addEventListener('pointermove', (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  updateCursor();
});

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
});

canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const btn = down.button;
  down = null;
  if (moved > 6 || !session || session.demo || session.paused) return;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (btn === 2) {
    setBuild(null);
    select(null);
    return;
  }
  if (btn !== 0) return;
  click(world.pickTile(e.clientX, e.clientY), e.shiftKey);
});

canvas.addEventListener('pointerleave', () => {
  world.setHover(null);
  world.setGhost(null);
  lastPointer = null;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function click(tile, keepBuilding) {
  const g = session.game;
  if (g.isOver()) return;
  if (!tile) {
    select(null);
    return;
  }
  if (session.buildType) {
    const type = session.buildType;
    const existing = g.towerAt(tile.c, tile.r);
    if (existing) {
      setBuild(null);
      select(existing);
      return;
    }
    if (g.canBuild(type, tile.c, tile.r)) {
      g.build(type, tile.c, tile.r);
      if (!keepBuilding || g.gold < g.buildCost(type)) setBuild(null);
    } else {
      audio.play('error');
      if (g.gold < g.buildCost(type)) hud.toast('Not enough gold');
    }
    updateCursor();
    return;
  }
  select(g.towerAt(tile.c, tile.r) || null);
}

const PAN_KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'KeyM') {
    save.settings.muted = !save.settings.muted;
    save.persist();
    audio.applyVolumes();
    if (session && !session.demo) hud.toast(save.settings.muted ? 'Sound off' : 'Sound on');
    return;
  }
  if (e.code === 'Escape' && screens.current && screens.current !== 'title' && screens.current !== 'result') {
    if (screens.back()) return;
  }
  if (!session || session.demo) return;
  if (PAN_KEYS[e.code] && !session.paused) {
    world.setPanKey(PAN_KEYS[e.code], true);
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (screens.current && screens.current !== 'pause') return;
    if (session.paused) setPaused(false);
    else if (e.code === 'Escape' && (session.buildType || session.selected)) {
      setBuild(null);
      select(null);
    } else setPaused(true);
    return;
  }
  if (session.paused || session.game.isOver()) return;
  const n = Number(e.key);
  if (n >= 1 && n <= TOWER_ORDER.length) {
    actions.selectBuild(TOWER_ORDER[n - 1]);
    return;
  }
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      actions.callWave();
      break;
    case 'KeyU':
      actions.upgrade();
      break;
    case 'KeyX':
    case 'Delete':
    case 'Backspace':
      actions.sell();
      break;
    case 'KeyT':
      actions.cycleTarget();
      break;
    case 'KeyF':
      session.speed = (session.speed % 3) + 1;
      break;
    case 'KeyC':
    case 'Home':
      world.frameCamera();
      break;
  }
});

// HUD buttons must not keep keyboard focus: Space would otherwise both fire
// the shortcut and activate the focused button.
document.getElementById('hud').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) b.blur();
});

window.addEventListener('keyup', (e) => {
  if (PAN_KEYS[e.code]) world.setPanKey(PAN_KEYS[e.code], false);
});

window.addEventListener('blur', () => {
  for (const k of ['up', 'down', 'left', 'right']) world.setPanKey(k, false);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (session && !session.demo && !session.game.isOver() && !session.paused) setPaused(true);
    audio.suspend();
  } else {
    audio.resume();
  }
});

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (session && !session.demo) setPaused(true);
});

// ---------------------------------------------------------------- loop

// If a battle runs well below 35 fps for several seconds, step graphics
// quality down once per level of quality so slower machines stay playable.
let slowFor = 0;
function adaptQuality(dt) {
  if (session.paused || document.hidden) return;
  slowFor = fpsAvg < 35 ? slowFor + dt : 0;
  if (slowFor < 6) return;
  slowFor = 0;
  const next = { high: 'medium', medium: 'low' }[save.settings.quality];
  if (!next) return;
  save.settings.quality = next;
  save.persist();
  world.setQuality(next);
  hud.toast(`Graphics set to ${next} to keep things smooth`);
}

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (realDt > 0) fpsAvg += (1 / realDt - fpsAvg) * 0.05;
  if (!session) return;

  const g = session.game;
  let alpha = 1;
  if (!session.paused) {
    const dt = realDt * session.speed;
    if (session.bot) session.bot.update(dt);
    alpha = g.update(dt);
    // The demo restarts on a fresh map when its battle ends.
    if (session.demo && g.isOver()) {
      startDemo();
      return;
    }
  }
  handleEvents(g.drainEvents());
  if (!session.demo) {
    adaptQuality(realDt);
    const busy = g.enemies.length + g.spawners.length;
    const boss = g.enemies.some((e) => e.boss);
    audio.setIntensity(boss ? 1 : busy > 0 ? 0.7 : 0.2);
    hud.update(session, fpsAvg);
  }
  world.sync(g, alpha);
  world.update(session.paused ? 0 : realDt * Math.min(session.speed, 2), g);
  world.render();
}

screens.title();
requestAnimationFrame(frame);

// Expose a tiny handle for debugging from the console.
window.cinderhold = {
  get session() {
    return session;
  },
  save,
  world,
  start: (idx, difficulty = 'normal', endless = false) => startBattle(idx, difficulty, endless),
  // Lets the built-in bot play the current battle (used for soak testing).
  autoplay: () => {
    if (session && !session.demo) session.bot = new Bot(session.game);
  },
};
