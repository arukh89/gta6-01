// Screenshot scenes behind ?shot=chase|foot|start|map (with &seed=N). Each
// scene places Lena and the city exactly, then plays the real rules forward
// for a fixed number of steps with scripted driving, so the frame is what
// real play looks like and the same seed always gives the same frame. The
// cover chase shows driving, the helicopter, wanted stars, the radio and a
// named district at golden hour; the other scenes show the city on foot at
// dusk in Neon Row, the title screen over the beach road, and the full city
// map with the job list and progress.
import { STEP } from './config.js';
import { createCar, playerCar } from './player.js';
import { pedLookForIndex } from './pedestrians.js';
import { spawnHelicopter } from './police.js';
import { startCurrentMission } from './missions.js';
import { startCrewJob } from './missions.js';
import { loadRecordToLive } from './characters.js';
import { spawnMuzzle } from './effects.js';

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

/** Drive while firing: the real drive-by path (bullets, mag, wanted heat).
 * `holdWanted` pins the wanted level after every step — the staged shots
 * are witnessed and would otherwise raise the posed heat past the staged
 * level (and spawn a roadblock mid-frame). `holdHeat` pins the HEAT flag
 * the same way, so the frame keeps its sixth red star. */
function driveFiring(state, stepper, seconds, aim, holdWanted, holdHeat) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    stepper(1, 0, true, aim);
    if (holdWanted !== undefined) state.wanted.level = holdWanted;
    if (holdHeat) state.wanted.heat = true;
  }
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
/** Bring a named local into a shot: put them on the block nearest a
 * point, strolling slowly, so the frame catches them. Their loop is the
 * block whose centre is nearest the point. */
function bringNamedIntoFrame(state, name, x, y, near) {
  const local = state.peds.find((p) => p.name === name);
  if (!local || !near.length) return;
  let bestBlock = near[0];
  let bestD = Infinity;
  for (const b of near) {
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d < bestD) { bestD = d; bestBlock = b; }
  }
  local.block = bestBlock;
  local.x = x;
  local.y = y;
  local.t = 0.05;
  local.dir = 1;
  local.speed = 20;
}

