// Combat in Solmaris: fists up close, a pistol at range, an SMG for those
// who buy one at Cielo Arms, bullets that spark off walls and dent cars,
// and officers who push back at high heat. Walkers can be killed (50 HP);
// officers only get knocked down and get back up, and cars smoke and stall.
import { WEAPONS, skillLevel } from './config.js';
import { damageCar, damagePlayer, playerCar } from './player.js';
import { damagePedestrian, panicNearby } from './pedestrians.js';
import { hitRangeTarget } from './minigames.js';
import { crimeWanted } from './police.js';
import { hasLineOfSight, pointInBuilding } from './world.js';

export function reloadWeapon(state) {
  const player = state.player;
  if (player.weapon === 'fists') return;
  const spec = WEAPONS[player.weapon];
  const need = spec.mag - player.mag[player.weapon];
  const take = Math.min(need, player.ammo[player.weapon]);
  if (take > 0) {
    player.mag[player.weapon] += take;
    player.ammo[player.weapon] -= take;
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
    // Five punches kill a walker (12 x 5 = 60); a kill is a bigger
    // witnessed crime than a punch, so it adds two stars instead of one.
    const result = damagePedestrian(state, ped, WEAPONS.fists.damage, events);
    crimeWanted(state, result === 'killed' ? 2 : 1, events);
  }
  panicNearby(state, player.x, player.y, 160);
}

function fireGun(state, events) {
  const player = state.player;
  const spec = WEAPONS[player.weapon];
  if (player.mag[player.weapon] <= 0) {
    reloadWeapon(state);
    if (player.mag[player.weapon] <= 0) return;
  }
  player.mag[player.weapon] -= 1;
  player.attackCooldown = spec.rate;
  state.stats.shotsFired += 1;
  // Shooting skill: each level adds 2% damage (cap +20%).
  const shootLv = state.progress ? skillLevel(state.progress.shooting, 'shooting') : 0;
  const speed = 900;
  state.bullets.push({
    x: player.x + Math.cos(player.angle) * 22,
    y: player.y + Math.sin(player.angle) * 22,
    vx: Math.cos(player.angle) * speed,
    vy: Math.sin(player.angle) * speed,
    life: spec.range / speed,
    damage: spec.damage * (1 + 0.02 * shootLv),
  });
  events.push({ type: 'shot' });
  // The range is a designated shooting spot: rounds fired there are
  // not a crime. Anywhere else, a shot is still witnessed.
  const onRange = state.minigame && state.minigame.active && state.minigame.kind === 'range';
  if (!onRange) crimeWanted(state, 1, events);
}

