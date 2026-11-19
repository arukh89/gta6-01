// The city of Solmaris: a road grid, blocks of buildings, a park, a neon
// district, downtown towers, a beach promenade and a marina. Everything is
// generated from the seeded stream, so the same seed builds the same streets.
// Collision is circle-versus-building-footprint, checked block by block.
import { PALETTE, WORLD } from './config.js';

/** The river: a north-south channel through column 6, between the 1760
 * and 2080 roads, running down into the bay. Every road crosses it on
 * a bridge; off the road it is water. At 112u wide it reads as a river
 * on the map and in 3D, not a canal. */
export const RIVER = { x0: 1864, x1: 1976 };

/** The landmark crossing: Coral Boulevard (y=800), the bridge the cover
 * chase drives over. Ordinary bridges are plain concrete decks; the
 * landmark is a wider gold deck with bowed edges, white rails and posts. */
export const LANDMARK_BRIDGE_Y = 800;
export const BRIDGE_DECK = { standard: 46, landmark: 62, overhang: 14, landmarkOverhang: 22 };

/** One crossing per horizontal road — every road over the river is a bridge. */
export function bridgeCrossings(city) {
  return city.ys.map((y) => ({ y, landmark: y === LANDMARK_BRIDGE_Y }));
}

/** Water edge at world x: the bay bites north into the city in a broad
 * arc (deepest ~100u near x=1900, none at the lighthouse west end or the
 * marina east end), over the gentle wave the coast always had. */
export function waterYAt(x) {
  const bay = x > 800 && x < 3000 ? 100 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (x - 800)) / 2200)) : 0;
  return WORLD.waterY - bay + Math.sin(x * 0.004) * 26 + Math.sin(x * 0.011 + 1.3) * 12;
}

export function roadCentersX() {
  const list = [];
  for (let x = WORLD.firstRoad; x < WORLD.width; x += WORLD.roadGap) list.push(x);
  return list;
}

export function roadCentersY() {
  const list = [];
  for (let y = WORLD.firstRoad; y < WORLD.beachY - 120; y += WORLD.roadGap) list.push(y);
  return list;
}

function districtFor(col, row, cols) {
  // Irregular (stepped) edges: the downtown border jogs a column in row 2
  // and the neon border jogs a column in row 5, so the districts read as
  // organic shapes on the map instead of perfect rectangles.
  if (col >= (row === 2 ? 8 : 7) && row >= 1 && row <= 3) return 'downtown';
  if (col <= (row === 5 ? 4 : 3) && row >= 4 && row <= 5) return 'neon';
  if (row === 6) return 'beachfront';
  if (col === cols - 1 && row >= 4) return 'marina';
  return 'uptown';
}

/** A deterministic [0,1) drawn from three integers. Building shapes are
 * picked from this, never from the seeded rng, so the tapes, the cash
 * drops and every draw after them land in exactly the same places as
 * before. */
