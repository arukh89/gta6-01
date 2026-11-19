// The weapon wheel: GTA-style radial selector for Solmaris Heat. Hold Tab
// and the wheel opens over the action — Fists, Pistol and SMG around a
// centre that names the highlighted weapon — point at a segment with the
// mouse (or cycle with the arrow keys) and release Tab to equip it. The
// wheel only selects; it never changes a weapon's stats, ammo or balance,
// it draws no randomness, and it is pure UI state — it is not saved, and
// the Digit 1/2/3 keys keep working exactly as before. A weapon the crew
// does not own yet still shows, dimmed and locked: it can be looked at,
// never equipped, until Cielo Arms sells it.
import { WEAPONS } from './config.js';

/** The three wheel slots, clockwise from the top: fists, pistol, SMG. */
export const WHEEL_SLOTS = ['fists', 'pistol', 'smg'];

/** Mouse closer than this to the wheel centre picks nothing: the centre
 * is the label, not a segment, so a still mouse never flips the pick. */
export const WHEEL_DEAD_ZONE = 28;

/** Fresh wheel state: closed, nothing picked yet, nothing touched. */
export function createWheelState() {
  return { open: false, selected: 0, touched: false };
}

/** What the HUD paints: one row per slot, with the owned flag and the
 * ammo line the player already sees under the weapon name. */
export function wheelSlots(state) {
  const player = state.player;
  return WHEEL_SLOTS.map((id) => {
    const owned = player.weapons.includes(id);
    const ammoText = id === 'fists' ? '' : `${player.mag[id]} / ${player.ammo[id]}`;
    return { id, name: WEAPONS[id].name, owned, ammoText };
  });
}

/** Pick a segment from a mouse offset (dx, dy) off the wheel centre, in
 * screen pixels (y down). Fists sits at the top, pistol bottom-right,
 * SMG bottom-left; each wedge spans 120 degrees. Inside the dead zone
 * the pick does not move, so a still mouse never flips it. Returns true
 * when the highlighted segment changed. */
export function wheelSelectByAngle(state, dx, dy) {
  const wheel = state.wheel;
  if (Math.hypot(dx, dy) < WHEEL_DEAD_ZONE) return false;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  let picked;
  if (deg >= -150 && deg < -30) picked = 0; // fists, top
  else if (deg >= -30 && deg < 90) picked = 1; // pistol, bottom-right
  else picked = 2; // SMG, bottom-left
  if (picked === wheel.selected) return false;
  wheel.selected = picked;
  wheel.touched = true;
  return true;
}

/** Cycle the highlight one slot, skipping weapons the crew does not own
 * yet (a locked slot can be looked at with the mouse, never cycled to).
 * `dir` is +1 forward, -1 back; wraps around the wheel. Returns true
 * when the highlighted segment changed. */
export function wheelCycle(state, dir) {
  const wheel = state.wheel;
  const player = state.player;
  for (let step = 1; step <= WHEEL_SLOTS.length; step += 1) {
    const next = (wheel.selected + dir * step + WHEEL_SLOTS.length * 2) % WHEEL_SLOTS.length;
    if (!player.weapons.includes(WHEEL_SLOTS[next])) continue;
    if (next === wheel.selected) return false;
    wheel.selected = next;
    wheel.touched = true;
    return true;
  }
  return false;
}

/** Open the wheel on the weapon in hand: the highlight starts where the
 * player already is, so releasing Tab at once changes nothing. */
export function wheelOpen(state) {
  const wheel = state.wheel;
  wheel.open = true;
  const at = WHEEL_SLOTS.indexOf(state.player.weapon);
  wheel.selected = at >= 0 ? at : 0;
  wheel.touched = false;
}

/** Close the wheel and equip what was picked. Nothing picked (Tab tapped
 * with a still mouse) keeps the weapon in hand. A locked pick keeps the
 * weapon in hand too and reports it, so the loop can say why. */
export function wheelClose(state) {
  const wheel = state.wheel;
  wheel.open = false;
  if (!wheel.touched) return null;
  const id = WHEEL_SLOTS[wheel.selected];
  if (!state.player.weapons.includes(id)) return { locked: id };
  state.player.weapon = id;
  return { equipped: id };
}
