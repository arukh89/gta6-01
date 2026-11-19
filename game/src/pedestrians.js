// The people of Solmaris: strollers walking block perimeters, beachgoers on
// the sand, and officers on foot. Pedestrians panic and scatter when a crime
// happens nearby; walkers can be killed — a body lingers, then fades from
// the street — while officers only get knocked down and get back up.
// Officers chase the player when the heat is on.
import { WALK } from './config.js';
import { RIVER, dryPoint, resolveBuildingCollision, waterYAt } from './world.js';

const SHIRTS = ['#e63946', '#2a9d8f', '#ffb703', '#8ecae6', '#f4a261', '#b5838d', '#90be6d', '#dee2e6'];
const SKINS = ['#f2c89b', '#c68642', '#8d5524', '#ffdbac', '#a0663a'];
const PANTS = ['#3d405b', '#212529', '#5c4a3a', '#14532d', '#6d6875', '#495057'];
const HATS = ['none', 'cap', 'beanie', 'wide'];
const HAT_COLORS = ['#14213d', '#e63946', '#ffb703', '#2a9d8f', '#6c757d', '#f4d35e'];
const COP_SHIRTS = ['#1d3557', '#1b2f4b', '#243a5e', '#16233a'];

/** Deterministic 0..1 hash — a look derived from an index alone, so no
 * seeded-rng call is consumed and tape positions (and everything the
 * stream feeds downstream) stay exactly where they were. */
