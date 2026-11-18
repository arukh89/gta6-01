// Screenshot scenes behind ?shot=chase|foot|start|dusk (with &seed=N). Each
// scene places Lena and the city exactly, then plays the real rules forward
// for a fixed number of steps with scripted driving, so the frame is what
// real play looks like and the same seed always gives the same frame. The
// cover chase shows driving, police, wanted stars, the minimap and a mission
// objective at once; the other scenes show the city on foot, the title
// screen, and a dusk getaway along the beach road.
import { STEP } from './config.js';
import { createCar, playerCar } from './player.js';
import { startCurrentMission } from './missions.js';

function putPlayerInCar(state, type, x, y, angle, speed) {
  const car = createCar(type, x, y, angle, 'player');
  car.speed = speed;
  car.vx = Math.cos(angle) * speed;
  car.vy = Math.sin(angle) * speed;
  state.cars.push(car);
  state.player.onFoot = false;
  state.player.carId = car.id;
  state.player.x = x;
  state.player.y = y;
  state.player.angle = angle;
  state.camera.x = x;
  state.camera.y = y;
  return car;
}

function clearCorridor(state, y, x0, x1) {
  state.cars = state.cars.filter((car) => {
    if (car.driver !== 'traffic' && car.driver !== 'none') return true;
    return !(Math.abs(car.y - y) < 52 && car.x > x0 && car.x < x1);
  });
}

function placePoliceFormation(state, count) {
  const car = state.cars.find((c) => c.id === state.player.carId);
  if (!car) return;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const px = -fy;
  const py = fx;
  for (let i = 0; i < count; i += 1) {
    const back = 190 + i * 150;
    const side = i % 2 === 0 ? -28 : 28;
    const police = createCar('police', car.x - fx * back + px * side, car.y - fy * back + py * side, car.angle, 'police');
    police.speed = Math.max(300, car.speed);
    state.cars.push(police);
  }
  state.lastPoliceSpawn = state.time;
}

function driveForward(state, stepper, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) stepper(1, 0);
}

function idleWorld(state, stepper, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) stepper(0, 0);
}

/**
 * Stage the named scene on a fresh state. `stepper(throttle, steer)` advances
 * one fixed step with scripted input. Returns the screen the loop should
 * show: 'title' for the start scene, 'play' for the rest.
 */
export function stageShot(name, state, stepper) {
  const events = [];
  if (name === 'chase') {
    state.player.money = 1250;
    state.player.health = 100;
    state.mission.index = 3;
    state.mission.briefPending = false;
    startCurrentMission(state, events);
    clearCorridor(state, 800, 1400, 2700);
    putPlayerInCar(state, 'sports', 1500, 800, 0, 360);
    driveForward(state, stepper, 1.2);
    placePoliceFormation(state, 2);
    state.wanted.level = 3;
    state.wanted.hiddenTimer = 0;
    return 'play';
  }
  if (name === 'foot') {
    state.player.money = 320;
    state.player.x = 1030;
    state.player.y = 1410;
    state.player.angle = 0;
    state.camera.x = 1030;
    state.camera.y = 1410;
    state.mission.index = 0;
    state.mission.briefPending = false;
    startCurrentMission(state, events);
    const near = state.city.blocks.filter((b) => Math.abs(b.x + b.w / 2 - 1000) < 500 && Math.abs(b.y + b.h / 2 - 1410) < 400);
    const shirts = ['#e63946', '#2a9d8f', '#ffb703', '#8ecae6', '#90be6d', '#b5838d'];
    for (let i = 0; i < 6 && near.length; i += 1) {
      state.peds.push({
        kind: 'ped',
        block: near[i % near.length],
        t: state.rng.next(),
        dir: i % 2 ? 1 : -1,
        speed: 45,
        x: 1000,
        y: 1410,
        angle: 0,
        shirt: shirts[i],
        skin: '#c68642',
        panic: 0,
        down: 0,
        phase: i,
        fare: false,
      });
    }
    idleWorld(state, stepper, 2);
    return 'play';
  }
  if (name === 'dusk') {
    state.player.money = 640;
    state.dusk = true;
    state.clockMinutes = 18 * 60 + 50;
    state.mission.index = 2;
    state.mission.briefPending = false;
    startCurrentMission(state, events);
    state.mission.stepIndex = 1;
    state.mission.timerLeft = 62;
    clearCorridor(state, 1760, 1800, 3050);
    putPlayerInCar(state, 'sedan', 1900, 1760, 0, 330);
    driveForward(state, stepper, 1.0);
    placePoliceFormation(state, 1);
    state.wanted.level = 2;
    state.wanted.hiddenTimer = 0;
    return 'play';
  }
  // 'start' and anything else: the title screen over a living city.
  state.camera.x = 2080;
  state.camera.y = 800;
  idleWorld(state, stepper, 2.5);
  state.camera.x = 2080;
  state.camera.y = 800;
  return 'title';
}

export function shotScreenName(name) {
  return name === 'start' ? 'title' : 'play';
}
void playerCar;
