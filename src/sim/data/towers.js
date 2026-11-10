// Tower definitions. tiers[0].cost is the build price; later tiers list the
// upgrade price. Every tier inherits the fields of the tier before it.
export const TOWERS = {
  bolt: {
    id: 'bolt',
    name: 'Bolt Turret',
    blurb: 'Rapid darts at a single target. Reliable, cheap, and it can hit fliers.',
    kind: 'projectile',
    hitsGround: true,
    hitsAir: true,
    damageType: 'physical',
    tiers: [
      { cost: 50, damage: 11, rate: 2.2, range: 3.0, projSpeed: 14 },
      { cost: 65, damage: 19, rate: 2.6, range: 3.3 },
      { cost: 130, damage: 34, rate: 3.0, range: 3.7 },
    ],
  },
  cannon: {
    id: 'cannon',
    name: 'Ember Cannon',
    blurb: 'Lobs shells that burst on impact. Good against packs; cannot hit fliers.',
    kind: 'projectile',
    hitsGround: true,
    hitsAir: false,
    damageType: 'physical',
    tiers: [
      { cost: 90, damage: 26, rate: 0.8, range: 2.8, splash: 1.0, projSpeed: 8 },
      { cost: 90, damage: 48, rate: 0.85, range: 3.0, splash: 1.15 },
      { cost: 170, damage: 88, rate: 0.9, range: 3.2, splash: 1.3 },
    ],
  },
  frost: {
    id: 'frost',
    name: 'Rime Spire',
    blurb: 'Freezing shards that slow everything they splash, fliers included.',
    kind: 'projectile',
    hitsGround: true,
    hitsAir: true,
    damageType: 'energy',
    tiers: [
      { cost: 70, damage: 4, rate: 1.2, range: 2.8, splash: 0.9, slow: 0.6, slowTime: 1.6, projSpeed: 10 },
      { cost: 70, damage: 8, rate: 1.3, range: 3.0, splash: 1.0, slow: 0.5, slowTime: 1.9 },
      { cost: 140, damage: 15, rate: 1.4, range: 3.3, splash: 1.15, slow: 0.38, slowTime: 2.2 },
    ],
  },
  tesla: {
    id: 'tesla',
    name: 'Storm Coil',
    blurb: 'Arcs of lightning that leap between enemies. Ignores armor.',
    kind: 'chain',
    hitsGround: true,
    hitsAir: true,
    damageType: 'energy',
    tiers: [
      { cost: 130, damage: 20, rate: 0.8, range: 2.7, chains: 3, chainRange: 1.6, falloff: 0.85 },
      { cost: 120, damage: 34, rate: 0.85, range: 2.9, chains: 4 },
      { cost: 230, damage: 60, rate: 0.95, range: 3.1, chains: 6, chainRange: 1.9 },
    ],
  },
  mortar: {
    id: 'mortar',
    name: 'Siege Mortar',
    blurb: 'Huge range and a huge blast, but slow, and blind to anything too close.',
    kind: 'mortar',
    hitsGround: true,
    hitsAir: false,
    damageType: 'physical',
    tiers: [
      { cost: 150, damage: 55, rate: 0.33, range: 6.0, minRange: 1.6, splash: 1.5, flight: 1.1 },
      { cost: 140, damage: 100, rate: 0.36, range: 6.5, splash: 1.7 },
      { cost: 260, damage: 185, rate: 0.4, range: 7.0, splash: 1.9 },
    ],
  },
  ember: {
    id: 'ember',
    name: 'Cinder Brazier',
    blurb: 'Pulses fire over every ground enemy nearby and sets them burning. Ignores armor.',
    kind: 'pulse',
    hitsGround: true,
    hitsAir: false,
    damageType: 'energy',
    tiers: [
      { cost: 110, damage: 6, rate: 1.0, range: 1.9, burn: 10, burnTime: 3 },
      { cost: 110, damage: 10, rate: 1.0, range: 2.1, burn: 18 },
      { cost: 210, damage: 18, rate: 1.1, range: 2.3, burn: 32 },
    ],
  },
  banner: {
    id: 'banner',
    name: 'War Banner',
    blurb: 'Does not attack. Towers around it hit harder and fire faster. Banners do not stack.',
    kind: 'aura',
    hitsGround: false,
    hitsAir: false,
    damageType: 'energy',
    tiers: [
      { cost: 120, damage: 0, rate: 0, range: 1.6, boost: 0.15 },
      { cost: 110, range: 1.8, boost: 0.22 },
      { cost: 200, range: 2.1, boost: 0.3 },
    ],
  },
};

export const TOWER_ORDER = ['bolt', 'cannon', 'frost', 'tesla', 'mortar', 'ember', 'banner'];

export const TARGET_MODES = ['first', 'last', 'strong', 'close'];

export function towerTier(type, tier) {
  const def = TOWERS[type];
  const out = {};
  for (let i = 0; i <= tier; i++) Object.assign(out, def.tiers[i]);
  return out;
}

export function towerInvested(type, tier) {
  let sum = 0;
  for (let i = 0; i <= tier; i++) sum += TOWERS[type].tiers[i].cost;
  return sum;
}
