// Juice: sparks, smoke, dust, muzzle flashes, cash bursts and screen shake.
// Particles are tiny fading circles; the renderer draws them, this file only
// spawns and ages them. Nothing here affects the rules, only the feel.
export function createEffects() {
  return { particles: [], shake: 0 };
}

export function spawnSparks(state, x, y) {
  for (let i = 0; i < 8; i += 1) {
    const angle = state.rng.range(0, Math.PI * 2);
    const speed = state.rng.range(60, 220);
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: state.rng.range(0.15, 0.4),
      maxLife: 0.4,
      size: state.rng.range(2, 4),
      color: '#fee440',
    });
  }
}

export function spawnSmoke(state, x, y) {
  state.particles.push({
    x, y,
    vx: state.rng.range(-14, 14),
    vy: -state.rng.range(24, 48),
    life: state.rng.range(0.7, 1.3),
    maxLife: 1.3,
    size: state.rng.range(6, 12),
    color: 'rgba(90, 90, 90, 0.5)',
  });
}

export function spawnDust(state, x, y) {
  state.particles.push({
    x, y,
    vx: state.rng.range(-30, 30),
    vy: state.rng.range(-30, 30),
    life: 0.4,
    maxLife: 0.4,
    size: state.rng.range(3, 6),
    color: 'rgba(217, 199, 167, 0.7)',
  });
}

export function spawnCashBurst(state, x, y) {
  for (let i = 0; i < 10; i += 1) {
    const angle = state.rng.range(0, Math.PI * 2);
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * state.rng.range(40, 140),
      vy: Math.sin(angle) * state.rng.range(40, 140) - 40,
      life: state.rng.range(0.4, 0.8),
      maxLife: 0.8,
      size: state.rng.range(3, 5),
      color: '#b7efc5',
    });
  }
}

export function spawnMuzzle(state, x, y, angle) {
  state.particles.push({
    x: x + Math.cos(angle) * 24,
    y: y + Math.sin(angle) * 24,
    vx: 0, vy: 0,
    life: 0.07,
    maxLife: 0.07,
    size: 9,
    color: '#fff3b0',
  });
}

export function updateEffects(state, dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 3 * dt;
    p.vy *= 1 - 3 * dt;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
  for (let i = state.skids.length - 1; i >= 0; i -= 1) {
    state.skids[i].life -= dt;
    if (state.skids[i].life <= 0) state.skids.splice(i, 1);
  }
  state.shake = Math.max(0, state.shake - 30 * dt);
  for (const car of state.cars) {
    if (car.health < 45 && car.health > 0 && state.rng.chance(0.12)) {
      spawnSmoke(state, car.x, car.y - 8);
    }
  }
}
