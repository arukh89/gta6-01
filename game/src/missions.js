// Story jobs and side work in Solmaris: nine jobs for Dario, from a first
// errand to the Heatwave finale, plus repeatable taxi fares and a street
// race. Each job is a list of steps (go somewhere, drive a car, lose the
// heat, pick something up); finishing a job pays out, earns Respect, saves
// the game, and briefs the next one.
import { addWanted } from './police.js';
import { minigameObjective } from './minigames.js';
// Crew jobs need cars (tail target, patrol), line of sight (stealth)
// and the crew names (briefs, wrong-character nudges).
import { createCar, playerCar } from './player.js';
import { hasLineOfSight } from './world.js';
import { characterById } from './config.js';

export const MISSION_COUNT = 9;

/** True while a crew job is running — races, taxi fares and random
 * events all stay out of the way until it ends. */
export function crewBusy(state) {
  return Boolean(state.crewJob && state.crewJob.active);
}

/** Street race: a loop of four checkpoints from the purple start marker. */
export const RACE = {
  start: { x: 480, y: 800 },
  checkpoints: [
    { x: 480, y: 1760 },
    { x: 2720, y: 1760 },
    { x: 2720, y: 800 },
    { x: 480, y: 800 },
  ],
  reward: 400,
  time: 110,
};

function gotoStep(label, point, radius) {
  return { kind: 'goto', label, point, radius: radius || 64 };
}

export function missionList(city) {
  return [
    {
      title: 'First Errand',
      brief: 'Dario needs a package moved across town, no questions. Pick it up at his garage, then walk it into the safehouse on foot. Keep it quiet.',
      reward: 200,
      par: 60,
      steps: [
        gotoStep('Pick up the package at Dario\'s Garage', city.garage, 70),
        gotoStep('Deliver the package to the Safehouse', city.safehouse, 70),
      ],
    },
    {
      title: 'Hot Wheels',
      brief: 'A red Vela GT is parked near the garage and Dario has a buyer. Take it — any red sports car will do — and bring it to the garage. Expect attention.',
      reward: 350,
      par: 90,
      steps: [
        { kind: 'steal-sports', label: 'Steal a red Vela GT sports car' },
        gotoStep('Deliver the Vela GT to Dario\'s Garage', city.garage, 80),
      ],
    },
    {
      title: 'Beach Run',
      brief: 'Three drops along the beach road, ninety seconds on the clock. Grab a car, hit every checkpoint, and do not stop to admire the sunset.',
      reward: 400,
      par: 90,
      timer: 90,
      steps: [
        { kind: 'enter-car', label: 'Get in any car' },
        gotoStep('Checkpoint 1: Marina Drive', { x: 2720, y: 1760 }, 80),
        gotoStep('Checkpoint 2: Sunset Row', { x: 1440, y: 1760 }, 80),
        gotoStep('Checkpoint 3: Palma Avenue', { x: 480, y: 1760 }, 80),
      ],
    },
    {
      title: 'The Getaway',
      brief: 'The tip went wrong and the whole precinct is awake. Lose three stars of heat, then lie low at the Old Lighthouse until it blows over.',
      reward: 500,
      par: 180,
      onStart(state, events) {
        addWanted(state, 3, events);
      },
      steps: [
        { kind: 'lose-heat', label: 'Lose the heat (0 stars)' },
        gotoStep('Reach the Old Lighthouse', city.lighthouse, 80),
      ],
    },
    {
      title: 'Harbor Deal',
      brief: 'A briefcase changes hands at the marina at dusk. Collect it, then get it to the safehouse. The other side brings friends with badges.',
      reward: 600,
      par: 120,
      steps: [
        gotoStep('Go to the Marina Deal', city.marina, 70),
        { kind: 'collect', label: 'Pick up the briefcase', point: city.marina, radius: 60 },
        gotoStep('Bring the briefcase to the Safehouse', city.safehouse, 70),
      ],
    },
    {
      title: 'Night Haul',
      brief: 'A crate waits at the marina after dark — Dario\'s buyer pays fast for quiet hands. Pick it up and bring it to the garage. One hundred and twenty seconds, no excuses.',
      reward: 700,
      par: 120,
      timer: 120,
      steps: [
        gotoStep('Go to the Marina', city.marina, 70),
        { kind: 'collect', label: 'Pick up the crate', point: city.marina, radius: 60 },
        gotoStep('Deliver the crate to Dario\'s Garage', city.garage, 80),
      ],
    },
    {
      title: 'Smoke Screen',
      brief: 'Dario needs a clean Vela GT for a client who asks no questions — and the precinct is already watching. Steal the car, shake the heat, then park it at the safehouse.',
      reward: 900,
      par: 180,
      steps: [
        { kind: 'steal-sports', label: 'Steal a red Vela GT sports car' },
        { kind: 'lose-heat', label: 'Lose the heat (0 stars)' },
        gotoStep('Deliver the Vela GT to the Safehouse', city.safehouse, 80),
      ],
    },
    {
      title: 'The Courier',
      brief: 'Three envelopes, three corners of Solmaris, one hundred and fifty seconds. Downtown, Neon Row, then the lighthouse road — drive like the city is yours, because after this it will be.',
      reward: 750,
      par: 150,
      timer: 150,
      steps: [
        { kind: 'enter-car', label: 'Get in any car' },
        gotoStep('Drop 1: Downtown Solmaris', { x: 2400, y: 480 }, 80),
        gotoStep('Drop 2: Neon Row', { x: 480, y: 1440 }, 80),
        gotoStep('Drop 3: Lighthouse Road', { x: 480, y: 2080 }, 80),
      ],
    },
    {
      title: 'Heatwave Finale',
      brief: 'One last run: gather the crew at the garage, swing by the marina, shake four stars, and finish at the lighthouse. After this, Solmaris is yours.',
      reward: 800,
      par: 240,
      onStart(state, events) {
        addWanted(state, 2, events);
      },
      steps: [
        gotoStep('Gather the crew at Dario\'s Garage', city.garage, 70),
        gotoStep('Swing by the Marina', city.marina, 70),
        { kind: 'lose-heat', label: 'Shake the heat (0 stars)' },
        gotoStep('Finish at the Old Lighthouse', city.lighthouse, 80),
      ],
    },
  ];
}

