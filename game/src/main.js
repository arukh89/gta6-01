// Solmaris Heat boot and loop: fixed 1/60 s steps, screens (title, play,
// paused, briefing, busted/wasted), buttons, prompts, and the translation of
// simulation events into sound and toasts.
//
// ?seed=N fixes the city. ?shot=chase|foot|start|dusk (with &seed=N) stages
// that scene instead of running the loop, paints it, updates the HUD, and
// sets window.__shotReady for a screenshot.
import { HEALTH, STEP, WANTED } from './config.js';
import { createSeededRandom } from './random.js';
import { createGameState, stepGame } from './update.js';
import { ACT, createInput } from './input.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { nearestCar, playerCar, tryEnterOrExitCar } from './player.js';
import { reloadWeapon } from './combat.js';
import { addWanted } from './police.js';
import { spawnMuzzle, spawnSparks } from './effects.js';
import { currentMission, startCurrentMission } from './missions.js';
import { applySave, hasSave, readSave, writeSave } from './save.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const overlays = {
  title: document.getElementById('title'),
  help: document.getElementById('help'),
  pause: document.getElementById('pause'),
  over: document.getElementById('over'),
  brief: document.getElementById('brief'),
};

// The 3D renderer (render3d.js) draws the game by default; ?renderer=2d
// falls back to the 2D canvas renderer (render.js). The 3D module is
// loaded only when used, so the 2D fallback never downloads the vendored
// three.js library.
const use3d = params.get('renderer') !== '2d';

let state = createGameState(createSeededRandom(seed), createSeededRandom((seed ^ 0x5f3759df) >>> 0));
const renderer = use3d
  ? await (await import('./render3d.js')).createRenderer3d(canvas)
  : createRenderer(canvas);
const hud = createHud();
const audio = createAudio();
const input = createInput(canvas);

function announce(message) {
  statusEl.textContent = message;
}

function showOnly(name) {
  for (const [key, node] of Object.entries(overlays)) {
    node.classList.toggle('hidden', key !== name);
  }
  if (name === null) {
    for (const node of Object.values(overlays)) node.classList.add('hidden');
  }
}

function toWorld(sx, sy) {
  return renderer.toWorld(sx, sy, state);
}

function computePrompt() {
  const player = state.player;
  if (player.onFoot) {
    const car = nearestCar(state, player.x, player.y, 52);
    if (car) return `E — ${car.parked || car.driver === 'traffic' ? 'Steal' : 'Get in'} the ${car.name}`;
    for (const stand of state.city.taxiStands) {
      if (Math.hypot(player.x - stand.x, player.y - stand.y) < 46 && !state.sideJob.active) return 'Taxi fare here — wait for a passenger in a car';
    }
  }
  if (state.wanted.level > 0 && Math.hypot(player.x - state.city.paintShop.x, player.y - state.city.paintShop.y) < WANTED.sprayRadius) {
    return `Spray Barn — $${WANTED.sprayCost} clears your wanted level`;
  }
  return '';
}

