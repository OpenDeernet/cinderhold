#!/usr/bin/env node
// Balance sweep: plays every level with bots of several skill levels and
// seeds on each difficulty, and prints the win rate and average lives left.
//
//   node scripts/balance.mjs [--seeds 4] [--difficulty normal,heroic]

import { LEVELS } from '../src/sim/data/levels.js';
import { Game, TICK } from '../src/sim/game.js';
import { Bot } from '../src/sim/bot.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const seeds = Number(opt('seeds', '4'));
const difficulties = opt('difficulty', 'casual,normal,heroic').split(',');
const skills = [1, 0.6, 0.3];

function play(level, idx, difficulty, skill, seed) {
  const game = new Game({ level, levelIdx: idx, difficulty });
  const bot = new Bot(game, { skill, seed });
  while (!game.isOver() && game.time < 3600) {
    bot.update(TICK);
    game.update(TICK);
    game.events.length = 0;
  }
  return game;
}

for (const difficulty of difficulties) {
  console.log(`\n${difficulty.toUpperCase()}`);
  console.log(['level'.padEnd(12), ...skills.map((s) => `skill ${s}`.padEnd(16))].join(''));
  LEVELS.forEach((level, idx) => {
    const cells = skills.map((skill) => {
      let wins = 0;
      let lives = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const g = play(level, idx, difficulty, skill, seed * 7919);
        if (g.status === 'won') {
          wins++;
          lives += g.lives / g.maxLives;
        }
      }
      const pct = Math.round((wins / seeds) * 100);
      const avg = wins ? Math.round((lives / wins) * 100) : 0;
      return `${String(pct).padStart(3)}% won ${String(avg).padStart(3)}%hp`.padEnd(16);
    });
    console.log([level.id.padEnd(12), ...cells].join(''));
  });
}
