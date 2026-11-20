// Minigames in Solmaris: darts at the Neon Club and a shooting range at
// Cielo Arms. Pure logic — the DOM and the renderers only call these
// functions and read the state. Both games pay cash and Respect, reuse
// the systems that are already there (mouse aim, the combat bullet loop,
// the witness-free range), and keep no state the save has to carry:
// a game is a session activity, money and REP are saved already.
import { skillLevel } from './config.js';

/** Darts: three throws at the board on the Neon Club, from the oche
 * 120 units south of it. Ring radii in world units and their points. */
export const DARTS_RINGS = [[12, 50], [26, 30], [44, 20], [64, 10]];
export const DARTS_THROWS = 3;

/** Shooting range: 30 seconds, five targets east of Cielo Arms. */
export const RANGE_TIME = 30;
export const RANGE_TARGETS = 5;
export const RANGE_HIT_POINTS = 20;

function payout(score) {
  if (score >= 120) return { money: 150, rep: 10 };
  if (score >= 80) return { money: 80, rep: 5 };
  if (score >= 40) return { money: 30, rep: 2 };
  return { money: 0, rep: 0 };
}

function rangePayout(hits) {
  if (hits >= 5) return { money: 150, rep: 10 };
  if (hits >= 4) return { money: 100, rep: 7 };
  if (hits >= 3) return { money: 60, rep: 5 };
  if (hits >= 2) return { money: 30, rep: 2 };
  return { money: 0, rep: 0 };
}

export function createMinigameState() {
  return { active: false, kind: null, score: 0, throwsLeft: 0, timerLeft: 0, targets: [], prevFiring: false };
}

/** The dartboard hangs on the Neon Club; the oche is 120u south of it. */
export function dartsBoard(state) {
  return { x: state.city.property.x, y: state.city.property.y };
}

export function dartsOche(state) {
  return { x: state.city.property.x, y: state.city.property.y + 120 };
}

/** The range firing line is west of Cielo Arms; the targets stand in a
 * row east of the shop, all inside pistol and SMG range of the line. */
export function rangeLine(state) {
  return { x: state.city.gunShop.x - 80, y: state.city.gunShop.y };
}

export function rangeTargetSpots(state) {
  const shop = state.city.gunShop;
  const spots = [];
  for (let i = 0; i < RANGE_TARGETS; i += 1) {
    spots.push({ x: shop.x + 60 + i * 50, y: shop.y, down: false });
  }
  return spots;
}

function finishGame(state, events, text) {
  const mg = state.minigame;
  const pay = mg.kind === 'range' ? rangePayout(mg.targets.filter((t) => t.down).length) : payout(mg.score);
  if (mg.kind === 'darts') {
    if (state.totalMinutes - state.progress.lastDartsAt < 1440) {
      pay.money = 0;
      pay.rep = 0;
      events.push({ type: 'toast', text: "Today's darts winnings are already collected." });
    } else {
      state.progress.lastDartsAt = state.totalMinutes;
    }
  }
  state.player.money += pay.money;
  state.progress.rep += pay.rep;
  if (pay.money > 0) {
    events.push({ type: 'toast', text: `${text} — +$${pay.money}${pay.rep ? `, +${pay.rep} REP` : ''}` });
  } else {
    events.push({ type: 'toast', text: `${text} — no payout this time.` });
  }
  events.push({ type: 'chime' });
  state.minigame = createMinigameState();
}

/** Start darts. Returns null on success, or a short reason. */
export function startDarts(state, events) {
  const mg = state.minigame;
  if (!mg) return 'Darts is not ready.';
  if (mg.active) return 'Finish the current game first.';
  if (!state.player.onFoot) return 'Step out of the car to play darts.';
  state.minigame = { active: true, kind: 'darts', score: 0, throwsLeft: DARTS_THROWS, timerLeft: 0, targets: [], prevFiring: false };
  const oche = dartsOche(state);
  state.player.x = oche.x;
  state.player.y = oche.y;
  state.player.angle = -Math.PI / 2;
  events.push({ type: 'toast', text: 'Darts at the Neon Club — 3 throws. Aim with the mouse, click to throw.' });
  events.push({ type: 'chime' });
  return null;
}

/** Start the shooting range. Returns null on success, or a short reason.
 * The range uses the player's own pistol ammo — no free-ammo farm. */
