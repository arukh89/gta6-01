// Keyboard and mouse for Solmaris: held movement keys, one-shot action flags
// (taken once, never lost between frames), the aim point in screen space, and
// click-to-attack. Buttons in the DOM overlays handle menus; this file only
// feeds the simulation.

export const ACT = {
  ENTER_CAR: 1,
  PAUSE: 2,
  MUTE: 4,
  RELOAD: 8,
  WEAPON_FISTS: 16,
  WEAPON_PISTOL: 32,
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
    else if (event.code === 'Digit1') actions |= ACT.WEAPON_FISTS;
    else if (event.code === 'Digit2') actions |= ACT.WEAPON_PISTOL;
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
    /** Scripted input for screenshot staging: drive forward, no keys needed. */
    script(throttleValue, steerValue) {
      return {
        steer: () => steerValue,
        throttle: () => throttleValue,
        sprint: () => false,
        mouse: () => ({ x: mouseX, y: mouseY }),
        isFiring: () => false,
        takeActions: () => 0,
      };
    },
  };
}
