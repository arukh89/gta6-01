// The one simulation step: every system advances here, in a fixed order, and
// reports what happened as events the loop turns into sound, toasts and
// screens. The screenshot staging calls this same step with scripted input,
// so a staged frame is always a frame the real rules produced.
import { HEALTH, SLOWMO, STEP, WALK, WORLD, skillLevel } from './config.js';
import { buildCity } from './world.js';
import { createPlayer, createCar, playerCar, damageCar, updateDriving, updatePlayerOnFoot } from './player.js';
import { createParkedCars, createTraffic, updateTraffic } from './traffic.js';
import { createPedestrians, updatePedestrians } from './pedestrians.js';
import { createWanted, updatePolice } from './police.js';
import { updateCombat } from './combat.js';
import { createMissionState, updateMissions, updateSideJobs, createSideJob, createRaceState, updateRace, updateUnlocks, createRandomEventState, updateRandomEvent, createCrewJobState, updateCrewJobs } from './missions.js';
import { createMinigameState, updateMinigames } from './minigames.js';
import { spawnCashBurst, updateEffects } from './effects.js';
import { createCharacterRecords } from './characters.js';

/** Progress the HUD shows and the save keeps: Respect, skill points and
 * levels, Tide Tapes found, and which hideouts Dario has unlocked. */
export function createProgress() {
  return {
    rep: 0,
    driving: 0,
    shooting: 0,
    stamina: 0,
    tapes: 0,
    safehouse: false,
    garage: false,
    levels: { driving: 0, shooting: 0, stamina: 0 },
    // Medals per job: 'gold' | 'silver' | 'bronze', best kept.
    medals: {},
    // The Neon Club: owned property, pays $120 per game day.
    property: false,
    lastSellAt: -1e9,
  };
}

export function createGameState(cityRng, playRng) {
  const city = buildCity(cityRng);
  const player = createPlayer(city.spawn);
  const cars = [
    ...createTraffic(city, playRng, 22),
    ...createParkedCars(city, playRng, 14),
  ];
  const getaway = createCar('sports', 640, 452, 0, 'none');
  getaway.color = '#e63946';
  cars.push(getaway);
  // Two drivable boats, both in the water: a skiff at the marina and a
  // speedboat off the lighthouse pier. Same kind ('boat' — missions
  // check it), different variant, so they read as two different boats.
  cars.push(createCar('boat', 2960, 2320, Math.PI / 2, 'none'));
  const speedboat = createCar('boat', 220, 2320, 0, 'none');
  speedboat.variant = 'speedboat';
  cars.push(speedboat);
  // The crew: Lena opens the game, Ivy and Marco wait at the safehouse.
  // Her perk (level 1 driving) is the live skill line from the start.
  const characters = createCharacterRecords(city.spawn, city.safehouse);
  const progress = createProgress();
  progress.driving = characters.lena.skills.driving;
  progress.levels.driving = characters.lena.levels.driving;
  return {
    city,
    rng: playRng,
    time: 0,
    clockMinutes: 16 * 60 + 40,
    player,
    character: 'lena',
    characters,
    cars,
    peds: createPedestrians(city, playRng, 40),
    wanted: createWanted(),
    heli: null,
    // Slow-mo (hold X): the world slows to SLOWMO.scale while Lena stays
    // at full speed. Meter 0-100, drains while active, refills while off.
    slowmo: { meter: SLOWMO.max, active: false },
    roadblock: false,
    lastRoadblock: -99,
    lastHeliDown: -99,
    lastSwatSpawn: -99,
    firstPerson: false,
    totalMinutes: 0,
    randomEvent: createRandomEventState(),
    mission: createMissionState(),
    crewJob: createCrewJobState(),
    sideJob: createSideJob(),
    race: createRaceState(),
    minigame: createMinigameState(),
    progress,
    bullets: [],
    particles: [],
    skids: [],
    camera: { x: player.x, y: player.y },
    shake: 0,
    dusk: false,
    lastPoliceSpawn: -99,
    lastOfficerSpawn: -99,
    stats: { missionsDone: 0, taxisDone: 0, shotsFired: 0, carsStolen: 0, cashFound: 0, racesWon: 0, eventsSolved: 0, crewDone: 0 },
  };
}

function collidePlayerCar(state, events) {
  const car = playerCar(state);
  if (!car) return;
  for (const other of state.cars) {
    if (other === car || (other.driver === 'police' && !other.blocking)) continue;
    const d = Math.hypot(other.x - car.x, other.y - car.y);
    if (d > 0 && d < 44) {
      const push = (44 - d) / 2;
      const nx = (car.x - other.x) / d;
      const ny = (car.y - other.y) / d;
      car.x += nx * push;
      car.y += ny * push;
      other.x -= nx * push;
      other.y -= ny * push;
      const impact = Math.abs(car.speed) + Math.abs(other.speed || 0);
      if (impact > 180) {
        damageCar(state, car, 6, events);
        damageCar(state, other, 6, events);
        car.speed *= 0.6;
        events.push({ type: 'crash' });
        state.shake = Math.min(14, state.shake + 6);
      }
    }
  }
}

function collectCash(state, events) {
  const player = state.player;
  for (const drop of state.city.cashDrops) {
    if (drop.taken) continue;
    if (Math.hypot(player.x - drop.x, player.y - drop.y) < 34) {
      drop.taken = true;
      player.money += drop.value;
      state.stats.cashFound += 1;
      spawnCashBurst(state, drop.x, drop.y);
      events.push({ type: 'chime' });
      events.push({ type: 'toast', text: `Cash drop! +$${drop.value}` });
    }
  }
}

