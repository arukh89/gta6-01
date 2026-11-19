// Keyboard and mouse for Solmaris: held movement keys, one-shot action flags
// (taken once, never lost between frames), the aim point in screen space, and
// click-to-attack. Buttons in the DOM overlays handle menus; this file only
// feeds the simulation. Hold Tab for the weapon wheel (the radial selector in
// wheel.js) — Tab is swallowed here so the browser never moves focus while
// the crew picks a weapon.

export const ACT = {
  ENTER_CAR: 1,
  PAUSE: 2,
  MUTE: 4,
  RELOAD: 8,
  WEAPON_FISTS: 16,
  WEAPON_PISTOL: 32,
  RADIO: 64,
  SHOP: 128,
  WEAPON_SMG: 256,
  MAP: 512,
  COVER: 1024,
  JUMP: 2048,
  CAMERA: 4096,
  SLEEP: 8192,
  SNACK: 16384,
  SELL_CAR: 32768,
  SWITCH: 65536,
};

const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let firing = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    held.add(event.code);
    if (event.code === 'KeyE') actions |= ACT.ENTER_CAR;
    else if (event.code === 'KeyP' || event.code === 'Escape') actions |= ACT.PAUSE;
    else if (event.code === 'KeyM') actions |= ACT.MUTE;
    else if (event.code === 'KeyR') actions |= ACT.RELOAD;
    else if (event.code === 'KeyQ') actions |= ACT.RADIO;
    else if (event.code === 'KeyF') actions |= ACT.SHOP;
    else if (event.code === 'KeyB') actions |= ACT.MAP;
    else if (event.code === 'KeyC') actions |= ACT.COVER;
    else if (event.code === 'Space') actions |= ACT.JUMP;
    else if (event.code === 'KeyV') actions |= ACT.CAMERA;
    else if (event.code === 'KeyH') actions |= ACT.SLEEP;
    else if (event.code === 'KeyG') actions |= ACT.SNACK;
    else if (event.code === 'KeyJ') actions |= ACT.SELL_CAR;
    else if (event.code === 'KeyT') actions |= ACT.SWITCH;
    else if (event.code === 'Digit1') actions |= ACT.WEAPON_FISTS;
    else if (event.code === 'Digit2') actions |= ACT.WEAPON_PISTOL;
    else if (event.code === 'Digit3') actions |= ACT.WEAPON_SMG;
    // Tab opens the weapon wheel (held, not an action): swallow it so the
    // browser never walks focus off the game while the wheel is up.
    if (event.code === 'Tab') event.preventDefault();
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || event.code === 'Space') {
      event.preventDefault();
    }
  }
  function onKeyUp(event) {
    held.delete(event.code);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => held.clear());
  canvas.addEventListener('pointermove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  canvas.addEventListener('pointerdown', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    if (event.button === 0) firing = true;
  });
  window.addEventListener('pointerup', () => {
    firing = false;
  });

  function axis(neg, pos) {
    return (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  }

  return {
    /** -1..1 steering / strafe: left negative, right positive. */
    steer() {
      let value = 0;
      for (const code of LEFT) if (held.has(code)) value -= 1;
      for (const code of RIGHT) if (held.has(code)) value += 1;
      return Math.max(-1, Math.min(1, value));
    },
    /** -1..1 throttle: forward positive, brake/reverse negative. */
    throttle() {
      let value = 0;
      for (const code of UP) if (held.has(code)) value += 1;
      for (const code of DOWN) if (held.has(code)) value -= 1;
      return Math.max(-1, Math.min(1, value));
    },
    sprint() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },
    /** Hold X for slow-mo: the world slows, Lena does not. */
    slowmo() {
      return held.has('KeyX');
    },
    /** Hold Tab for the weapon wheel: the radial selector in wheel.js. */
    wheelHeld() {
      return held.has('Tab');
    },
    /** Hold Space while driving for the NOS boost. */
    boost() {
      return held.has('Space');
    },
    mouse() {
      return { x: mouseX, y: mouseY };
    },
    isFiring() {
      return firing;
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Scripted input for screenshot staging: drive forward, no keys needed.
     * `fire` holds the trigger (drive-by staging) and `aim` overrides the
     * mouse point in screen space, so a staged shot can aim at a cruiser. */
    script(throttleValue, steerValue, fire, aim) {
      return {
        steer: () => steerValue,
        throttle: () => throttleValue,
        sprint: () => false,
        slowmo: () => false,
        wheelHeld: () => false,
        boost: () => false,
        mouse: () => (aim ? { x: aim.x, y: aim.y } : { x: mouseX, y: mouseY }),
        isFiring: () => !!fire,
        takeActions: () => 0,
      };
    },
  };
}
