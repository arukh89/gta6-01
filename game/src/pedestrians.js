// The people of Solmaris: strollers walking block perimeters, beachgoers on
// the sand, and officers on foot. Pedestrians panic and scatter when a crime
// happens nearby; nobody here is ever killed, a knocked-down pedestrian gets
// up, dusts off, and runs. Officers chase the player when the heat is on.
import { WALK } from './config.js';
import { resolveBuildingCollision } from './world.js';

const SHIRTS = ['#e63946', '#2a9d8f', '#ffb703', '#8ecae6', '#f4a261', '#b5838d', '#90be6d', '#dee2e6'];
const SKINS = ['#f2c89b', '#c68642', '#8d5524', '#ffdbac', '#a0663a'];

export function createPedestrians(city, rng, count) {
  const peds = [];
  const walkable = city.blocks.filter((b) => !b.park && b.district !== 'marina');
  for (let i = 0; i < count; i += 1) {
    const block = rng.pick(walkable);
    peds.push({
      kind: 'ped',
      block,
      t: rng.next(),
      dir: rng.chance(0.5) ? 1 : -1,
      speed: rng.range(38, 62),
      x: block.x,
      y: block.y,
      angle: 0,
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKINS),
      panic: 0,
      down: 0,
      phase: rng.range(0, 6),
      fare: false,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    peds.push({
      kind: 'ped',
      block: null,
      t: 0,
      dir: 1,
      speed: rng.range(30, 50),
      x: rng.range(120, 3080),
      y: rng.range(2020, 2200),
      angle: rng.range(0, Math.PI * 2),
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKINS),
      panic: 0,
      down: 0,
      phase: rng.range(0, 6),
      fare: false,
      beach: true,
    });
  }
  return peds;
}

export function createOfficer(x, y) {
  return {
    kind: 'cop',
    block: null,
    t: 0,
    dir: 1,
    speed: 150,
    x,
    y,
    angle: 0,
    shirt: '#1d3557',
    skin: '#f2c89b',
    panic: 0,
    down: 0,
    phase: 0,
    fare: false,
  };
}

function perimeterPoint(block, t) {
  const m = 26;
  const x0 = block.x - m;
  const y0 = block.y - m;
  const x1 = block.x + block.w + m;
  const y1 = block.y + block.h + m;
  const w = x1 - x0;
  const h = y1 - y0;
  const total = 2 * (w + h);
  let d = ((t % 1) + 1) % 1 * total;
  if (d < w) return { x: x0 + d, y: y0, angle: 0 };
  d -= w;
  if (d < h) return { x: x1, y: y0 + d, angle: Math.PI / 2 };
  d -= h;
  if (d < w) return { x: x1 - d, y: y1, angle: Math.PI };
  d -= w;
  return { x: x0, y: y1 - d, angle: -Math.PI / 2 };
}

/** Scatter every pedestrian within range of a scare point. */
export function panicNearby(state, x, y, radius) {
  for (const ped of state.peds) {
    if (ped.kind !== 'ped') continue;
    if (Math.hypot(ped.x - x, ped.y - y) < radius) ped.panic = 4;
  }
}

export function updatePedestrians(state, dt, events) {
  const player = state.player;
  for (const ped of state.peds) {
    if (ped.down > 0) {
      ped.down -= dt;
      continue;
    }
    if (ped.panic > 0) {
      ped.panic -= dt;
      const away = Math.atan2(ped.y - player.y, ped.x - player.x);
      ped.angle = away;
      const [nx, ny] = resolveBuildingCollision(state.city, ped.x + Math.cos(away) * 130 * dt, ped.y + Math.sin(away) * 130 * dt, 11);
      ped.x = nx;
      ped.y = ny;
      ped.phase += dt * 12;
      continue;
    }
    if (ped.kind === 'cop') {
      const d = Math.hypot(player.x - ped.x, player.y - ped.y);
      if (state.wanted.level > 0 && d < 900) {
        ped.angle = Math.atan2(player.y - ped.y, player.x - ped.x);
        const [nx, ny] = resolveBuildingCollision(state.city, ped.x + Math.cos(ped.angle) * ped.speed * dt, ped.y + Math.sin(ped.angle) * ped.speed * dt, 11);
        ped.x = nx;
        ped.y = ny;
        ped.phase += dt * 10;
        if (d < 30 && player.onFoot) {
          events.push({ type: 'cop-touch' });
        }
      }
      continue;
    }
    if (ped.beach) {
      ped.x += Math.cos(ped.angle) * ped.speed * dt;
      ped.y += Math.sin(ped.angle) * ped.speed * 0.4 * dt;
      if (ped.x < 80 || ped.x > 3120) ped.angle = Math.PI - ped.angle;
      if (ped.y < 2000 || ped.y > 2220) ped.angle = -ped.angle;
      ped.phase += dt * 7;
      continue;
    }
    if (!ped.block) continue;
    const m = 26;
    const perimeter = 2 * (ped.block.w + 2 * m + ped.block.h + 2 * m);
    ped.t += (ped.dir * ped.speed * dt) / perimeter;
    const point = perimeterPoint(ped.block, ped.t);
    ped.x = point.x;
    ped.y = point.y;
    ped.angle = ped.dir > 0 ? point.angle : point.angle + Math.PI;
    ped.phase += dt * 7;
  }
}

/** Knock a pedestrian down (they recover) and raise the heat. */
export function knockPedestrian(state, ped, events) {
  if (ped.down > 0) return;
  ped.down = 2.5;
  ped.panic = 5;
  events.push({ type: 'ped-hit', ped });
}
