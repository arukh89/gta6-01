// Story jobs and side work in Solmaris: nine jobs for Dario, from a first
// errand to the Heatwave finale, plus repeatable taxi fares and a street
// race. Each job is a list of steps (go somewhere, drive a car, lose the
// heat, pick something up); finishing a job pays out, earns Respect, saves
// the game, and briefs the next one.
import { addWanted } from './police.js';
import { minigameObjective } from './minigames.js';

export const MISSION_COUNT = 9;

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

export function missionMarker(state) {
  if (state.race && state.race.active) return RACE.checkpoints[state.race.index];
  const mission = currentMission(state);
  if (mission) {
    for (let i = state.mission.stepIndex; i < mission.steps.length; i += 1) {
      if (mission.steps[i].point) return mission.steps[i].point;
    }
  }
  if (state.sideJob && state.sideJob.active) return state.sideJob.target;
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
      !state.mission.started && race.cooldown <= 0 && !state.player.onFoot
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
    if (state.player.onFoot) {
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
  if (state.mission.started || state.wanted.level > 0 || (state.race && state.race.active)) return;
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