export function createMissionState() {
  return {
    index: 0,
    stepIndex: 0,
    started: false,
    briefPending: true,
    timerLeft: 0,
    done: false,
    failed: false,
    // Missions finished: the story is a set of completed jobs, not a
    // single pointer — the next two unfinished jobs are both available.
    completed: [],
    // Checkpoint: the step a retry resumes from — the last step
    // finished, so failing at the end no longer restarts the whole job.
    checkpoint: 0,
    // Skip: consecutive failures on the same job; three unlocks a skip.
    fails: 0,
    failMission: -1,
    // Replay: re-running a finished job pays nothing and returns the
    // story to where it was.
    replay: false,
    returnIndex: 0,
    // Medal timing: clock time and damage taken on this attempt.
    startTime: 0,
    damageTaken: 0,
  };
}

/** The first two unfinished jobs — both are available to start. */
export function availableMissions(state) {
  const out = [];
  for (let i = 0; i < MISSION_COUNT; i += 1) {
    if (!state.mission.completed.includes(i)) out.push(i);
    if (out.length >= 2) break;
  }
  return out;
}

function firstUnfinished(state) {
  for (let i = 0; i < MISSION_COUNT; i += 1) {
    if (!state.mission.completed.includes(i)) return i;
  }
  return MISSION_COUNT;
}

/** A medal for a finished job: gold for fast and clean, silver for
 * on-par, bronze otherwise. The best medal per job is kept. */
export function medalFor(mission, seconds, damage) {
  if (seconds <= (mission.par || 120) * 0.7 && damage <= 10) return 'gold';
  if (seconds <= (mission.par || 120) && damage <= 40) return 'silver';
  return 'bronze';
}

const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };

export function currentMission(state) {
  const list = missionList(state.city);
  if (state.mission.index >= list.length) return null;
  return list[state.mission.index];
}

export function currentStep(state) {
  const mission = currentMission(state);
  if (!mission) return null;
  return mission.steps[state.mission.stepIndex] || null;
}

/** The skiff nearest the player (for pointing at it before boarding). */
function nearestBoat(state) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (car.kind !== 'boat') continue;
    const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function missionMarker(state) {
  if (state.race && state.race.active) return RACE.checkpoints[state.race.index];
  // While a crew job runs, the marker is the job's own target: the tail
  // car, the crate, the next skiff or pier, the next junction box.
  const cj = state.crewJob;
  if (cj && cj.active) {
    const job = CREW_JOBS[cj.index];
    if (job) {
      if (job.type === 'tail' && cj.target) return { x: cj.target.x, y: cj.target.y };
      if (job.type === 'stealth') return job.target;
      if (job.type === 'boat') {
        if (cj.step === 0) return nearestBoat(state) || job.target;
        return job.target;
      }
      if (job.type === 'sabotage') return job.boxes[Math.min(cj.boxesDone, job.boxes.length - 1)];
    }
  }
  const mission = currentMission(state);
  if (mission) {
    for (let i = state.mission.stepIndex; i < mission.steps.length; i += 1) {
      if (mission.steps[i].point) return mission.steps[i].point;
    }
  }
  if (state.sideJob && state.sideJob.active) return state.sideJob.target;
  return null;
}