export function stageShot(name, state, stepper) {
  const events = [];
  if (name === 'chase') {
    // Golden-hour chase, westbound across the Coral Bridge: 173 km/h,
    // HEAT — five stars plus the sixth red star — six cruisers behind
    // and the police helicopter overhead with its searchlight sweeping
    // the street. The car ends ON the landmark bridge (x≈1920, y=800),
    // so the gold deck and the river on both sides are the cover's stars.
    state.player.money = 1250;
    state.player.health = 100;
    state.progress.rep = 120;
    state.stats.missionsDone = 3;
    state.clockMinutes = 18 * 60 + 5;
    state.mission.index = 3;
    state.mission.briefPending = false;
    startCurrentMission(state, events);
    // Show the lighthouse leg, not the lose-heat leg: the staged HEAT
    // is the chase itself, so "Lose the heat (0 stars)" reads as a
    // contradiction in the frame. The lighthouse (170,2100) is far from
    // the staged drive, so the step cannot complete during staging.
    state.mission.stepIndex = 1;
    // The Getaway's onStart raises three stars, and the cruisers it
    // spawns end up on the road ahead of a westbound car (eastbound
    // they were harmlessly behind). Clear them and pin the heat to zero
    // for the drive, so the run to the bridge is clean; the staged
    // formation below supplies the chase, and the heat is pinned after it.
    state.cars = state.cars.filter((c) => c.driver !== 'police');
    state.wanted.level = 0;
    clearCorridor(state, 800, 1200, 3150);
    putPlayerInCar(state, 'sports', 2850, 800, Math.PI, 480);
    // Drive-by kit: an SMG with a full mag, so the staged chase fires
    // through the real rules — bullets, mag spend, wanted heat included.
    state.player.weapons = ['fists', 'pistol', 'smg'];
    state.player.weapon = 'smg';
    state.player.mag.smg = 30;
    state.player.ammo.smg = 120;
    driveForward(state, stepper, 1.2);
    placePoliceFormation(state, 6);
    state.wanted.level = 5;
    state.wanted.heat = true;
    state.wanted.hiddenTimer = 0;
    spawnHelicopter(state);
    // Final half second: firing back at the cruisers behind the car.
    // The chase camera puts them below screen centre, so the aim point
    // is (640, 520); the heat is held at the posed HEAT step by step.
    driveFiring(state, stepper, 0.5, { x: 640, y: 520 }, 5, true);
    // The staged steps drop the event list, so the last shot's muzzle
    // flash is spawned here — same function, same spot and angle the
    // live handler would use — fresh for the frozen frame.
    spawnMuzzle(state, state.player.x, state.player.y, state.player.angle);
    return 'play';
  }
  if (name === 'foot') {
    // Ivy's Quiet Hands at the marina, 19:30: the stealth crew job, not
    // another First Errand. Ivy stands mid-approach on the marina road —
    // the gold marker sits on the crate 200u east, the patrol car works
    // the south leg, Dedi the fisherman is at the crate, and the HUD
    // reads the crew objective with no stars (unseen is the whole job).
    // The safehouse is unlocked in this staging (three jobs done), or
    // the crew job could not start at all.
    loadRecordToLive(state, 'ivy');
    state.progress.safehouse = true;
    state.mission.completed = [0, 1, 2];
    state.player.money = 320;
    state.player.x = 2760;
    state.player.y = 1760;
    state.player.angle = 0;
    state.camera.x = 2760;
    state.camera.y = 1760;
    state.mission.index = 0;
    state.mission.briefPending = false;
    startCrewJob(state, 1, events);
    const near = state.city.blocks.filter((b) => Math.abs(b.x + b.w / 2 - 2760) < 500 && Math.abs(b.y + b.h / 2 - 1760) < 400);
    const shirts = ['#e63946', '#2a9d8f', '#ffb703', '#8ecae6', '#90be6d', '#b5838d'];
    for (let i = 0; i < 6 && near.length; i += 1) {
      // Staged walkers get hashed looks from a far index band (200+),
      // so they never collide with the city's own peds.
      state.peds.push({
        kind: 'ped',
        block: near[i % near.length],
        t: state.rng.next(),
        dir: i % 2 ? 1 : -1,
        speed: 35 + i * 6,
        x: 2760,
        y: 1760,
        angle: 0,
        shirt: shirts[i],
        skin: '#c68642',
        panic: 0,
        down: 0,
        phase: i,
        fare: false,
        ...pedLookForIndex(i + 200),
      });
    }
    // Dedi the fisherman works the marina: bring him into the frame,
    // strolling slowly by the crate, so the shot shows a named local.
    bringNamedIntoFrame(state, 'Dedi', 2900, 1720, near);
    idleWorld(state, stepper, 2);
    // The weapon wheel, open on the Pistol: Ivy owns it (12 in the mag,
    // 48 in reserve), so the staged frame shows the radial selector
    // itself — three wedges, the Pistol highlighted gold, the SMG dimmed
    // and locked because the crew has not bought one yet.
    state.wheel.open = true;
    state.wheel.selected = 1;
    state.wheel.touched = true;
    return 'play';
  }
  if (name === 'map') {
    // City map at golden hour: four jobs done, Harbor Deal in progress,
    // Respect 185, 5 of 12 Tide Tapes, skills on the board.
    state.player.money = 2840;
    state.player.health = 100;
    state.progress.rep = 185;
    state.progress.tapes = 5;
    state.progress.driving = 120;
    state.progress.shooting = 16;
    state.progress.stamina = 45;
    state.stats.missionsDone = 4;
    state.stats.racesWon = 1;
    // One crew job done (Shadow Run), safehouse unlocked — so the map
    // shot shows the CREW JOBS section with a tick on it.
    state.stats.crewDone = 1;
    state.progress.safehouse = true;
    state.crewJob.done = [0];
    state.mission.completed = [0, 1, 2, 3];
    // Medals on the four finished jobs, so the map shot shows the medal
    // column and the Replay buttons — the completion story in one frame.
    state.progress.medals = { 0: 'gold', 1: 'silver', 2: 'gold', 3: 'bronze' };
    // Lena herself, ON the Coral Bridge (Coral Boulevard, y=800) and
    // facing east, so the player arrow sits on the landmark bridge
    // itself in the map shot — the river and the gold deck behind it.
    state.player.x = 1920;
    state.player.y = 800;
    state.player.angle = 0;
    state.clockMinutes = 18 * 60 + 40;
    state.dusk = true;
    state.mission.index = 4;
    state.mission.briefPending = false;
    state.camera.x = 1600;
    state.camera.y = 1200;
    idleWorld(state, stepper, 1);
    state.camera.x = 1600;
    state.camera.y = 1200;
    return 'map';
  }
  // 'start' and anything else: the title screen over a living city. The
  // camera looks east down the beach road at golden hour — palms and water
  // to the right, low beachfront buildings to the left, no tower roof
  // dominating the frame.
  state.dusk = true;
  state.player.angle = 0;
  state.camera.x = 1120;
  state.camera.y = 1760;
  idleWorld(state, stepper, 2.5);
  state.camera.x = 1120;
  state.camera.y = 1760;
  return 'title';
}

export function shotScreenName(name) {
  return name === 'start' ? 'title' : name === 'map' ? 'map' : 'play';
}
void playerCar;
