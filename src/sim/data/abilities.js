// Commander abilities: one-off powers on a cooldown. `from` is the campaign
// level index where each becomes available; custom maps, trials and endless
// get all of them.
export const ABILITIES = {
  meteor: {
    id: 'meteor',
    name: 'Meteor',
    key: 'Q',
    blurb: 'Call down a burning rock on a spot of your choice. Hits ground enemies in a wide circle.',
    cooldown: 45,
    targeted: true,
    radius: 1.6,
    delay: 0.9,
    from: 2,
  },
  nova: {
    id: 'nova',
    name: 'Frost Nova',
    key: 'E',
    blurb: 'A wave of cold over the whole field slows every enemy for a few seconds.',
    cooldown: 60,
    slow: 0.45,
    duration: 3.5,
    from: 4,
  },
  chest: {
    id: 'chest',
    name: 'War Chest',
    key: 'Z',
    blurb: 'Open the Hold’s coffers for an instant payout that grows with each wave.',
    cooldown: 90,
    from: 6,
  },
};

export const ABILITY_ORDER = ['meteor', 'nova', 'chest'];

// Meteor damage and chest gold grow with the wave so they stay relevant.
export function meteorDamage(waveIndex) {
  return 120 + 28 * waveIndex;
}

export function chestGold(waveIndex) {
  return 40 + 9 * waveIndex;
}