/** The HUD objective line while a crew job runs (null when none). */
function crewObjectiveText(state) {
  const job = CREW_JOBS[state.crewJob.index];
  if (!job) return null;
  const left = Math.ceil(state.crewJob.timerLeft);
  if (job.type === 'tail') return `Crew: ${job.title} — tail the sedan 45–220u — ${left}s left`;
  if (job.type === 'stealth') return `Crew: ${job.title} — reach the marina crate unseen`;
  if (job.type === 'boat') {
    return state.crewJob.step === 0
      ? `Crew: ${job.title} — get in a skiff — ${left}s left`
      : `Crew: ${job.title} — lighthouse pier — ${left}s left`;
  }
  if (job.type === 'sabotage') {
    const hold = state.crewJob.holdTimer > 0 ? `, hold ${state.crewJob.holdTimer.toFixed(1)}s/2s` : '';
    return `Crew: ${job.title} — box ${state.crewJob.boxesDone + 1}/3${hold}, ${state.wanted.level}★ heat`;
  }
  return null;
}

export function objectiveText(state) {
  if (state.minigame && state.minigame.active) {
    const text = minigameObjective(state);
    if (text) return text;
  }
  if (state.race && state.race.active) {
    return `Street race — checkpoint ${state.race.index + 1}/4 — ${Math.ceil(state.race.timerLeft)}s left`;
  }
  if (state.crewJob && state.crewJob.active) {
    const text = crewObjectiveText(state);
    if (text) return text;
  }
  const mission = currentMission(state);
  const step = currentStep(state);
  if (state.mission.done) return 'Free roam — Solmaris is yours. Taxi fares pay at the blue markers.';
  if (!mission || !step) return 'Head to the gold marker.';
  let text = step.label;
  if (mission.timer && state.mission.timerLeft > 0) text += ` — ${Math.ceil(state.mission.timerLeft)}s left`;
  return text;
}

export function startCurrentMission(state, events) {
  const mission = currentMission(state);
  if (!mission) return;
  // A new job resets the failure counter; a retry of the same job keeps it.
  if (state.mission.failMission !== state.mission.index) {
    state.mission.fails = 0;
    state.mission.failMission = state.mission.index;
  }
  state.mission.started = true;
  state.mission.briefPending = false;
  // Retry from the checkpoint, not from the first step.
  state.mission.stepIndex = state.mission.checkpoint || 0;
  state.mission.timerLeft = mission.timer || 0;
  state.mission.failed = false;
  state.mission.startTime = state.time;
  state.mission.damageTaken = 0;
  if (mission.onStart) mission.onStart(state, events);
}

/** Skip the current job after three failures: the story moves on
 * with no pay and no Respect — the job counts as done, never as won. */
export function skipCurrentMission(state, events) {
  const mission = currentMission(state);
  if (!mission) return;
  if (!state.mission.completed.includes(state.mission.index)) {
    state.mission.completed.push(state.mission.index);
  }
  applyUnlocks(state, events);
  state.mission.index = firstUnfinished(state);
  state.mission.done = state.mission.index >= MISSION_COUNT;
  state.mission.started = false;
  state.mission.stepIndex = 0;
  state.mission.checkpoint = 0;
  state.mission.fails = 0;
  state.mission.failMission = -1;
  state.mission.replay = false;
  state.mission.briefPending = !state.mission.done;
  events.push({ type: 'toast', text: `Skipped "${mission.title}" — no pay, but the story goes on.` });
  if (state.mission.done) events.push({ type: 'story-done', reward: 0 });
}

/** Replay a finished job: no pay, no Respect, best medal kept. */
export function replayMission(state, index, events) {
  if (index < 0 || index >= MISSION_COUNT) return false;
  if (!state.mission.completed.includes(index)) return false;
  state.mission.returnIndex = state.mission.done ? MISSION_COUNT : state.mission.index;
  state.mission.index = index;
  state.mission.replay = true;
  state.mission.done = false;
  state.mission.checkpoint = 0;
  state.mission.briefPending = true;
  startCurrentMission(state, events);
  return true;
}

/** Unlocks follow jobs finished, not the job number: the safehouse opens
 * after three jobs, the garage after five — whichever order they fell in. */
function applyUnlocks(state, events) {
  const done = state.mission.completed.length;
  if (done >= 3 && !state.progress.safehouse) {
    state.progress.safehouse = true;
    events.push({ type: 'toast', text: 'Safehouse unlocked — stop by to patch up and save.' });
  }
  if (done >= 5 && !state.progress.garage) {
    state.progress.garage = true;
    events.push({ type: 'toast', text: "Dario's Garage unlocked — free repairs and fresh paint." });
  }
}