export function updateCombat(state, input, dt, events, toWorld) {
  const player = state.player;
  // Darts is thrown with a click, not shot: while a darts game is
  // running the trigger throws darts, so the gun stays holstered.
  // No shooting while swimming either: both hands are busy staying afloat.
  const darts = state.minigame && state.minigame.active && state.minigame.kind === 'darts';
  if (player.onFoot && !player.swimming && !darts && input.isFiring() && player.attackCooldown <= 0) {
    if (player.weapon === 'fists') meleeAttack(state, events);
    else fireGun(state, events);
  }
  // Drive-by shooting: pistol or SMG from the driver's seat, aimed
  // with the mouse like on foot. Fists stay out of the car.
  if (!player.onFoot && !darts && input.isFiring() && player.attackCooldown <= 0 && player.weapon !== 'fists') {
    const aim = toWorld ? toWorld(input.mouse().x, input.mouse().y) : { x: player.x + Math.cos(player.angle) * 200, y: player.y + Math.sin(player.angle) * 200 };
    player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
    fireGun(state, events);
  }
  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    let dead = bullet.life <= 0;
    // The police helicopter is a sky target: it flies at altitude
    // 190-300, so a bullet aimed up at it is not stopped by a building
    // below. Check it before the building test, or the heli would be
    // unshootable whenever it hovered over a block.
    if (!dead) {
      const heli = state.heli;
      if (heli && heli.mode !== 'crashing' && Math.hypot(heli.x - bullet.x, heli.y - bullet.y) < 45) {
        heli.health -= bullet.damage;
        if (state.progress) state.progress.shooting += 1;
        events.push({ type: 'spark', x: bullet.x, y: bullet.y });
        if (heli.health <= 0) {
          heli.mode = 'crashing';
          events.push({ type: 'toast', text: 'You hit the helicopter!' });
        }
        dead = true;
      }
    }
    if (!dead && pointInBuilding(state.city, bullet.x, bullet.y)) {
      events.push({ type: 'spark', x: bullet.x, y: bullet.y });
      dead = true;
    }
    if (!dead) {
      for (const car of state.cars) {
        if (car.driver === 'player' || car.exploded) continue;
        if (Math.hypot(car.x - bullet.x, car.y - bullet.y) < 26) {
          damageCar(state, car, bullet.damage, events);
          if (state.progress) state.progress.shooting += 1;
          events.push({ type: 'spark', x: bullet.x, y: bullet.y });
          if (car.driver === 'police') crimeWanted(state, 1, events);
          dead = true;
          break;
        }
      }
    }
    // Shooting-range targets: paper boards on the Cielo Arms range.
    // A hit knocks one down and scores it; the bullet stops there.
    if (!dead && state.minigame && state.minigame.active && state.minigame.kind === 'range') {
      for (const target of state.minigame.targets) {
        if (target.down) continue;
        if (Math.hypot(target.x - bullet.x, target.y - bullet.y) < 16) {
          hitRangeTarget(state, target, events);
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const ped of state.peds) {
        // A downed walker can still be finished off (two pistol shots
        // kill: 26 + 26); a downed officer is out of the fight, and a
        // body is not a target.
        if (ped.dead) continue;
        if (ped.down > 0 && ped.kind === 'cop') continue;
        if (Math.hypot(ped.x - bullet.x, ped.y - bullet.y) < 14) {
          const result = damagePedestrian(state, ped, bullet.damage, events);
          if (state.progress) state.progress.shooting += 1;
          if (ped.kind === 'cop') crimeWanted(state, 1, events);
          else if (result === 'killed') crimeWanted(state, 2, events);
          dead = true;
          break;
        }
      }
    }
    if (dead) state.bullets.splice(i, 1);
  }

  // Officers at three stars or more return fire from a distance.
  // SWAT hits harder and faster.
  if (state.wanted.level >= 3 && player.onFoot) {
    for (const ped of state.peds) {
      if (ped.kind !== 'cop' || ped.down > 0) continue;
      const d = Math.hypot(ped.x - player.x, ped.y - player.y);
      const interval = ped.swat ? 1.0 : 1.4;
      if (d < 260 && d > 40 && state.time - (ped.lastShot || -99) > interval) {
        ped.lastShot = state.time;
        damagePlayer(state, ped.swat ? 14 : 9, events);
        events.push({ type: 'shot' });
      }
    }
  }

  // Police shoot from their cars when the heat is three stars or
  // more and Lena is driving: hitscan on her car, only with a clear line
  // of sight, so breaking away behind a building still works.
  const car = playerCar(state);
  if (state.wanted.level >= 3 && car && !car.exploded) {
    for (const cop of state.cars) {
      if (cop.driver !== 'police' || cop.health <= 0 || cop.blocking) continue;
      const d = Math.hypot(cop.x - car.x, cop.y - car.y);
      if (d < 320 && d > 30 && state.time - (cop.lastShot || -99) > 1.5
        && hasLineOfSight(state.city, cop.x, cop.y, car.x, car.y)) {
        cop.lastShot = state.time;
        damageCar(state, car, 4, events);
        events.push({ type: 'cop-shot', x: car.x, y: car.y });
      }
    }
  }

  // The player's car running into people, and traffic running into the player.
  if (car && Math.abs(car.speed) > 60) {
    for (const ped of state.peds) {
      if (ped.down > 0) continue;
      if (Math.hypot(ped.x - car.x, ped.y - car.y) < 26) {
        // Speed kills: damage scales with speed, so a slow roll just
        // knocks them down while a fast car (400+ units/s) kills.
        damagePedestrian(state, ped, Math.max(8, Math.round(Math.abs(car.speed) / 8)), events);
        crimeWanted(state, 2, events);
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
