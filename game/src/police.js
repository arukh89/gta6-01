// The wanted system and the Solmaris PD response: stars rise with crimes,
// fall when the player stays unseen, and clear at the Spray Barn. Police
// cruisers spawn at the edge of view and chase; officers appear on foot at
// higher heat. Standing still beside the police while wanted gets Lena busted.
import { WANTED, WORLD } from './config.js';
import { createCar, playerCar } from './player.js';
import { createOfficer, createSwatOfficer, panicNearby } from './pedestrians.js';
import { dryPoint, hasLineOfSight, resolveBuildingCollision } from './world.js';

export function createWanted() {
  // `heat` is the sixth star: a separate flag over the 0-5 level, so the
  // level cap the rest of the game relies on never moves.
  return { level: 0, heat: false, hiddenTimer: 0, bustedTimer: 0, seen: false, lastCarId: null, lastSeen: { x: 0, y: 0 } };
}

/** A crime only raises the heat when someone sees it: a cop or an
 * officer within 520u with a clear line of sight, or a pedestrian within
 * 280u who calls it in. Firing into an empty street is free. */
export function crimeWanted(state, amount, events, opts) {
  const player = state.player;
  const policeRadius = opts?.policeRadius ?? WANTED.witnessPoliceRadius;
  const pedRadius = opts?.pedRadius ?? WANTED.witnessPedRadius;
  let seenByCop = false;
  for (const car of policeCars(state)) {
    if (Math.hypot(car.x - player.x, car.y - player.y) < policeRadius
      && hasLineOfSight(state.city, car.x, car.y, player.x, player.y)) {
      seenByCop = true;
      break;
    }
  }
  if (!seenByCop) {
    for (const ped of state.peds) {
      if (ped.kind === 'cop' && Math.hypot(ped.x - player.x, ped.y - player.y) < policeRadius
        && hasLineOfSight(state.city, ped.x, ped.y, player.x, player.y)) {
        seenByCop = true;
        break;
      }
    }
  }
  let seenByPed = false;
  if (!seenByCop) {
    for (const ped of state.peds) {
      if (ped.kind !== 'ped' || ped.down > 0) continue;
      if (Math.hypot(ped.x - player.x, ped.y - player.y) < pedRadius
        && hasLineOfSight(state.city, ped.x, ped.y, player.x, player.y)) {
        seenByPed = true;
        break;
      }
    }
  }
  if (!seenByCop && !seenByPed) return false;
  if (seenByPed) events.push({ type: 'toast', text: 'A witness called the police!' });
  addWanted(state, amount, events);
  return true;
}

export function addWanted(state, amount, events) {
  const before = state.wanted.level;
  state.wanted.level = Math.min(WANTED.max, state.wanted.level + amount);
  state.wanted.hiddenTimer = 0;
  // At five stars, one more witnessed crime pushes the whole PD into
  // HEAT: a sixth star, more cruisers, faster SWAT, slower cooldown.
  if (before === WANTED.max && amount > 0 && !state.wanted.heat) {
    state.wanted.heat = true;
    events.push({ type: 'toast', text: 'HEAT! The whole Solmaris PD is coming for you.' });
    panicNearby(state, state.player.x, state.player.y, 320);
  }
  if (state.wanted.level > before) {
    events.push({ type: 'wanted-up', level: state.wanted.level });
    panicNearby(state, state.player.x, state.player.y, 320);
  }
}

export function policeCars(state) {
  return state.cars.filter((car) => car.driver === 'police');
}

function spawnPoliceCar(state) {
  const player = state.player;
  const angle = state.rng.range(0, Math.PI * 2);
  const dist = 720;
  const x = Math.max(60, Math.min(3140, player.x + Math.cos(angle) * dist));
  const y = Math.max(60, Math.min(2020, player.y + Math.sin(angle) * dist));
  const car = createCar('police', x, y, Math.atan2(player.y - y, player.x - x), 'police');
  car.axis = 'chase';
  state.cars.push(car);
  return car;
}

function spawnOfficer(state) {
  const player = state.player;
  const angle = state.rng.range(0, Math.PI * 2);
  // Officers stay on dry land: never spawn in the water (bay or river).
  const [ox, oy] = dryPoint(state.city, player.x + Math.cos(angle) * 420, player.y + Math.sin(angle) * 420);
  const officer = createOfficer(ox, oy);
  state.peds.push(officer);
}

/** SWAT: at four stars the PD sends tougher officers — they recover
 * from a knockdown in a second and hit harder. They hunt on foot, so a
 * moving car outruns them, but the moment Lena stops they are on her. */
