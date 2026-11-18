// Combat in Solmaris: fists up close, a pistol at range, bullets that spark
// off walls and dent cars, and officers who push back at high heat. Nobody is
// killed: people get knocked down and get back up, and cars smoke and stall.
import { WEAPONS } from './config.js';
import { damagePlayer, playerCar } from './player.js';
import { knockPedestrian, panicNearby } from './pedestrians.js';
import { addWanted } from './police.js';

function pointInBuilding(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

export function reloadWeapon(state) {
  const player = state.player;
  if (player.weapon !== 'pistol') return;
  const need = WEAPONS.pistol.mag - player.mag;
  const take = Math.min(need, player.ammo);
  if (take > 0) {
    player.mag += take;
    player.ammo -= take;
  }
}

function meleeAttack(state, events) {
  const player = state.player;
  player.attackCooldown = WEAPONS.fists.rate;
  events.push({ type: 'punch' });
  for (const ped of state.peds) {
    const d = Math.hypot(ped.x - player.x, ped.y - player.y);
    if (d > WEAPONS.fists.range + 10) continue;
    const facing = Math.atan2(ped.y - player.y, ped.x - player.x);
    let diff = facing - player.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.2) continue;
    knockPedestrian(state, ped, events);
    if (ped.kind === 'cop') addWanted(state, 1, events);
    else addWanted(state, 1, events);
  }
  panicNearby(state, player.x, player.y, 160);
}

function firePistol(state, events) {
  const player = state.player;
  if (player.mag <= 0) {
    reloadWeapon(state);
    if (player.mag <= 0) return;
  }
  player.mag -= 1;
  player.attackCooldown = WEAPONS.pistol.rate;
  state.stats.shotsFired += 1;
  const speed = 900;
  state.bullets.push({
    x: player.x + Math.cos(player.angle) * 22,
    y: player.y + Math.sin(player.angle) * 22,
    vx: Math.cos(player.angle) * speed,
    vy: Math.sin(player.angle) * speed,
    life: WEAPONS.pistol.range / speed,
    damage: WEAPONS.pistol.damage,
  });
  events.push({ type: 'shot' });
  addWanted(state, 1, events);
}

export function updateCombat(state, input, dt, events) {
  const player = state.player;
  if (player.onFoot && input.isFiring() && player.attackCooldown <= 0) {
    if (player.weapon === 'pistol') firePistol(state, events);
    else meleeAttack(state, events);
  }
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    let dead = bullet.life <= 0;
    if (!dead && pointInBuilding(state.city, bullet.x, bullet.y)) {
      events.push({ type: 'spark', x: bullet.x, y: bullet.y });
      dead = true;
    }
    if (!dead) {
      for (const car of state.cars) {
        if (car.driver === 'player') continue;
        if (Math.hypot(car.x - bullet.x, car.y - bullet.y) < 26) {
          car.health = Math.max(0, car.health - bullet.damage);
          events.push({ type: 'spark', x: bullet.x, y: bullet.y });
          if (car.driver === 'police') addWanted(state, 1, events);
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const ped of state.peds) {
        if (ped.down > 0) continue;
        if (Math.hypot(ped.x - bullet.x, ped.y - bullet.y) < 14) {
          knockPedestrian(state, ped, events);
          if (ped.kind === 'cop') addWanted(state, 1, events);
          dead = true;
          break;
        }
      }
    }
    if (dead) state.bullets.splice(i, 1);
  }

  // Officers at three stars or more return fire from a distance.
  if (state.wanted.level >= 3 && player.onFoot) {
    for (const ped of state.peds) {
      if (ped.kind !== 'cop' || ped.down > 0) continue;
      const d = Math.hypot(ped.x - player.x, ped.y - player.y);
      if (d < 260 && d > 40 && state.time - (ped.lastShot || -99) > 1.4) {
        ped.lastShot = state.time;
        damagePlayer(state, 9, events);
        events.push({ type: 'shot' });
      }
    }
  }

  // The player's car running into people, and traffic running into the player.
  const car = playerCar(state);
  if (car && Math.abs(car.speed) > 60) {
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      if (Math.hypot(ped.x - car.x, ped.y - car.y) < 26) {
        knockPedestrian(state, ped, events);
        addWanted(state, 2, events);
        state.shake = Math.min(14, state.shake + 7);
      }
    }
  }
  if (player.onFoot) {
    for (const other of state.cars) {
      if (other.driver !== 'traffic' && other.driver !== 'police') continue;
      if (Math.abs(other.speed) < 60) continue;
      if (Math.hypot(other.x - player.x, other.y - player.y) < 26) {
        damagePlayer(state, 18, events);
        state.shake = Math.min(14, state.shake + 8);
      }
    }
  }
}
