#!/usr/bin/env node
// Plays the whole campaign headlessly with the bot and reports, per level,
// whether it was won, the lives left and how long it took in game time.
//
//   node scripts/playthrough.mjs [--difficulty normal] [--skill 1] [--level id] [--endless]

import { LEVELS } from '../src/sim/data/levels.js';
import { Game, TICK } from '../src/sim/game.js';
import { Bot } from '../src/sim/bot.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const difficulty = opt('difficulty', 'normal');
const skill = Number(opt('skill', '1'));
const only = opt('level', null);
const endless = args.includes('--endless');
const patient = args.includes('--patient');

const fmt = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

let total = 0;
let failures = 0;
LEVELS.forEach((level, idx) => {
  if (only && level.id !== only) return;
  const game = new Game({ level, levelIdx: idx, difficulty, endless });
  const bot = new Bot(game, { skill, callEarly: !patient });
  const limit = endless ? 60 * 90 : 60 * 60;
  let events = 0;
  while (!game.isOver() && game.time < limit) {
    bot.update(TICK);
    game.update(TICK);
    events += game.drainEvents().length;
  }
  total += game.time;
  const ok = game.status === 'won' || (endless && game.status === 'lost');
  if (!ok) failures++;
  console.log(
    [
      level.id.padEnd(12),
      game.status.padEnd(5),
      `wave ${game.stats.wavesCleared}/${endless ? '∞' : level.waves}`.padEnd(11),
      `lives ${game.lives}/${game.maxLives}`.padEnd(12),
      `stars ${game.stars()}`,
      `towers ${game.towers.length}`.padEnd(10),
      `kills ${game.stats.kills}`.padEnd(11),
      fmt(game.time),
      `events ${events}`,
    ].join('  '),
  );
});
console.log(`total game time ${fmt(total)}; ${failures} level(s) not won`);
process.exitCode = failures && !endless ? 1 : 0;
