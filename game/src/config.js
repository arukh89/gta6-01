// Solmaris Heat tuning: one place for the city size, movement, police heat,
// mission money and the sun-soaked palette. Nothing here depends on screen size.

/** Fixed simulation step: 60 updates a second whatever the display rate. */
export const STEP = 1 / 60;

export const WORLD = {
  width: 3200,
  height: 2400,
  roadGap: 320,
  roadWidth: 64,
  firstRoad: 160,
  beachY: 2080,
  waterY: 2240,
};

export const SAVE_KEY = 'solmaris-heat.save.v1';

export const WALK = { speed: 175, sprint: 265, radius: 13 };
export const DRIVE = { accel: 420, brake: 620, reverse: 160, maxSpeed: 520, turn: 2.6, grip: 3.2 };
export const HEALTH = { max: 100, regenDelay: 6, regenRate: 4, regenCap: 50, wastedPercent: 0.05, wastedCap: 5000 };
/** Slow-mo (hold X): the world runs at this fraction of full speed while
 * Lena stays at full speed. The meter drains while it lasts and refills
 * while it rests; it only starts again above minStart, so it never
 * flickers on an empty meter. */
export const SLOWMO = { scale: 0.35, drain: 25, regen: 12, max: 100, minStart: 10 };
/** Wanted decay: seconds hidden to lose one star, per level (GTA V scale). */
export const WANTED = { max: 5, coolSecondsByLevel: [30, 45, 60, 75, 90], sprayCost: 150, sprayRadius: 90, witnessPedRadius: 280, witnessPoliceRadius: 520, heliRespawnDelay: 20,
  /** HEAT (sixth star): at five stars, one more witnessed crime pushes
   * the whole PD into HEAT — more cruisers, more SWAT sooner, faster
   * roadblocks and heli replacements, and stars that cool half as fast. */
  heatPolice: 6, heatSwat: 4, heatSwatDelay: 5, heatRoadblockDelay: 12, heatHeliDelay: 8, heatDecayMult: 2 };

export const VEHICLES = {
  sedan: { name: 'Coral Sedan', length: 46, width: 22, top: 430, accel: 380, color: '#e76f51' },
  taxi: { name: 'Bay Cab', length: 46, width: 22, top: 410, accel: 360, color: '#ffb703' },
  pickup: { name: 'Dune Pickup', length: 50, width: 23, top: 400, accel: 340, color: '#8ab17d' },
  sports: { name: 'Vela GT', length: 48, width: 22, top: 560, accel: 520, color: '#e63946' },
  van: { name: 'Harbor Van', length: 54, width: 24, top: 360, accel: 300, color: '#a8dadc' },
  police: { name: 'Solmaris PD Cruiser', length: 48, width: 22, top: 500, accel: 470, color: '#1d3557' },
  /** A drivable boat: water-only, reuses the car system (kind 'boat'). */
  boat: { name: 'Solmaris Skiff', length: 54, width: 20, top: 380, accel: 300, color: '#f8f9fa' },
};

/** Swimming: 60% of walk speed, stamina drains in the water and refills
 * on land; with an empty tank Lena's health drains until she reaches shore. */
export const SWIM = { speedMult: 0.6, drain: 6, regen: 10, healthDrain: 2 };

export const WEAPONS = {
  fists: { name: 'Fists', damage: 12, range: 34, rate: 0.38, ammo: Infinity },
  pistol: { name: 'Pistol', damage: 26, range: 420, rate: 0.3, ammo: 48, mag: 12 },
  smg: { name: 'SMG', damage: 14, range: 380, rate: 0.09, ammo: 120, mag: 30 },
};

/** Skill points needed per level (levels cap at 10). */
export const SKILL_PER = { driving: 50, shooting: 8, stamina: 40 };

/** The crew: three playable characters. Money, jobs, Respect and progress
 * are shared; each keeps their own skills, weapons, health and spot in
 * the city. Everyone starts at level 1 in their own perk skill. The
 * others wait at the safehouse — press T there to switch. All names,
 * looks and backstories are original. */
export const CHARACTERS = [
  { id: 'lena', name: 'Lena Cruz', role: 'The Wheelwoman', perk: 'driving', perkText: '+Driving — top speed grows sooner', shirt: '#fb8500', skin: '#c68642', blurb: 'Owes Dario one last favour. Knows every shortcut in Solmaris.' },
  { id: 'ivy', name: 'Ivy Solano', role: 'The Sharpshooter', perk: 'shooting', perkText: '+Shooting — harder hits from the start', shirt: '#2a9d8f', skin: '#e8b88a', blurb: 'Ex-range regular. Never misses twice, never talks about the first time.' },
  { id: 'marco', name: 'Marco Vane', role: 'The Muscle', perk: 'stamina', perkText: '+Stamina — sprints longer, recovers faster', shirt: '#9b5de5', skin: '#8d5524', blurb: 'Carries the heavy crates and the heavier grudges. The crew’s backbone.' },
];

/** Look a character up by id; unknown ids fall back to Lena. */
export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
}

export function skillLevel(points, kind) {
  return Math.min(10, Math.floor((points || 0) / SKILL_PER[kind]));
}

/** Respect titles the HUD shows as REP grows. */
export function repTitle(rep) {
  if (rep >= 500) return 'Solmaris Legend';
  if (rep >= 300) return 'Heatmaker';
  if (rep >= 150) return 'Wheelman';
  if (rep >= 50) return 'Hustler';
  return 'Nobody';
}

export const PALETTE = {
  grass: '#7fb069',
  park: '#6aa84f',
  sand: '#f2d492',
  water: '#219ebc',
  deepWater: '#126782',
  asphalt: '#4a4a52',
  asphaltLine: '#e9c46a',
  sidewalk: '#d9c7a7',
  building: ['#f4a261', '#e9c46a', '#ee8959', '#f7d6a0', '#e76f51', '#f2e8cf'],
  tower: ['#8ecae6', '#a8dadc', '#90be6d', '#f9c74f'],
  roof: '#b08968',
  shadow: 'rgba(60, 20, 0, 0.25)',
  duskTint: 'rgba(251, 133, 0, 0.24)',
  dayTint: 'rgba(255, 214, 130, 0.10)',
};

export const FONT = '"Avenir Next", "Segoe UI", system-ui, sans-serif';

/** Street names for flavour on the HUD and in mission text. All invented. */
export const STREETS = [
  'Palma Avenue', 'Coral Boulevard', 'Sunset Row', 'Marina Drive', 'Cielo Street',
  'Mango Lane', 'Harbor Way', 'Flamingo Road', 'Sol Street', 'Bayview Terrace',
];
