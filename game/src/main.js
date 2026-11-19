// Solmaris Heat boot and loop: fixed 1/60 s steps, screens (title, play,
// paused, briefing, busted/wasted, shop, map), buttons, prompts, and the
// translation of simulation events into sound and toasts.
//
// ?seed=N fixes the city. ?shot=chase|foot|start|map (with &seed=N) stages
// that scene instead of running the loop, paints it, updates the HUD, and
// sets window.__shotReady for a screenshot.
import { HEALTH, STEP, WANTED, CHARACTERS, characterById, repTitle, skillLevel } from './config.js';
import { createSeededRandom } from './random.js';
import { createGameState, stepGame } from './update.js';
import { ACT, createInput } from './input.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { applyBustedPenalty, applyWastedPenalty, findCover, nearestCar, playerCar, startJump, tryEnterOrExitCar } from './player.js';
import { reloadWeapon } from './combat.js';
import { crimeWanted } from './police.js';
import { spawnMuzzle, spawnSparks } from './effects.js';
import { RACE, availableMissions, createRaceState, currentMission, missionList, replayMission, skipCurrentMission, startCurrentMission } from './missions.js';
import { SELL_VALUES, SHOP_ITEMS, buyItem, eatSnack, sellCar, shopItemState } from './shops.js';
import { createMinigameState, quitMinigame, startDarts, startRange } from './minigames.js';
import { applySave, hasSave, readSave, writeSave } from './save.js';
import { loadRecordToLive, nextCharacterId, switchCharacter } from './characters.js';
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
  select: document.getElementById('select'),
  help: document.getElementById('help'),
  pause: document.getElementById('pause'),
  over: document.getElementById('over'),
  brief: document.getElementById('brief'),
  shop: document.getElementById('shop'),
  map: document.getElementById('map'),
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

function near(x, y, point, radius) {
  return Math.hypot(x - point.x, y - point.y) < radius;
}

function computePrompt() {
  const player = state.player;
  if (state.minigame && state.minigame.active) {
    return state.minigame.kind === 'darts' ? 'E — Quit darts' : 'E — Quit the shooting range';
  }
  if (player.onFoot) {
    if (near(player.x, player.y, state.city.gunShop, 60)) return 'F — Browse Cielo Arms (weapons & armour) · E — Shooting range';
    if (!state.progress.safehouse && near(player.x, player.y, state.city.safehouse, 80)) {
      return 'Safehouse locked — finish three jobs first';
    }
    if (state.progress.safehouse && near(player.x, player.y, state.city.safehouse, 80)) {
      // T cycles the crew: the prompt names who is next, so the switch
      // never surprises — the others are waiting right here.
      const next = characterById(nextCharacterId(state));
      const swap = `T — Switch to ${next.name}`;
      return player.health < HEALTH.max ? `Safehouse — patching up… · H — sleep 8h (save) · ${swap}` : `Safehouse — H — sleep 8h (save) · ${swap}`;
    }
    if (!state.progress.property && near(player.x, player.y, state.city.property, 70)) {
      return `F — Buy the Neon Club for $${state.city.property.price} (earns $${state.city.property.income}/day) · E — Play darts`;
    }
    if (state.progress.property && near(player.x, player.y, state.city.property, 70)) {
      return `Neon Club — yours, earning $${state.city.property.income}/day · E — Play darts`;
    }
    const car = nearestCar(state, player.x, player.y, 52);
    if (car) {
      if (car.kind === 'boat') return `E — Board the ${car.name}`;
      return `E — ${car.parked || car.driver === 'traffic' ? 'Steal' : 'Get in'} the ${car.name}`;
    }
    for (const stand of state.city.taxiStands) {
      if (Math.hypot(player.x - stand.x, player.y - stand.y) < 46 && !state.sideJob.active) return 'Taxi fare here — wait for a passenger in a car';
    }
  } else {
    if (state.progress.garage && near(player.x, player.y, state.city.garage, 90)) {
      const car = playerCar(state);
      const sell = car && car.stolen && state.totalMinutes - state.progress.lastSellAt >= 1440;
      return sell
        ? `F — Repaint $50 · J — Sell this ${car.name} for $${sellValue(car)} (once a day)`
        : 'F — Repaint $50 · the garage repairs your car';
    }
    if (!state.mission.started && !state.race.active && near(player.x, player.y, RACE.start, 120)) {
      return 'Street race — drive through the purple marker to start';
    }
  }
  if (state.wanted.level > 0 && Math.hypot(player.x - state.city.paintShop.x, player.y - state.city.paintShop.y) < WANTED.sprayRadius) {
    if (player.onFoot) return 'Spray Barn — drive a car in to clear your heat';
    if (state.wanted.seen) return 'Spray Barn — the police are watching! Break line of sight first';
    return `Spray Barn — $${WANTED.sprayCost} clears your wanted level`;
  }
  return '';
}

