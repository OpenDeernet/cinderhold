// Enemy definitions. speed is in tiles per second, threat is the cost the wave
// generator pays to include one in a wave, lives is what a leak costs.
export const ENEMIES = {
  grunt: {
    id: 'grunt', name: 'Ashling', hp: 55, speed: 1.15, bounty: 5, threat: 1, lives: 1,
    blurb: 'The rank and file of the ash tide. Unremarkable alone.',
  },
  runner: {
    id: 'runner', name: 'Skitter', hp: 32, speed: 2.1, bounty: 4, threat: 0.8, lives: 1,
    blurb: 'Fast and fragile. Slow it down or it will slip through.',
  },
  swarm: {
    id: 'swarm', name: 'Cinderling', hp: 16, speed: 1.55, bounty: 1, threat: 0.3, lives: 1,
    blurb: 'Comes in clouds. Splash damage makes short work of them.',
  },
  brute: {
    id: 'brute', name: 'Slagback', hp: 200, armor: 5, speed: 0.75, bounty: 12, threat: 4, lives: 2,
    blurb: 'Plated in cooled slag. Armor blunts every physical hit; fire and lightning ignore it.',
  },
  wisp: {
    id: 'wisp', name: 'Smoke Wisp', hp: 45, speed: 1.45, bounty: 6, threat: 1.2, lives: 1, air: true,
    blurb: 'Flies over the road. Cannons, mortars and braziers cannot reach it.',
  },
  mender: {
    id: 'mender', name: 'Kiln Mender', hp: 85, speed: 1.0, bounty: 10, threat: 2.5, lives: 1,
    heal: { radius: 1.6, fraction: 0.06, every: 1.5 },
    blurb: 'Patches up nearby allies. Kill it first.',
  },
  warden: {
    id: 'warden', name: 'Glass Warden', hp: 110, shield: 110, armor: 2, speed: 0.95, bounty: 12, threat: 3.5, lives: 2,
    blurb: 'A glass shield soaks damage and regrows if left alone.',
  },
  splitter: {
    id: 'splitter', name: 'Clinker', hp: 130, speed: 0.95, bounty: 8, threat: 3, lives: 1,
    split: { type: 'swarm', count: 3 },
    blurb: 'Bursts into cinderlings when it breaks.',
  },
  colossus: {
    id: 'colossus', name: 'Ashen Colossus', hp: 2400, armor: 8, speed: 0.45, bounty: 150, threat: 40, lives: 10, boss: true,
    blurb: 'A walking furnace. Bring everything you have.',
  },
  stormwing: {
    id: 'stormwing', name: 'Stormwing', hp: 1800, speed: 0.7, bounty: 150, threat: 40, lives: 10, boss: true, air: true,
    blurb: 'A thundercloud with wings. Only anti-air towers can touch it.',
  },
};

export const ENEMY_ORDER = [
  'grunt', 'runner', 'swarm', 'brute', 'wisp', 'mender', 'warden', 'splitter', 'colossus', 'stormwing',
];
