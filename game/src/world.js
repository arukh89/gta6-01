// The city of Solmaris: a road grid, blocks of buildings, a park, a neon
// district, downtown towers, a beach promenade and a marina. Everything is
// generated from the seeded stream, so the same seed builds the same streets.
// Collision is circle-versus-building-footprint, checked block by block.
import { PALETTE, WORLD } from './config.js';

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
  if (col >= 7 && row >= 1 && row <= 3) return 'downtown';
  if (col <= 3 && row >= 4 && row <= 5) return 'neon';
  if (row === 6) return 'beachfront';
  if (col === cols - 1 && row >= 4) return 'marina';
  return 'uptown';
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
        boats.push({ x: bx + bw * 0.3, y: by + bh * 0.5, angle: 0.4 });
        boats.push({ x: bx + bw * 0.7, y: by + bh * 0.3, angle: -0.3 });
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

  return {
    xs,
    ys,
    blocks,
    buildings,
    trees,
    lamps,
    boats,
    umbrellas,
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

/** True when the point sits inside any building footprint. */
export function pointInBuilding(city, x, y) {
  for (const b of city.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
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

/** Push a circle out of every building footprint it overlaps. Returns [x, y]. */
export function resolveBuildingCollision(city, x, y, radius) {
  let px = x;
  let py = y;
  for (const b of city.buildings) {
    if (px + radius < b.x || px - radius > b.x + b.w || py + radius < b.y || py - radius > b.y + b.h) continue;
    const cx = Math.max(b.x, Math.min(px, b.x + b.w));
    const cy = Math.max(b.y, Math.min(py, b.y + b.h));
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