function handleEvents(events, screen) {
  for (const event of events) {
    if (event.type === 'shot') {
      audio.shot();
      const player = state.player;
      spawnMuzzle(state, player.x, player.y, player.angle);
      state.shake = Math.min(10, state.shake + 2);
    } else if (event.type === 'punch') {
      audio.punch();
    } else if (event.type === 'crash') {
      audio.crash();
      state.shake = Math.min(14, state.shake + 5);
    } else if (event.type === 'chime') {
      audio.chime();
    } else if (event.type === 'spark') {
      spawnSparks(state, event.x, event.y);
    } else if (event.type === 'toast') {
      hud.toast(event.text, 3.4);
    } else if (event.type === 'stolen') {
      addWanted(state, 1, []);
      hud.toast('Car stolen! The heat is on.', 3);
    } else if (event.type === 'wanted-up' && event.level >= 3) {
      hud.toast(`Wanted level ${event.level} — lose the police!`, 3);
    } else if (event.type === 'sprayed') {
      hud.toast('Fresh paint — heat cleared!', 3);
      audio.chime();
    } else if (event.type === 'mission-done') {
      audio.missionDone();
      hud.toast(`Job complete: ${event.title} — +$${event.reward}`, 4);
      writeSave(state, seed);
    } else if (event.type === 'story-done') {
      audio.missionDone();
      hud.toast(`Heatwave finale complete! +$${event.reward} — Solmaris is yours.`, 5);
      writeSave(state, seed);
    } else if (event.type === 'mission-failed') {
      hud.toast(`Out of time on ${event.title} — try it again.`, 4);
    } else if (event.type === 'busted' && screen.current === 'play') {
      endRun('busted');
    } else if (event.type === 'wasted' && screen.current === 'play') {
      endRun('wasted');
    }
  }
}

function endRun(kind) {
  const player = state.player;
  if (kind === 'busted') {
    const fine = Math.min(player.money, HEALTH.bustFine);
    player.money -= fine;
    document.getElementById('over-title').textContent = 'Busted';
    document.getElementById('over-text').textContent = `The Solmaris PD caught up with you. Fine: $${fine}. Your heat is cleared and Dario is waiting at the safehouse.`;
    audio.busted();
    state.respawn = { x: state.city.safehouse.x, y: state.city.safehouse.y };
  } else {
    const fine = Math.min(player.money, HEALTH.clinicFine);
    player.money -= fine;
    document.getElementById('over-title').textContent = 'Wasted';
    document.getElementById('over-text').textContent = `You woke up at Solmaris Clinic. Bill: $${fine}. Take better care of yourself out there.`;
    state.respawn = { x: state.city.clinic.x, y: state.city.clinic.y };
  }
  state.wanted.level = 0;
  state.wanted.hiddenTimer = 0;
  screenRef.current = 'over';
  showOnly('over');
  hud.hide();
  announce(kind === 'busted' ? 'Busted by the police.' : 'Wasted. You woke up at the clinic.');
}

const screenRef = { current: 'title' };

function respawn() {
  const player = state.player;
  const spot = state.respawn || state.city.spawn;
  const car = playerCar(state);
  if (car) {
    car.driver = 'none';
    car.parked = true;
  }
  player.onFoot = true;
  player.carId = null;
  player.health = HEALTH.max;
  player.x = spot.x;
  player.y = spot.y;
  state.camera.x = spot.x;
  state.camera.y = spot.y;
  state.cars = state.cars.filter((c) => c.driver !== 'police');
  state.peds = state.peds.filter((p) => p.kind !== 'cop');
  screenRef.current = 'play';
  showOnly(null);
  hud.show();
  writeSave(state, seed);
}

function showBrief() {
  const mission = currentMission(state);
  if (!mission) return;
  document.getElementById('brief-kicker').textContent = `JOB ${state.mission.index + 1} OF 6 · PAYS $${mission.reward}`;
  document.getElementById('brief-title').textContent = mission.title;
  document.getElementById('brief-text').textContent = mission.brief;
  screenRef.current = 'brief';
  showOnly('brief');
  announce(`Job ${state.mission.index + 1}: ${mission.title}.`);
}

function startFresh() {
  state = createGameState(createSeededRandom(seed), createSeededRandom((seed ^ 0x5f3759df) >>> 0));
  screenRef.current = 'play';
  showOnly(null);
  hud.show();
  showBrief();
}

function startContinued() {
  const data = readSave();
  if (data) applySave(state, data);
  screenRef.current = 'play';
  showOnly(null);
  hud.show();
  if (state.mission.briefPending && !state.mission.done) showBrief();
  announce('Continuing your game in Solmaris.');
}