function sellValue(car) {
  return SELL_VALUES[car.kind] || 250;
}

function handleEvents(events, screen) {
  // Index loop, not for-of: handlers may append events (a stolen car can
  // raise the heat, which toasts), and those get handled in the same pass.
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
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
    } else if (event.type === 'cop-shot') {
      audio.shot();
      spawnSparks(state, event.x, event.y);
    } else if (event.type === 'explosion') {
      audio.explosion();
      state.shake = Math.min(16, state.shake + 10);
    } else if (event.type === 'toast') {
      hud.toast(event.text, 3.4);
    } else if (event.type === 'stolen') {
      // A steal only brings the heat when someone sees or hears it:
      // a witness in sight, or an alarm ringing in earshot.
      if (event.alarm) audio.alarm();
      const witnessed = crimeWanted(state, 1, events, event.alarm ? { pedRadius: 400 } : undefined);
      hud.toast(event.alarm ? 'Car alarm! Someone heard that.' : witnessed ? 'Car stolen! The heat is on.' : 'Car stolen — nobody saw a thing.', 3);
    } else if (event.type === 'wanted-up' && event.level >= 3) {
      hud.toast(`Wanted level ${event.level} — lose the police!`, 3);
    } else if (event.type === 'sprayed') {
      hud.toast('Fresh paint — heat cleared!', 3);
      audio.chime();
    } else if (event.type === 'mission-done') {
      audio.missionDone();
      hud.toast(`Job complete: ${event.title} — +$${event.reward}${event.medal ? ` · ${event.medal.toUpperCase()} medal` : ''}`, 4);
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
    // Busted: the PD keeps every round of ammunition and the armour.
    // The guns stay — Lena buys her way back to a full mag at Cielo Arms.
    applyBustedPenalty(state);
    document.getElementById('over-title').textContent = 'Busted';
    document.getElementById('over-text').textContent = 'The Solmaris PD caught up with you. They kept all your ammo and your armour — the guns are yours, but the magazines are empty. Your heat is cleared and Dario is waiting at the safehouse.';
    audio.busted();
    state.respawn = { x: state.city.safehouse.x, y: state.city.safehouse.y };
  } else {
    // Wasted: the clinic takes 5% of the cash on hand, up to $5,000.
    const fine = applyWastedPenalty(state);
    document.getElementById('over-title').textContent = 'Wasted';
    document.getElementById('over-text').textContent = `You woke up at Solmaris Clinic. Bill: $${fine} (5% of your cash). Take better care of yourself out there.`;
    state.respawn = { x: state.city.clinic.x, y: state.city.clinic.y };
  }
  state.wanted.level = 0;
  state.wanted.heat = false;
  state.wanted.hiddenTimer = 0;
  state.heli = null;
  state.roadblock = false;
  state.race = createRaceState();
  state.minigame = createMinigameState();
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
  document.getElementById('brief-kicker').textContent = `JOB ${state.mission.index + 1} OF 9 · PAYS $${mission.reward}`;
  document.getElementById('brief-title').textContent = mission.title;
  let text = mission.brief;
  if (state.mission.checkpoint > 0 && mission.steps[state.mission.checkpoint]) {
    text += ` Retry from checkpoint: ${mission.steps[state.mission.checkpoint].label}.`;
  }
  document.getElementById('brief-text').textContent = text;
  // Another job is open too: offer the switch.
  const altBtn = document.getElementById('btn-brief-alt');
  const other = availableMissions(state).find((i) => i !== state.mission.index);
  if (other !== undefined) {
    const otherJob = missionList(state.city)[other];
    altBtn.textContent = `Also open: ${otherJob.title} ($${otherJob.reward})`;
    altBtn.classList.remove('hidden');
  } else {
    altBtn.classList.add('hidden');
  }
  // Three failures on this job: offer the skip.
  const skipBtn = document.getElementById('btn-brief-skip');
  if (state.mission.fails >= 3 && state.mission.failMission === state.mission.index) {
    skipBtn.classList.remove('hidden');
  } else {
    skipBtn.classList.add('hidden');
  }
  screenRef.current = 'brief';
  showOnly('brief');
  announce(`Job ${state.mission.index + 1}: ${mission.title}.`);
}

