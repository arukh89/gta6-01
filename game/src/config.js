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
export const HEALTH = { max: 100, regenDelay: 6, regenRate: 4, bustFine: 200, clinicFine: 150 };
export const WANTED = { max: 5, coolSeconds: 9, sprayCost: 150, sprayRadius: 90 };

export const VEHICLES = {
  sedan: { name: 'Coral Sedan', length: 46, width: 22, top: 430, accel: 380, color: '#e76f51' },
  taxi: { name: 'Bay Cab', length: 46, width: 22, top: 410, accel: 360, color: '#ffb703' },
  pickup: { name: 'Dune Pickup', length: 50, width: 23, top: 400, accel: 340, color: '#8ab17d' },
  sports: { name: 'Vela GT', length: 48, width: 22, top: 560, accel: 520, color: '#e63946' },
  van: { name: 'Harbor Van', length: 54, width: 24, top: 360, accel: 300, color: '#a8dadc' },
  police: { name: 'Solmaris PD Cruiser', length: 48, width: 22, top: 500, accel: 470, color: '#1d3557' },
};

export const WEAPONS = {
  fists: { name: 'Fists', damage: 12, range: 34, rate: 0.38, ammo: Infinity },
  pistol: { name: 'Pistol', damage: 26, range: 420, rate: 0.3, ammo: 48, mag: 12 },
};

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
