// Gamepad input for the "standard" mapping (Xbox / PlayStation layouts).
// This module only turns raw pad state into intents; main.js decides what an
// intent does. Polled once per frame.
//
//   Left stick / D-pad   move the tile cursor, or move focus in menus
//   Right stick          orbit (x) and zoom (y) the camera
//   A / Cross            act on the cursor tile, or press the focused button
//   B / Circle           cancel / back
//   X / Square           upgrade the selected tower
//   Y / Triangle         send the next wave
//   LB / RB              previous / next tower to build
//   LT                   sell the selected tower
//   RT                   cycle game speed
//   Back / Select        show every tower's range
//   Start / Options      pause

export const BUTTON = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const PRESS_EVENTS = [
  [BUTTON.A, 'confirm'],
  [BUTTON.B, 'cancel'],
  [BUTTON.X, 'upgrade'],
  [BUTTON.Y, 'wave'],
  [BUTTON.LB, 'prevTower'],
  [BUTTON.RB, 'nextTower'],
  [BUTTON.LT, 'sell'],
  [BUTTON.RT, 'speed'],
  [BUTTON.BACK, 'ranges'],
  [BUTTON.START, 'pause'],
];

const DEADZONE = 0.35;
const CAMERA_DEADZONE = 0.15;
const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 0.09;

export class GamepadInput {
  // source: () => array of Gamepad-like objects (injectable for tests).
  constructor(source = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [])) {
    this.source = source;
    this.prev = new Map();
    this.held = { x: 0, y: 0, time: 0, repeat: 0 };
    this.connected = false;
  }

  pad() {
    for (const p of this.source()) if (p && p.connected !== false && p.buttons?.length) return p;
    return null;
  }

  // Returns { presses: [intent], move: {dx, dy} | null, camera: {x, y} }.
  update(dt) {
    const out = { presses: [], move: null, camera: { x: 0, y: 0 } };
    const p = this.pad();
    this.connected = !!p;
    if (!p) {
      this.prev.clear();
      this.held = { x: 0, y: 0, time: 0, repeat: 0 };
      return out;
    }

    const down = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
    for (const [i, intent] of PRESS_EVENTS) {
      const now = down(i);
      if (now && !this.prev.get(i)) out.presses.push(intent);
      this.prev.set(i, now);
    }

    // Direction from the D-pad, else the left stick.
    const ax = p.axes || [];
    let dx = (down(BUTTON.RIGHT) ? 1 : 0) - (down(BUTTON.LEFT) ? 1 : 0);
    let dy = (down(BUTTON.DOWN) ? 1 : 0) - (down(BUTTON.UP) ? 1 : 0);
    if (!dx && !dy) {
      const lx = ax[0] || 0;
      const ly = ax[1] || 0;
      if (Math.abs(lx) > DEADZONE || Math.abs(ly) > DEADZONE) {
        // Snap to the dominant axis so the cursor moves one tile at a time.
        if (Math.abs(lx) >= Math.abs(ly)) dx = Math.sign(lx);
        else dy = Math.sign(ly);
      }
    }
    out.move = this.repeat(dx, dy, dt);

    const rx = ax[2] || 0;
    const ry = ax[3] || 0;
    out.camera.x = Math.abs(rx) > CAMERA_DEADZONE ? rx : 0;
    out.camera.y = Math.abs(ry) > CAMERA_DEADZONE ? ry : 0;
    return out;
  }

  // Emits a step immediately, then again after a delay while held.
  repeat(dx, dy, dt) {
    const h = this.held;
    if (!dx && !dy) {
      this.held = { x: 0, y: 0, time: 0, repeat: 0 };
      return null;
    }
    if (dx !== h.x || dy !== h.y) {
      this.held = { x: dx, y: dy, time: 0, repeat: REPEAT_DELAY };
      return { dx, dy };
    }
    h.time += dt;
    if (h.time >= h.repeat) {
      h.repeat += REPEAT_RATE;
      return { dx, dy };
    }
    return null;
  }
}
