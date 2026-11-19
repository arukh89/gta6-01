// Lena Cruz, on foot and behind the wheel: walking with sprint, aiming at the
// mouse, arcade driving with drift and skids, entering and leaving cars, and
// the damage and knockback that come with both. Cars are plain objects shared
// with traffic and police; whoever drives one just sets its driver field.
import { DRIVE, HEALTH, SWIM, VEHICLES, WALK, WORLD, skillLevel } from './config.js';
import { isInWater, resolveBuildingCollision } from './world.js';
import { spawnExplosion, spawnSmoke } from './effects.js';

let nextCarId = 1;

export function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    angle: -Math.PI / 2,
    health: HEALTH.max,
    armour: 0,
    money: 120,
    onFoot: true,
    carId: null,
    weapon: 'fists',
    weapons: ['fists', 'pistol'],
    ammo: { pistol: 48, smg: 0 },
    mag: { pistol: 12, smg: 0 },
    attackCooldown: 0,
    hurtTimer: 0,
    lastHurtAt: -99,
    walkPhase: 0,
    moving: false,
    // What this character wears: Lena's orange by default, the crew's own
    // colours after a switch (the renderers read these, not a hardcode).
    shirt: '#fb8500',
    skin: '#c68642',
    pants: '#1d3557',
    hat: 'cap',
    scale: 1.0,
    build: 1.0,
    // Jump height above the ground (0 = on the ground) and its velocity.
    z: 0,
    vz: 0,
    // Cover: null on the open street, otherwise { x, y, angle } — the
    // spot Lena is pressed against, facing out into the street.
    cover: null,
    snacks: 0,
    // Swimming: true in the water (y past the shoreline). Stamina 0-100
    // drains while swimming; empty, health drains until she reaches shore.
    swimming: false,
    stamina: 100,
  };
}

export function createCar(type, x, y, angle, driver) {
  const spec = VEHICLES[type];
  const id = nextCarId++;
  return {
    id,
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
    nos: 100,
    blocking: false,
    // Damage taken while already wrecked; past 40 the car explodes.
    wreckDamage: 0,
    exploded: false,
    // Police livery: three patrol paint jobs, from the car id alone —
    // no rng, so the stream is untouched and every cruiser reads
    // differently. Boats keep kind 'boat' (missions check it) and
    // vary by variant instead: 'skiff' or 'speedboat'.
    livery: type === 'police' ? id % 3 : 0,
    variant: type === 'boat' ? 'skiff' : null,
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
    if (car.driver === 'police' || car.exploded) continue;
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
  // Moving breaks cover: GTA lets you step out of cover by walking away.
  if (player.cover && (steer !== 0 || throttle !== 0)) player.cover = null;
  // Jump physics: a hop with real height and gravity. While airborne
  // Lena keeps her ground speed; landing is just z reaching zero again.
  if (player.z > 0 || player.vz !== 0) {
    player.vz -= 900 * dt;
    player.z += player.vz * dt;
    if (player.z <= 0) {
      player.z = 0;
      player.vz = 0;
    }
  }
  // Stamina skill: each level adds 4% sprint speed (cap +40%).
  const staminaLv = state.progress ? skillLevel(state.progress.stamina, 'stamina') : 0;
  const baseSpeed = input.sprint() ? WALK.sprint * (1 + 0.04 * staminaLv) : WALK.speed;
  // Swimming: in the bay or the river Lena swims at 60% of walk speed.
  const swimming = isInWater(state.city, player.x, player.y);
  const speed = swimming ? baseSpeed * SWIM.speedMult : baseSpeed;
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
  // Stamina drains in the water and refills on land. With an empty tank
  // health drains slowly until she reaches shore — and the drain counts
  // as a fresh hurt, so regen never out-heals drowning.
  player.swimming = swimming;
  if (player.swimming) {
    player.stamina = Math.max(0, player.stamina - SWIM.drain * dt);
    if (player.stamina <= 0 && player.health > 0) {
      player.health = Math.max(0, player.health - SWIM.healthDrain * dt);
      player.lastHurtAt = state.time;
    }
  } else {
    player.stamina = Math.min(100, player.stamina + SWIM.regen * dt);
  }
  const aim = toWorld(input.mouse().x, input.mouse().y);
  if (input.isFiring() || player.weapon === 'pistol') {
    player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
  }
  if (player.attackCooldown > 0) player.attackCooldown -= dt;
  if (player.hurtTimer > 0) player.hurtTimer -= dt;
}

/** Start a jump (Space on foot): only from the ground, never from cover — and never from the water. */
export function startJump(state) {
  const player = state.player;
  if (!player.onFoot || player.cover || player.swimming || player.z !== 0 || player.vz !== 0) return false;
  player.vz = 330;
  return true;
}

/** Find the nearest cover spot: a building edge or a car side within 45u.
 * Returns { x, y, angle } (pressed against the wall, facing the street)
 * or null when there is nothing to hide behind. */
export function findCover(state, x, y) {
  let best = null;
  let bestDist = 45;
  for (const b of state.city.buildings) {
    const cx = Math.max(b.x, Math.min(x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(y, b.y + b.h));
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestDist && d > 2) {
      const away = Math.atan2(y - cy, x - cx);
      bestDist = d;
      best = { x: cx + Math.cos(away) * 20, y: cy + Math.sin(away) * 20, angle: away };
    }
  }
  for (const car of state.cars) {
    if (car.driver === 'police') continue;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestDist + 10 && d > 2) {
      const away = Math.atan2(y - car.y, x - car.x);
      bestDist = d;
      best = { x: car.x + Math.cos(away) * 30, y: car.y + Math.sin(away) * 30, angle: away };
    }
  }
  return best;
}