const PAINTS = ['#e76f51', '#e63946', '#2a9d8f', '#ffb703', '#4361ee', '#9b5de5'];

function openShop() {
  document.getElementById('shop-money').textContent = `You have $${state.player.money.toLocaleString('en-US')}.`;
  for (const item of SHOP_ITEMS) {
    const btn = document.getElementById(`buy-${item.id}`);
    const st = shopItemState(state, item.id);
    btn.disabled = st !== 'buy';
    btn.textContent = st === 'owned' ? `${item.name} — OWNED` : st === 'locked' ? `${item.name} — buy the SMG first` : `${item.name} — $${item.price}`;
  }
  screenRef.current = 'shop';
  showOnly('shop');
}

function closeShop() {
  screenRef.current = 'play';
  showOnly(null);
}

function repaintCar() {
  const car = playerCar(state);
  if (!car || state.player.money < 50) {
    hud.toast(state.player.money < 50 ? 'Not enough money for paint.' : 'No car to paint.', 2.5);
    return;
  }
  const next = PAINTS[(PAINTS.indexOf(car.color) + 1) % PAINTS.length];
  car.color = next;
  state.player.money -= 50;
  hud.toast('Fresh paint — $50.', 2.5);
  audio.chime();
}

/** Sleep at the safehouse: eight hours pass, Lena wakes up healed,
 * and the game saves. The city clock — and the property payout — move on. */
function sleepAtSafehouse() {
  const player = state.player;
  if (!state.progress.safehouse || !near(player.x, player.y, state.city.safehouse, 80)) {
    hud.toast('Sleep at the safehouse.', 2.5);
    return;
  }
  state.clockMinutes = (state.clockMinutes + 480) % (24 * 60);
  state.totalMinutes += 480;
  player.health = HEALTH.max;
  writeSave(state, seed);
  hud.toast('You slept 8 hours — rested, saved, and the city moved on.', 3.5);
  audio.chime();
}

/** Sell a borrowed car to the garage: once per game day, by model. */
function sellCarAtGarage() {
  const player = state.player;
  const car = playerCar(state);
  if (!car || !state.progress.garage || !near(player.x, player.y, state.city.garage, 90)) return;
  const ev = [];
  const problem = sellCar(state, ev);
  if (problem) {
    hud.toast(problem, 2.5);
  } else {
    handleEvents(ev, screenRef);
    audio.chime();
  }
}

/** Buy the Neon Club: $2,500 once, $120 every game day after. */
function buyProperty() {
  const player = state.player;
  if (state.progress.property) return;
  if (player.money < state.city.property.price) {
    hud.toast('Not enough money for the Neon Club.', 2.5);
    return;
  }
  player.money -= state.city.property.price;
  state.progress.property = true;
  hud.toast(`The Neon Club is yours — $${state.city.property.income} every day.`, 3.5);
  audio.chime();
}

function openMap() {
  hud.renderMap(state);
  screenRef.current = 'map';
  showOnly('map');
  hud.hide();
}

function closeMap() {
  screenRef.current = 'play';
  showOnly(null);
  hud.show();
}

function startFresh(charId) {
  state = createGameState(createSeededRandom(seed), createSeededRandom((seed ^ 0x5f3759df) >>> 0));
  // The crew waits at the safehouse; only the chosen character starts on
  // the street, with their perk skill and their own colours.
  const id = charId || 'lena';
  for (const def of CHARACTERS) {
    if (def.id === id) continue;
    state.characters[def.id].x = state.city.safehouse.x;
    state.characters[def.id].y = state.city.safehouse.y;
  }
  loadRecordToLive(state, id);
  screenRef.current = 'play';
  showOnly(null);
  hud.show();
  showBrief();
}