function spawnSwat(state) {
  const player = state.player;
  const angle = state.rng.range(0, Math.PI * 2);
  const [ox, oy] = dryPoint(state.city, player.x + Math.cos(angle) * 420, player.y + Math.sin(angle) * 420);
  const officer = createSwatOfficer(ox, oy);
  state.peds.push(officer);
  return officer;
}

/** The police helicopter: appears at three stars, hovers ahead of the
 * player so the chase camera sees it, and climbs away once the heat is gone.
 * It swoops in at its hover point, high, then settles to patrol altitude. */
export function spawnHelicopter(state) {
  const player = state.player;
  const fx = Math.cos(player.angle);
  const fy = Math.sin(player.angle);
  state.heli = {
    x: player.x + fx * 150 - fy * 70,
    y: player.y + fy * 150 + fx * 70,
    z: 300,
    angle: player.angle,
    rotor: 0,
    mode: 'chase',
    // The helicopter can be shot down: 100 health, then it falls.
    health: 100,
  };
}

function updateHelicopter(state, dt, events) {
  const heli = state.heli;
  if (!heli) {
    // A downed helicopter stays down for a while before the PD sends a new one — sooner in HEAT.
    const delay = state.wanted.heat ? WANTED.heatHeliDelay : WANTED.heliRespawnDelay;
    if (state.wanted.level >= 3 && state.time - (state.lastHeliDown || -99) > delay) {
      spawnHelicopter(state);
      events.push({ type: 'toast', text: 'Police helicopter overhead!' });
    }
    return;
  }
  const player = state.player;
  if (heli.mode === 'crashing') {
    // Shot down: spin, fall and burn until it hits the ground.
    heli.z -= 260 * dt;
    heli.rotor += dt * 60;
    heli.angle += dt * 2.2;
    if (state.rng.chance(0.4)) {
      state.particles.push({
        x: heli.x, y: heli.y,
        vx: state.rng.range(-20, 20), vy: -state.rng.range(30, 60),
        life: 0.8, maxLife: 0.8, size: state.rng.range(6, 12),
        color: state.rng.chance(0.5) ? '#ff7b00' : 'rgba(90, 90, 90, 0.5)',
      });
    }
    if (heli.z <= 0) {
      state.heli = null;
      state.lastHeliDown = state.time;
      state.particles.push({
        x: heli.x, y: heli.y,
        vx: 0, vy: 0, life: 1.2, maxLife: 1.2, size: 26, color: '#ff7b00',
      });
      events.push({ type: 'explosion', x: heli.x, y: heli.y });
      events.push({ type: 'toast', text: 'Police helicopter down!' });
      // Taking down a police helicopter is a big crime: +1 star.
      addWanted(state, 1, events);
    }
    return;
  }
  if (state.wanted.level === 0) heli.mode = 'leaving';
  if (heli.mode === 'leaving') {
    const away = Math.atan2(heli.y - player.y, heli.x - player.x);
    heli.x += Math.cos(away) * 420 * dt;
    heli.y += Math.sin(away) * 420 * dt;
    heli.z += (320 - heli.z) * dt;
    if (Math.hypot(heli.x - player.x, heli.y - player.y) > 1300) state.heli = null;
  } else {
    const fx = Math.cos(player.angle);
    const fy = Math.sin(player.angle);
    const tx = player.x + fx * 150 - fy * 70;
    const ty = player.y + fy * 150 + fx * 70;
    const dx = tx - heli.x;
    const dy = ty - heli.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const sp = Math.min(340, 120 + d * 0.5);
      heli.x += (dx / d) * sp * dt;
      heli.y += (dy / d) * sp * dt;
      heli.angle = Math.atan2(dy, dx);
    }
    heli.z += (190 - heli.z) * dt * 1.5;
  }
  heli.rotor += dt * 42;
}

/** At four stars and up the PD blocks the road ahead of the player with two
 * cruisers parked across it. They hold position until the heat drops. */
function spawnRoadblock(state) {
  const player = state.player;
  const eastWest = Math.abs(Math.cos(player.angle)) > Math.abs(Math.sin(player.angle));
  const cars = [];
  if (eastWest) {
    const ry = state.city.ys.reduce((a, b) => (Math.abs(b - player.y) < Math.abs(a - player.y) ? b : a), state.city.ys[0]);
    const dir = Math.cos(player.angle) >= 0 ? 1 : -1;
    const x = Math.max(90, Math.min(3110, player.x + dir * 340));
    cars.push([x, ry - 26], [x, ry + 26]);
    for (const [cx, cy] of cars) {
      const car = createCar('police', cx, cy, Math.PI / 2, 'police');
      car.blocking = true;
      car.axis = 'block';
      state.cars.push(car);
    }
  } else {
    const rx = state.city.xs.reduce((a, b) => (Math.abs(b - player.x) < Math.abs(a - player.x) ? b : a), state.city.xs[0]);
    const dir = Math.sin(player.angle) >= 0 ? 1 : -1;
    const y = Math.max(90, Math.min(2310, player.y + dir * 340));
    cars.push([rx - 26, y], [rx + 26, y]);
    for (const [cx, cy] of cars) {
      const car = createCar('police', cx, cy, 0, 'police');
      car.blocking = true;
      car.axis = 'block';
      state.cars.push(car);
    }
  }
  state.roadblock = true;
  state.lastRoadblock = state.time;
}

