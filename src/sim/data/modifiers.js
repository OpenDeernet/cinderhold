// Battle modifiers used by the Daily Trial. Each one bends a single rule;
// `clash` lists modifiers that would make a combination unfair or pointless.
export const MODIFIERS = [
  { id: 'swift', name: 'Swift Tide', blurb: 'Enemies move 20% faster.' },
  { id: 'ironclad', name: 'Ironclad', blurb: 'Every enemy has 3 more armor.', clash: ['stubborn'] },
  { id: 'stubborn', name: 'Stubborn', blurb: 'Enemies have 40% more health but drop 20% more gold.', clash: ['ironclad'] },
  { id: 'skyborne', name: 'Skyborne', blurb: 'Smoke Wisps join every wave.' },
  { id: 'frenzy', name: 'Frenzy', blurb: 'Enemies come out of the portals twice as tightly packed.' },
  { id: 'lean', name: 'Lean Times', blurb: 'Kills pay 35% less, but you start with 150 extra gold.', clash: ['dear'] },
  { id: 'dear', name: 'Dear Stone', blurb: 'Towers and upgrades cost 15% more.', clash: ['lean'] },
  { id: 'fragile', name: 'Fragile Walls', blurb: 'The Hold can only take 8 leaks.' },
  { id: 'nosell', name: 'No Retreat', blurb: 'Towers cannot be sold.' },
];

export function modifierById(id) {
  return MODIFIERS.find((m) => m.id === id);
}
