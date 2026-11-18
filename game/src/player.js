// Lena Cruz, on foot and behind the wheel: walking with sprint, aiming at the
// mouse, arcade driving with drift and skids, entering and leaving cars, and
// the damage and knockback that come with both. Cars are plain objects shared
// with traffic and police; whoever drives one just sets its driver field.
import { DRIVE, HEALTH, VEHICLES, WALK } from './config.js';
import { resolveBuildingCollision } from './world.js';

let nextCarId = 1;
const WEAPONS_AMMO_START = 48;

export function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    angle: -Math.PI / 2,
    health: HEALTH.max,
    money: 120,
    onFoot: true,
    carId: null,
    weapon: 'fists',
    ammo: WEAPONS_AMMO_START,
    mag: 12,
    attackCooldown: 0,
    hurtTimer: 0,
    lastHurtAt: -99,
    walkPhase: 0,
    moving: false,
  };
}

export function createCar(type, x, y, angle, driver) {
  const spec = VEHICLES[type];
  return {
    id: nextCarId++,
    kind: type,
    name: spec.name,
    x,
    y,
    angle,
    speed: 0,
    vx: 0,
    vy: 0,
    color: spec.color,
    driver: driver || 'none',
    health: 100,
    parked: driver === 'none',
    stolen: false,
    skidTimer: 0,
  };
}

export function playerCar(state) {
  if (state.player.carId === null) return null;
  return state.cars.find((car) => car.id === state.player.carId) || null;
}

export function nearestCar(state, x, y, maxDist) {
  let best = null;
  let bestDist = maxDist;
  for (const car of state.cars) {
    if (car.driver === 'police') continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = car;
    }
  }
  return best;
}

/** Walk, sprint, aim and collide. Returns nothing; mutates the player. */
export function updatePlayerOnFoot(state, input, dt, toWorld) {
  const player = state.player;
  const steer = input.steer();
  const throttle = input.throttle();
  const speed = input.sprint() ? WALK.sprint : WALK.speed;
  const len = Math.hypot(steer, throttle);
  player.moving = len > 0;
  if (len > 0) {
    const nx = steer / len;
    const ny = -throttle / len;
    const [nx2, ny2] = resolveBuildingCollision(state.city, player.x + nx * speed * dt, player.y + ny * speed * dt, WALK.radius);
    player.x = nx2;
    player.y = ny2;
    player.walkPhase += dt * (input.sprint() ? 14 : 9);
    if (!input.isFiring()) player.angle = Math.atan2(ny, nx);
  }
  const aim = toWorld(input.mouse().x, input.mouse().y);
  if (input.isFiring() || player.weapon === 'pistol') {
    player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
  }
  if (player.attackCooldown > 0) player.attackCooldown -= dt;
  if (player.hurtTimer > 0) player.hurtTimer -= dt;
}

/** Arcade driving: accelerate, steer harder at speed, drift, collide, skid. */
export function updateDriving(state, input, dt, onCrash) {
  const car = playerCar(state);
  if (!car) return;
  const spec = VEHICLES[car.kind];
  const throttle = input.throttle();
  const steer = input.steer();
  if (throttle > 0) car.speed += spec.accel * throttle * dt;
  else if (throttle < 0) {
    car.speed += (car.speed > 5 ? -DRIVE.brake : DRIVE.accel * 0.6) * dt * (car.speed > 5 ? 1 : -throttle);
    if (car.speed < -DRIVE.reverse) car.speed = -DRIVE.reverse;
  } else {
    car.speed -= car.speed * 0.7 * dt;
  }
  if (car.speed > spec.top) car.speed = spec.top;
  const steerPower = DRIVE.turn * Math.min(1, Math.abs(car.speed) / 160) * (car.speed < 0 ? -1 : 1);
  car.angle += steer * steerPower * dt * (input.sprint() ? 1.35 : 1);
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const targetVx = fx * car.speed;
  const targetVy = fy * car.speed;
  const grip = input.sprint() ? DRIVE.grip * 0.45 : DRIVE.grip;
  car.vx += (targetVx - car.vx) * Math.min(1, grip * dt);
  car.vy += (targetVy - car.vy) * Math.min(1, grip * dt);
  const oldX = car.x;
  const oldY = car.y;
  const [nx, ny] = resolveBuildingCollision(state.city, car.x + car.vx * dt, car.y + car.vy * dt, 22);
  car.x = nx;
  car.y = ny;
  const hitWall = Math.hypot(nx - oldX, ny - oldY) < Math.hypot(car.vx, car.vy) * dt * 0.55 && Math.hypot(car.vx, car.vy) > 120;
  if (hitWall) {
    car.speed *= 0.45;
    car.vx *= 0.4;
    car.vy *= 0.4;
    car.health = Math.max(0, car.health - 8);
    if (onCrash) onCrash(car);
  }
  car.skidTimer -= dt;
  const drifting = Math.abs(car.speed) > 200 && Math.abs(steer) > 0.5;
  if (drifting && car.skidTimer <= 0) {
    car.skidTimer = 0.05;
    state.skids.push({ x: car.x - fx * 18, y: car.y - fy * 18, angle: car.angle, life: 5 });
    if (state.skids.length > 220) state.skids.shift();
  }
  state.player.x = car.x;
  state.player.y = car.y;
  state.player.angle = car.angle;
  state.player.moving = Math.abs(car.speed) > 20;
}

/** Step into the nearest car, or step out of the one being driven. */
export function tryEnterOrExitCar(state, events) {
  const player = state.player;
  if (!player.onFoot) {
    const car = playerCar(state);
    if (car) {
      car.driver = 'none';
      car.parked = true;
      car.speed = 0;
      car.vx = 0;
      car.vy = 0;
      player.x = car.x - Math.cos(car.angle + Math.PI / 2) * 34;
      player.y = car.y - Math.sin(car.angle + Math.PI / 2) * 34;
      const [px, py] = resolveBuildingCollision(state.city, player.x, player.y, WALK.radius);
      player.x = px;
      player.y = py;
    }
    player.onFoot = true;
    player.carId = null;
    return 'exit';
  }
  const car = nearestCar(state, player.x, player.y, 52);
  if (!car) return null;
  const wasParked = car.parked;
  const wasTraffic = car.driver === 'traffic';
  car.driver = 'player';
  car.parked = false;
  player.onFoot = false;
  player.carId = car.id;
  player.x = car.x;
  player.y = car.y;
  if (wasParked || wasTraffic) {
    car.stolen = true;
    state.stats.carsStolen += 1;
    events.push({ type: 'stolen', car });
  }
  return 'enter';
}

export function damagePlayer(state, amount, events) {
  const player = state.player;
  if (player.hurtTimer > 0) return;
  player.health = Math.max(0, player.health - amount);
  player.hurtTimer = 0.5;
  player.lastHurtAt = state.time;
  events.push({ type: 'hurt', amount });
}
