// Drawing only: the city, the cars, the people and the light. The static
// ground (grass, roads, beach, water) is painted once to an offscreen canvas;
// buildings, vehicles and pedestrians are drawn each frame sorted by depth,
// so a car passing a tall tower reads as passing behind its face. Warm light,
// long shadows and a dusk tint carry the sun-soaked look.
import { FONT, PALETTE, VEHICLES, WORLD } from './config.js';
import { RACE, missionMarker } from './missions.js';
import { playerCar } from './player.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function buildGround(city) {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD.width;
  canvas.height = WORLD.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  for (const block of city.blocks) {
    if (block.park) {
      ctx.fillStyle = PALETTE.park;
      ctx.fillRect(block.x - 26, block.y - 26, block.w + 52, block.h + 52);
    } else if (block.district === 'marina') {
      ctx.fillStyle = PALETTE.water;
      ctx.fillRect(block.x - 26, block.y - 26, block.w + 52, block.h + 52);
      ctx.fillStyle = PALETTE.deepWater;
      ctx.fillRect(block.x - 26, block.y + block.h * 0.4, block.w + 52, block.h * 0.6);
    } else {
      ctx.fillStyle = PALETTE.sidewalk;
      ctx.fillRect(block.x - 26, block.y - 26, block.w + 52, block.h + 52);
    }
  }
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(0, WORLD.beachY, WORLD.width, WORLD.height - WORLD.beachY);
  ctx.fillStyle = PALETTE.water;
  ctx.fillRect(0, WORLD.waterY, WORLD.width, WORLD.height - WORLD.waterY);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 3;
  for (let x = 0; x < WORLD.width; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, WORLD.waterY + 14);
    ctx.quadraticCurveTo(x + 22, WORLD.waterY + 6, x + 45, WORLD.waterY + 14);
    ctx.stroke();
  }
  ctx.fillStyle = PALETTE.asphalt;
  const half = WORLD.roadWidth / 2;
  for (const x of city.xs) ctx.fillRect(x - half, 0, WORLD.roadWidth, WORLD.beachY);
  for (const y of city.ys) ctx.fillRect(0, y - half, WORLD.width, WORLD.roadWidth);
  ctx.strokeStyle = PALETTE.asphaltLine;
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  for (const x of city.xs) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.beachY);
    ctx.stroke();
  }
  for (const y of city.ys) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (const x of city.xs) {
    for (const y of city.ys) {
      for (let i = -1; i <= 1; i += 1) {
        ctx.fillRect(x - half + 8, y + i * 18 - 4, 10, 8);
        ctx.fillRect(x + half - 18, y + i * 18 - 4, 10, 8);
      }
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `700 22px ${FONT}`;
  ctx.textAlign = 'center';
  const labels = [
    ['PALMA AVENUE', city.xs[1], 1200],
    ['CORAL BOULEVARD', city.xs[5], 700],
    ['MARINA DRIVE', 1700, city.ys[5]],
    ['SUNSET ROW', 900, city.ys[3]],
  ];
  for (const [text, x, y] of labels) ctx.fillText(text, x, y);
  return canvas;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 1280, h: 720, dpr: 1 };
  let ground = null;
  let groundCity = null;

  function resize() {
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  function clampedCamera(state) {
    const cam = state.camera;
    const halfW = Math.min(view.w / 2, WORLD.width / 2);
    const halfH = Math.min(view.h / 2, WORLD.height / 2);
    return {
      x: Math.max(halfW, Math.min(WORLD.width - halfW, cam.x)),
      y: Math.max(halfH, Math.min(WORLD.height - halfH, cam.y)),
    };
  }

  function toWorld(sx, sy, state) {
    const cam = clampedCamera(state);
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    return { x: sx - view.w / 2 + cam.x + shakeX, y: sy - view.h / 2 + cam.y + shakeY };
  }

  function drawBuilding(b, time) {
    const lift = b.height * 0.58;
    ctx.fillStyle = PALETTE.shadow;
    ctx.fillRect(b.x + 9, b.y + 9, b.w, b.h);
    ctx.fillStyle = shade(b.color, -42);
    ctx.fillRect(b.x, b.y + b.h - lift * 0.55, b.w, lift * 0.55);
    ctx.fillStyle = shade(b.color, -24);
    ctx.fillRect(b.x + b.w - lift * 0.4, b.y, lift * 0.4, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y - lift * 0.55, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y - lift * 0.55, b.w, b.h);
    ctx.fillStyle = shade(b.color, -14);
    ctx.fillRect(b.x + b.w * 0.32, b.y - lift * 0.55 + b.h * 0.3, b.w * 0.22, b.h * 0.24);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    const cols = Math.max(1, Math.floor(b.w / 26));
    const rows = Math.max(1, Math.floor(b.h / 26));
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        if ((i + j) % 2 === 0) ctx.fillRect(b.x + 8 + i * 26, b.y - lift * 0.55 + 8 + j * 26, 12, 10);
      }
    }
    if (b.sign) {
      const glow = 0.6 + 0.4 * Math.sin(time * 3 + b.x);
      ctx.fillStyle = b.sign;
      ctx.globalAlpha = glow;
      ctx.fillRect(b.x + b.w * 0.2, b.y + b.h - 6, b.w * 0.6, 8);
      ctx.globalAlpha = 1;
    }
  }

  function drawTree(tree) {
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(tree.x + 5, tree.y + 6, tree.r, tree.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (tree.palm) {
      ctx.strokeStyle = '#8d5524';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tree.x, tree.y);
      ctx.lineTo(tree.x + 3, tree.y - 14);
      ctx.stroke();
      ctx.strokeStyle = '#2a9d8f';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(tree.x + 3, tree.y - 14);
        ctx.quadraticCurveTo(tree.x + 3 + Math.cos(a) * 12, tree.y - 20, tree.x + 3 + Math.cos(a) * 20, tree.y - 10 + Math.sin(a) * 6);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#2a7d4f';
      ctx.beginPath();
      ctx.arc(tree.x, tree.y - 6, tree.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#40916c';
      ctx.beginPath();
      ctx.arc(tree.x - 4, tree.y - 10, tree.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCar(car, state, isPlayer) {
    const spec = VEHICLES[car.kind];
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(3, 5, spec.length / 2, spec.width / 2 + 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // A boat has no wheels: a hull, a white deck stripe and a red cabin.
    if (car.kind !== 'boat') {
      ctx.fillStyle = '#222';
      const wl = spec.length * 0.32;
      const ww = spec.width / 2 + 2;
      ctx.fillRect(-wl, -ww - 2, 10, 5);
      ctx.fillRect(wl - 10, -ww - 2, 10, 5);
      ctx.fillRect(-wl, ww - 3, 10, 5);
      ctx.fillRect(wl - 10, ww - 3, 10, 5);
    }
    ctx.fillStyle = car.color;
    roundRect(ctx, -spec.length / 2, -spec.width / 2, spec.length, spec.width, 8);
    ctx.fill();
    if (car.kind === 'boat') {
      ctx.fillStyle = '#e63946';
      roundRect(ctx, -spec.length * 0.18, -spec.width / 2 + 4, spec.length * 0.28, spec.width - 8, 5);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, spec.length * 0.08, -spec.width / 2 + 3, spec.length * 0.22, spec.width - 6, 4);
    ctx.fill();
    ctx.fillStyle = shade(car.color, -30);
    roundRect(ctx, -spec.length * 0.28, -spec.width / 2 + 4, spec.length * 0.3, spec.width - 8, 5);
    ctx.fill();
    if (car.kind !== 'boat') {
      ctx.fillStyle = '#fff8d6';
      ctx.fillRect(spec.length / 2 - 4, -spec.width / 2 + 4, 4, 5);
      ctx.fillRect(spec.length / 2 - 4, spec.width / 2 - 9, 4, 5);
      ctx.fillStyle = '#e63946';
      ctx.fillRect(-spec.length / 2, -spec.width / 2 + 4, 4, 5);
      ctx.fillRect(-spec.length / 2, spec.width / 2 - 9, 4, 5);
    }
    if (car.kind === 'taxi') {
      ctx.fillStyle = '#111';
      ctx.fillRect(-6, -5, 14, 10);
      ctx.fillStyle = '#ffb703';
      ctx.font = `800 8px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', 1, 3);
    }
    if (car.kind === 'police') {
      const flash = Math.floor(state.time * 6) % 2 === 0;
      ctx.fillStyle = flash ? '#e63946' : '#4361ee';
      ctx.fillRect(-8, -spec.width / 2 + 2, 16, 7);
      ctx.fillStyle = flash ? '#4361ee' : '#e63946';
      ctx.fillRect(-8, spec.width / 2 - 9, 16, 7);
      ctx.fillStyle = '#fff';
      ctx.font = `800 9px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('PD', 0, 3);
    }
    if (car.health < 50) {
      ctx.fillStyle = 'rgba(40,40,40,0.45)';
      roundRect(ctx, -spec.length / 2, -spec.width / 2, spec.length * 0.4, spec.width, 8);
      ctx.fill();
    }
    ctx.restore();
    if (isPlayer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(car.x, car.y, spec.length / 2 + 8, spec.width / 2 + 10, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPerson(ped, isPlayer, time) {
    const bob = Math.sin(ped.phase || 0) * 1.5;
    // A jump lifts the body off its ground shadow; cover crouches
    // it behind a dark wall line.
    const lift = (ped.z || 0) * 0.6;
    // A swimmer sits low in the water: smaller body, ringed by the bay.
    const bodyR = ped.cover ? 8 : ped.swimming ? 7 : 10;
    // A dead body fades out over its last two seconds on the street.
    const deadFade = ped.dead ? Math.max(0, Math.min(1, ped.down / 2)) : 1;
    if (deadFade < 1) ctx.globalAlpha = deadFade;
    ctx.fillStyle = PALETTE.shadow;
    ctx.beginPath();
    ctx.ellipse(ped.x + 3, ped.y + 7, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (ped.down > 0) {
      ctx.fillStyle = ped.shirt;
      ctx.beginPath();
      ctx.ellipse(ped.x, ped.y, 13, 7, ped.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ped.skin;
      ctx.beginPath();
      ctx.arc(ped.x + Math.cos(ped.angle) * 12, ped.y + Math.sin(ped.angle) * 12, 5, 0, Math.PI * 2);
      ctx.fill();
      if (deadFade < 1) ctx.globalAlpha = 1;
      return;
    }
    if (ped.cover) {
      ctx.strokeStyle = 'rgba(40,40,40,0.85)';
      ctx.lineWidth = 5;
      const px = Math.cos(ped.cover.angle + Math.PI / 2);
      const py = Math.sin(ped.cover.angle + Math.PI / 2);
      const bx = ped.x - Math.cos(ped.cover.angle) * 14;
      const by = ped.y - Math.sin(ped.cover.angle) * 14;
      ctx.beginPath();
      ctx.moveTo(bx - px * 16, by - py * 16);
      ctx.lineTo(bx + px * 16, by + py * 16);
      ctx.stroke();
    }
    ctx.fillStyle = ped.shirt;
    ctx.beginPath();
    ctx.arc(ped.x, ped.y - lift + bob * 0.3, bodyR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(ped.x, ped.y - 2 - lift + bob * 0.3, 6, 0, Math.PI * 2);
    ctx.fill();
    if (ped.swimming) {
      ctx.strokeStyle = 'rgba(33, 158, 188, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(ped.x, ped.y + 4, 14, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (ped.kind === 'cop') {
      ctx.fillStyle = '#14213d';
      ctx.beginPath();
      ctx.arc(ped.x, ped.y - 4 - lift + bob * 0.3, 6, Math.PI, Math.PI * 2);
      ctx.fill();
    }
    if (isPlayer) {
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      ctx.arc(ped.x, ped.y - 4 - lift + bob * 0.3, 6, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ped.x, ped.y - lift, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ped.x, ped.y - lift);
      ctx.lineTo(ped.x + Math.cos(ped.angle) * 22, ped.y - lift + Math.sin(ped.angle) * 22);
      ctx.stroke();
    }
    if (deadFade < 1) ctx.globalAlpha = 1;
    void time;
  }

  function drawHeli(state) {
    const heli = state.heli;
    if (!heli) return;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(heli.x + 40, heli.y + 50, 26, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    const mins = state.clockMinutes;
    const nightF = state.dusk ? 0.85 : mins < 17 * 60 ? 0 : mins < 19 * 60 ? (mins - 17 * 60) / 120 : 1;
    if (nightF > 0.05) {
      ctx.fillStyle = `rgba(255, 242, 192, ${0.2 * nightF})`;
      ctx.beginPath();
      ctx.moveTo(heli.x, heli.y);
      ctx.lineTo(state.player.x - 50, state.player.y);
      ctx.lineTo(state.player.x + 50, state.player.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 242, 192, ${0.3 * nightF})`;
      ctx.beginPath();
      ctx.arc(state.player.x, state.player.y, 60, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(heli.x, heli.y);
    ctx.rotate(heli.angle);
    ctx.fillStyle = '#1d3557';
    ctx.beginPath();
    ctx.ellipse(0, 0, 24, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(-20, -3, 40, 6);
    ctx.fillStyle = '#1d3557';
    ctx.fillRect(-42, -2, 24, 4);
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,20,20,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(heli.x - Math.cos(heli.rotor) * 34, heli.y - Math.sin(heli.rotor) * 34);
    ctx.lineTo(heli.x + Math.cos(heli.rotor) * 34, heli.y + Math.sin(heli.rotor) * 34);
    ctx.stroke();
  }

  function drawMarker(state) {
    const marker = missionMarker(state);
    if (!marker) return;
    const pulse = 1 + 0.18 * Math.sin(state.time * 4);
    ctx.fillStyle = 'rgba(255, 183, 3, 0.18)';
    ctx.fillRect(marker.x - 14, marker.y - 170, 28, 170);
    ctx.save();
    ctx.translate(marker.x, marker.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffb703';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    const s = 16 * pulse;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
    if (state.sideJob && state.sideJob.active && state.sideJob.target) {
      ctx.fillStyle = '#219ebc';
      ctx.beginPath();
      ctx.arc(state.sideJob.target.x, state.sideJob.target.y - 34, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Minigame fixtures: the dartboard on the Neon Club (always there)
   * with the oche line south of it, and the shooting-range targets
   * while a range game is running. */
  function drawMinigames(state) {
    const club = state.city.property;
    const rings = [[64, '#f8f9fa'], [44, '#e63946'], [26, '#f8f9fa'], [12, '#e63946']];
    for (const [r, color] of rings) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(club.x, club.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#1d3557';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(club.x, club.y, 64, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(club.x - 30, club.y + 120);
    ctx.lineTo(club.x + 30, club.y + 120);
    ctx.stroke();
    const mg = state.minigame;
    if (mg && mg.active && mg.kind === 'range') {
      for (const target of mg.targets) {
        if (target.down) {
          ctx.fillStyle = '#6c757d';
          ctx.beginPath();
          ctx.ellipse(target.x, target.y, 16, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillStyle = '#8d0801';
        ctx.fillRect(target.x - 2, target.y, 4, 22);
        ctx.fillStyle = '#f8f9fa';
        ctx.beginPath();
        ctx.arc(target.x, target.y - 12, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e63946';
        ctx.beginPath();
        ctx.arc(target.x, target.y - 12, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function draw(state) {
    if (!ground || groundCity !== state.city) {
      ground = buildGround(state.city);
      groundCity = state.city;
    }
    const cam = clampedCamera(state);
    const shakeX = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
    const ox = view.w / 2 - cam.x + shakeX;
    const oy = view.h / 2 - cam.y + shakeY;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.drawImage(ground, 0, 0);
    const left = cam.x - view.w / 2 - 80;
    const right = cam.x + view.w / 2 + 80;
    const top = cam.y - view.h / 2 - 120;
    const bottom = cam.y + view.h / 2 + 80;
    const visible = (x, y) => x > left && x < right && y > top && y < bottom;

    for (const skid of state.skids) {
      if (!visible(skid.x, skid.y)) continue;
      ctx.save();
      ctx.translate(skid.x, skid.y);
      ctx.rotate(skid.angle);
      ctx.fillStyle = `rgba(30,30,30,${0.35 * (skid.life / 5)})`;
      ctx.fillRect(-14, -3, 28, 5);
      ctx.restore();
    }
    for (const drop of state.city.cashDrops) {
      if (drop.taken || !visible(drop.x, drop.y)) continue;
      ctx.fillStyle = '#b7efc5';
      ctx.strokeStyle = '#2a9d8f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, 9 + Math.sin(state.time * 3 + drop.x) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2a9d8f';
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('$', drop.x, drop.y + 4);
    }
    for (const tape of state.city.tapes) {
      if (tape.taken || !visible(tape.x, tape.y)) continue;
      ctx.fillStyle = '#ffd60a';
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tape.x, tape.y - 9);
      ctx.lineTo(tape.x + 9, tape.y);
      ctx.lineTo(tape.x, tape.y + 9);
      ctx.lineTo(tape.x - 9, tape.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Cielo Arms: a green shopfront block with a dollar sign.
    ctx.fillStyle = '#2a9d8f';
    ctx.fillRect(state.city.gunShop.x - 10, state.city.gunShop.y - 10, 20, 20);
    ctx.fillStyle = '#fff';
    ctx.font = `800 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('$', state.city.gunShop.x, state.city.gunShop.y + 5);
    // Street-race start: a purple marker until the race is running.
    if (!state.race.active) {
      ctx.fillStyle = '#9b5de5';
      ctx.fillRect(RACE.start.x - 10, RACE.start.y - 10, 20, 20);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(RACE.start.x - 10, RACE.start.y - 10, 20, 20);
    }
    for (const lamp of state.city.lamps) {
      if (!visible(lamp.x, lamp.y)) continue;
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(lamp.x - 2, lamp.y - 2, 4, 4);
    }
    for (const umbrella of state.city.umbrellas) {
      if (!visible(umbrella.x, umbrella.y)) continue;
      ctx.fillStyle = umbrella.color;
      ctx.beginPath();
      ctx.arc(umbrella.x, umbrella.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(umbrella.x, umbrella.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const boat of state.city.boats) {
      ctx.save();
      ctx.translate(boat.x, boat.y);
      ctx.rotate(boat.angle);
      ctx.fillStyle = '#fff';
      roundRect(ctx, -26, -9, 52, 18, 8);
      ctx.fill();
      ctx.fillStyle = '#e63946';
      ctx.fillRect(-8, -6, 16, 12);
      ctx.restore();
    }

    const drawables = [];
    for (const b of state.city.buildings) {
      if (visible(b.x + b.w / 2, b.y + b.h / 2)) drawables.push({ y: b.y + b.h, fn: () => drawBuilding(b, state.time) });
    }
    for (const tree of state.city.trees) {
      if (visible(tree.x, tree.y)) drawables.push({ y: tree.y, fn: () => drawTree(tree) });
    }
    const heroCar = playerCar(state);
    for (const car of state.cars) {
      if (visible(car.x, car.y)) drawables.push({ y: car.y, fn: () => drawCar(car, state, car === heroCar) });
    }
    for (const ped of state.peds) {
      if (visible(ped.x, ped.y)) drawables.push({ y: ped.y, fn: () => drawPerson(ped, false, state.time) });
    }
    if (state.player.onFoot) {
      drawables.push({
        y: state.player.y,
        fn: () => drawPerson({ ...state.player, shirt: state.player.shirt || '#fb8500', skin: state.player.skin || '#c68642', kind: 'player', phase: state.player.walkPhase, down: 0 }, true, state.time),
      });
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();

    drawHeli(state);
    drawMarker(state);
    drawMinigames(state);

    for (const bullet of state.bullets) {
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    const dusk = state.dusk || state.clockMinutes >= 18 * 60;
    ctx.fillStyle = dusk ? PALETTE.duskTint : PALETTE.dayTint;
    ctx.fillRect(0, 0, view.w, view.h);
    const vignette = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.42, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(40,10,0,0.28)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  return { draw, resize, toWorld, view };
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}