function hash3(a, b, c) {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** Give one building a varied shape, without spending any rng. The base
 * footprint (x, y, w, h) is sacred — collision, cover and the map all
 * keep using it. An upper tier is always strictly inside the base, and
 * an L wing always stays inside the building's own cell, so nothing can
 * overlap a neighbour or poke out of its block. A roof detail sits on
 * the highest face. The four forms: slab (plain box), stepped (broad
 * base + a narrower storey on top), podium (low broad base + a slim
 * tall tower), L (the base plus a wing on one side). */
function varyBuilding(b, col, row, i, cx, cy, cellW, cellH) {
  const h1 = hash3(col, row, i);
  const h2 = hash3(col + 11, row + 11, i);
  const h3 = hash3(col + 22, row + 22, i);
  const h4 = hash3(col + 33, row + 33, i);
  const h5 = hash3(col + 44, row + 44, i);
  const h6 = hash3(col + 55, row + 55, i);
  const h7 = hash3(col + 66, row + 66, i);
  let form = 'slab';
  if (b.district === 'downtown') form = h1 < 0.55 ? 'stepped' : h1 < 0.85 ? 'podium' : 'slab';
  else if (b.district === 'neon') form = h1 < 0.35 ? 'stepped' : h1 < 0.65 ? 'L' : 'slab';
  else if (b.district === 'beachfront') form = h1 < 0.4 ? 'L' : h1 < 0.6 ? 'stepped' : 'slab';
  else form = h1 < 0.3 ? 'stepped' : h1 < 0.5 ? 'podium' : h1 < 0.75 ? 'L' : 'slab';
  b.form = form;
  if (form === 'stepped' || form === 'podium') {
    const isStepped = form === 'stepped';
    const wFrac = isStepped ? 0.55 + h3 * 0.2 : 0.38 + h3 * 0.12;
    const dFrac = isStepped ? 0.55 + h2 * 0.2 : 0.38 + h2 * 0.12;
    const topH = b.height * (isStepped ? 0.35 + h4 * 0.15 : 0.6 + h4 * 0.15);
    const uw = b.w * wFrac;
    const uh = b.h * dFrac;
    const dx = (b.w - uw) * (0.2 + h2 * 0.6);
    const dy = (b.h - uh) * (0.2 + h4 * 0.6);
    b.upper = { x: b.x + dx, y: b.y + dy, w: uw, h: uh, height: topH };
  }
  if (form === 'L') {
    const side = Math.floor(h2 * 4); // 0 east, 1 west, 2 south, 3 north
    const along = 0.45 + h3 * 0.3;
    const edge = h4 < 0.5 ? 0 : 1;
    const wingH = b.height * (0.7 + h4 * 0.3);
    if (side === 0) {
      const aw = cx + cellW - (b.x + b.w);
      const ah = b.h * along;
      b.arm = { x: b.x + b.w, y: b.y + (b.h - ah) * edge, w: aw, h: ah, height: wingH };
    } else if (side === 1) {
      const aw = b.x - cx;
      const ah = b.h * along;
      b.arm = { x: cx, y: b.y + (b.h - ah) * edge, w: aw, h: ah, height: wingH };
    } else if (side === 2) {
      const ah = cy + cellH - (b.y + b.h);
      const aw = b.w * along;
      b.arm = { x: b.x + (b.w - aw) * edge, y: b.y + b.h, w: aw, h: ah, height: wingH };
    } else {
      const ah = b.y - cy;
      const aw = b.w * along;
      b.arm = { x: b.x + (b.w - aw) * edge, y: cy, w: aw, h: ah, height: wingH };
    }
  }
  // A rooftop feature on the highest face (the upper tier when there is
  // one, otherwise the base roof).
  const kinds = b.district === 'downtown' ? ['antenna', 'helipad', 'watertower']
    : b.district === 'neon' ? ['ac', 'garden', 'antenna']
    : b.district === 'beachfront' ? ['garden', 'ac']
    : ['ac', 'garden', 'antenna', 'watertower'];
  b.roof = h5 < 0.45 ? null : { kind: kinds[Math.floor(((h5 - 0.45) / 0.55) * kinds.length) % kinds.length], fx: 0.25 + h6 * 0.5, fy: 0.25 + h7 * 0.5 };
}

export function buildCity(rng) {
  const xs = roadCentersX();
  const ys = roadCentersY();
  const half = WORLD.roadWidth / 2;
  const blocks = [];
  const buildings = [];
  const trees = [];
  const lamps = [];
  const boats = [];
  const umbrellas = [];

  const colEdges = [24, ...xs.map((x) => x + half), WORLD.width - 24];
  const colStarts = [24, ...xs.map((x) => x + half)];
  const colEnds = [...xs.map((x) => x - half), WORLD.width - 24];
  const rowStarts = [24, ...ys.map((y) => y + half)];
  const rowEnds = [...ys.map((y) => y - half), WORLD.beachY - 40];
  void colEdges;

  const parkCol = 4;
  const parkRow = 3;
  for (let row = 0; row < rowStarts.length; row += 1) {
    for (let col = 0; col < colStarts.length; col += 1) {
      const bx = colStarts[col];
      const by = rowStarts[row];
      const bw = colEnds[col] - bx;
      const bh = rowEnds[row] - by;
      const district = districtFor(col, row, colStarts.length);
      const block = { x: bx, y: by, w: bw, h: bh, district, buildings: [], park: col === parkCol && row === parkRow };
      blocks.push(block);
      if (block.park) {
        for (let i = 0; i < 16; i += 1) {
          trees.push({ x: bx + rng.range(24, bw - 24), y: by + rng.range(24, bh - 24), r: rng.range(10, 16), palm: false });
        }
        continue;
      }
      if (district === 'marina') {
        // Decorative moored boats: skiff or speedboat by position hash,
        // so no rng is consumed and the marina reads differently per block.
        const pickBoat = (seed) => (hash3(col, row, seed) < 0.5 ? 'skiff' : 'speedboat');
        boats.push({ x: bx + bw * 0.3, y: by + bh * 0.5, angle: 0.4, variant: pickBoat(1) });
        boats.push({ x: bx + bw * 0.7, y: by + bh * 0.3, angle: -0.3, variant: pickBoat(2) });
        continue;
      }
      const count = district === 'downtown' ? 1 : rng.int(2, 5);
      const pad = 14;
      for (let i = 0; i < count; i += 1) {
        const cols = count === 1 ? 1 : 2;
        const rows = count <= 2 ? 1 : 2;
        const cellW = (bw - pad * 2) / cols;
        const cellH = (bh - pad * 2) / rows;
        const cx = bx + pad + (i % cols) * cellW;
        const cy = by + pad + Math.floor(i / cols) * cellH;
        const w = cellW * rng.range(0.62, 0.86);
        const h = cellH * rng.range(0.62, 0.86);
        const tall = district === 'downtown';
        const building = {
          x: cx + (cellW - w) / 2,
          y: cy + (cellH - h) / 2,
          w,
          h,
          height: tall ? rng.range(46, 88) : rng.range(14, 34),
          color: tall ? rng.pick(PALETTE.tower) : rng.pick(PALETTE.building),
          sign: district === 'neon' ? rng.pick(['#ff5d8f', '#00f5d4', '#fee440', '#9b5de5']) : null,
          district,
        };
        // Shape variety, and nothing else: this call spends no rng, so
        // the stream — and every tape, cash drop and staged scene after
        // it — is byte-identical to the build before it.
        varyBuilding(building, col, row, i, cx, cy, cellW, cellH);
        block.buildings.push(building);
        buildings.push(building);
      }
      if (district === 'beachfront') {
        umbrellas.push({ x: bx + bw * 0.5, y: by + bh + 44, color: rng.pick(['#ff5d8f', '#fee440', '#00f5d4']) });
      }
    }
  }

  for (const x of xs) {
    for (const y of ys) lamps.push({ x: x + half + 6, y: y + half + 6 });
  }
  for (let x = 200; x < WORLD.width - 100; x += 170) {
    trees.push({ x: x + rng.range(-20, 20), y: WORLD.beachY + 30, r: 12, palm: true });
  }

  const cashDrops = [];
  for (let i = 0; i < 12; i += 1) {
    const block = blocks[rng.int(0, blocks.length)];
    cashDrops.push({ x: block.x - 20, y: block.y + block.h / 2, taken: false, value: 25 });
  }

  // Tide Tapes: 12 collectibles scattered along the roadsides. Finding them
  // all is a quiet badge of honour — and each one pays a little.
  const tapes = [];
  for (let i = 0; i < 12; i += 1) {
    tapes.push({
      x: rng.pick(xs) + rng.range(-26, 26),
      y: rng.range(120, WORLD.beachY - 120),
      taken: false,
    });
  }

  // No building may stand in the river: drop any footprint the channel
  // cuts. Filtering after generation keeps the seeded stream identical,
  // so only column 6 changes. When the channel cuts an L wing, only the
  // wing goes — the base stays put.
  const baseClear = (b) => b.x + b.w < RIVER.x0 || b.x > RIVER.x1;
  const armClear = (b) => !b.arm || (b.arm.x + b.arm.w < RIVER.x0 || b.arm.x > RIVER.x1);
  for (const block of blocks) {
    block.buildings = block.buildings.filter(baseClear);
    for (const b of block.buildings) if (!armClear(b)) b.arm = null;
  }

  // Two skiffs moored in the river itself (decorative city.boats only —
  // the drivable boats are separate cars out in the bay, so the 39-car
  // and 2-boat counts are untouched). They point along the channel.
  boats.push({ x: 1920, y: 620, angle: Math.PI / 2, variant: 'skiff' });
  boats.push({ x: 1920, y: 1480, angle: Math.PI / 2, variant: 'skiff' });

  // Street props: benches, vendors, billboards, hydrants, lifeguard
  // towers, crates — nought, one or two per block, picked from a
  // position hash, so ZERO rng is consumed and the stream (tapes, cash
  // drops, staged scenes) stays byte-identical to the v8 build. Props
  // sit on the sidewalk band at block corners, never on a road, never
  // inside a building footprint or L arm, never in the river: they are
  // decoration, not collision. Kinds differ by district, so each
  // district reads differently at street level.
  const props = [];
  const DISTRICT_PROPS = {
    downtown: ['billboard', 'bench', 'planter'],
    neon: ['neon-sign', 'vendor', 'bench'],
    beachfront: ['lifeguard', 'bench', 'planter'],
    marina: ['crate', 'dockpost', 'vendor'],
    uptown: ['bench', 'hydrant', 'planter', 'mailbox'],
  };
  const PROP_PAINTS = {
    billboard: ['#e63946', '#4361ee', '#ffb703'],
    'neon-sign': ['#ff5d8f', '#00f5d4', '#fee440', '#9b5de5'],
    vendor: ['#ff5d8f', '#ffb703', '#2a9d8f'],
    bench: ['#8d5524', '#6c757d'],
    planter: ['#2a7d4f', '#40916c'],
    lifeguard: ['#e63946', '#ffb703'],
    crate: ['#8d5524', '#b08968'],
    dockpost: ['#6c757d'],
    hydrant: ['#e63946'],
    mailbox: ['#4361ee'],
    picnic: ['#8d5524'],
  };
  for (const block of blocks) {
    if (block.park) {
      props.push({ kind: 'bench', x: block.x + 10, y: block.y + 10, color: '#8d5524', angle: 0 });
      props.push({ kind: 'picnic', x: block.x + block.w - 10, y: block.y + block.h - 10, color: '#8d5524', angle: 0 });
      continue;
    }
    const menu = DISTRICT_PROPS[block.district] || DISTRICT_PROPS.uptown;
    const density = hash3(block.x, block.y, 7);
    const count = density < 0.3 ? 0 : density < 0.8 ? 1 : 2;
    for (let k = 0; k < count; k += 1) {
      const slot = Math.floor(hash3(block.x, block.y, 9 + k) * 4);
      const x = slot % 2 === 0 ? block.x + 8 : block.x + block.w - 8;
      const y = slot < 2 ? block.y + 8 : block.y + block.h - 8;
      if (x >= RIVER.x0 - 8 && x <= RIVER.x1 + 8 && y < WORLD.beachY) continue;
      const kind = menu[Math.floor(hash3(block.x, block.y, 20 + k) * menu.length)];
      const palette = PROP_PAINTS[kind];
      props.push({ kind, x, y, color: palette[Math.floor(hash3(block.x, block.y, 30 + k) * palette.length)], angle: hash3(block.x, block.y, 40 + k) * Math.PI });
    }
  }

  return {
    xs,
    ys,
    blocks,
    buildings: buildings.filter(baseClear),
    trees,
    lamps,
    boats,
    umbrellas,
    props,
    cashDrops,
    tapes,
    paintShop: { x: 800, y: 480, name: 'Spray Barn' },
    gunShop: { x: 800, y: 1120, name: 'Cielo Arms' },
    property: { x: 2080, y: 1440, name: 'Neon Club', price: 2500, income: 120 },
    safehouse: { x: 2560, y: 1440, name: 'Safehouse' },
    clinic: { x: 1600, y: 480, name: 'Solmaris Clinic' },
    garage: { x: 1120, y: 1440, name: "Dario's Garage" },
    marina: { x: 2960, y: 1760, name: 'Marina Deal' },
    lighthouse: { x: 170, y: 2100, name: 'Old Lighthouse' },
    spawn: { x: 480, y: 400 },
    taxiStands: [
      { x: 480, y: 160 },
      { x: 2080, y: 800 },
      { x: 800, y: 1760 },
      { x: 2720, y: 480 },
    ],
  };
}

/** True when the point sits inside any building footprint — the base
 * rectangle, or one of its L wings. */
export function pointInBuilding(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
    const a = b.arm;
    if (a && x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return true;
  }
  return false;
}

/** Line of sight: true when no building blocks the segment. Sampled every
 * 30 units, so a wall between two points always counts as cover. */
export function hasLineOfSight(city, x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist / 30));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (pointInBuilding(city, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
  }
  return true;
}