/** Boats are water-only: keep one inside the water band, bleeding off
 * the speed that pushed it ashore. Returns true when it was clamped. */
export function clampBoatToWater(car) {
  if (car.kind !== 'boat') return false;
  let clamped = false;
  const minY = WORLD.waterY + 24;
  const maxY = WORLD.height - 24;
  if (car.y < minY) { car.y = minY; car.vy = Math.max(0, car.vy); clamped = true; }
  if (car.y > maxY) { car.y = maxY; car.vy = Math.min(0, car.vy); clamped = true; }
  if (car.x < 24) { car.x = 24; car.vx = Math.max(0, car.vx); clamped = true; }
  if (car.x > WORLD.width - 24) { car.x = WORLD.width - 24; car.vx = Math.min(0, car.vx); clamped = true; }
  if (clamped) car.speed *= 0.6;
  return clamped;
}

/** Arcade driving: accelerate, steer harder at speed, drift, collide, skid. */
export function updateDriving(state, input, dt, onCrash, events) {
  const car = playerCar(state);
  if (!car) return;
  const spec = VEHICLES[car.kind];
  // A wrecked car (0 health) is dead: no engine, no steering — it just
  // coasts to a stop. Get out with E and borrow another car.
  const wrecked = car.health <= 0;
  const throttle = wrecked ? 0 : input.throttle();
  const steer = wrecked ? 0 : input.steer();
  // Driving skill: each level adds 1.5% top speed (cap +15%).
  const driveLv = state.progress ? skillLevel(state.progress.driving, 'driving') : 0;
  const boosting = input.boost && input.boost() && car.nos > 0 && throttle > 0;
  // A damaged car loses performance as its health drops below 50:
  // top speed and acceleration sag to 60% at the edge of wrecking.
  const wear = car.health < 50 ? 0.6 + 0.4 * (car.health / 50) : 1;
  const topSpeed = spec.top * (1 + 0.015 * driveLv) * (boosting ? 1.35 : 1) * wear;
  if (throttle > 0) car.speed += spec.accel * wear * throttle * dt;
  else if (throttle < 0) {
    car.speed += (car.speed > 5 ? -DRIVE.brake : DRIVE.accel * 0.6) * dt * (car.speed > 5 ? 1 : -throttle);
    if (car.speed < -DRIVE.reverse) car.speed = -DRIVE.reverse;
  } else {
    car.speed -= car.speed * (wrecked ? 2.5 : 0.7) * dt;
  }
  if (boosting) {
    car.speed += spec.accel * 0.9 * dt;
    car.nos = Math.max(0, car.nos - 35 * dt);
    spawnSmoke(state, car.x - Math.cos(car.angle) * 22, car.y - Math.sin(car.angle) * 22);
  } else {
    car.nos = Math.min(100, car.nos + 8 * dt);
  }
  if (car.speed > topSpeed) car.speed = topSpeed;
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
  // A boat never leaves the water: the shore stops it, it does not beach.
  if (car.kind === 'boat') clampBoatToWater(car);
  const hitWall = Math.hypot(nx - oldX, ny - oldY) < Math.hypot(car.vx, car.vy) * dt * 0.55 && Math.hypot(car.vx, car.vy) > 120;
  if (hitWall) {
    car.speed *= 0.45;
    car.vx *= 0.4;
    car.vy *= 0.4;
    damageCar(state, car, 8, events || []);
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
  // The player's timers tick down while driving too: without this, the
  // first drive-by shot locks the trigger (attackCooldown never clears)
  // and the first hit makes Lena invulnerable until she steps out
  // (hurtTimer never clears). Both are ticked on foot already.
  if (state.player.attackCooldown > 0) state.player.attackCooldown -= dt;
  if (state.player.hurtTimer > 0) state.player.hurtTimer -= dt;
}

/** Step into the nearest car, or step out of the one being driven. */
export function tryEnterOrExitCar(state, events) {
  const player = state.player;
  if (!player.onFoot) {
    const car = playerCar(state);
    if (car) {
      car.driver = 'none';
      car.parked = true;
      // A moving car keeps rolling when Lena steps out: the speed is
      // left alone and traffic update coasts it to a stop.
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
    // A boat is not a steal: the skiffs at the marina and the lighthouse
    // are free to borrow — no alarm, no stolen count, no witness call.
    if (car.kind === 'boat') {
      events.push({ type: 'toast', text: `Boarded the ${car.name} — the bay is yours.` });
    } else {
      car.stolen = true;
      state.stats.carsStolen += 1;
      // Car alarm: a stolen car sometimes screams — anyone in earshot
      // hears it, so the steal is only free when nobody is around.
      const alarm = state.rng.chance(0.35);
      car.alarm = alarm;
      events.push({ type: 'stolen', car, alarm });
    }
  }
  // Changing rides while unseen cools the heat by one star: the police
  // are looking for the old car, not this one.
  if (state.wanted.level > 0 && !state.wanted.seen && state.wanted.lastCarId !== car.id) {
    state.wanted.level = Math.max(0, state.wanted.level - 1);
    state.wanted.hiddenTimer = 0;
    events.push({ type: 'toast', text: 'New wheels — the heat cools off a star.' });
  }
  state.wanted.lastCarId = car.id;
  return 'enter';
}

/** Damage a car: health drops to zero and the car is wrecked; more
 * damage while wrecked builds up until the car explodes and is gone. */
export function damageCar(state, car, amount, events) {
  if (!car || car.exploded || amount <= 0) return;
  if (car.health > 0) {
    car.health = Math.max(0, car.health - amount);
    if (car.health === 0) {
      car.wreckDamage = 0;
      if (car.driver === 'player') events.push({ type: 'toast', text: 'Your car is wrecked — get out and find another!' });
    }
  } else {
    car.wreckDamage = (car.wreckDamage || 0) + amount;
    if (car.wreckDamage >= 40) explodeCar(state, car, events);
  }
}

/** A wrecked car that takes one hit too many: fireball, burnt husk, and
 * Lena (or the driver) thrown clear. The husk stays in the world, dark
 * and undrivable, until the city forgets it. */
export function explodeCar(state, car, events) {
  if (car.exploded) return;
  car.exploded = true;
  car.color = '#1a1a1a';
  car.speed = 0;
  car.vx = 0;
  car.vy = 0;
  spawnExplosion(state, car.x, car.y);
  events.push({ type: 'explosion', x: car.x, y: car.y });
  if (car.driver === 'player') {
    const player = state.player;
    player.onFoot = true;
    player.carId = null;
    player.x = car.x - Math.cos(car.angle + Math.PI / 2) * 34;
    player.y = car.y - Math.sin(car.angle + Math.PI / 2) * 34;
    const [px, py] = resolveBuildingCollision(state.city, player.x, player.y, WALK.radius);
    player.x = px;
    player.y = py;
    damagePlayer(state, 25, events);
    events.push({ type: 'toast', text: 'Your car exploded! Find another ride.' });
  }
  car.driver = 'none';
  car.parked = true;
}

/** Busted: the PD keeps every round of ammunition and the armour.
 * The guns stay — Lena buys her way back to a full mag at Cielo Arms. */
export function applyBustedPenalty(state) {
  const player = state.player;
  player.ammo = { pistol: 0, smg: 0 };
  player.mag = { pistol: 0, smg: 0 };
  player.armour = 0;
}

/** Wasted: the clinic takes 5% of the cash on hand, up to $5,000.
 * Returns the fine charged. */
export function applyWastedPenalty(state) {
  const player = state.player;
  const fine = Math.min(player.money, Math.min(HEALTH.wastedCap, Math.floor(player.money * HEALTH.wastedPercent)));
  player.money -= fine;
  return fine;
}

export function damagePlayer(state, amount, events) {
  const player = state.player;
  if (player.hurtTimer > 0) return;
  // Cover halves incoming damage: the wall takes the rest.
  if (player.cover) amount *= 0.5;
  // Armour soaks 70% of a hit before health takes the rest.
  if (player.armour > 0) {
    const absorbed = Math.min(player.armour, amount * 0.7);
    player.armour -= absorbed;
    amount -= absorbed;
  }
  player.health = Math.max(0, player.health - amount);
  player.hurtTimer = 0.5;
  player.lastHurtAt = state.time;
  // Mission medals track how much damage Lena took on the job.
  if (state.mission && state.mission.started) {
    state.mission.damageTaken = (state.mission.damageTaken || 0) + amount;
  }
  events.push({ type: 'hurt', amount });
}