function updateRoadblock(state, events) {
  const delay = state.wanted.heat ? WANTED.heatRoadblockDelay : 25;
  if (state.wanted.level >= 4 && !state.roadblock && state.time - (state.lastRoadblock || -99) > delay) {
    spawnRoadblock(state);
    events.push({ type: 'toast', text: 'Roadblock ahead!' });
  } else if (state.wanted.level < 4 && state.roadblock) {
    for (const car of policeCars(state)) {
      if (car.blocking) {
        car.blocking = false;
        car.axis = 'chase';
      }
    }
    state.roadblock = false;
  }
}

function desiredPolice(level, heat) {
  if (level <= 0) return 0;
  if (heat) return 6;
  if (level === 1) return 1;
  if (level === 2) return 2;
  if (level === 3) return 3;
  return 4;
}

/** Chase steering: aim at the player, ram gently, avoid buildings by sliding. */
function chaseCar(state, car, dt, events) {
  if (car.blocking) return;
  const player = state.player;
  const target = playerCar(state) || null;
  const tx = target ? target.x + target.vx * 0.35 : player.x;
  const ty = target ? target.y + target.vy * 0.35 : player.y;
  const want = Math.atan2(ty - car.y, tx - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
  const dist = Math.hypot(tx - car.x, ty - car.y);
  // A wrecked cruiser's engine is dead: it rolls to a stop and stops chasing.
  const cruise = car.health <= 0 ? 0 : (dist > 320 ? 470 : 380);
  car.speed += (cruise - car.speed) * Math.min(1, 2 * dt);
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
  const [nx, ny0] = resolveBuildingCollision(state.city, car.x + car.vx * dt, car.y + car.vy * dt, 22);
  // Cruisers stay on dry land: the shoreline is a wall to them, so a
  // boat (or a swimmer) out on the bay is out of their reach.
  let ny = ny0;
  let blocked = Math.hypot(nx - car.x, ny - car.y) < Math.hypot(car.vx, car.vy) * dt * 0.4;
  if (ny > WORLD.waterY - 24) {
    ny = WORLD.waterY - 24;
    blocked = true;
  }
  car.x = nx;
  car.y = ny;
  if (blocked) {
    car.angle += 0.9 * dt * 10 * (state.rng.chance(0.5) ? 1 : -1);
    car.speed *= 0.7;
  }
  if (dist < 46 && target && car.health > 0) {
    target.health = Math.max(0, target.health - 12 * dt);
    target.vx += Math.cos(car.angle) * 60 * dt;
    target.vy += Math.sin(car.angle) * 60 * dt;
    events.push({ type: 'rammed' });
  }
  if (dist < 40 && player.onFoot) {
    events.push({ type: 'cop-touch' });
  }
}

export function updatePolice(state, dt, events) {
  const wanted = state.wanted;
  const player = state.player;

  if (wanted.level > 0) {
    const cops = policeCars(state);
    const want = desiredPolice(wanted.level, wanted.heat);
    if (cops.length < want && state.time - (state.lastPoliceSpawn || -99) > 2.5) {
      spawnPoliceCar(state);
      state.lastPoliceSpawn = state.time;
    }
    const officers = state.peds.filter((p) => p.kind === 'cop' && !p.swat);
    if (wanted.level >= 2 && officers.length < 2 && player.onFoot && state.time - (state.lastOfficerSpawn || -99) > 6) {
      spawnOfficer(state);
      state.lastOfficerSpawn = state.time;
    }
    const swat = state.peds.filter((p) => p.kind === 'cop' && p.swat);
    // HEAT doubles the SWAT on the street and sends them twice as fast.
    const swatMax = wanted.heat ? WANTED.heatSwat : 2;
    const swatDelay = wanted.heat ? WANTED.heatSwatDelay : 8;
    if (wanted.level >= 4 && swat.length < swatMax && state.time - (state.lastSwatSpawn || -99) > swatDelay) {
      spawnSwat(state);
      state.lastSwatSpawn = state.time;
      if (swat.length === 0) events.push({ type: 'toast', text: 'SWAT is on the scene!' });
    }
    for (const car of cops) chaseCar(state, car, dt, events);
    for (let i = 0; i < cops.length; i += 1) {
      for (let j = i + 1; j < cops.length; j += 1) {
        const a = cops[i];
        const b = cops[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0 && d < 58) {
          const push = (58 - d) / 2;
          const nx = (a.x - b.x) / d;
          const ny = (a.y - b.y) / d;
          a.x += nx * push;
          a.y += ny * push;
          b.x -= nx * push;
          b.y -= ny * push;
        }
      }
    }

    let nearestCar = null;
    let nearest = Infinity;
    for (const car of cops) {
      const d = Math.hypot(car.x - player.x, car.y - player.y);
      if (d < nearest) {
        nearest = d;
        nearestCar = car;
      }
    }
    const playerSpeed = player.onFoot ? (player.moving ? 160 : 0) : Math.abs((playerCar(state) || { speed: 0 }).speed);
    // Seen means a ground unit has eyes on Lena: close AND with a clear
    // line of sight. Ducking behind a building breaks the sight line
    // and starts the search phase, even with a cruiser around the corner.
    // The helicopter watches from above but does not count for `seen`:
    // its spotlight marks the spot, the ground units do the seeing.
    let seen = false;
    for (const car of cops) {
      const d = Math.hypot(car.x - player.x, car.y - player.y);
      if (d < WANTED.witnessPoliceRadius
        && hasLineOfSight(state.city, car.x, car.y, player.x, player.y)) {
        seen = true;
        break;
      }
    }
    if (!seen) {
      for (const ped of state.peds) {
        if (ped.kind !== 'cop' || ped.down > 0) continue;
        const d = Math.hypot(ped.x - player.x, ped.y - player.y);
        if (d < WANTED.witnessPoliceRadius && hasLineOfSight(state.city, ped.x, ped.y, player.x, player.y)) {
          seen = true;
          break;
        }
      }
    }
    wanted.seen = seen;
    if (seen) wanted.lastSeen = { x: player.x, y: player.y };
    if (!wanted.seen) {
      wanted.hiddenTimer += dt;
      // One star cools off after the per-level hidden time: 30s at
      // one star, up to 90s at five — twice as long in HEAT.
      const cool = (WANTED.coolSecondsByLevel[wanted.level - 1] || 30) * (wanted.heat ? WANTED.heatDecayMult : 1);
      if (wanted.hiddenTimer > cool) {
        wanted.level -= 1;
        wanted.hiddenTimer = 0;
        // HEAT only lives at five stars: dropping to four ends it.
        if (wanted.level < 5) wanted.heat = false;
        events.push({ type: 'wanted-down', level: wanted.level });
      }
    } else {
      wanted.hiddenTimer = 0;
    }
    const copNear = nearest < 70 || state.peds.some((p) => p.kind === 'cop' && Math.hypot(p.x - player.x, p.y - player.y) < 60);
    if (copNear && playerSpeed < 30) {
      wanted.bustedTimer += dt;
      if (wanted.bustedTimer > 2.6) {
        events.push({ type: 'busted' });
        wanted.bustedTimer = 0;
      }
    } else {
      wanted.bustedTimer = Math.max(0, wanted.bustedTimer - dt * 2);
    }
  } else {
    for (const car of policeCars(state)) {
      car.speed = Math.max(0, car.speed - 200 * dt);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      if (car.y > WORLD.waterY - 24) car.y = WORLD.waterY - 24;
    }
    state.cars = state.cars.filter((car) => {
      if (car.driver !== 'police') return true;
      return Math.hypot(car.x - player.x, car.y - player.y) < 900 && car.speed > 5;
    });
    state.peds = state.peds.filter((p) => p.kind !== 'cop' || Math.hypot(p.x - player.x, p.y - player.y) < 700);
  }

  const shop = state.city.paintShop;
  // The Spray Barn only works when the police have lost sight of
  // Lena (blinking stars) and she drives in: no respray under their eyes.
  if (wanted.level > 0 && !wanted.seen && !player.onFoot
    && Math.hypot(player.x - shop.x, player.y - shop.y) < WANTED.sprayRadius && player.money >= WANTED.sprayCost) {
    player.money -= WANTED.sprayCost;
    wanted.level = 0;
    wanted.heat = false;
    wanted.hiddenTimer = 0;
    const car = playerCar(state);
    if (car) car.health = 100;
    events.push({ type: 'sprayed' });
  }

  updateHelicopter(state, dt, events);
  updateRoadblock(state, events);
}