/** True when the point sits on a road band (either direction). */
export function isOnRoad(city, x, y) {
  const half = WORLD.roadWidth / 2;
  for (const rx of city.xs) if (Math.abs(x - rx) <= half) return true;
  for (const ry of city.ys) if (Math.abs(y - ry) <= half) return true;
  return false;
}

/** True when the point is in water: the bay (past the curved shoreline)
 * or the river — except on a road band, where the road is a bridge. */
export function isInWater(city, x, y) {
  if (y >= waterYAt(x)) return true;
  if (y < WORLD.beachY && x >= RIVER.x0 && x <= RIVER.x1 && !isOnRoad(city, x, y)) return true;
  return false;
}

/** Push a point out of the water: above the shoreline (the lower of the
 * curved edge and the old straight line, so the straight-line holds the
 * probes assert still stand) and out of the river band when off-road.
 * Returns [x, y]. */
export function dryPoint(city, x, y) {
  const ny = Math.min(y, waterYAt(x) - 14, WORLD.waterY - 14);
  let nx = x;
  if (ny < WORLD.beachY && nx >= RIVER.x0 && nx <= RIVER.x1 && !isOnRoad(city, nx, ny)) {
    nx = nx - RIVER.x0 < RIVER.x1 - nx ? RIVER.x0 - 1 : RIVER.x1 + 1;
  }
  return [nx, ny];
}