export function startRange(state, events) {
  const mg = state.minigame;
  if (!mg) return 'The range is not ready.';
  if (mg.active) return 'Finish the current game first.';
  if (!state.player.onFoot) return 'Step out of the car to shoot the range.';
  if ((state.player.mag.pistol || 0) + (state.player.ammo.pistol || 0) <= 0) {
    return 'No pistol ammo — buy some at Cielo Arms first.';
  }
  state.player.weapon = 'pistol';
  state.minigame = { active: true, kind: 'range', score: 0, throwsLeft: 0, timerLeft: RANGE_TIME, targets: rangeTargetSpots(state), prevFiring: false };
  events.push({ type: 'toast', text: `Shooting range — ${RANGE_TIME} seconds, ${RANGE_TARGETS} targets. Hit them all!` });
  events.push({ type: 'chime' });
  return null;
}

/** Walk away from a game: no payout, no penalty. */
export function quitMinigame(state, events) {
  if (!state.minigame || !state.minigame.active) return;
  state.minigame = createMinigameState();
  events.push({ type: 'toast', text: 'You walked away from the game.' });
}

function throwDart(state, events, toWorld, input) {
  const mg = state.minigame;
  const aim = toWorld ? toWorld(input.mouse().x, input.mouse().y) : { x: state.player.x, y: state.player.y - 100 };
  // A steady hand helps: the wobble shrinks as the shooting skill grows.
  const shootLv = state.progress ? skillLevel(state.progress.shooting, 'shooting') : 0;
  const wobble = 24 - Math.min(10, shootLv) * 1.2;
  const wobAngle = state.rng.range(0, Math.PI * 2);
  const wobDist = state.rng.range(0, wobble);
  const land = { x: aim.x + Math.cos(wobAngle) * wobDist, y: aim.y + Math.sin(wobAngle) * wobDist };
  const board = dartsBoard(state);
  const d = Math.hypot(land.x - board.x, land.y - board.y);
  let pts = 0;
  for (const [radius, points] of DARTS_RINGS) {
    if (d <= radius) { pts = points; break; }
  }
  mg.score += pts;
  mg.throwsLeft -= 1;
  if (pts >= 50) events.push({ type: 'toast', text: `Bullseye! +50 — total ${mg.score}` });
  else if (pts > 0) events.push({ type: 'toast', text: `Dart: +${pts} — total ${mg.score}` });
  else events.push({ type: 'toast', text: `Dart missed — total ${mg.score}` });
  events.push({ type: 'chime' });
  if (mg.throwsLeft <= 0) finishGame(state, events, `Darts: ${mg.score} points`);
}

/** A bullet hit a range target: knock it down, score it, spark it. */
export function hitRangeTarget(state, target, events) {
  const mg = state.minigame;
  if (!mg || !mg.active || mg.kind !== 'range' || target.down) return;
  target.down = true;
  mg.score += RANGE_HIT_POINTS;
  if (state.progress) state.progress.shooting += 1;
  events.push({ type: 'spark', x: target.x, y: target.y });
  events.push({ type: 'chime' });
}

/** Advance an active game one step. Darts pins Lena to the oche and
 * throws on a click; the range counts down and ends when time is up or
 * Lena walks off the firing line. */
export function updateMinigames(state, input, dt, events, toWorld) {
  const mg = state.minigame;
  if (!mg || !mg.active) return;
  if (mg.kind === 'darts') {
    // Darts is thrown from the line: hold Lena on the oche, facing
    // the board, while the game lasts.
    const oche = dartsOche(state);
    state.player.x = oche.x;
    state.player.y = oche.y;
    state.player.angle = -Math.PI / 2;
    const firing = !!(input.isFiring && input.isFiring());
    if (firing && !mg.prevFiring && mg.throwsLeft > 0) throwDart(state, events, toWorld, input);
    mg.prevFiring = firing;
    return;
  }
  if (mg.kind === 'range') {
    mg.timerLeft -= dt;
    if (mg.timerLeft <= 0) {
      const hits = mg.targets.filter((t) => t.down).length;
      finishGame(state, events, `Range: ${hits}/${RANGE_TARGETS} targets`);
      return;
    }
    const line = rangeLine(state);
    if (Math.hypot(state.player.x - line.x, state.player.y - line.y) > 320) {
      state.minigame = createMinigameState();
      events.push({ type: 'toast', text: 'You walked off the range — no payout.' });
    }
  }
}

/** The HUD objective line while a game is running: score and timer. */
export function minigameObjective(state) {
  const mg = state.minigame;
  if (!mg || !mg.active) return null;
  if (mg.kind === 'darts') {
    return `Darts — ${mg.throwsLeft} throw${mg.throwsLeft === 1 ? '' : 's'} left · score ${mg.score}`;
  }
  const hits = mg.targets.filter((t) => t.down).length;
  return `Shooting range — ${hits}/${RANGE_TARGETS} targets · ${Math.ceil(mg.timerLeft)}s left`;
}
