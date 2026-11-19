// The DOM HUD and the minimap: wanted stars, health, money, the mission
// objective, the clock, weapon and speed readouts, prompts and toasts. The
// minimap is a small canvas painted from the city itself, with blips for the
// player, the mission marker, police and taxi stands. Text updates are kept
// cheap: only rewritten when the value shown actually changes.
import { HEALTH, PALETTE, VEHICLES, WEAPONS, WORLD, characterById, repTitle, skillLevel } from './config.js';
import { BRIDGE_DECK, RIVER, bridgeCrossings, districtNameAt, waterYAt } from './world.js';
import { MISSION_COUNT, RACE, missionList, missionMarker, objectiveText } from './missions.js';
import { CREW_JOBS, crewJobStartPoints } from './missions.js';
import { playerCar } from './player.js';

function el(id) {
  return document.getElementById(id);
}

/** 100% completion: jobs are half the game, tapes and cash a third,
 * and the rest is winning a race, running a fare, owning the club and
 * solving a random event. */
function completionPercent(state) {
  const jobs = (state.mission.completed.length / MISSION_COUNT) * 50;
  const tapes = (state.progress.tapes / 12) * 20;
  const cash = (state.stats.cashFound / 12) * 10;
  const extra = (state.stats.racesWon > 0 ? 5 : 0) + (state.stats.taxisDone > 0 ? 5 : 0)
    + (state.progress.property ? 5 : 0) + ((state.stats.eventsSolved || 0) > 0 ? 5 : 0);
  return Math.min(100, Math.round(jobs + tapes + cash + extra));
}