/** Push a circle out of every building footprint it overlaps. Base
 * rectangles go first, then their L wings, so a push out of a base can
 * never leave the circle sitting inside the wing. Returns [x, y]. */
export function resolveBuildingCollision(city, x, y, radius) {
  let px = x;
  let py = y;
  const pushOut = (rx, ry, rw, rh) => {
    if (px + radius < rx || px - radius > rx + rw || py + radius < ry || py - radius > ry + rh) return;
    const cx = Math.max(rx, Math.min(px, rx + rw));
    const cy = Math.max(ry, Math.min(py, ry + rh));
    let dx = px - cx;
    let dy = py - cy;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) {
      dy = -1;
      dx = 0;
    } else {
      dx /= dist;
      dy /= dist;
    }
    const push = radius - dist;
    if (push > 0) {
      px += dx * push;
      py += dy * push;
    }
  };
  for (const b of city.buildings) {
    pushOut(b.x, b.y, b.w, b.h);
    if (b.arm) pushOut(b.arm.x, b.arm.y, b.arm.w, b.arm.h);
  }
  px = Math.max(radius, Math.min(WORLD.width - radius, px));
  py = Math.max(radius, Math.min(WORLD.height - radius, py));
  return [px, py];
}

/** A random point on a road, for spawning traffic and police. */
export function randomRoadPoint(city, rng) {
  if (rng.chance(0.5)) {
    return { x: rng.pick(city.xs), y: rng.range(80, WORLD.beachY - 80) };
  }
  return { x: rng.range(80, WORLD.width - 80), y: rng.pick(city.ys) };
}

export function districtNameAt(city, x, y) {
  for (const block of city.blocks) {
    if (x >= block.x - 40 && x <= block.x + block.w + 40 && y >= block.y - 40 && y <= block.y + block.h + 40) {
      if (block.park) return 'Palma Park';
      if (block.district === 'downtown') return 'Downtown Solmaris';
      if (block.district === 'neon') return 'Neon Row';
      if (block.district === 'beachfront') return 'Solmaris Beach';
      if (block.district === 'marina') return 'The Marina';
      return 'Uptown';
    }
  }
  if (y >= WORLD.beachY) return 'Solmaris Beach';
  return 'Solmaris';
}