// Character select: three portraits, arrows + Enter, click to pick.
let selectedChar = 0;
function renderSelect() {
  const cards = document.querySelectorAll('#char-cards .char-card');
  cards.forEach((card, i) => {
    card.classList.toggle('selected', i === selectedChar);
    card.setAttribute('aria-pressed', i === selectedChar ? 'true' : 'false');
  });
  document.getElementById('btn-char-start').textContent = `Start as ${CHARACTERS[selectedChar].name}`;
}
function openSelect() {
  selectedChar = CHARACTERS.findIndex((c) => c.id === state.character);
  if (selectedChar < 0) selectedChar = 0;
  renderSelect();
  screenRef.current = 'select';
  showOnly('select');
}
function confirmSelect() {
  audio.unlock();
  startFresh(CHARACTERS[selectedChar].id);
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
  const stepper = (throttle, steer, fire, aim) => {
    const scripted = input.script(throttle, steer, fire, aim);
    // Staging steps deliberately drop the event list (as before): a staged
    // drive-by still fires real bullets through the real rules, and the
    // shot itself spawns its own muzzle flash — but no toast, sound or
    // shake leaks into the frozen frame.
    stepGame(state, scripted, STEP, toWorld);
  };
  // Each shot listens to its own station, so the radio name in the HUD is
  // deterministic per shot.
  audio.setStation(name === 'chase' ? 1 : name === 'foot' ? 2 : name === 'start' ? 3 : 0);
  const scene = stageShot(name, state, stepper);
  // A frozen frame: drop any camera shake the staging picked up, so the
  // screenshot is centred and byte-stable.
  state.shake = 0;
  if (scene === 'title') {
    showOnly('title');
    hud.hide();
  } else if (scene === 'map') {
    hud.renderMap(state);
    showOnly('map');
    hud.hide();
  } else {
    showOnly(null);
    hud.show();
  }
  let painted = 0;
  function paint() {
    renderer.draw(state);
    if (scene !== 'title' && scene !== 'map') hud.update(state, computePrompt(), audio.stationLabel());
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
    openSelect();
  });
  // Character select cards, built from the crew list so the screen and
  // the simulation never disagree about who exists.
  const cardsEl = document.getElementById('char-cards');
  for (const def of CHARACTERS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'char-card';
    card.innerHTML = `<span class="char-swatch" style="background:${def.shirt}"></span><span class="char-name">${def.name}</span><span class="char-role">${def.role}</span><span class="char-perk">${def.perkText}</span><span class="char-blurb">${def.blurb}</span>`;
    card.addEventListener('click', () => {
      selectedChar = CHARACTERS.indexOf(def);
      renderSelect();
    });
    card.addEventListener('dblclick', () => {
      selectedChar = CHARACTERS.indexOf(def);
      confirmSelect();
    });
    cardsEl.appendChild(card);
  }
  document.getElementById('btn-char-prev').addEventListener('click', () => {
    selectedChar = (selectedChar + CHARACTERS.length - 1) % CHARACTERS.length;
    renderSelect();
  });
  document.getElementById('btn-char-next').addEventListener('click', () => {
    selectedChar = (selectedChar + 1) % CHARACTERS.length;
    renderSelect();
  });
  document.getElementById('btn-char-start').addEventListener('click', () => confirmSelect());
  document.getElementById('btn-char-back').addEventListener('click', () => {
    screenRef.current = 'title';
    showOnly('title');
  });
  document.addEventListener('keydown', (event) => {
    if (screenRef.current !== 'select') return;
    if (event.code === 'ArrowLeft') {
      selectedChar = (selectedChar + CHARACTERS.length - 1) % CHARACTERS.length;
      renderSelect();
    } else if (event.code === 'ArrowRight') {
      selectedChar = (selectedChar + 1) % CHARACTERS.length;
      renderSelect();
    } else if (event.code === 'Enter') {
      confirmSelect();
    } else if (event.code === 'Escape') {
      screenRef.current = 'title';
      showOnly('title');
    }
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
  document.getElementById('btn-map').addEventListener('click', () => {
    openMap();
  });
  document.getElementById('btn-map-close').addEventListener('click', () => {
    if (screenRef.current === 'map') closeMap();
  });
  document.getElementById('btn-shop-close').addEventListener('click', () => {
    closeShop();
  });
  for (const item of SHOP_ITEMS) {
    document.getElementById(`buy-${item.id}`).addEventListener('click', () => {
      const events = [];
      const problem = buyItem(state, item.id, events);
      if (problem) hud.toast(problem, 2.5);
      handleEvents(events, screenRef);
      openShop();
    });
  }
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
  document.getElementById('btn-brief-alt').addEventListener('click', () => {
    const other = availableMissions(state).find((i) => i !== state.mission.index);
    if (other === undefined) return;
    state.mission.index = other;
    state.mission.checkpoint = 0;
    showBrief();
  });
  document.getElementById('btn-brief-skip').addEventListener('click', () => {
    const ev = [];
    skipCurrentMission(state, ev);
    handleEvents(ev, screenRef);
    if (state.mission.done) {
      screenRef.current = 'play';
      showOnly(null);
      hud.show();
    } else {
      showBrief();
    }
  });
  document.getElementById('maplist').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-replay]');
    if (!btn || screenRef.current !== 'map') return;
    const index = Number.parseInt(btn.dataset.replay, 10);
    const ev = [];
    if (replayMission(state, index, ev)) {
      handleEvents(ev, screenRef);
      closeMap();
      hud.toast(`Replaying "${missionList(state.city)[index].title}" — no pay for a replay.`, 3);
    }
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
        document.getElementById('pause-stats').textContent = `${characterById(state.character).name} · $${state.player.money} · ${state.stats.missionsDone}/9 jobs · ${state.stats.taxisDone} fares · ${state.stats.carsStolen} cars borrowed · ${state.stats.racesWon} races won · REP ${state.progress.rep} ${repTitle(state.progress.rep)} · DRV Lv ${skillLevel(state.progress.driving, 'driving')} · SHT Lv ${skillLevel(state.progress.shooting, 'shooting')} · STA Lv ${skillLevel(state.progress.stamina, 'stamina')}`;
        showOnly('pause');
      } else if (screenRef.current === 'paused') {
        screenRef.current = 'play';
        showOnly(null);
      } else if (screenRef.current === 'shop') {
        closeShop();
      } else if (screenRef.current === 'map') {
        closeMap();
      }
    }
    if (actions & ACT.MUTE) {
      const muted = audio.toggleMute();
      hud.toast(muted ? 'Sound off.' : 'Sound on.', 2);
    }
    if (actions & ACT.RADIO) {
      hud.toast(audio.nextStation(), 2.5);
    }
    if (actions & ACT.MAP) {
      if (screenRef.current === 'play') openMap();
      else if (screenRef.current === 'map') closeMap();
    }
    if (actions & ACT.SHOP) {
      if (screenRef.current === 'shop') {
        closeShop();
      } else if (screenRef.current === 'play') {
        const player = state.player;
        if (player.onFoot && near(player.x, player.y, state.city.gunShop, 60)) {
          openShop();
        } else if (player.onFoot && !state.progress.property && near(player.x, player.y, state.city.property, 70)) {
          buyProperty();
        } else if (!player.onFoot && state.progress.garage && near(player.x, player.y, state.city.garage, 90)) {
          repaintCar();
        }
      }
    }
    if (screenRef.current === 'play') {
      if (actions & ACT.ENTER_CAR) {
        const ev = [];
        const player = state.player;
        if (player.onFoot && state.minigame && state.minigame.active) {
          quitMinigame(state, ev);
          handleEvents(ev, screenRef);
        } else if (player.onFoot && near(player.x, player.y, state.city.gunShop, 60)) {
          const problem = startRange(state, ev);
          if (problem) hud.toast(problem, 2.5);
          else handleEvents(ev, screenRef);
        } else if (player.onFoot && near(player.x, player.y, state.city.property, 70)) {
          const problem = startDarts(state, ev);
          if (problem) hud.toast(problem, 2.5);
          else handleEvents(ev, screenRef);
        } else {
          tryEnterOrExitCar(state, ev);
          handleEvents(ev, screenRef);
        }
      }
      if (actions & ACT.COVER) {
        const player = state.player;
        if (player.onFoot) {
          if (player.cover) {
            player.cover = null;
          } else {
            const spot = findCover(state, player.x, player.y);
            if (spot) {
              player.cover = spot;
              player.x = spot.x;
              player.y = spot.y;
              player.angle = spot.angle;
              hud.toast('In cover — aim and shoot from behind it. Move to step out.', 3);
            } else {
              hud.toast('No cover nearby.', 2);
            }
          }
        }
      }
      if (actions & ACT.JUMP) startJump(state);
      if (actions & ACT.CAMERA) {
        state.firstPerson = !state.firstPerson;
        hud.toast(state.firstPerson ? 'First-person camera.' : 'Chase camera.', 2);
      }
      if (actions & ACT.SLEEP) sleepAtSafehouse();
      if (actions & ACT.SWITCH) {
        const ev = [];
        const problem = switchCharacter(state, nextCharacterId(state), ev);
        if (problem) hud.toast(problem, 2.5);
        else handleEvents(ev, screenRef);
      }
      if (actions & ACT.SNACK) {
        const ev = [];
        const problem = eatSnack(state, ev);
        if (problem) hud.toast(problem, 2.5);
        else handleEvents(ev, screenRef);
      }
      if (actions & ACT.SELL_CAR) sellCarAtGarage();
      if (actions & ACT.RELOAD) reloadWeapon(state);
      if (actions & ACT.WEAPON_FISTS) state.player.weapon = 'fists';
      if (actions & ACT.WEAPON_PISTOL) state.player.weapon = 'pistol';
      if (actions & ACT.WEAPON_SMG && state.player.weapons.includes('smg')) state.player.weapon = 'smg';
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
      hud.update(state, computePrompt(), audio.stationLabel());
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