function stepDone(state, step) {
  const player = state.player;
  if (step.kind === 'goto' || step.kind === 'collect') {
    return Math.hypot(player.x - step.point.x, player.y - step.point.y) < step.radius;
  }
  if (step.kind === 'enter-car') return !player.onFoot;
  if (step.kind === 'steal-sports') {
    const car = state.cars.find((c) => c.id === player.carId);
    return Boolean(car && car.kind === 'sports');
  }
  if (step.kind === 'lose-heat') return state.wanted.level === 0;
  return false;
}

export function updateMissions(state, dt, events) {
  const mission = currentMission(state);
  if (!mission || !state.mission.started || state.mission.done) return;
  if (mission.timer) {
    state.mission.timerLeft -= dt;
    if (state.mission.timerLeft <= 0) {
      state.mission.failed = true;
      state.mission.started = false;
      state.mission.briefPending = true;
      // Failures stack per job; the checkpoint survives the failure.
      state.mission.fails += 1;
      state.mission.failMission = state.mission.index;
      events.push({ type: 'mission-failed', title: mission.title });
      return;
    }
  }
  const step = currentStep(state);
  if (!step) return;
  if (stepDone(state, step)) {
    if (step.kind === 'collect') {
      addWanted(state, 2, events);
      events.push({ type: 'toast', text: 'Briefcase secured — the police are coming!' });
    }
    state.mission.stepIndex += 1;
    // Every finished step is a checkpoint: the next retry starts here.
    state.mission.checkpoint = state.mission.stepIndex;
    events.push({ type: 'step-done' });
    if (state.mission.stepIndex >= mission.steps.length) {
      const seconds = state.time - state.mission.startTime;
      const medal = medalFor(mission, seconds, state.mission.damageTaken || 0);
      const prev = state.progress.medals[state.mission.index];
      if (!prev || MEDAL_RANK[medal] > MEDAL_RANK[prev]) state.progress.medals[state.mission.index] = medal;
      const wasReplay = state.mission.replay;
      if (wasReplay) {
        // A replay pays nothing and the story returns to where it was.
        events.push({ type: 'toast', text: `Replay done: ${medal.toUpperCase()} medal — no pay for a replay.` });
        state.mission.index = state.mission.returnIndex;
        state.mission.done = state.mission.index >= MISSION_COUNT;
      } else {
        state.player.money += mission.reward;
        state.progress.rep += 25;
        state.stats.missionsDone += 1;
        if (!state.mission.completed.includes(state.mission.index)) {
          state.mission.completed.push(state.mission.index);
        }
        applyUnlocks(state, events);
        state.mission.index = firstUnfinished(state);
        state.mission.done = state.mission.index >= MISSION_COUNT;
      }
      state.mission.started = false;
      state.mission.stepIndex = 0;
      state.mission.checkpoint = 0;
      state.mission.fails = 0;
      state.mission.failMission = -1;
      state.mission.replay = false;
      if (state.mission.done) {
        state.mission.briefPending = false;
        // A replay that restores the finished story pays nothing twice.
        if (!wasReplay) events.push({ type: 'story-done', reward: mission.reward });
      } else {
        state.mission.briefPending = true;
        events.push({ type: 'mission-done', reward: mission.reward, title: mission.title, medal });
      }
    }
  }
}

// --- Street race: drive through the purple start marker in a car to start;
// hit all four checkpoints before the clock runs out. ---

export function createRaceState() {
  return { active: false, index: 0, timerLeft: 0, cooldown: 0 };
}

export function updateRace(state, dt, events) {
  const race = state.race;
  if (!race) return;
  if (race.cooldown > 0) race.cooldown -= dt;
  if (!race.active) {
    if (
      !state.mission.started && !crewBusy(state) && race.cooldown <= 0 && !state.player.onFoot
      && Math.hypot(state.player.x - RACE.start.x, state.player.y - RACE.start.y) < 70
    ) {
      race.active = true;
      race.index = 0;
      race.timerLeft = RACE.time;
      events.push({ type: 'toast', text: `Street race! 4 checkpoints — beat the clock for $${RACE.reward}.` });
    }
    return;
  }
  race.timerLeft -= dt;
  if (race.timerLeft <= 0) {
    race.active = false;
    race.cooldown = 20;
    events.push({ type: 'toast', text: 'Race over — out of time.' });
    return;
  }
  const target = RACE.checkpoints[race.index];
  if (Math.hypot(state.player.x - target.x, state.player.y - target.y) < 80) {
    race.index += 1;
    events.push({ type: 'chime' });
    if (race.index >= RACE.checkpoints.length) {
      state.player.money += RACE.reward;
      state.progress.rep += 15;
      state.stats.racesWon += 1;
      race.active = false;
      race.cooldown = 30;
      events.push({ type: 'toast', text: `Race won! +$${RACE.reward} — the streets are talking.` });
    } else {
      events.push({ type: 'toast', text: `Checkpoint ${race.index}/4!` });
    }
  }
}