export function createHud() {
  const nodes = {
    hud: el('hud'),
    wanted: el('wanted'),
    healthFill: el('healthfill'),
    healthText: el('healthtext'),
    money: el('money'),
    respect: el('respect'),
    radio: el('radio'),
    tapes: el('tapes'),
    armourFill: el('armourfill'),
    armourText: el('armourtext'),
    objectiveText: el('objective-text'),
    clock: el('clock'),
    drive: el('driveinfo'),
    speed: el('speed'),
    carName: el('carname'),
    nosBar: el('nosbar'),
    nosFill: el('nosfill'),
    weaponName: el('weaponname'),
    ammo: el('ammo'),
    snacks: el('snacks'),
    slowmoBar: el('slowmobar'),
    slowmoFill: el('slowmofill'),
    swimBar: el('swimbar'),
    swimFill: el('swimfill'),
    prompt: el('prompt'),
    toast: el('toast'),
    hint: el('hint'),
    district: el('district'),
    heatStatus: el('heatstatus'),
    mapCanvas: el('mapcanvas'),
    mapList: el('maplist'),
    minimap: el('minimap'),
  };
  const mapCtx = nodes.minimap.getContext('2d');
  let mapBase = null;
  let mapCity = null;
  let last = {};
  let toastUntil = 0;
  let districtUntil = 0;

  // Wavy coastline, drawn the same way on the full map and the minimap:
  // the sand band ends at a straight promenade edge, but the water edge
  // follows the shared coast curve (bay + wave), so the maps agree with
  // the ground the game itself draws.
  function drawCoast(ctx, sx, sy, w, h) {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, WORLD.beachY * sy, w, h);
    const waveY = (x) => waterYAt(x / sx) * sy;
    ctx.fillStyle = PALETTE.water;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, waveY(x));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    // Foam line along the water edge.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, sy * 10);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      if (x === 0) ctx.moveTo(x, waveY(x));
      else ctx.lineTo(x, waveY(x));
    }
    ctx.stroke();
  }

  // The river, painted the same way on the full map and the minimap
  // (before the roads, so crossings read as bridges). Sandy banks,
  // deeper water than the bay, a bright centre flow and a white
  // current line.
  function drawRiver(ctx, sx, sy) {
    const top = 24 * sy;
    const bottom = (waterYAt(1920) + 30) * sy;
    const len = bottom - top;
    const cx = ((RIVER.x0 + RIVER.x1) / 2) * sx;
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect((RIVER.x0 - 8) * sx, top, 8 * sx, len);
    ctx.fillRect(RIVER.x1 * sx, top, 8 * sx, len);
    ctx.fillStyle = PALETTE.deepWater;
    ctx.fillRect(RIVER.x0 * sx, top, (RIVER.x1 - RIVER.x0) * sx, len);
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(cx - 16 * sx, top, 32 * sx, len);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(cx - Math.max(0.5, sx), top, Math.max(1, 2 * sx), len);
  }

  // Bridges over the river, painted the same way on the full map and the
  // minimap (after the roads, so the decks sit on top): a deck wider than
  // the road with white rails; the landmark (Coral Boulevard) is a wider
  // gold deck with bowed edges. `detail` adds the rail posts (full map).
  function drawBridges(ctx, city, sx, sy, detail) {
    const bow = 20; // control-point offset; the edge bulges bow/2 at mid-river
    for (const { y, landmark } of bridgeCrossings(city)) {
      const half = landmark ? BRIDGE_DECK.landmark : BRIDGE_DECK.standard;
      const over = landmark ? BRIDGE_DECK.landmarkOverhang : BRIDGE_DECK.overhang;
      const bx0 = (RIVER.x0 - over) * sx;
      const bx1 = (RIVER.x1 + over) * sx;
      const cx = ((RIVER.x0 + RIVER.x1) / 2) * sx;
      const top = (y - half) * sy;
      const bot = (y + half) * sy;
      ctx.fillStyle = landmark ? '#e9c46a' : '#8d8578';
      if (landmark) {
        ctx.beginPath();
        ctx.moveTo(bx0, top);
        ctx.quadraticCurveTo(cx, top - bow * sy, bx1, top);
        ctx.lineTo(bx1, bot);
        ctx.quadraticCurveTo(cx, bot + bow * sy, bx0, bot);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(bx0, top, bx1 - bx0, bot - top);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = Math.max(1, 2 * sy);
      ctx.beginPath();
      if (landmark) {
        ctx.moveTo(bx0, top + 3 * sy);
        ctx.quadraticCurveTo(cx, top - bow * sy + 3 * sy, bx1, top + 3 * sy);
        ctx.moveTo(bx0, bot - 3 * sy);
        ctx.quadraticCurveTo(cx, bot + bow * sy - 3 * sy, bx1, bot - 3 * sy);
      } else {
        ctx.moveTo(bx0, top + 3 * sy);
        ctx.lineTo(bx1, top + 3 * sy);
        ctx.moveTo(bx0, bot - 3 * sy);
        ctx.lineTo(bx1, bot - 3 * sy);
      }
      ctx.stroke();
      ctx.strokeStyle = landmark ? '#4a4a52' : '#e9c46a';
      ctx.lineWidth = Math.max(1, 2 * sy);
      ctx.setLineDash([6 * sy, 5 * sy]);
      ctx.beginPath();
      ctx.moveTo(bx0, y * sy);
      ctx.lineTo(bx1, y * sy);
      ctx.stroke();
      ctx.setLineDash([]);
      if (landmark && detail) {
        ctx.fillStyle = '#fff';
        for (const t of [0.25, 0.5, 0.75]) {
          const px = bx0 + (bx1 - bx0) * t;
          const bulge = 2 * bow * sy * (1 - t) * t;
          ctx.beginPath(); ctx.arc(px, top - bulge + 3 * sy, Math.max(1.5, 2.5 * sy), 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(px, bot + bulge - 3 * sy, Math.max(1.5, 2.5 * sy), 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  function buildMapBase(city) {
    const c = document.createElement('canvas');
    c.width = 188;
    c.height = 188;
    const ctx = c.getContext('2d');
    const sx = 188 / WORLD.width;
    const sy = 188 / WORLD.height;
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, 188, 188);
    drawCoast(ctx, sx, sy, 188, 188);
    drawRiver(ctx, sx, sy);
    ctx.fillStyle = PALETTE.asphalt;
    for (const x of city.xs) ctx.fillRect(x * sx - 2, 0, 4, 188);
    for (const y of city.ys) ctx.fillRect(0, y * sy - 2, 188, 4);
    drawBridges(ctx, city, sx, sy, false);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (const b of city.buildings) {
      ctx.fillRect(b.x * sx, b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
      // An L wing reads on the minimap too, so the footprint matches the city.
      if (b.arm) ctx.fillRect(b.arm.x * sx, b.arm.y * sy, Math.max(1, b.arm.w * sx), Math.max(1, b.arm.h * sy));
    }
    return c;
  }

  function setText(node, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  function drawMinimap(state) {
    if (!mapBase || mapCity !== state.city) {
      mapBase = buildMapBase(state.city);
      mapCity = state.city;
    }
    // Round minimap, GTA-style: clip the whole paint to the inscribed
    // circle of the 188x188 canvas (the CSS ring is round too).
    mapCtx.save();
    mapCtx.beginPath();
    mapCtx.arc(94, 94, 94, 0, Math.PI * 2);
    mapCtx.clip();
    mapCtx.drawImage(mapBase, 0, 0);
    const sx = 188 / WORLD.width;
    const sy = 188 / WORLD.height;
    // Search area: while the police have lost sight of Lena, the
    // minimap shows the circle they are searching around her last seen spot.
    if (state.wanted.level > 0 && !state.wanted.seen && state.wanted.lastSeen) {
      const lx = state.wanted.lastSeen.x * sx;
      const ly = state.wanted.lastSeen.y * sy;
      const r = 400 * sx;
      mapCtx.fillStyle = 'rgba(255, 107, 107, 0.10)';
      mapCtx.strokeStyle = 'rgba(255, 107, 107, 0.55)';
      mapCtx.lineWidth = 1.5;
      mapCtx.setLineDash([5, 4]);
      mapCtx.beginPath();
      mapCtx.arc(lx, ly, r, 0, Math.PI * 2);
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.setLineDash([]);
    }
    // North marker: the minimap is north-up, so say so.
    mapCtx.fillStyle = 'rgba(255,255,255,0.85)';
    mapCtx.font = '800 11px "Avenir Next", "Segoe UI", system-ui, sans-serif';
    mapCtx.textAlign = 'center';
    mapCtx.fillText('N', 94, 12);
    for (const stand of state.city.taxiStands) {
      mapCtx.fillStyle = '#219ebc';
      mapCtx.fillRect(stand.x * sx - 3, stand.y * sy - 3, 6, 6);
    }
    mapCtx.fillStyle = '#fb8500';
    mapCtx.fillRect(state.city.paintShop.x * sx - 3, state.city.paintShop.y * sy - 3, 6, 6);
    mapCtx.fillStyle = '#2a9d8f';
    mapCtx.fillRect(state.city.gunShop.x * sx - 3, state.city.gunShop.y * sy - 3, 6, 6);
    mapCtx.fillStyle = '#ffd60a';
    mapCtx.fillRect(state.city.property.x * sx - 3, state.city.property.y * sy - 3, 6, 6);
    if (!state.race.active) {
      mapCtx.fillStyle = '#9b5de5';
      mapCtx.fillRect(RACE.start.x * sx - 4, RACE.start.y * sy - 4, 8, 8);
      mapCtx.strokeStyle = '#fff';
      mapCtx.lineWidth = 1;
      mapCtx.strokeRect(RACE.start.x * sx - 4, RACE.start.y * sy - 4, 8, 8);
    }
    // Crew-job starts: gold squares on the minimap, drawn like the race
    // start so a player can spot the next job at a glance.
    const gold = '#ffb703';
    for (const p of crewJobStartPoints(state)) {
      mapCtx.fillStyle = gold;
      mapCtx.fillRect(p.x * sx - 4, p.y * sy - 4, 8, 8);
      mapCtx.strokeStyle = '#fff';
      mapCtx.lineWidth = 1;
      mapCtx.strokeRect(p.x * sx - 4, p.y * sy - 4, 8, 8);
    }
    const marker = missionMarker(state);
    if (marker) {
      // GPS route: dashed line from the player to the marker, snapped to
      // the road grid (Manhattan along the nearest roads).
      const nearestOn = (v, list) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), list[0]);
      const ry = nearestOn(state.player.y, state.city.ys);
      const rx = nearestOn(marker.x, state.city.xs);
      mapCtx.strokeStyle = 'rgba(255, 183, 3, 0.9)';
      mapCtx.lineWidth = 2;
      mapCtx.setLineDash([4, 3]);
      mapCtx.beginPath();
      mapCtx.moveTo(state.player.x * sx, state.player.y * sy);
      mapCtx.lineTo(state.player.x * sx, ry * sy);
      mapCtx.lineTo(rx * sx, ry * sy);
      mapCtx.lineTo(rx * sx, marker.y * sy);
      mapCtx.lineTo(marker.x * sx, marker.y * sy);
      mapCtx.stroke();
      mapCtx.setLineDash([]);
      const pulse = 5 + Math.sin(state.time * 4) * 1.5;
      mapCtx.fillStyle = '#ffb703';
      mapCtx.strokeStyle = '#fff';
      mapCtx.lineWidth = 2;
      mapCtx.beginPath();
      mapCtx.arc(marker.x * sx, marker.y * sy, pulse, 0, Math.PI * 2);
      mapCtx.fill();
      mapCtx.stroke();
    }
    for (const car of state.cars) {
      if (car.driver !== 'police') continue;
      // Vision cone: the wedge the cruiser can actually see down.
      mapCtx.fillStyle = 'rgba(67, 97, 238, 0.16)';
      mapCtx.beginPath();
      mapCtx.moveTo(car.x * sx, car.y * sy);
      mapCtx.arc(car.x * sx, car.y * sy, 300 * sx, car.angle - 0.5, car.angle + 0.5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.fillStyle = '#4361ee';
      mapCtx.beginPath();
      mapCtx.arc(car.x * sx, car.y * sy, 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Officers on foot (and SWAT): small dots so the player can see the
    // hunt coming, not just the cars.
    for (const ped of state.peds) {
      if (ped.kind !== 'cop' || ped.down > 0) continue;
      mapCtx.fillStyle = ped.swat ? '#2b2d42' : '#4361ee';
      mapCtx.beginPath();
      mapCtx.arc(ped.x * sx, ped.y * sy, 2.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Random-event thief: a pulsing orange blip to chase.
    if (state.randomEvent && state.randomEvent.active && state.randomEvent.ped) {
      const thief = state.randomEvent.ped;
      const pulse = 4 + Math.sin(state.time * 6) * 1.5;
      mapCtx.fillStyle = '#ff7b00';
      mapCtx.beginPath();
      mapCtx.arc(thief.x * sx, thief.y * sy, pulse, 0, Math.PI * 2);
      mapCtx.fill();
    }
    if (state.heli) {
      // Police helicopter: a cyan rotor cross, distinct from cruiser blips.
      const hx = state.heli.x * sx;
      const hy = state.heli.y * sy;
      mapCtx.strokeStyle = '#00f5d4';
      mapCtx.lineWidth = 2;
      mapCtx.beginPath();
      mapCtx.arc(hx, hy, 5, 0, Math.PI * 2);
      mapCtx.stroke();
      const r = state.heli.rotor || 0;
      mapCtx.beginPath();
      mapCtx.moveTo(hx - Math.cos(r) * 7, hy - Math.sin(r) * 7);
      mapCtx.lineTo(hx + Math.cos(r) * 7, hy + Math.sin(r) * 7);
      mapCtx.stroke();
      mapCtx.fillStyle = '#00f5d4';
      mapCtx.beginPath();
      mapCtx.arc(hx, hy, 2, 0, Math.PI * 2);
      mapCtx.fill();
    }
    const player = state.player;
    // Player arrow: a triangle that rotates with the heading, white
    // outline so it reads at a glance. Hidden: the arrow turns grey
    // while the police are searching — the same signal GTA uses.
    const hidden = state.wanted.level > 0 && !state.wanted.seen;
    mapCtx.save();
    mapCtx.translate(player.x * sx, player.y * sy);
    mapCtx.rotate(player.angle);
    mapCtx.beginPath();
    mapCtx.moveTo(8, 0);
    mapCtx.lineTo(-6, -5);
    mapCtx.lineTo(-6, 5);
    mapCtx.closePath();
    mapCtx.fillStyle = hidden ? '#9a9a9a' : '#e63946';
    mapCtx.fill();
    mapCtx.lineWidth = 1.5;
    mapCtx.strokeStyle = '#fff';
    mapCtx.stroke();
    mapCtx.restore();
    mapCtx.restore(); // un-clip the round minimap
  }

  return {
    show() {
      nodes.hud.classList.remove('hidden');
    },
    hide() {
      nodes.hud.classList.add('hidden');
    },
    /** Full city map: districts, markers, job list and progress. */
    renderMap(state) {
      const canvas = nodes.mapCanvas;
      const ctx = canvas.getContext('2d');
      const s = 560 / WORLD.width;
      ctx.fillStyle = PALETTE.grass;
      ctx.fillRect(0, 0, 560, 420);
      drawCoast(ctx, s, s, 560, 420);
      drawRiver(ctx, s, s);
      for (const b of state.city.blocks) {
        ctx.fillStyle = b.park ? PALETTE.park : b.district === 'marina' ? PALETTE.water : PALETTE.sidewalk;
        ctx.fillRect(b.x * s, b.y * s, b.w * s, b.h * s);
      }
      // District tints: a faint wash per district so the blocks are not
      // one flat beige — downtown cool, Neon Row pink, beachfront sandy.
      const DISTRICT_TINT = { downtown: 'rgba(142,202,230,0.20)', neon: 'rgba(255,93,143,0.16)', beachfront: 'rgba(242,212,146,0.28)', marina: 'rgba(18,103,130,0.25)', uptown: 'rgba(255,255,255,0.04)' };
      for (const b of state.city.blocks) {
        if (b.park) continue;
        const tint = DISTRICT_TINT[b.district];
        if (!tint) continue;
        ctx.fillStyle = tint;
        ctx.fillRect(b.x * s, b.y * s, b.w * s, b.h * s);
      }
      ctx.fillStyle = PALETTE.asphalt;
      for (const x of state.city.xs) ctx.fillRect(x * s - 2, 0, 4, 420);
      for (const y of state.city.ys) ctx.fillRect(0, y * s - 2, 560, 4);
      drawBridges(ctx, state.city, s, s, true);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (const b of state.city.buildings) {
        ctx.fillRect(b.x * s, b.y * s, Math.max(1, b.w * s), Math.max(1, b.h * s));
        // An L wing reads on the full map too, so the footprint matches the city.
        if (b.arm) ctx.fillRect(b.arm.x * s, b.arm.y * s, Math.max(1, b.arm.w * s), Math.max(1, b.arm.h * s));
      }
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '800 13px "Avenir Next", "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      const labels = [
        ['DOWNTOWN', 2720, 800], ['NEON ROW', 640, 1440], ['SOLMARIS BEACH', 1600, 2160],
        ['THE MARINA', 2900, 1600], ['UPTOWN', 1600, 480], ['PALMA PARK', 1600, 1280],
      ];
      for (const [t, x, y] of labels) ctx.fillText(t, x * s, y * s);
      // Street names: the east-west roads and four north-south roads, in
      // the same invented names the HUD flavour text uses. A dark underlay
      // keeps the white text readable on the asphalt.
      ctx.font = '700 9px "Avenir Next", "Segoe UI", system-ui, sans-serif';
      const roadName = (text, x, y) => {
        ctx.fillStyle = 'rgba(30,30,40,0.85)';
        ctx.fillText(text, x + 1, y + 1);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(text, x, y);
      };
      const hNames = ['Palma Avenue', 'Sunset Row', 'Coral Boulevard', 'Marina Drive', 'Cielo Street', 'Mango Lane'];
      state.city.ys.forEach((y, i) => {
        ctx.textAlign = 'left';
        roadName(hNames[i % hNames.length], 8, y * s + 3);
      });
      const vNames = { 480: 'Harbor Way', 1120: 'Flamingo Road', 2080: 'Sol Street', 2720: 'Bayview Terrace' };
      for (const [x, name] of Object.entries(vNames)) {
        ctx.save();
        ctx.translate(Number(x) * s - 4, 8);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = 'left';
        roadName(name, 0, 0);
        ctx.restore();
      }
      // The landmark bridge, named on the map so it reads as the feature
      // it is: the gold deck the cover chase drives over.
      ctx.textAlign = 'center';
      roadName('CORAL BRIDGE', 1920 * s, 720 * s);
      const dot = (x, y, color, r) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x * s, y * s, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };
      dot(state.city.safehouse.x, state.city.safehouse.y, '#f4a261', 5);
      dot(state.city.gunShop.x, state.city.gunShop.y, '#2a9d8f', 5);
      dot(state.city.paintShop.x, state.city.paintShop.y, '#fb8500', 5);
      dot(state.city.property.x, state.city.property.y, '#ffd60a', 5);
      dot(RACE.start.x, RACE.start.y, '#9b5de5', 5);
      for (const st of state.city.taxiStands) dot(st.x, st.y, '#219ebc', 3);
      const marker = missionMarker(state);
      if (marker) dot(marker.x, marker.y, '#ffb703', 6);
      // Player arrow: a triangle that rotates with the heading, thick
      // white outline so it reads at a glance; grey while hidden, the
      // same signal as the minimap.
      const hidden = state.wanted.level > 0 && !state.wanted.seen;
      ctx.save();
      ctx.translate(state.player.x * s, state.player.y * s);
      ctx.rotate(state.player.angle);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.fillStyle = hidden ? '#9a9a9a' : '#e63946';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
      ctx.font = '700 11px "Avenir Next", "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      const legend = [['#ffb703', 'Mission'], ['#219ebc', 'Taxi'], ['#2a9d8f', 'Gun shop'], ['#fb8500', 'Spray Barn'], ['#9b5de5', 'Street race'], ['#f4a261', 'Safehouse'], ['#ffd60a', 'Neon Club']];
      let lx = 8;
      for (const [c, t] of legend) {
        ctx.fillStyle = c;
        ctx.fillRect(lx, 404, 10, 10);
        ctx.fillStyle = '#fff';
        ctx.fillText(t, lx + 13, 413);
        lx += 13 + ctx.measureText(t).width + 14;
      }
      const jobs = missionList(state.city);
      let html = `<div><b>${characterById(state.character).name.toUpperCase()} · RESPECT ${state.progress.rep} — ${repTitle(state.progress.rep).toUpperCase()}</b></div>`;
      html += `<div>TAPES ${state.progress.tapes}/12 · RACES WON ${state.stats.racesWon} · $${state.player.money.toLocaleString('en-US')}</div>`;
      html += `<div>DRIVING Lv ${skillLevel(state.progress.driving, 'driving')} · SHOOTING Lv ${skillLevel(state.progress.shooting, 'shooting')} · STAMINA Lv ${skillLevel(state.progress.stamina, 'stamina')}</div>`;
      html += `<div>COMPLETION ${completionPercent(state)}% · EVENTS SOLVED ${state.stats.eventsSolved || 0}${state.progress.property ? ' · NEON CLUB ✓' : ''}</div><hr>`;
      jobs.forEach((job, i) => {
        const done = state.mission.completed.includes(i);
        const mark = done ? '✓' : i === state.mission.index ? '►' : '·';
        const cls = done ? 'done' : i === state.mission.index ? 'current' : '';
        const medal = state.progress.medals[i] ? ` ★ ${state.progress.medals[i].toUpperCase()}` : '';
        const replay = done ? ` <button type="button" data-replay="${i}">↻ Replay</button>` : '';
        html += `<div class="${cls}">${mark} ${i + 1}. ${job.title} — $${job.reward}${medal}${replay}</div>`;
      });
      // The crew board: four jobs, each tagged with the crew member who
      // runs it. Locked until the safehouse (three story jobs done).
      const lockNote = state.progress.safehouse ? '' : ' — UNLOCK AFTER 3 STORY JOBS';
      html += `<hr><div><b>CREW JOBS</b>${lockNote}</div>`;
      CREW_JOBS.forEach((job, i) => {
        const done = state.crewJob.done.includes(i);
        const active = state.crewJob.active && state.crewJob.index === i;
        const mark = done ? '✓' : active ? '►' : '·';
        const cls = done ? 'done' : active ? 'current' : '';
        html += `<div class="${cls}">${mark} ${job.title} — $${job.reward} (${characterById(job.crew).name})</div>`;
      });
      nodes.mapList.innerHTML = html;
    },
    toast(text, seconds) {
      nodes.toast.textContent = text;
      nodes.toast.classList.remove('hidden');
      toastUntil = performance.now() + (seconds || 3.2) * 1000;
    },
    prompt(text) {
      if (text) {
        nodes.prompt.textContent = text;
        nodes.prompt.classList.remove('hidden');
      } else {
        nodes.prompt.classList.add('hidden');
      }
    },
    update(state, promptText, radioLabel) {
      const player = state.player;
      // Six stars in HEAT (five lit + one red), five otherwise.
      const shown = state.wanted.level + (state.wanted.heat ? 1 : 0);
      const total = state.wanted.heat ? 6 : 5;
      const stars = '★'.repeat(shown) + '☆'.repeat(total - shown);
      if (last.stars !== stars) {
        last.stars = stars;
        nodes.wanted.innerHTML = '';
        for (let i = 0; i < total; i += 1) {
          const span = document.createElement('span');
          span.textContent = '★';
          span.className = i < shown ? 'lit' : 'dim';
          if (state.wanted.heat && i === total - 1) span.classList.add('heat');
          nodes.wanted.appendChild(span);
        }
      }
      // Blinking stars: while the police have lost sight of Lena the
      // lit stars blink — the most iconic wanted signal in the genre.
      const blinkOff = state.wanted.level > 0 && !state.wanted.seen && Math.floor(state.time * 2) % 2 === 0;
      if (last.blinkOff !== blinkOff) {
        last.blinkOff = blinkOff;
        for (const span of nodes.wanted.children) {
          if (span.classList.contains('lit')) span.classList.toggle('blink', blinkOff);
        }
      }
      const pct = Math.max(0, Math.round((player.health / HEALTH.max) * 100));
      if (last.health !== pct) {
        last.health = pct;
        nodes.healthFill.style.width = `${pct}%`;
        nodes.healthText.textContent = `HEALTH ${pct}`;
      }
      // Police phase: HEAT at the sixth star, SEARCHING while a unit has
      // eyes on Lena, HIDDEN while the heat is cooling down unseen.
      const heat = state.wanted.heat ? '● HEAT' : state.wanted.level > 0 ? (state.wanted.seen ? '● SEARCHING' : '○ HIDDEN') : '';
      setText(nodes.heatStatus, 'heat', heat);
      nodes.heatStatus.style.color = state.wanted.heat ? '#ff2e2e' : state.wanted.seen ? '#ff6b6b' : '#8ecae6';
      const armourPct = Math.max(0, Math.round(player.armour || 0));
      if (last.armour !== armourPct) {
        last.armour = armourPct;
        nodes.armourFill.style.width = `${armourPct}%`;
        nodes.armourText.textContent = armourPct > 0 ? `ARMOUR ${armourPct}` : '';
      }
      setText(nodes.money, 'money', `$${player.money.toLocaleString('en-US')}`);
      const district = districtNameAt(state.city, player.x, player.y);
      setText(nodes.respect, 'respect', `${characterById(state.character).name.toUpperCase()} · ${district.toUpperCase()} · REP ${state.progress.rep} ${repTitle(state.progress.rep).toUpperCase()} · ${state.stats.missionsDone}/${MISSION_COUNT} JOBS`);
      if (radioLabel) setText(nodes.radio, 'radio', radioLabel);
      setText(nodes.tapes, 'tapes', `TAPES ${state.progress.tapes}/12`);
      if (last.district !== district) {
        last.district = district;
        nodes.district.textContent = `— ${district.toUpperCase()} —`;
        nodes.district.classList.remove('hidden');
        // Six seconds, not 2.6: the banner is the district's introduction,
        // and a slow screenshot paint used to eat it before the capture.
        districtUntil = performance.now() + 6000;
      }
      if (districtUntil && performance.now() > districtUntil) {
        nodes.district.classList.add('hidden');
        districtUntil = 0;
      }
      setText(nodes.objectiveText, 'objective', objectiveText(state));
      const hours = Math.floor(state.clockMinutes / 60);
      const minutes = Math.floor(state.clockMinutes % 60);
      setText(nodes.clock, 'clock', `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
      const car = playerCar(state);
      if (car) {
        nodes.drive.classList.remove('hidden');
        setText(nodes.speed, 'speed', String(Math.round(Math.abs(car.speed) * 0.36)));
        setText(nodes.carName, 'carname', VEHICLES[car.kind].name.toUpperCase());
        nodes.nosBar.classList.remove('hidden');
        nodes.nosFill.style.width = `${Math.max(0, Math.round(car.nos || 0))}%`;
      } else {
        nodes.drive.classList.add('hidden');
      }
      const weapon = WEAPONS[player.weapon];
      setText(nodes.weaponName, 'weapon', weapon.name);
      setText(nodes.ammo, 'ammo', player.weapon === 'fists' ? '' : `${player.mag[player.weapon]} / ${player.ammo[player.weapon]}`);
      setText(nodes.snacks, 'snacks', (player.snacks || 0) > 0 ? `SNACKS ${player.snacks} (G)` : '');
      // Slow-mo meter: drains while the world runs slow, refills at rest.
      const sm = state.slowmo || { meter: 100, active: false };
      nodes.slowmoFill.style.width = `${Math.max(0, Math.round(sm.meter))}%`;
      nodes.slowmoBar.classList.toggle('active', sm.active);
      // Stamina bar: only in the water, where the tank is the timer.
      const swimming = !!player.swimming;
      nodes.swimBar.classList.toggle('hidden', !swimming);
      if (swimming) nodes.swimFill.style.width = `${Math.max(0, Math.round(player.stamina || 0))}%`;
      this.prompt(promptText);
      if (toastUntil && performance.now() > toastUntil) {
        nodes.toast.classList.add('hidden');
        toastUntil = 0;
      }
      if (state.time - (last.hintAt || 0) > 14) {
        nodes.hint.style.opacity = '0.35';
      }
      drawMinimap(state);
    },
  };
}
