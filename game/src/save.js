// Saving Solmaris: one localStorage slot holding the progress that matters —
// money, jobs done, position, health and ammo, plus Respect, skills, Tide
// Tapes, unlocked hideouts, owned weapons and armour. The city itself is
// rebuilt from its seed, so a save stays small and always loads into a
// living city. Storage failures are swallowed: the game simply keeps playing
// unsaved.
//
// Save version 2 adds the crew: which character is active and each
// character's own record (skills, weapons, health, spot). Version 1 saves
// predate the crew and still load — Lena keeps everything she had, and
// Ivy and Marco wait at the safehouse with their perk skills.
import { CHARACTERS, SAVE_KEY, skillLevel } from './config.js';
import { MISSION_COUNT } from './missions.js';
import { createCharacterRecords, loadRecordToLive, syncRecordFromLive } from './characters.js';

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
    // The active character's live values go into their record first, so
    // the saved crew is exactly the crew that is playing.
    if (state.characters) syncRecordFromLive(state);
    const data = {
      version: 2,
      seed,
      money: player.money,
      health: player.health,
      armour: player.armour,
      x: player.x,
      y: player.y,
      weapon: player.weapon,
      weapons: player.weapons,
      ammo: player.ammo,
      mag: player.mag,
      character: state.character || 'lena',
      characters: state.characters || null,
      missionIndex: state.mission.index,
      missionsDone: state.stats.missionsDone,
      taxisDone: state.stats.taxisDone,
      carsStolen: state.stats.carsStolen,
      racesWon: state.stats.racesWon,
      rep: state.progress.rep,
      driving: state.progress.driving,
      shooting: state.progress.shooting,
      stamina: state.progress.stamina,
      tapes: state.progress.tapes,
      safehouse: state.progress.safehouse,
      garage: state.progress.garage,
      clockMinutes: state.clockMinutes,
      // Total minutes drive the once-a-day car sale and the property
      // payout day-boundary; without it a load resets the clock to 0 and
      // locks the sale out for hours. Old saves have no key and default
      // to 0 below, which is the previous behaviour.
      totalMinutes: state.totalMinutes,
      cashTaken: state.city.cashDrops.map((d) => d.taken),
      tapesTaken: state.city.tapes.map((t) => t.taken),
      // Loading keeps the heat: a save never wipes the wanted level.
      wanted: state.wanted.level,
      heat: state.wanted.heat,
      completedMissions: [...state.mission.completed],
      // Crew jobs ride along: which of the four are done, and how many
      // the counter shows — so a loaded game keeps its board progress.
      crewDone: [...(state.crewJob ? state.crewJob.done : [])],
      crewJobsDone: state.stats.crewDone || 0,
      medals: { ...state.progress.medals },
      property: state.progress.property,
      lastSellAt: state.progress.lastSellAt,
    lastDartsAt: state.progress.lastDartsAt,
      snacks: state.player.snacks || 0,
      eventsSolved: state.stats.eventsSolved || 0,
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
    if (!data || (data.version !== 1 && data.version !== 2)) return null;
    // A save missing its core fields (or holding non-numbers there) is
    // too corrupt to trust — treat it as no save rather than loading
    // undefined money/position into NaN. applySave still defaults these
    // fields as a second layer, for any caller that builds a data object
    // by hand.
    const finiteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!finiteNumber(data.money) || !finiteNumber(data.health)
      || !finiteNumber(data.x) || !finiteNumber(data.y)) return null;
    return data;
  } catch {
    return null;
  }
}

