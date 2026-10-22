// The phone version. Same game, set up to feel right on a phone:
//  - landscape and full screen (browsers only allow full screen after a tap,
//    so the first tap anywhere does it; holding the phone upright shows a
//    "turn sideways" screen; installed to the home screen it opens that way),
//  - thumb controls (see touchControls.js),
//  - lighter graphics by default, haptics, and the screen kept awake.
// The radio stays on PC: its YouTube player has to be a big visible box, and
// phones already play music from their own apps alongside the game.

export const IS_MOBILE = (() => {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) <= 820;
  const ua = /Android|iPhone|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent);
  return (coarse && small) || ua || new URLSearchParams(location.search).has('mobile');
})();

// Full screen + landscape lock, from inside a tap. Quietly does nothing where
// it isn't supported (e.g. iPhone Safari, which has no full-screen API for
// pages: there the rotate screen and Add to Home Screen do the job).
export async function goFullLandscape() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (!document.webkitFullscreenElement && el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch { /* refused */ }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* not allowed or not supported */ }
}

// Short vibration on Android (iOS has no Vibration API).
export function buzz(ms = 25) {
  try { if (IS_MOBILE && navigator.vibrate) navigator.vibrate(ms); } catch { /* ignore */ }
}

let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed */ }
}

export function setupMobile() {
  if (!IS_MOBILE) return;
  document.body.classList.add('mobile');
  // The first tap anywhere goes full screen + landscape. If the player later
  // swipes out of full screen, the next tap on the game brings it back.
  const onTap = () => { if (!document.fullscreenElement) goFullLandscape(); };
  addEventListener('pointerup', onTap, { capture: true });
  // the screen goes back to sleep in the background, and wakes with the game
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.body.classList.contains('riding')) keepAwake(true);
  });
}

// Tilt-to-steer: hold the phone sideways like a steering wheel and turn it.
//
// Phones disagree on motion axes (iOS reports the gravity vector with the
// opposite sign to Android), so this doesn't trust them. It projects the
// gravity reading onto the screen's own left-right / up-down axes, then
// learns which way is "up" from the first readings while the phone is held
// sideways. After that, turning the phone clockwise is always a right turn,
// on any phone, whichever way round it's held.
export const TILT_SENS = { low: 40, medium: 28, high: 18 };   // degrees of turn for full lock

export class Tilt {
  constructor(onChange) {
    this.value = 0;          // -1..1, positive = left (like the A key)
    this.on = false;
    this.sign = 0;           // learned: +1 / -1 (0 = not yet)
    this.full = TILT_SENS.medium;
    this.onChange = onChange;
    this.handler = (e) => this.read(e);
    this.relearn = () => { this.sign = 0; };
  }

  // Must run inside a tap: iOS asks the player for permission.
  async enable() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        if ((await DeviceMotionEvent.requestPermission()) !== 'granted') return false;
      }
    } catch { return false; }
    if (typeof DeviceMotionEvent === 'undefined') return false;
    this.on = true;
    this.sign = 0;
    addEventListener('devicemotion', this.handler);
    screen.orientation?.addEventListener?.('change', this.relearn);
    addEventListener('orientationchange', this.relearn);
    return true;
  }

  disable() {
    this.on = false;
    removeEventListener('devicemotion', this.handler);
    screen.orientation?.removeEventListener?.('change', this.relearn);
    removeEventListener('orientationchange', this.relearn);
    this.value = 0;
    this.onChange?.(0);
  }

  read(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    // device axes -> screen axes (x right, y up) for the current rotation
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) % 360 + 360) % 360;
    let sx, sy;
    if (angle === 90) { sx = -g.y; sy = g.x; }
    else if (angle === 270) { sx = g.y; sy = -g.x; }
    else if (angle === 180) { sx = -g.x; sy = -g.y; }
    else { sx = g.x; sy = g.y; }
    // phone lying flat: no steering information
    if (Math.hypot(sx, sy) < 2.5) return;
    // learn which way is "up" while the phone is held roughly level
    if (!this.sign) {
      if (Math.abs(sy) < 4 || Math.abs(sx) > Math.abs(sy)) return;
      this.sign = Math.sign(sy);
    }
    const ux = sx * this.sign, uy = sy * this.sign;     // world "up", seen on screen
    const turn = Math.atan2(-ux, uy) * 180 / Math.PI;   // + = phone turned clockwise (right)
    const dead = 2;
    const t = Math.abs(turn) < dead ? 0 : turn - Math.sign(turn) * dead;
    const target = Math.max(-1, Math.min(1, -t / this.full));
    this.value += (target - this.value) * 0.5;           // a little smoothing
    this.onChange?.(this.value);
  }
}
