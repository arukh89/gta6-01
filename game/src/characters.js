// Three playable characters (H9): Lena Cruz plus two original crew members.
// The crew shares money, jobs, Respect and progress; each character keeps
// their own skills, weapons, health and spot in the city. The live
// `state.player` and `state.progress` skill points always describe the
// ACTIVE character — switching saves the outgoing character's live values
// into their record and loads the incoming character's record out.
import { CHARACTERS, SKILL_PER, characterById } from './config.js';

/** One record per character: everything that is theirs alone. The two
 * who are not playing wait at the safehouse; Lena opens at the spawn. */
export function createCharacterRecords(spawn, safehouse) {
  const records = {};
  for (const def of CHARACTERS) {
    const atHome = def.id !== 'lena';
    const rec = {
      x: atHome ? safehouse.x : spawn.x,
      y: atHome ? safehouse.y : spawn.y,
      angle: -Math.PI / 2,
      health: 100,
      armour: 0,
      weapon: 'fists',
      weapons: ['fists', 'pistol'],
      ammo: { pistol: 48, smg: 0 },
      mag: { pistol: 12, smg: 0 },
      snacks: 0,
      // Swim stamina (0-100), not the stamina skill: it refills on land.
      stamina: 100,
      skills: { driving: 0, shooting: 0, stamina: 0 },
      levels: { driving: 0, shooting: 0, stamina: 0 },
    };
    // Everyone starts at level 1 in their own perk skill.
    rec.skills[def.perk] = SKILL_PER[def.perk];
    rec.levels[def.perk] = 1;
    records[def.id] = rec;
  }
  return records;
}

/** Copy the live player + live skill points into the active character's
 * record. Call before switching away or saving. */
export function syncRecordFromLive(state) {
  const rec = state.characters && state.characters[state.character];
  if (!rec) return;
  const p = state.player;
  rec.x = p.x;
  rec.y = p.y;
  rec.angle = p.angle;
  rec.health = p.health;
  rec.armour = p.armour;
  rec.weapon = p.weapon;
  rec.weapons = [...p.weapons];
  rec.ammo = { ...p.ammo };
  rec.mag = { ...p.mag };
  rec.snacks = p.snacks || 0;
  rec.stamina = p.stamina ?? 100;
  rec.skills = { driving: state.progress.driving, shooting: state.progress.shooting, stamina: state.progress.stamina };
  rec.levels = { ...state.progress.levels };
}

/** Load a character's record into the live player + live skill points.
 * The character arrives on foot at the spot they were left, in the
 * clothes they always wear. Returns false when the id is unknown. */
export function loadRecordToLive(state, id) {
  const rec = state.characters && state.characters[id];
  if (!rec) return false;
  const def = characterById(id);
  const p = state.player;
  p.x = rec.x;
  p.y = rec.y;
  p.angle = rec.angle;
  p.health = rec.health;
  p.armour = rec.armour;
  p.weapon = rec.weapon;
  p.weapons = [...rec.weapons];
  p.ammo = { ...rec.ammo };
  p.mag = { ...rec.mag };
  p.snacks = rec.snacks || 0;
  p.stamina = rec.stamina ?? 100;
  p.shirt = def.shirt;
  p.skin = def.skin;
  p.pants = def.pants ?? '#1d3557';
  p.hat = def.hat ?? 'cap';
  p.scale = def.scale ?? 1;
  p.build = def.build ?? 1;
  p.onFoot = true;
  p.carId = null;
  p.cover = null;
  p.z = 0;
  p.vz = 0;
  p.swimming = false;
  p.attackCooldown = 0;
  p.hurtTimer = 0;
  p.moving = false;
  state.progress.driving = rec.skills.driving;
  state.progress.shooting = rec.skills.shooting;
  state.progress.stamina = rec.skills.stamina;
  state.progress.levels = { ...rec.levels };
  state.character = id;
  state.camera.x = p.x;
  state.camera.y = p.y;
  return true;
}

/** Switch to another character at the safehouse. The heat, the job and
 * the shared money all stay exactly where they were — only the body
 * changes. Returns a problem string, or null on success. */
export function switchCharacter(state, id, events) {
  if (!state.characters || !state.characters[id]) return 'No such character.';
  if (id === state.character) return 'Already playing as them.';
  const player = state.player;
  if (!player.onFoot) return 'Get out of the car to switch.';
  if (!state.progress.safehouse) return 'The safehouse is locked — finish three jobs first.';
  if (Math.hypot(player.x - state.city.safehouse.x, player.y - state.city.safehouse.y) >= 80) {
    return 'Switch characters at the safehouse.';
  }
  if (state.mission && state.mission.started) return 'Finish the job first — no switching mid-job.';
  if (state.race && state.race.active) return 'Finish the race first.';
  if (state.minigame && state.minigame.active) return 'Quit the minigame first.';
  syncRecordFromLive(state);
  loadRecordToLive(state, id);
  const def = characterById(id);
  events.push({ type: 'toast', text: `Now playing as ${def.name} — ${def.role}.` });
  return null;
}

/** The next crew member after the active one: Lena → Ivy → Marco → Lena. */
export function nextCharacterId(state) {
  const i = CHARACTERS.findIndex((c) => c.id === state.character);
  return CHARACTERS[(i + 1) % CHARACTERS.length].id;
}
