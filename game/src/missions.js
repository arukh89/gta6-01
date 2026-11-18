// Story jobs and side work in Solmaris: six jobs for Dario, from a first
// errand to the Heatwave finale, plus repeatable taxi fares. Each job is a
// list of steps (go somewhere, drive a car, lose the heat, pick something
// up); finishing a job pays out, saves the game, and briefs the next one.
import { addWanted } from './police.js';

export const MISSION_COUNT = 6;

function gotoStep(label, point, radius) {
  return { kind: 'goto', label, point, radius: radius || 64 };
}

export function missionList(city) {
  return [
    {
      title: 'First Errand',
      brief: 'Dario needs a package moved across town, no questions. Pick it up at his garage, then walk it into the safehouse on foot. Keep it quiet.',
      reward: 200,
      steps: [
        gotoStep('Pick up the package at Dario\'s Garage', city.garage, 70),
        gotoStep('Deliver the package to the Safehouse', city.safehouse, 70),
      ],
    },
    {
      title: 'Hot Wheels',
      brief: 'A red Vela GT is parked near the garage and Dario has a buyer. Take it — any red sports car will do — and bring it to the garage. Expect attention.',
      reward: 350,
      steps: [
        { kind: 'steal-sports', label: 'Steal a red Vela GT sports car' },
        gotoStep('Deliver the Vela GT to Dario\'s Garage', city.garage, 80),
      ],
    },
    {
      title: 'Beach Run',
      brief: 'Three drops along the beach road, ninety seconds on the clock. Grab a car, hit every checkpoint, and do not stop to admire the sunset.',
      reward: 400,
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
      steps: [
        gotoStep('Go to the Marina Deal', city.marina, 70),
        { kind: 'collect', label: 'Pick up the briefcase', point: city.marina, radius: 60 },
        gotoStep('Bring the briefcase to the Safehouse', city.safehouse, 70),
      ],
    },
    {
      title: 'Heatwave Finale',
      brief: 'One last run: gather the crew at the garage, swing by the marina, shake four stars, and finish at the lighthouse. After this, Solmaris is yours.',
      reward: 800,
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
  };
}

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
  state.mission.started = true;
  state.mission.briefPending = false;
  state.mission.stepIndex = 0;
  state.mission.timerLeft = mission.timer || 0;
  state.mission.failed = false;
  if (mission.onStart) mission.onStart(state, events);
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
    events.push({ type: 'step-done' });
    if (state.mission.stepIndex >= mission.steps.length) {
      state.player.money += mission.reward;
      state.stats.missionsDone += 1;
      state.mission.index += 1;
      state.mission.started = false;
      state.mission.stepIndex = 0;
      if (state.mission.index >= MISSION_COUNT) {
        state.mission.done = true;
        events.push({ type: 'story-done', reward: mission.reward });
      } else {
        state.mission.briefPending = true;
        events.push({ type: 'mission-done', reward: mission.reward, title: mission.title });
      }
    }
  }
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
    state.stats.taxisDone += 1;
    events.push({ type: 'toast', text: `Fare complete! +$${job.fare}` });
    events.push({ type: 'chime' });
    state.sideJob = createSideJob();
  }
}
