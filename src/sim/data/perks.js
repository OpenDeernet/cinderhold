// Permanent upgrades bought with stars earned in the campaign. Stars are never
// spent for good: perks can be refunded and reassigned at any time.
export const PERKS = [
  { id: 'purse', name: 'Deep Pockets', cost: 2, blurb: 'Start every battle with 50 extra gold.' },
  { id: 'walls', name: 'Stonewall', cost: 2, blurb: 'The Hold can take 5 more leaks.' },
  { id: 'tools', name: 'Fine Tools', cost: 3, blurb: 'Building and upgrading costs 8% less.' },
  { id: 'salvage', name: 'Salvage Crews', cost: 2, blurb: 'Selling refunds 85% instead of 70%.' },
  { id: 'darts', name: 'Barbed Darts', cost: 2, blurb: 'Bolt Turrets deal 15% more damage.' },
  { id: 'powder', name: 'Volatile Powder', cost: 3, blurb: 'Cannon and mortar blasts are 15% wider.' },
  { id: 'rime', name: 'Deep Rime', cost: 2, blurb: 'Rime Spire slows last 40% longer.' },
  { id: 'overcharge', name: 'Overcharge', cost: 3, blurb: 'Storm Coil arcs jump to one more enemy.' },
  { id: 'bounty', name: 'Bounty Hunters', cost: 3, blurb: 'Enemies drop 10% more gold.' },
  { id: 'bugle', name: 'Early Bugle', cost: 2, blurb: 'Calling a wave early pays double.' },
  { id: 'spyglass', name: 'Spyglasses', cost: 4, blurb: 'Every tower reaches 8% farther.' },
  { id: 'kindling', name: 'Dry Kindling', cost: 2, blurb: 'Cinder Brazier burns 25% hotter.' },
];

export function perkById(id) {
  return PERKS.find((p) => p.id === id);
}
