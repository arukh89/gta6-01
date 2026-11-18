// The DOM HUD and the minimap: wanted stars, health, money, the mission
// objective, the clock, weapon and speed readouts, prompts and toasts. The
// minimap is a small canvas painted from the city itself, with blips for the
// player, the mission marker, police and taxi stands. Text updates are kept
// cheap: only rewritten when the value shown actually changes.
import { HEALTH, PALETTE, VEHICLES, WEAPONS, WORLD } from './config.js';
import { districtNameAt } from './world.js';
import { missionMarker, objectiveText } from './missions.js';
import { playerCar } from './player.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const nodes = {
    hud: el('hud'),
    wanted: el('wanted'),
    healthFill: el('healthfill'),
    healthText: el('healthtext'),
    money: el('money'),
    respect: el('respect'),
    objectiveText: el('objective-text'),
    clock: el('clock'),
    drive: el('driveinfo'),
    speed: el('speed'),
    carName: el('carname'),
    weaponName: el('weaponname'),
    ammo: el('ammo'),
    prompt: el('prompt'),
    toast: el('toast'),
    hint: el('hint'),
    minimap: el('minimap'),
  };
  const mapCtx = nodes.minimap.getContext('2d');
  let mapBase = null;
  let mapCity = null;
  let last = {};
  let toastUntil = 0;

  function buildMapBase(city) {
    const c = document.createElement('canvas');
    c.width = 188;
    c.height = 188;
    const ctx = c.getContext('2d');
    const sx = 188 / WORLD.width;
    const sy = 188 / WORLD.height;
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, 188, 188);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, WORLD.beachY * sy, 188, 188);
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(0, WORLD.waterY * sy, 188, 188);
    ctx.fillStyle = PALETTE.asphalt;
    for (const x of city.xs) ctx.fillRect(x * sx - 2, 0, 4, 188);
    for (const y of city.ys) ctx.fillRect(0, y * sy - 2, 188, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (const b of city.buildings) ctx.fillRect(b.x * sx, b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
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
    mapCtx.drawImage(mapBase, 0, 0);
    const sx = 188 / WORLD.width;
    const sy = 188 / WORLD.height;
    for (const stand of state.city.taxiStands) {
      mapCtx.fillStyle = '#219ebc';
      mapCtx.fillRect(stand.x * sx - 3, stand.y * sy - 3, 6, 6);
    }
    mapCtx.fillStyle = '#fb8500';
    mapCtx.fillRect(state.city.paintShop.x * sx - 3, state.city.paintShop.y * sy - 3, 6, 6);
    const marker = missionMarker(state);
    if (marker) {
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
      mapCtx.fillStyle = '#4361ee';
      mapCtx.beginPath();
      mapCtx.arc(car.x * sx, car.y * sy, 3.5, 0, Math.PI * 2);
      mapCtx.fill();
    }
    const player = state.player;
    mapCtx.fillStyle = '#fff';
    mapCtx.beginPath();
    mapCtx.arc(player.x * sx, player.y * sy, 5, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = '#e63946';
    mapCtx.beginPath();
    mapCtx.arc(player.x * sx, player.y * sy, 3, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.strokeStyle = 'rgba(255,255,255,0.7)';
    mapCtx.lineWidth = 1;
    mapCtx.beginPath();
    mapCtx.moveTo(player.x * sx, player.y * sy);
    mapCtx.lineTo(player.x * sx + Math.cos(player.angle) * 9, player.y * sy + Math.sin(player.angle) * 9);
    mapCtx.stroke();
  }

  return {
    show() {
      nodes.hud.classList.remove('hidden');
    },
    hide() {
      nodes.hud.classList.add('hidden');
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
    update(state, promptText) {
      const player = state.player;
      const stars = '★'.repeat(state.wanted.level) + '☆'.repeat(5 - state.wanted.level);
      if (last.stars !== stars) {
        last.stars = stars;
        nodes.wanted.innerHTML = '';
        for (let i = 0; i < 5; i += 1) {
          const span = document.createElement('span');
          span.textContent = '★';
          span.className = i < state.wanted.level ? 'lit' : 'dim';
          nodes.wanted.appendChild(span);
        }
      }
      const pct = Math.max(0, Math.round((player.health / HEALTH.max) * 100));
      if (last.health !== pct) {
        last.health = pct;
        nodes.healthFill.style.width = `${pct}%`;
        nodes.healthText.textContent = `HEALTH ${pct}`;
      }
      setText(nodes.money, 'money', `$${player.money.toLocaleString('en-US')}`);
      setText(nodes.respect, 'respect', `${districtNameAt(state.city, player.x, player.y).toUpperCase()} · ${state.stats.missionsDone}/6 JOBS`);
      setText(nodes.objectiveText, 'objective', objectiveText(state));
      const hours = Math.floor(state.clockMinutes / 60);
      const minutes = Math.floor(state.clockMinutes % 60);
      setText(nodes.clock, 'clock', `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
      const car = playerCar(state);
      if (car) {
        nodes.drive.classList.remove('hidden');
        setText(nodes.speed, 'speed', String(Math.round(Math.abs(car.speed) * 0.36)));
        setText(nodes.carName, 'carname', VEHICLES[car.kind].name.toUpperCase());
      } else {
        nodes.drive.classList.add('hidden');
      }
      const weapon = WEAPONS[player.weapon];
      setText(nodes.weaponName, 'weapon', weapon.name);
      setText(nodes.ammo, 'ammo', player.weapon === 'pistol' ? `${player.mag} / ${player.ammo}` : '');
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