function runShot(name) {
  const stepper = (throttle, steer) => {
    const scripted = input.script(throttle, steer);
    stepGame(state, scripted, STEP, toWorld);
  };
  const scene = stageShot(name, state, stepper);
  if (scene === 'title') {
    showOnly('title');
    hud.hide();
  } else {
    showOnly(null);
    hud.show();
  }
  let painted = 0;
  function paint() {
    renderer.draw(state);
    if (scene !== 'title') hud.update(state, computePrompt());
    painted += 1;
    if (painted < 3) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();
  const idleInput = {
    steer: () => 0,
    throttle: () => 0,
    sprint: () => false,
    mouse: () => ({ x: 0, y: 0 }),
    isFiring: () => false,
    takeActions: () => 0,
  };

  document.getElementById('btn-new').addEventListener('click', () => {
    audio.unlock();
    startFresh();
  });
  document.getElementById('btn-continue').addEventListener('click', () => {
    audio.unlock();
    startContinued();
  });
  document.getElementById('btn-help').addEventListener('click', () => showOnly('help'));
  document.getElementById('btn-help-back').addEventListener('click', () => showOnly('title'));
  document.getElementById('btn-resume').addEventListener('click', () => {
    screenRef.current = 'play';
    showOnly(null);
  });
  document.getElementById('btn-save').addEventListener('click', () => {
    writeSave(state, seed);
    hud.toast('Game saved.', 2.5);
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    writeSave(state, seed);
    screenRef.current = 'title';
    showOnly('title');
    hud.hide();
  });
  document.getElementById('btn-again').addEventListener('click', () => {
    audio.unlock();
    respawn();
  });
  document.getElementById('btn-brief').addEventListener('click', () => {
    audio.unlock();
    startCurrentMission(state, []);
    screenRef.current = 'play';
    showOnly(null);
    hud.show();
  });
  canvas.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  if (hasSave()) document.getElementById('btn-continue').classList.remove('hidden');

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const actions = input.takeActions();
    if (actions & ACT.PAUSE) {
      if (screenRef.current === 'play') {
        screenRef.current = 'paused';
        document.getElementById('pause-stats').textContent = `$${state.player.money} · ${state.stats.missionsDone}/6 jobs · ${state.stats.taxisDone} fares · ${state.stats.carsStolen} cars borrowed`;
        showOnly('pause');
      } else if (screenRef.current === 'paused') {
        screenRef.current = 'play';
        showOnly(null);
      }
    }
    if (actions & ACT.MUTE) {
      const muted = audio.toggleMute();
      hud.toast(muted ? 'Sound off.' : 'Sound on.', 2);
    }
    if (screenRef.current === 'play') {
      if (actions & ACT.ENTER_CAR) {
        const events = [];
        tryEnterOrExitCar(state, events);
        handleEvents(events, screenRef);
      }
      if (actions & ACT.RELOAD) reloadWeapon(state);
      if (actions & ACT.WEAPON_FISTS) state.player.weapon = 'fists';
      if (actions & ACT.WEAPON_PISTOL) state.player.weapon = 'pistol';
      while (accumulator >= STEP) {
        const events = stepGame(state, input, STEP, toWorld);
        handleEvents(events, screenRef);
        accumulator -= STEP;
        if (screenRef.current !== 'play') {
          accumulator = 0;
          break;
        }
      }
      if (state.mission.briefPending && !state.mission.done && screenRef.current === 'play') showBrief();
      const car = playerCar(state);
      audio.update(STEP, car ? car.speed : 0, state.wanted.level > 0, state.time);
      hud.update(state, computePrompt());
    } else if (screenRef.current === 'title') {
      while (accumulator >= STEP) {
        stepGame(state, idleInput, STEP, toWorld);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(state);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screenRef.current === 'play') {
      screenRef.current = 'paused';
      showOnly('pause');
    }
  });

  showOnly('title');
  announce('Solmaris Heat. Choose New game to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
window.__gameReady = true;