/** Safehouse healing and garage repairs: standing near an unlocked spot
 * patches Lena (or her car) up for free. */
export function updateUnlocks(state, dt, events) {
  const player = state.player;
  if (state.progress.safehouse && player.onFoot
    && Math.hypot(player.x - state.city.safehouse.x, player.y - state.city.safehouse.y) < 80
    && player.health > 0 && player.health < 100) {
    player.health = Math.min(100, player.health + 25 * dt);
  }
  const car = state.cars.find((c) => c.id === player.carId);
  if (state.progress.garage && car
    && Math.hypot(player.x - state.city.garage.x, player.y - state.city.garage.y) < 90
    && car.health < 100) {
    car.health = Math.min(100, car.health + 30 * dt);
  }
  void events;
}

// --- Taxi fares: walk to a blue stand, pick up a passenger, drive them over. ---

export function createSideJob() {
  return { active: false, phase: 'idle', target: null, passenger: null, fare: 0, timerLeft: 0 };
}

export function updateSideJobs(state, dt, events) {
  const job = state.sideJob;
  if (!job.active) {
    if (state.player.onFoot && !crewBusy(state)) {
      for (const stand of state.city.taxiStands) {
        if (Math.hypot(state.player.x - stand.x, state.player.y - stand.y) < 46) {
          const drop = state.rng.pick(state.city.taxiStands.filter((s) => s !== stand));
          job.active = true;
          job.phase = 'pickup';
          job.target = stand;
          job.dropoff = drop;
          job.fare = 60 + state.rng.int(0, 5) * 20;
          job.timerLeft = 75;
          events.push({ type: 'toast', text: `Fare! Pick up your passenger at the blue marker, then drive them over. $${job.fare}` });
          break;
        }
      }
    }
    return;
  }
  job.timerLeft -= dt;
  if (job.timerLeft <= 0) {
    state.sideJob = createSideJob();
    events.push({ type: 'toast', text: 'The fare gave up and walked away.' });
    return;
  }
  if (job.phase === 'pickup') {
    if (!state.player.onFoot && Math.hypot(state.player.x - job.target.x, state.player.y - job.target.y) < 70) {
      job.phase = 'dropoff';
      job.target = job.dropoff;
      events.push({ type: 'toast', text: 'Passenger aboard — drive to the blue marker!' });
    }
  } else if (Math.hypot(state.player.x - job.target.x, state.player.y - job.target.y) < 70) {
    state.player.money += job.fare;
    state.progress.rep += 2;
    state.stats.taxisDone += 1;
    events.push({ type: 'toast', text: `Fare complete! +$${job.fare}` });
    events.push({ type: 'chime' });
    state.sideJob = createSideJob();
  }
}

// --- Random events: free-roam surprises. One kind for now — a thief
// snatches a purse and runs. Catch them (knock them down) within a minute
// for $150 and 5 REP; let them go and the moment is gone. ---

export function createRandomEventState() {
  return { active: false, type: null, ped: null, timerLeft: 0, cooldown: 45 };
}

export function updateRandomEvent(state, dt, events) {
  const ev = state.randomEvent;
  if (!ev) return;
  if (ev.active) {
    ev.timerLeft -= dt;
    if (ev.ped && ev.ped.down > 0) {
      state.player.money += 150;
      state.progress.rep += 5;
      state.stats.eventsSolved += 1;
      events.push({ type: 'toast', text: 'Thief caught! The purse is back — +$150, +5 REP.' });
      events.push({ type: 'chime' });
      ev.active = false;
      ev.ped = null;
      ev.cooldown = 120;
      return;
    }
    if (ev.timerLeft <= 0) {
      if (ev.ped) state.peds = state.peds.filter((p) => p !== ev.ped);
      events.push({ type: 'toast', text: 'The thief got away.' });
      ev.active = false;
      ev.ped = null;
      ev.cooldown = 90;
    }
    return;
  }
  ev.cooldown -= dt;
  if (ev.cooldown > 0) return;
  if (state.mission.started || crewBusy(state) || state.wanted.level > 0 || (state.race && state.race.active)) return;
  // Spawn a thief on a nearby road, running from Lena.
  const player = state.player;
  const angle = state.rng.range(0, Math.PI * 2);
  const x = Math.max(60, Math.min(3140, player.x + Math.cos(angle) * 250));
  const y = Math.max(60, Math.min(2020, player.y + Math.sin(angle) * 250));
  const thief = {
    kind: 'ped',
    block: null,
    t: 0,
    dir: 1,
    speed: 185,
    x,
    y,
    angle,
    shirt: '#111111',
    skin: '#c68642',
    panic: 0,
    down: 0,
    phase: 0,
    fare: false,
    flee: true,
  };
  state.peds.push(thief);
  ev.active = true;
  ev.type = 'thief';
  ev.ped = thief;
  ev.timerLeft = 60;
  events.push({ type: 'toast', text: 'A thief snatched a purse! Catch them before they get away!' });
}

