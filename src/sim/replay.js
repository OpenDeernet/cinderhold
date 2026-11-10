import { Game } from './game.js';

// Replays. A battle is fully described by its setup and the player's command
// log, because the rules never use Math.random or wall-clock time.
//
// A replay is plain JSON:
//   { v, level, levelIdx, difficulty, perks, endless, modifiers, log, result }

export const REPLAY_VERSION = 1;

const OPS = {
  build: (g, type, c, r) => g.build(type, c, r),
  upgrade: (g, id) => g.upgrade(id),
  sell: (g, id) => g.sell(id),
  target: (g, id) => g.cycleTargeting(id),
  mode: (g, id, mode) => g.setTargeting(id, mode),
  cast: (g, id, x, y) => g.cast(id, x, y),
  wave: (g) => g.callWave(),
};

export function makeReplay(game) {
  return {
    v: REPLAY_VERSION,
    level: game.level,
    levelIdx: game.levelIdx,
    difficulty: game.difficulty,
    perks: [...game.perks],
    endless: game.endless,
    modifiers: [...game.modifiers],
    log: game.log.map((entry) => [...entry]),
    result: summary(game),
  };
}

export function summary(game) {
  return {
    ticks: game.ticks,
    status: game.status,
    lives: game.lives,
    gold: game.gold,
    kills: game.stats.kills,
    waves: game.stats.wavesCleared,
  };
}

// Drives a fresh Game through a recorded log. Commands are applied just
// before the tick they were issued before, in their original order.
export class ReplayDriver {
  constructor(replay) {
    if (!replay || replay.v !== REPLAY_VERSION) throw new Error('Unsupported replay.');
    this.replay = replay;
    this.game = new Game({
      level: replay.level,
      levelIdx: replay.levelIdx,
      difficulty: replay.difficulty,
      perks: replay.perks,
      endless: replay.endless,
      modifiers: replay.modifiers,
    });
    this.next = 0;
    this.failed = 0;
    this.game.beforeTick = () => this.apply();
    this.apply();
  }

  apply() {
    const { log } = this.replay;
    const g = this.game;
    while (this.next < log.length && log[this.next][0] <= g.ticks) {
      const [, op, ...args] = log[this.next++];
      const fn = OPS[op];
      // A command that no longer succeeds means the replay has diverged.
      const res = fn ? fn(g, ...args) : false;
      if (res === false || res === null) this.failed++;
    }
  }

  get done() {
    return this.game.isOver() || (this.next >= this.replay.log.length && this.game.ticks >= this.replay.result.ticks);
  }
}

// Runs a replay to the end without rendering and reports whether it lands
// exactly where the original battle did.
export function verifyReplay(replay, maxTicks = 30 * 60 * 120) {
  const d = new ReplayDriver(replay);
  const g = d.game;
  while (!g.isOver() && g.ticks < replay.result.ticks && g.ticks < maxTicks) {
    d.apply();
    g.beforeTick = null;
    g.tick();
    g.events.length = 0;
  }
  const got = summary(g);
  const want = replay.result;
  const same = Object.keys(want).every((k) => got[k] === want[k]);
  return { ok: same && d.failed === 0, got, want, failed: d.failed };
}
