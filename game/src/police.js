// The wanted system and the Solmaris PD response: stars rise with crimes,
// fall when the player stays unseen, and clear at the Spray Barn. Police
// cruisers spawn at the edge of view and chase; officers appear on foot at
// higher heat. Standing still beside the police while wanted gets Lena busted.
import { WANTED } from './config.js';
import { createCar, playerCar } from './player.js';
import { createOfficer, panicNearby } from './pedestrians.js';
import { resolveBuildingCollision } from './world.js';

export function createWanted() {
  return { level: 0, heat: 0, hiddenTimer: 0, bustedTimer: 0, seen: false };
}

export function addWanted(state, amount, events) {
  const before = state.wanted.level;
  state.wanted.level = Math.min(WANTED.max, state.wanted.level + amount);
  state.wanted.hiddenTimer = 0;
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
  const officer = createOfficer(player.x + Math.cos(angle) * 420, player.y + Math.sin(angle) * 420);
  state.peds.push(officer);
}

function desiredPolice(level) {
  if (level <= 0) return 0;
  if (level === 1) return 1;
  if (level === 2) return 2;
  if (level === 3) return 3;
  return 4;
}

/** Chase steering: aim at the player, ram gently, avoid buildings by sliding. */
function chaseCar(state, car, dt, events) {
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
  const cruise = dist > 320 ? 470 : 380;
  car.speed += (cruise - car.speed) * Math.min(1, 2 * dt);
  car.vx = Math.cos(car.angle) * car.speed;
  car.vy = Math.sin(car.angle) * car.speed;
  const [nx, ny] = resolveBuildingCollision(state.city, car.x + car.vx * dt, car.y + car.vy * dt, 22);
  const blocked = Math.hypot(nx - car.x, ny - car.y) < Math.hypot(car.vx, car.vy) * dt * 0.4;
  car.x = nx;
  car.y = ny;
  if (blocked) {
    car.angle += 0.9 * dt * 10 * (state.rng.chance(0.5) ? 1 : -1);
    car.speed *= 0.7;
  }
  if (dist < 46 && target) {
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
    const want = desiredPolice(wanted.level);
    if (cops.length < want && state.time - (state.lastPoliceSpawn || -99) > 2.5) {
      spawnPoliceCar(state);
      state.lastPoliceSpawn = state.time;
    }
    const officers = state.peds.filter((p) => p.kind === 'cop');
    if (wanted.level >= 2 && officers.length < 2 && player.onFoot && state.time - (state.lastOfficerSpawn || -99) > 6) {
      spawnOfficer(state);
      state.lastOfficerSpawn = state.time;
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

    const nearest = cops.reduce((best, car) => Math.min(best, Math.hypot(car.x - player.x, car.y - player.y)), Infinity);
    const playerSpeed = player.onFoot ? (player.moving ? 160 : 0) : Math.abs((playerCar(state) || { speed: 0 }).speed);
    wanted.seen = nearest < 520;
    if (!wanted.seen) {
      wanted.hiddenTimer += dt;
      if (wanted.hiddenTimer > WANTED.coolSeconds) {
        wanted.level -= 1;
        wanted.hiddenTimer = 0;
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
    }
    state.cars = state.cars.filter((car) => {
      if (car.driver !== 'police') return true;
      return Math.hypot(car.x - player.x, car.y - player.y) < 900 && car.speed > 5;
    });
    state.peds = state.peds.filter((p) => p.kind !== 'cop' || Math.hypot(p.x - player.x, p.y - player.y) < 700);
  }

  const shop = state.city.paintShop;
  if (wanted.level > 0 && Math.hypot(player.x - shop.x, player.y - shop.y) < WANTED.sprayRadius && player.money >= WANTED.sprayCost) {
    player.money -= WANTED.sprayCost;
    wanted.level = 0;
    wanted.hiddenTimer = 0;
    const car = playerCar(state);
    if (car) car.health = 100;
    events.push({ type: 'sprayed' });
  }
}
