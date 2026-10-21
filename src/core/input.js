// Keyboard, gamepad and touch merged into one driving input.
//   W/↑ throttle · S/↓ brake/reverse · A/D ←/→ steer · Space handbrake
//   R reset · C camera · M map · Tab players
//   Alt+C show/hide the mouse cursor · F3 performance overlay · Q radio
// Gamepad: left stick steer, RT throttle, LT brake, A handbrake, Y reset, B camera.

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0 };
    this.handlers = {}; // one-shot actions: reset, camera, map, players
    this.enabled = true;
    this.padPrev = {};

    addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.altKey && e.code === 'KeyC') {   // not the camera key while Alt is held
        e.preventDefault();
        if (!e.repeat) this.fire('cursor', true);
        return;
      }
      if (e.code === 'F3') { e.preventDefault(); if (!e.repeat) this.fire('stats', true); return; }
      if (e.code === 'Tab') e.preventDefault();
      if (!e.repeat) {
        const action = { KeyR: 'reset', KeyC: 'camera', KeyM: 'map', KeyQ: 'radio', Tab: 'players', Escape: 'escape' }[e.code];
        if (action) this.fire(action, true);
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.fire('players', false);
    });
    addEventListener('blur', () => this.keys.clear());
  }

  on(action, fn) { this.handlers[action] = fn; }
  fire(action, down) { if (this.handlers[action]) this.handlers[action](down); }

  read() {
    const k = this.keys;
    let steer = 0, throttle = 0, brake = 0, handbrake = false;
    if (this.enabled) {
      if (k.has('KeyA') || k.has('ArrowLeft')) steer += 1;
      if (k.has('KeyD') || k.has('ArrowRight')) steer -= 1;
      if (k.has('KeyW') || k.has('ArrowUp')) throttle = 1;
      if (k.has('KeyS') || k.has('ArrowDown')) brake = 1;
      handbrake = k.has('Space');

      steer += this.touch.steer;
      throttle = Math.max(throttle, this.touch.throttle);
      brake = Math.max(brake, this.touch.brake);

      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(Boolean) : null;
      if (pad) {
        const ax = pad.axes[0] || 0;
        if (Math.abs(ax) > 0.12) steer -= ax;
        throttle = Math.max(throttle, pad.buttons[7]?.value || 0);
        brake = Math.max(brake, pad.buttons[6]?.value || 0);
        handbrake = handbrake || !!pad.buttons[0]?.pressed;
        const edge = (i, action) => {
          const p = !!pad.buttons[i]?.pressed;
          if (p && !this.padPrev[i]) this.fire(action, true);
          this.padPrev[i] = p;
        };
        edge(3, 'reset');
        edge(1, 'camera');
        edge(8, 'map');
      }
    }
    return { steer: Math.max(-1, Math.min(1, steer)), throttle, brake, handbrake };
  }

  // On-screen controls for phones / tablets.
  attachTouch(root) {
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
    root.classList.add('touch');
    const bind = (el, key, val) => {
      const on = (e) => { e.preventDefault(); this.touch[key] = val; el.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = 0; el.classList.remove('down'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
    };
    bind(root.querySelector('[data-t=left]'), 'steer', 1);
    bind(root.querySelector('[data-t=right]'), 'steer', -1);
    bind(root.querySelector('[data-t=gas]'), 'throttle', 1);
    bind(root.querySelector('[data-t=brake]'), 'brake', 1);
    root.querySelector('[data-t=reset]').addEventListener('touchstart', (e) => { e.preventDefault(); this.fire('reset', true); }, { passive: false });
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}