// --- Crew jobs: Dario's board, four one-time jobs, one per crew member's
// voice and way of working. They unlock with the safehouse (three story
// jobs done) and start at their gold markers — walk or drive into one as
// the right character. Each has its own fail rule, so they play nothing
// alike: the tail is lost or made, the stealth job is blown by a patrol's
// eyes, the boat run is a clock, the sabotage stacks its own heat.
// Busted or wasted blows an active crew job (see crewJobArrested).
// The nine story jobs above are untouched: same list, same pay.
export const CREW_JOBS = [
  {
    title: 'Shadow Run',
    crew: 'lena',
    reward: 400,
    type: 'tail',
    clock: 16 * 60 + 40,
    brief: "Tail the purple sedan for 45s — closer than 45 and you're made, further than 220 for 5s and he's gone.",
    start: { x: 2720, y: 1120 },
    waypoints: [{ x: 2720, y: 1120 }, { x: 2720, y: 480 }, { x: 2080, y: 480 }, { x: 2080, y: 1120 }],
    spawn: { x: 2720, y: 960 },
    spawnWp: 1,
    speed: 190,
    time: 45,
  },
  {
    title: 'Quiet Hands',
    crew: 'ivy',
    reward: 450,
    type: 'stealth',
    clock: 19 * 60 + 30,
    brief: 'The crate at the marina is Dario\'s, and a patrol car is circling it. Reach the crate on foot — if that patrol sees you, the job is blown.',
    start: { x: 2400, y: 1760 },
    target: { x: 2960, y: 1760 },
    patrol: {
      spawn: { x: 2720, y: 2080 },
      waypoints: [{ x: 2720, y: 2080 }, { x: 3040, y: 2080 }, { x: 3040, y: 1760 }, { x: 2720, y: 1760 }],
      speed: 150,
    },
  },
  {
    title: 'Harbor Sprint',
    crew: 'marco',
    reward: 500,
    type: 'boat',
    clock: 18 * 60 + 30,
    brief: 'Take a skiff from the marina and run the package to the lighthouse pier — 75 seconds, and the water is the only road.',
    start: { x: 2960, y: 2080 },
    target: { x: 220, y: 2320 },
    time: 75,
  },
  {
    title: 'Cut the Lights',
    crew: 'marco',
    reward: 550,
    type: 'sabotage',
    clock: 22 * 60,
    brief: 'Three junction boxes, three alarms. Cut them all — each one wakes the precinct a little more. Three stars and the job is blown. Start clean.',
    start: { x: 2080, y: 1120 },
    boxes: [{ x: 1120, y: 480 }, { x: 2400, y: 800 }, { x: 1440, y: 1440 }],
  },
];

/** A fresh crew-job slot: nothing running, nothing done, no target car. */
export function createCrewJobState() {
  return {
    active: false,
    index: -1,
    step: 0,
    timerLeft: 0,
    done: [],
    target: null,
    lostTimer: 0,
    holdTimer: 0,
    boxesDone: 0,
    lastWarn: -1e9,
  };
}

/** Job indexes open to start right now: unlocked, unfinished, none running. */
export function crewJobsAvailable(state) {
  if (!state.progress.safehouse) return [];
  return CREW_JOBS.map((_, i) => i).filter((i) => !state.crewJob.done.includes(i));
}

/** Start points of the jobs that can be started now — the gold markers
 * the renderers and the minimap draw. Empty while one is running. */
export function crewJobStartPoints(state) {
  if (!state.crewJob || state.crewJob.active) return [];
  return crewJobsAvailable(state).map((i) => CREW_JOBS[i].start);
}

/** Drive a car along axis-aligned waypoints (all on roads), so a tail or
 * patrol car never cuts a corner through a building. It moves along the
 * longer axis only, snapping to the waypoint when it arrives. */