function collectTapes(state, events) {
  const player = state.player;
  for (const tape of state.city.tapes) {
    if (tape.taken) continue;
    if (Math.hypot(player.x - tape.x, player.y - tape.y) < 34) {
      tape.taken = true;
      player.money += 25;
      state.progress.tapes += 1;
      state.progress.rep += 5;
      events.push({ type: 'chime' });
      events.push({ type: 'toast', text: `Tide Tape ${state.progress.tapes}/12 found! +$25` });
    }
  }
}

/** Skills grow from what Lena actually does: fast driving, hits landed,
 * sprinting on foot. Level-ups are toasted once each. */
function updateSkills(state, input, dt, events) {
  const prog = state.progress;
  const car = playerCar(state);
  if (car && Math.abs(car.speed) > 300) prog.driving += (Math.abs(car.speed) * dt) / 500;
  if (state.player.onFoot && state.player.moving && input.sprint && input.sprint()) {
    prog.stamina += (WALK.sprint * dt) / 400;
  }
  for (const kind of ['driving', 'shooting', 'stamina']) {
    const lv = skillLevel(prog[kind], kind);
    if (lv > prog.levels[kind]) {
      prog.levels[kind] = lv;
      const perk = kind === 'driving' ? 'top speed up!' : kind === 'shooting' ? 'damage up!' : 'sprint speed up!';
      events.push({ type: 'toast', text: `${kind[0].toUpperCase()}${kind.slice(1)} Lv ${lv} — ${perk}` });
      events.push({ type: 'chime' });
    }
  }
}

/** Advance the world one fixed step. `toWorld` maps screen pixels to world points for aiming. */
export function stepGame(state, input, dt, toWorld) {
  const events = [];
  // Slow-mo (hold X): the world runs at SLOWMO.scale while Lena stays at
  // full speed, so aiming and driving stay responsive while everything
  // else crawls. The meter drains while it lasts and refills while it
  // rests; it only starts again above minStart. Inputs without a slowmo
  // method (older test stubs, the title-screen idle input) never trigger it.
  const sm = state.slowmo;
  const prevSlow = sm.active;
  const held = !!(input.slowmo && input.slowmo());
  if (!sm.active && held && sm.meter > SLOWMO.minStart) sm.active = true;
  if (sm.active && (!held || sm.meter <= 0)) sm.active = false;
  if (sm.active) {
    sm.meter = Math.max(0, sm.meter - SLOWMO.drain * dt);
    if (sm.meter <= 0) sm.active = false;
  } else {
    sm.meter = Math.min(SLOWMO.max, sm.meter + SLOWMO.regen * dt);
  }
  if (sm.active && !prevSlow) events.push({ type: 'chime' });
  const wdt = sm.active ? dt * SLOWMO.scale : dt;
  state.time += dt;
  state.clockMinutes += wdt * 0.5;
  if (state.clockMinutes >= 24 * 60) state.clockMinutes -= 24 * 60;
  // Total game minutes never wrap: the property payout and the once-a-day
  // car sale both key off whole days passing.
  const beforeDay = Math.floor((state.totalMinutes || 0) / 1440);
  state.totalMinutes = (state.totalMinutes || 0) + wdt * 0.5;
  if (state.progress.property && Math.floor(state.totalMinutes / 1440) > beforeDay) {
    state.player.money += state.city.property.income;
    events.push({ type: 'toast', text: `Neon Club paid out $${state.city.property.income}.` });
  }

  const player = state.player;
  if (player.onFoot) updatePlayerOnFoot(state, input, dt, toWorld);
  else updateDriving(state, input, dt, () => events.push({ type: 'crash' }), events);

  updateTraffic(state, wdt);
  collidePlayerCar(state, events);
  updatePedestrians(state, wdt, events);
  updatePolice(state, wdt, events);
  updateCombat(state, input, wdt, events, toWorld);
  updateMissions(state, wdt, events);
  updateCrewJobs(state, wdt, events);
  updateSideJobs(state, wdt, events);
  updateMinigames(state, input, wdt, events, toWorld);
  updateRace(state, wdt, events);
  updateUnlocks(state, wdt, events);
  updateRandomEvent(state, wdt, events);
  updateEffects(state, wdt);
  collectCash(state, events);
  collectTapes(state, events);
  updateSkills(state, input, dt, events);

  // Health regen: only up to 50 HP, and only while standing still,
  // driving, or in cover — running around stops it. Above 50 HP, Lena
  // needs the clinic, the safehouse, or a snack.
  const canRegen = player.cover || !player.onFoot || !player.moving;
  if (canRegen && state.time - player.lastHurtAt > HEALTH.regenDelay && player.health > 0 && player.health < HEALTH.regenCap) {
    player.health = Math.min(HEALTH.regenCap, player.health + HEALTH.regenRate * dt);
  }
  if (player.health <= 0) events.push({ type: 'wasted' });

  const focus = playerCar(state) || player;
  const ease = Math.min(1, 5 * dt);
  state.camera.x += (focus.x - state.camera.x) * ease;
  state.camera.y += (focus.y - state.camera.y) * ease;
  state.camera.x = Math.max(0, Math.min(WORLD.width, state.camera.x));
  state.camera.y = Math.max(0, Math.min(WORLD.height, state.camera.y));
  void STEP;
  return events;
}