export function applySave(state, data) {
  const player = state.player;
  // Core fields default instead of landing as undefined: a partial or
  // hand-edited save must load into a playable state, never NaN.
  // (readSave already rejects saves missing these, so this is the second
  // layer — it also guards any caller that builds a data object by hand.)
  player.money = data.money ?? 0;
  player.health = data.health ?? 100;
  player.armour = data.armour ?? 0;
  player.x = data.x ?? state.city.spawn.x;
  player.y = data.y ?? state.city.spawn.y;
  player.weapon = data.weapon || 'fists';
  player.weapons = Array.isArray(data.weapons) && data.weapons.length ? data.weapons : ['fists', 'pistol'];
  if (!player.weapons.includes(player.weapon)) player.weapon = 'fists';
  player.ammo = { pistol: data.ammo?.pistol ?? 48, smg: data.ammo?.smg ?? 0 };
  player.mag = { pistol: data.mag?.pistol ?? 12, smg: data.mag?.smg ?? 0 };
  player.onFoot = true;
  player.carId = null;
  state.mission.index = data.missionIndex || 0;
  state.mission.done = state.mission.index >= MISSION_COUNT;
  state.mission.completed = Array.isArray(data.completedMissions)
    ? data.completedMissions
    : Array.from({ length: data.missionIndex || 0 }, (_, i) => i);
  state.mission.briefPending = !state.mission.done;
  // Crew jobs: version-2 saves carry them, older saves start fresh —
  // a missing list just means no crew job was ever finished.
  if (state.crewJob) state.crewJob.done = Array.isArray(data.crewDone) ? [...data.crewDone] : [];
  state.stats.crewDone = data.crewJobsDone || 0;
  state.progress.medals = data.medals || {};
  state.progress.property = Boolean(data.property);
  state.progress.lastSellAt = typeof data.lastSellAt === 'number' ? data.lastSellAt : -1e9;
  state.progress.lastDartsAt = typeof data.lastDartsAt === 'number' ? data.lastDartsAt : -1e9;
  player.snacks = data.snacks || 0;
  state.stats.eventsSolved = data.eventsSolved || 0;
  // The heat survives a load: the police do not forget a save.
  state.wanted.level = data.wanted || 0;
  state.wanted.heat = Boolean(data.heat);
  state.wanted.seen = false;
  state.wanted.hiddenTimer = 0;
  state.wanted.lastCarId = null;
  state.stats.missionsDone = data.missionsDone || 0;
  state.stats.taxisDone = data.taxisDone || 0;
  state.stats.carsStolen = data.carsStolen || 0;
  state.stats.racesWon = data.racesWon || 0;
  state.progress.rep = data.rep || 0;
  state.progress.driving = data.driving || 0;
  state.progress.shooting = data.shooting || 0;
  state.progress.stamina = data.stamina || 0;
  state.progress.tapes = data.tapes || 0;
  state.progress.safehouse = Boolean(data.safehouse);
  state.progress.garage = Boolean(data.garage);
  state.clockMinutes = data.clockMinutes || state.clockMinutes;
  // Total minutes are restored so the once-a-day sale and the property
  // payout keep their place across a load; old saves have no key and
  // start at 0, which is the previous behaviour.
  state.totalMinutes = Number.isFinite(data.totalMinutes) ? data.totalMinutes : 0;
  if (Array.isArray(data.cashTaken)) {
    data.cashTaken.forEach((taken, i) => {
      if (state.city.cashDrops[i]) state.city.cashDrops[i].taken = Boolean(taken);
    });
  }
  if (Array.isArray(data.tapesTaken)) {
    data.tapesTaken.forEach((taken, i) => {
      if (state.city.tapes[i]) state.city.tapes[i].taken = Boolean(taken);
    });
  }
  // Characters (save version 2): the crew rides together. A version 1
  // save predates the crew — Lena keeps the loaded position, health,
  // weapons and skills, and Ivy and Marco wait at the safehouse.
  if (data.version === 2 && data.characters && typeof data.characters === 'object') {
    state.characters = normalizeCharacters(data.characters, state.city);
    state.character = data.characters[data.character] ? data.character : 'lena';
    loadRecordToLive(state, state.character);
  } else {
    state.character = 'lena';
    state.characters = createCharacterRecords({ x: player.x, y: player.y }, state.city.safehouse);
    syncRecordFromLive(state);
  }
  state.camera.x = player.x;
  state.camera.y = player.y;
}

/** Fill a saved crew with defaults for anything missing or malformed,
 * so a hand-edited or older save can never strand a character. Levels
 * are recomputed from the skill points, never trusted from the file. */
function normalizeCharacters(raw, city) {
  const base = createCharacterRecords(city.spawn, city.safehouse);
  for (const def of CHARACTERS) {
    const r = raw[def.id];
    if (!r || typeof r !== 'object') continue;
    const rec = base[def.id];
    if (typeof r.x === 'number') rec.x = r.x;
    if (typeof r.y === 'number') rec.y = r.y;
    if (typeof r.angle === 'number') rec.angle = r.angle;
    if (typeof r.health === 'number') rec.health = Math.max(0, Math.min(100, r.health));
    if (typeof r.armour === 'number') rec.armour = Math.max(0, r.armour);
    if (typeof r.weapon === 'string') rec.weapon = r.weapon;
    if (Array.isArray(r.weapons) && r.weapons.length) rec.weapons = [...r.weapons];
    if (r.ammo && typeof r.ammo === 'object') {
      rec.ammo = { pistol: r.ammo.pistol ?? 48, smg: r.ammo.smg ?? 0 };
    }
    if (r.mag && typeof r.mag === 'object') {
      rec.mag = { pistol: r.mag.pistol ?? 12, smg: r.mag.smg ?? 0 };
    }
    if (typeof r.snacks === 'number') rec.snacks = r.snacks;
    if (typeof r.stamina === 'number') rec.stamina = r.stamina;
    if (r.skills && typeof r.skills === 'object') {
      rec.skills = {
        driving: r.skills.driving || 0,
        shooting: r.skills.shooting || 0,
        stamina: r.skills.stamina || 0,
      };
      rec.levels = {
        driving: skillLevel(rec.skills.driving, 'driving'),
        shooting: skillLevel(rec.skills.shooting, 'shooting'),
        stamina: skillLevel(rec.skills.stamina, 'stamina'),
      };
    }
  }
  return base;
}
