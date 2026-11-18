// The one simulation step: every system advances here, in a fixed order, and
// reports what happened as events the loop turns into sound, toasts and
// screens. The screenshot staging calls this same step with scripted input,
// so a staged frame is always a frame the real rules produced.
import { HEALTH, STEP, WORLD } from './config.js';
import { buildCity } from './world.js';
import { createPlayer, createCar, playerCar, updateDriving, updatePlayerOnFoot } from './player.js';
import { createParkedCars, createTraffic, updateTraffic } from './traffic.js';
import { createPedestrians, updatePedestrians } from './pedestrians.js';
import { createWanted, updatePolice } from './police.js';
import { updateCombat } from './combat.js';
import { createMissionState, updateMissions, updateSideJobs, createSideJob } from './missions.js';
import { spawnCashBurst, updateEffects } from './effects.js';

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
  return {
    city,
    rng: playRng,
    time: 0,
    clockMinutes: 16 * 60 + 40,
    player,
    cars,
    peds: createPedestrians(city, playRng, 40),
    wanted: createWanted(),
    mission: createMissionState(),
    sideJob: createSideJob(),
    bullets: [],
    particles: [],
    skids: [],
    camera: { x: player.x, y: player.y },
    shake: 0,
    dusk: false,
    lastPoliceSpawn: -99,
    lastOfficerSpawn: -99,
    stats: { missionsDone: 0, taxisDone: 0, shotsFired: 0, carsStolen: 0, cashFound: 0 },
  };
}

function collidePlayerCar(state, events) {
  const car = playerCar(state);
  if (!car) return;
  for (const other of state.cars) {
    if (other === car || other.driver === 'police') continue;
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
        car.health = Math.max(0, car.health - 6);
        other.health = Math.max(0, other.health - 6);
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

/** Advance the world one fixed step. `toWorld` maps screen pixels to world points for aiming. */
export function stepGame(state, input, dt, toWorld) {
  const events = [];
  state.time += dt;
  state.clockMinutes += dt * 0.5;
  if (state.clockMinutes >= 24 * 60) state.clockMinutes -= 24 * 60;

  const player = state.player;
  if (player.onFoot) updatePlayerOnFoot(state, input, dt, toWorld);
  else updateDriving(state, input, dt, () => events.push({ type: 'crash' }));

  updateTraffic(state, dt);
  collidePlayerCar(state, events);
  updatePedestrians(state, dt, events);
  updatePolice(state, dt, events);
  updateCombat(state, input, dt, events);
  updateMissions(state, dt, events);
  updateSideJobs(state, dt, events);
  updateEffects(state, dt);
  collectCash(state, events);

  if (state.time - player.lastHurtAt > HEALTH.regenDelay && player.health > 0 && player.health < HEALTH.max) {
    player.health = Math.min(HEALTH.max, player.health + HEALTH.regenRate * dt);
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
