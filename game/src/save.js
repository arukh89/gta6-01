// Saving Solmaris: one localStorage slot holding the progress that matters —
// money, jobs done, position, health and ammo. The city itself is rebuilt
// from its seed, so a save stays small and always loads into a living city.
// Storage failures are swallowed: the game simply keeps playing unsaved.
import { SAVE_KEY } from './config.js';

export function hasSave() {
  try {
    return window.localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function writeSave(state, seed) {
  try {
    const player = state.player;
    const data = {
      version: 1,
      seed,
      money: player.money,
      health: player.health,
      x: player.x,
      y: player.y,
      weapon: player.weapon,
      ammo: player.ammo,
      mag: player.mag,
      missionIndex: state.mission.index,
      missionsDone: state.stats.missionsDone,
      taxisDone: state.stats.taxisDone,
      carsStolen: state.stats.carsStolen,
      clockMinutes: state.clockMinutes,
      cashTaken: state.city.cashDrops.map((d) => d.taken),
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function applySave(state, data) {
  const player = state.player;
  player.money = data.money;
  player.health = data.health;
  player.x = data.x;
  player.y = data.y;
  player.weapon = data.weapon || 'fists';
  player.ammo = data.ammo ?? 48;
  player.mag = data.mag ?? 12;
  player.onFoot = true;
  player.carId = null;
  state.mission.index = data.missionIndex || 0;
  state.mission.done = state.mission.index >= 6;
  state.mission.briefPending = !state.mission.done;
  state.stats.missionsDone = data.missionsDone || 0;
  state.stats.taxisDone = data.taxisDone || 0;
  state.stats.carsStolen = data.carsStolen || 0;
  state.clockMinutes = data.clockMinutes || state.clockMinutes;
  if (Array.isArray(data.cashTaken)) {
    data.cashTaken.forEach((taken, i) => {
      if (state.city.cashDrops[i]) state.city.cashDrops[i].taken = Boolean(taken);
    });
  }
  state.camera.x = player.x;
  state.camera.y = player.y;
}
