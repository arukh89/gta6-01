// Solmaris traffic: cars that follow the road grid, turn at intersections,
// queue behind the car ahead, and parked cars waiting to be borrowed. Traffic
// never leaves the roads, so the streets always read as streets from above.
import { TRAFFIC, VEHICLES, WORLD } from './config.js';
import { clampBoatToWater, createCar } from './player.js';
import { isOnRoad, randomRoadPoint, resolveBuildingCollision } from './world.js';

/** Body shapes on the road: the pick list stays the ORIGINAL six, so
 * the rng draw — and the taxi/non-taxi pattern that decides whether
 * a paint draw follows — is byte-identical to v8, and every traffic
 * and parked position stays exactly where it was. The new shapes
 * (coupe, hatch, truck) are mapped from the picked type by a position
 * hash, so ZERO rng is consumed: a sports pick becomes a coupe half
 * the time, a sedan becomes a hatch 40% of the time, a pickup becomes
 * a truck 40% of the time. The traffic reads as a fleet instead of
 * clones, and the stream never moves. */
const TRAFFIC_TYPES = ['sedan', 'taxi', 'pickup', 'van', 'sedan', 'sports'];
const PAINTS = ['#e76f51', '#2a9d8f', '#e9c46a', '#6c757d', '#f4a261', '#8ecae6', '#b5838d', '#dee2e6', '#f4d35e', '#90be6d', '#ff8fa3', '#4a4e69'];

/** Deterministic 0..1 hash — a per-car habit from an index alone, so
 * no seeded-rng call is consumed and the stream stays exactly where
 * it was. */
function unitHash(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Map a picked body to its variant: sports → coupe, sedan → hatch,
 * pickup → truck, the rest unchanged. Pure hash, no rng. */
function shapeVariant(type, i) {
  if (type === 'sports' && unitHash(i * 3.3 + 2.1) < 0.5) return 'coupe';
  if (type === 'sedan' && unitHash(i * 2.9 + 1.3) < 0.4) return 'hatch';
  if (type === 'pickup' && unitHash(i * 4.1 + 0.7) < 0.4) return 'truck';
  return type;
}

export function createTraffic(city, rng, count) {
  const cars = [];
  for (let i = 0; i < count; i += 1) {
    const point = randomRoadPoint(city, rng);
    const vertical = city.xs.some((x) => Math.abs(point.x - x) < 4);
    const type = shapeVariant(rng.pick(TRAFFIC_TYPES), i);
    const car = createCar(type, point.x, point.y, vertical ? Math.PI / 2 : 0, 'traffic');
    car.color = type === 'taxi' ? VEHICLES.taxi.color : rng.pick(PAINTS);
    car.axis = vertical ? 'y' : 'x';
    car.dir = rng.chance(0.5) ? 1 : -1;
    // Cruise speed: the plain TRAFFIC band — never varied per car (see
    // config.js: a per-car multiplier shifted trajectories and broke R1a).
    car.speed = rng.range(TRAFFIC.cruiseMin, TRAFFIC.cruiseMax);
    car.cruise = car.speed;
    cars.push(car);
  }
  return cars;
}

export function createParkedCars(city, rng, count) {
  const cars = [];
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < 300) {
    guard += 1;
    const point = randomRoadPoint(city, rng);
    const vertical = city.xs.some((x) => Math.abs(point.x - x) < 4);
    const offset = 22;
    const x = vertical ? point.x + offset : point.x;
    const y = vertical ? point.y : point.y + offset;
    if (!isOnRoad(city, x, y)) continue;
    const type = shapeVariant(rng.pick(TRAFFIC_TYPES), placed);
    const car = createCar(type, x, y, vertical ? Math.PI / 2 : 0, 'none');
    car.color = type === 'taxi' ? VEHICLES.taxi.color : rng.pick(PAINTS);
    cars.push(car);
    placed += 1;
  }
  return cars;
}

function carAhead(state, car) {
  for (const other of state.cars) {
    if (other === car || other.parked) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const along = car.axis === 'x' ? dx * car.dir : dy * car.dir;
    const side = car.axis === 'x' ? Math.abs(dy) : Math.abs(dx);
    if (along > 0 && along < 58 && side < 20) return true;
  }
  return false;
}

function atIntersection(city, car) {
  const nearX = city.xs.some((x) => Math.abs(car.x - x) < 8);
  const nearY = city.ys.some((y) => Math.abs(car.y - y) < 8);
  return nearX && nearY;
}

/** Advance every traffic car one step; the player's and police cars are moved elsewhere. */
export function updateTraffic(state, dt) {
  for (const car of state.cars) {
    // A driverless car that was left rolling coasts on until friction
    // stops it; a wall stops it dead. Parked cars sit at speed zero, so
    // the speed check alone is enough to tell them apart.
    if (car.driver === 'none' && Math.abs(car.speed) > 1 && !car.exploded) {
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      const [nx, ny] = resolveBuildingCollision(state.city, car.x + fx * car.speed * dt, car.y + fy * car.speed * dt, 22);
      const stopped = Math.hypot(nx - car.x, ny - car.y) < Math.abs(car.speed) * dt * 0.5;
      car.x = nx;
      car.y = ny;
      // A coasting boat stops at the shore instead of beaching on land.
      if (car.kind === 'boat' && clampBoatToWater(car)) car.speed = 0;
      car.speed = stopped ? 0 : car.speed * (1 - Math.min(1, 0.7 * dt));
      car.vx = fx * car.speed;
      car.vy = fy * car.speed;
      continue;
    }
    if (car.driver !== 'traffic') continue;
    // Wrecked traffic rolls to a stop on its road and never turns again.
    const target = car.health <= 0 ? 0 : (carAhead(state, car) ? 0 : car.cruise);
    car.speed += (target - car.speed) * Math.min(1, 3 * dt);
    if (car.health > 0 && atIntersection(state.city, car) && state.rng.chance(TRAFFIC.turnChance)) {
      // Turn onto the crossing road: the plain TRAFFIC chance — never
      // varied per car (see config.js: per-car variation broke R1a).
      car.axis = car.axis === 'x' ? 'y' : 'x';
      car.dir = state.rng.chance(0.5) ? 1 : -1;
      if (car.axis === 'x') {
        car.y = state.city.ys.reduce((best, y) => (Math.abs(y - car.y) < Math.abs(best - car.y) ? y : best), state.city.ys[0]);
        car.angle = car.dir > 0 ? 0 : Math.PI;
      } else {
        car.x = state.city.xs.reduce((best, x) => (Math.abs(x - car.x) < Math.abs(best - car.x) ? x : best), state.city.xs[0]);
        car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    if (car.axis === 'x') {
      car.x += car.dir * car.speed * dt;
      car.angle = car.dir > 0 ? 0 : Math.PI;
      if (car.x < 40 || car.x > WORLD.width - 40) car.dir *= -1;
    } else {
      car.y += car.dir * car.speed * dt;
      car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (car.y < 40 || car.y > WORLD.beachY - 60) car.dir *= -1;
    }
    car.vx = car.axis === 'x' ? car.dir * car.speed : 0;
    car.vy = car.axis === 'y' ? car.dir * car.speed : 0;
  }
}
