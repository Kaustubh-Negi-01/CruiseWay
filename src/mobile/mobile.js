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
