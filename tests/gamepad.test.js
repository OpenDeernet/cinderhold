import { describe, expect, it } from 'vitest';
import { BUTTON, GamepadInput } from '../src/input/gamepad.js';

function fakePad() {
  const pad = { connected: true, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  return {
    pad,
    press: (b, on = true) => {
      pad.buttons[b] = { pressed: on, value: on ? 1 : 0 };
    },
  };
}

describe('GamepadInput', () => {
  it('reports nothing without a pad', () => {
    const g = new GamepadInput(() => [null]);
    expect(g.update(0.016)).toEqual({ presses: [], move: null, camera: { x: 0, y: 0 } });
    expect(g.connected).toBe(false);
  });

  it('turns button presses into intents once per press', () => {
    const f = fakePad();
    const g = new GamepadInput(() => [f.pad]);
    f.press(BUTTON.A);
    f.press(BUTTON.Y);
    expect(g.update(0.016).presses).toEqual(['confirm', 'wave']);
    expect(g.update(0.016).presses).toEqual([]);
    f.press(BUTTON.A, false);
    g.update(0.016);
    f.press(BUTTON.A);
    expect(g.update(0.016).presses).toEqual(['confirm']);
  });

  it('treats a half-pulled analog trigger as pressed', () => {
    const f = fakePad();
    const g = new GamepadInput(() => [f.pad]);
    f.pad.buttons[BUTTON.RT] = { pressed: false, value: 0.8 };
    expect(g.update(0.016).presses).toEqual(['speed']);
  });

  it('moves one tile on press, then repeats while held', () => {
    const f = fakePad();
    const g = new GamepadInput(() => [f.pad]);
    f.press(BUTTON.RIGHT);
    expect(g.update(0.016).move).toEqual({ dx: 1, dy: 0 });
    let steps = 0;
    for (let t = 0; t < 1; t += 0.016) if (g.update(0.016).move) steps++;
    // 0.35 s delay, then roughly every 0.09 s.
    expect(steps).toBeGreaterThanOrEqual(6);
    expect(steps).toBeLessThanOrEqual(9);
    f.press(BUTTON.RIGHT, false);
    expect(g.update(0.016).move).toBeNull();
  });

  it('snaps the left stick to its dominant axis and ignores the dead zone', () => {
    const f = fakePad();
    const g = new GamepadInput(() => [f.pad]);
    f.pad.axes[0] = 0.2;
    f.pad.axes[1] = 0.25;
    expect(g.update(0.016).move).toBeNull();
    f.pad.axes[0] = 0.5;
    f.pad.axes[1] = -0.9;
    expect(g.update(0.016).move).toEqual({ dx: 0, dy: -1 });
  });

  it('passes the right stick through for the camera', () => {
    const f = fakePad();
    const g = new GamepadInput(() => [f.pad]);
    f.pad.axes[2] = 0.6;
    f.pad.axes[3] = 0.05;
    expect(g.update(0.016).camera).toEqual({ x: 0.6, y: 0 });
  });
});