function driveWaypoints(car, waypoints, speed, dt) {
  const wp = waypoints[car.wpIndex % waypoints.length];
  const dx = wp.x - car.x;
  const dy = wp.y - car.y;
  if (Math.hypot(dx, dy) < 30) {
    car.wpIndex = (car.wpIndex + 1) % waypoints.length;
    return;
  }
  const alongX = Math.abs(dx) >= Math.abs(dy);
  if (alongX) {
    car.x += Math.sign(dx) * Math.min(speed * dt, Math.abs(dx));
    car.angle = dx > 0 ? 0 : Math.PI;
  } else {
    car.y += Math.sign(dy) * Math.min(speed * dt, Math.abs(dy));
    car.angle = dy > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  car.speed = speed;
  car.vx = Math.cos(car.angle) * speed;
  car.vy = Math.sin(car.angle) * speed;
}

export function startCrewJob(state, index, events) {
  const job = CREW_JOBS[index];
  const cj = state.crewJob;
  if (!job || !cj || cj.active) return false;
  if (!state.progress.safehouse || cj.done.includes(index)) return false;
  if (state.mission.started || (state.race && state.race.active) || (state.minigame && state.minigame.active)) return false;
  // Reset the slot, then set the clock the job's brief calls for.
  cj.active = true;
  cj.index = index;
  cj.step = 0;
  cj.timerLeft = job.time || 0;
  cj.lostTimer = 0;
  cj.holdTimer = 0;
  cj.boxesDone = 0;
  cj.target = null;
  if (typeof job.clock === 'number') state.clockMinutes = job.clock;
  // The tail and the stealth job each bring their own car: a purple
  // sedan to follow, a patrol car circling the marina.
  const spawnJobCar = (type, x, y, angle, tag, wpIndex, speed) => {
    const car = createCar(type, x, y, angle, tag);
    car.wpIndex = wpIndex;
    car.speed = speed;
    car.cruise = speed;
    state.cars.push(car);
    cj.target = car;
    return car;
  };
  if (job.type === 'tail') {
    const car = spawnJobCar('sedan', job.spawn.x, job.spawn.y, -Math.PI / 2, 'tail', job.spawnWp, job.speed);
    car.color = '#7b2cbf';
  }
  if (job.type === 'stealth') {
    spawnJobCar('police', job.patrol.spawn.x, job.patrol.spawn.y, 0, 'patrol', 1, job.patrol.speed);
  }
  events.push({ type: 'toast', text: `Crew job — ${job.title} (${characterById(job.crew).name}): ${job.brief}` });
  return true;
}

/** Close a crew job out. A win pays the reward and +15 REP and marks the
 * job done; a fail just toasts why. Either way the target car is pulled
 * and the slot is reset. */
function endCrewJob(state, index, events, ok, reason) {
  const cj = state.crewJob;
  const job = CREW_JOBS[index];
  if (cj.target) {
    state.cars = state.cars.filter((c) => c !== cj.target);
    cj.target = null;
  }
  cj.active = false;
  cj.index = -1;
  cj.step = 0;
  cj.timerLeft = 0;
  cj.lostTimer = 0;
  cj.holdTimer = 0;
  cj.boxesDone = 0;
  if (ok && job) {
    state.player.money += job.reward;
    state.progress.rep += 15;
    state.stats.crewDone = (state.stats.crewDone || 0) + 1;
    if (!cj.done.includes(index)) cj.done.push(index);
    events.push({ type: 'toast', text: `Crew job done — ${job.title}! +$${job.reward}, +15 REP.` });
    events.push({ type: 'chime' });
  } else if (job) {
    events.push({ type: 'toast', text: `${job.title} failed — ${reason}` });
  }
}

export function updateCrewJobs(state, dt, events) {
  const cj = state.crewJob;
  if (!cj) return;
  if (!cj.active) {
    // Start a crew job by walking or driving into its gold marker —
    // only as the right character, and never mid-job, mid-race or
    // mid-minigame. The wrong character gets a nudge, throttled.
    if (state.mission.started || (state.race && state.race.active) || (state.minigame && state.minigame.active)) return;
    for (const i of crewJobsAvailable(state)) {
      const job = CREW_JOBS[i];
      if (Math.hypot(state.player.x - job.start.x, state.player.y - job.start.y) > 55) continue;
      if (state.character !== job.crew) {
        if (state.time - cj.lastWarn > 5) {
          cj.lastWarn = state.time;
          events.push({ type: 'toast', text: `That's ${characterById(job.crew).name}'s job — switch to ${characterById(job.crew).name.split(' ')[0]} at the safehouse.` });
        }
        continue;
      }
      startCrewJob(state, i, events);
      return;
    }
    return;
  }
  const job = CREW_JOBS[cj.index];
  if (!job) { cj.active = false; return; }
  if (job.type === 'tail') stepTail(state, cj, job, dt, events);
  else if (job.type === 'stealth') stepStealth(state, cj, job, dt, events);
  else if (job.type === 'boat') stepBoat(state, cj, job, dt, events);
  else if (job.type === 'sabotage') stepSabotage(state, cj, job, dt, events);
}

/** Shadow Run: follow the sedan for 45s. Closer than 45 and you're made;
 * further than 220 for 5s and the trail is lost. */
function stepTail(state, cj, job, dt, events) {
  const target = cj.target;
  if (!target) { endCrewJob(state, cj.index, events, false, 'the courier vanished'); return; }
  driveWaypoints(target, job.waypoints, job.speed, dt);
  const d = Math.hypot(state.player.x - target.x, state.player.y - target.y);
  if (d < 45) { endCrewJob(state, cj.index, events, false, "spotted — you got too close"); return; }
  if (d > 220) {
    cj.lostTimer += dt;
    if (cj.lostTimer > 5) { endCrewJob(state, cj.index, events, false, 'lost the tail'); return; }
  } else {
    cj.lostTimer = 0;
  }
  cj.timerLeft -= dt;
  if (cj.timerLeft <= 0) endCrewJob(state, cj.index, events, true);
}

/** Quiet Hands: reach the marina crate on foot. If the patrol car gets
 * within 300 with a line of sight, the job is blown. */
function stepStealth(state, cj, job, dt, events) {
  const patrol = cj.target;
  if (patrol) driveWaypoints(patrol, job.patrol.waypoints, job.patrol.speed, dt);
  const player = state.player;
  const seen = patrol && Math.hypot(player.x - patrol.x, player.y - patrol.y) < 300
    && hasLineOfSight(state.city, patrol.x, patrol.y, player.x, player.y);
  if (seen) {
    endCrewJob(state, cj.index, events, false, 'the patrol saw you');
    return;
  }
  if (player.onFoot && Math.hypot(player.x - job.target.x, player.y - job.target.y) < 60) {
    endCrewJob(state, cj.index, events, true);
  }
}

/** Harbor Sprint: board a skiff, then run it to the lighthouse pier
 * before the 75s clock runs out. Arrival only counts in the boat. */
function stepBoat(state, cj, job, dt, events) {
  cj.timerLeft -= dt;
  if (cj.timerLeft <= 0) { endCrewJob(state, cj.index, events, false, 'out of time — the tide turned'); return; }
  const car = playerCar(state);
  if (cj.step === 0) {
    if (car && car.kind === 'boat') { cj.step = 1; events.push({ type: 'step-done' }); }
    return;
  }
  if (car && car.kind === 'boat' && Math.hypot(state.player.x - job.target.x, state.player.y - job.target.y) < 90) {
    endCrewJob(state, cj.index, events, true);
  }
}

/** Cut the Lights: hold 2s at each of three junction boxes. Each cut
 * wakes the precinct (+1 wanted); three stars at any point blows it.
 * The last cut still finishes the job — the heat just comes home. */
function stepSabotage(state, cj, job, dt, events) {
  if (state.wanted.level >= 3) { endCrewJob(state, cj.index, events, false, 'too hot — the precinct swarmed you'); return; }
  const box = job.boxes[cj.boxesDone];
  if (!box) { endCrewJob(state, cj.index, events, true); return; }
  const player = state.player;
  const atBox = player.onFoot && Math.hypot(player.x - box.x, player.y - box.y) < 50;
  if (!atBox) {
    cj.holdTimer = 0;
    return;
  }
  cj.holdTimer += dt;
  if (cj.holdTimer < 2) return;
  cj.holdTimer = 0;
  cj.boxesDone += 1;
  events.push({ type: 'step-done' });
  if (cj.boxesDone >= job.boxes.length) {
    // The last cut finishes the job — and the alarm still goes off
    // behind you, so the heat is on as you celebrate.
    addWanted(state, 1, events);
    events.push({ type: 'toast', text: 'Lights cut — the precinct is coming!' });
    endCrewJob(state, cj.index, events, true);
    return;
  }
  addWanted(state, 1, events);
  events.push({ type: 'toast', text: `Junction box ${cj.boxesDone}/3 cut — the PD is coming!` });
  if (state.wanted.level >= 3) {
    endCrewJob(state, cj.index, events, false, 'too hot — the precinct swarmed you');
  }
}

/** Busted or wasted blows an active crew job: the target car is pulled
 * and the job is gone — no pay, no retry from a checkpoint. */
export function crewJobArrested(state) {
  const cj = state.crewJob;
  if (!cj || !cj.active) return;
  if (cj.target) {
    state.cars = state.cars.filter((c) => c !== cj.target);
    cj.target = null;
  }
  cj.active = false;
  cj.index = -1;
  cj.step = 0;
  cj.timerLeft = 0;
  cj.lostTimer = 0;
  cj.holdTimer = 0;
  cj.boxesDone = 0;
}