function hash01(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** One person's look from an index alone: height, build, hat, trousers
 * and walk cadence. The same index always yields the same person. */
export function pedLookForIndex(i) {
  return {
    scale: 0.88 + hash01(i * 1.7 + 0.3) * 0.24,
    build: 0.85 + hash01(i * 2.3 + 1.1) * 0.35,
    hat: HATS[Math.floor(hash01(i * 3.1 + 2.7) * HATS.length)],
    hatColor: HAT_COLORS[Math.floor(hash01(i * 4.7 + 0.9) * HAT_COLORS.length)],
    pants: PANTS[Math.floor(hash01(i * 5.3 + 4.2) * PANTS.length)],
    stride: 0.7 + hash01(i * 6.9 + 3.3) * 0.7,
  };
}

/** Named ambient locals: five of the forty strollers, given a name, a
 * role and a home spot. They walk a normal block perimeter near their
 * spot and behave exactly like any other ped (same HP, same rules) —
 * they are ambience, not missions. */
const NAMED_NPCS = [
  { name: 'Sari', role: 'Street-food vendor', spot: { x: 1030, y: 1410 }, look: { hat: 'wide', hatColor: '#f4d35e', shirt: '#e63946', pants: '#3d405b', scale: 0.98, build: 1.05 } },
  { name: 'Budi', role: 'Taxi driver', spot: { x: 2080, y: 800 }, look: { hat: 'cap', hatColor: '#14213d', shirt: '#8ecae6', pants: '#212529', scale: 1.0, build: 0.95 } },
  { name: 'Raka', role: 'Neon Club bouncer', spot: { x: 2080, y: 1440 }, look: { hat: 'cap', hatColor: '#14213d', shirt: '#212529', pants: '#212529', scale: 1.14, build: 1.25 } },
  { name: 'Dedi', role: 'Fisherman', spot: { x: 2960, y: 1760 }, look: { hat: 'beanie', hatColor: '#6c757d', shirt: '#2a9d8f', pants: '#5c4a3a', scale: 1.02, build: 1.1 } },
  { name: 'Maya', role: 'Lifeguard', spot: { x: 1600, y: 2120 }, look: { hat: 'cap', hatColor: '#e63946', shirt: '#ffb703', pants: '#e63946', scale: 0.96, build: 0.9 } },
];

function nearestWalkableBlock(walkable, x, y) {
  let best = walkable[0];
  let bestD = Infinity;
  for (const b of walkable) {
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

export function createPedestrians(city, rng, count) {
  const peds = [];
  // Strollers walk block perimeters — never a block the river cuts,
  // whose perimeter would cross the channel.
  const walkable = city.blocks.filter((b) => !b.park && b.district !== 'marina' && !(b.x < RIVER.x1 && b.x + b.w > RIVER.x0));
  for (let i = 0; i < count; i += 1) {
    const block = rng.pick(walkable);
    const ped = {
      kind: 'ped',
      block,
      t: rng.next(),
      dir: rng.chance(0.5) ? 1 : -1,
      speed: rng.range(32, 70),
      x: block.x,
      y: block.y,
      angle: 0,
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKINS),
      panic: 0,
      down: 0,
      hp: 50,
      dead: false,
      phase: rng.range(0, 6),
      fare: false,
      ...pedLookForIndex(i),
    };
    // Five of the strollers are named locals with a home spot: the
    // same rng calls still happen above, so the stream is untouched.
    if (i < NAMED_NPCS.length) {
      const named = NAMED_NPCS[i];
      ped.name = named.name;
      ped.role = named.role;
      Object.assign(ped, named.look);
      ped.block = nearestWalkableBlock(walkable, named.spot.x, named.spot.y);
      ped.x = ped.block.x;
      ped.y = ped.block.y;
    }
    peds.push(ped);
  }
  for (let i = 0; i < 8; i += 1) {
    const bx = rng.range(120, 3080);
    peds.push({
      kind: 'ped',
      block: null,
      t: 0,
      dir: 1,
      speed: rng.range(28, 55),
      x: bx,
      // Beachgoers stay on the sand: never spawn past the bay's edge.
      y: Math.min(rng.range(2020, 2200), waterYAt(bx) - 14),
      angle: rng.range(0, Math.PI * 2),
      shirt: rng.pick(SHIRTS),
      skin: rng.pick(SKINS),
      panic: 0,
      down: 0,
      hp: 50,
      dead: false,
      phase: rng.range(0, 6),
      fare: false,
      beach: true,
      ...pedLookForIndex(i + 100),
    });
  }
  return peds;
}

export function createOfficer(x, y) {
  // Officers vary like walkers — height, build, uniform shade, cadence —
  // derived from where they spawn, so the dark cap still reads as police.
  const v = hash01(Math.floor(x) * 0.13 + Math.floor(y) * 0.29);
  const v2 = hash01(Math.floor(x) * 0.31 + Math.floor(y) * 0.17);
  return {
    kind: 'cop',
    block: null,
    t: 0,
    dir: 1,
    speed: 150,
    x,
    y,
    angle: 0,
    shirt: COP_SHIRTS[Math.floor(v * COP_SHIRTS.length)],
    skin: '#f2c89b',
    panic: 0,
    down: 0,
    phase: 0,
    fare: false,
    scale: 0.94 + v2 * 0.16,
    build: 0.9 + hash01(Math.floor(x) * 0.07 + Math.floor(y) * 0.43) * 0.3,
    hat: 'cap',
    hatColor: '#14213d',
    pants: '#14213d',
    stride: 0.9 + hash01(Math.floor(x) * 0.53 + Math.floor(y) * 0.11) * 0.3,
  };
}

/** A SWAT officer: faster, tougher (recovers from a knockdown in a
 * second), and hits harder. Dark gear, same shape as a regular officer. */
export function createSwatOfficer(x, y) {
  const officer = createOfficer(x, y);
  officer.swat = true;
  officer.speed = 170;
  officer.shirt = '#2b2d42';
  officer.scale = (officer.scale ?? 1) * 1.06;
  officer.build = (officer.build ?? 1) * 1.08;
  return officer;
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
    // A dead pedestrian lies where they fell while the body lingers;
    // the cleanup below removes the body once the linger runs out.
    if (ped.dead) {
      ped.down -= dt;
      continue;
    }
    if (ped.down > 0) {
      ped.down -= dt;
      continue;
    }
    if (ped.panic > 0) {
      ped.panic -= dt;
      const away = Math.atan2(ped.y - player.y, ped.x - player.x);
      ped.angle = away;
      const [nx, ny] = resolveBuildingCollision(state.city, ped.x + Math.cos(away) * 130 * dt, ped.y + Math.sin(away) * 130 * dt, 11);
      const [dx, dy] = dryPoint(state.city, nx, ny);
      ped.x = dx;
      ped.y = dy;
      ped.phase += dt * 12 * (ped.stride ?? 1);
      continue;
    }
    if (ped.kind === 'cop') {
      const d = Math.hypot(player.x - ped.x, player.y - ped.y);
      if (state.wanted.level > 0 && d < 900) {
        ped.angle = Math.atan2(player.y - ped.y, player.x - ped.x);
        const [nx, ny] = resolveBuildingCollision(state.city, ped.x + Math.cos(ped.angle) * ped.speed * dt, ped.y + Math.sin(ped.angle) * ped.speed * dt, 11);
        const [dx, dy] = dryPoint(state.city, nx, ny);
        ped.x = dx;
        ped.y = dy;
        ped.phase += dt * 10 * (ped.stride ?? 1);
        if (d < 30 && player.onFoot) {
          events.push({ type: 'cop-touch' });
        }
      }
      continue;
    }
    // A random-event thief runs from Lena until caught or gone.
    if (ped.flee) {
      const away = Math.atan2(ped.y - player.y, ped.x - player.x);
      ped.angle = away;
      const [nx, ny] = resolveBuildingCollision(state.city, ped.x + Math.cos(away) * ped.speed * dt, ped.y + Math.sin(away) * ped.speed * dt, 11);
      const [dx, dy] = dryPoint(state.city, nx, ny);
      ped.x = dx;
      ped.y = dy;
      ped.phase += dt * 12 * (ped.stride ?? 1);
      continue;
    }
    if (ped.beach) {
      ped.x += Math.cos(ped.angle) * ped.speed * dt;
      ped.y += Math.sin(ped.angle) * ped.speed * 0.4 * dt;
      if (ped.x < 80 || ped.x > 3120) ped.angle = Math.PI - ped.angle;
      if (ped.y < 2000 || ped.y > waterYAt(ped.x) - 14) ped.angle = -ped.angle;
      ped.phase += dt * 7 * (ped.stride ?? 1);
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
    ped.phase += dt * 7 * (ped.stride ?? 1);
  }
  // Bodies whose linger ran out leave the street.
  state.peds = state.peds.filter((p) => !p.dead || p.down > 0);
}

/** Knock a pedestrian down (they recover) and raise the heat. */
export function knockPedestrian(state, ped, events) {
  if (ped.down > 0) return;
  // SWAT gets up in a second; everyone else takes 2.5.
  ped.down = ped.swat ? 1.0 : 2.5;
  ped.panic = 5;
  events.push({ type: 'ped-hit', ped });
}

/** Hurt a pedestrian. Walkers have 50 HP: a non-lethal hit knocks them
 * down like before, a lethal one kills them — the body falls, lingers
 * 6 seconds, then fades from the street, and nearby pedestrians panic.
 * Officers have no HP: they only get knocked down and get back up.
 * Returns 'killed' | 'hurt' | 'none' (already dead). The caller reports
 * the crime through the witness system: a kill counts as a witnessed
 * crime, so the caller adds the wanted level for it. */
export function damagePedestrian(state, ped, damage, events) {
  if (ped.dead) return 'none';
  if (ped.kind !== 'ped') {
    knockPedestrian(state, ped, events);
    return 'hurt';
  }
  const hp = (ped.hp ?? 50) - damage;
  ped.hp = hp;
  if (hp > 0) {
    knockPedestrian(state, ped, events);
    return 'hurt';
  }
  ped.dead = true;
  ped.down = 6;
  ped.panic = 0;
  for (let i = 0; i < 6; i += 1) {
    state.particles.push({
      x: ped.x + state.rng.range(-8, 8), y: ped.y + state.rng.range(-8, 8),
      vx: state.rng.range(-30, 30), vy: state.rng.range(-30, 30),
      life: 0.6, maxLife: 0.6, size: state.rng.range(3, 6), color: '#8d0801',
    });
  }
  panicNearby(state, ped.x, ped.y, 220);
  events.push({ type: 'ped-killed', ped });
  return 'killed';
}
