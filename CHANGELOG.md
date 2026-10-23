# Changelog

Everything built so far, newest first. Live at **https://cruiseway.vercel.app**.

0.1–0.7 were built on 21 October 2026, 0.8–1.5 on 22 October 2026, and 1.6–1.7 on 23 October 2026.

## 1.7 · Hikari: a city you can find your way round · 23 Oct 2026

- **The city has a name: Hikari (光, "light").** It shows on the portals, the map, the messages ("Ravi warped into Hikari") and the vehicle menu.
- **New portals.** The portal is now the project owner's video of a crackling cyan ring around a swirling vortex, played on a loop (trimmed from 6.9 MB to 0.75 MB). It's huge: about 28 m across on the island and 32 m in the city. Its brightness sets how see-through it is, so it looks right against a daytime sky too. The video only plays while a portal is within about 900 m. Until it starts (or on a phone that won't autoplay it), a drawn swirl stands in.
- **Portals at the ends of the island.** Two gates, at the far east and far west ends, on the farthest straight stretch of road each way, instead of one near the start. Coming back from the city, you arrive at the gate you left by.
- **A new city, designed map first.** The layout follows the map, so it's easy to navigate:
  - **The core:** a regular grid of 10 × 10 blocks inside a ring road lit purple along its kerbs.
  - **The Loop:** a boulevard round downtown, lit cyan along both edges. Follow the colour and you know where you are.
  - **The crossing:** two central avenues meet at the scramble crossing in the middle.
  - **The Harbor** (west wing): warehouses with lit loading doors and about 600 stacked shipping containers. The portal home stands at the end of the main avenue.
  - **The Circuit District** (east wing): a tech campus with ribbon windows and lines of cyan light.
  - **The bay** lies north and south, behind the seawall.
- **New map.** A night-time city guide:
  - dark water with depth contours;
  - streets lighter than the blocks;
  - the Loop and ring road glowing in their colours;
  - buildings tinted by district;
  - districts named, and the portals drawn as glowing rings.
- **Races and Manhunt in Hikari.**
  - **Races:** Loop Grand Prix (Expert), Ring Road Run (Hard), Downtown Zigzag (Extreme, 18 right-angle turns) and Circuit–Harbor Dash (Hard).
  - **Manhunt arenas:** Scramble Square and Circuit Yard.
  - They work like the island's: beacons, lobbies, gates, race walls and best times. Whoever is in the other world just sees a message.
- **Clearer roads.** The street reflections are much fainter (at most 28% instead of 60%), the tarmac is a little lighter, and the markings are brighter.

## 1.6 · The neon city · 23 Oct 2026

- **A portal on the island.** A glowing pink arch stands across a road a few hundred metres from where you start. It's on the map, and a light beam marks it from far away. Ride through it either way to travel.
- **The neon city, a second map.** About 1.1 km across, always night, inspired by Tokyo after dark (every name and sign is invented):
  - A street grid round a central scramble crossing with diagonal zebras, avenues with yellow centre lines, side streets, narrow alleys through the big blocks, and a ring road along a seawall, with the bay and a distant skyline beyond.
  - About 1,700 buildings: small shops at the edge, mid-rise blocks, and a ring of towers up to about 270 m round the centre, with lit windows that switch on and off, shop fronts and glowing crowns.
  - Neon everywhere: vertical blade signs, shop signs, big billboards and animated LED screens, some with a dying tube that flickers. Street lights and vending machines line the sidewalks.
  - Wet streets that reflect the signs and buildings, and coloured light pooling on the road.
  - Its own weather on the shared clock: clear nights, drizzle, rain, fog and the odd thunderstorm.
  - Buildings, vending machines, street lights and the seawall are solid. The chase camera pulls in rather than look through a wall.
  - It has its own map and minimap, and GPS routes and R (back to the road) work there too. A green gate on the west side leads back to the island.
- **Your bike's city look.** In the city the bike becomes "Cyberpunk bike" by daCruz, with the same handling. The wheels spin and steer, your colour glows underneath, and in first person its screen shows your real speed. The model is only downloaded when you head for the city (1.3 MB, trimmed from 3.1 MB). The car looks the same in both worlds.
- **Each rider travels alone.** You only see riders in the same world as you. When someone crosses, the world they left is told (for example "Ravi warped into the neon city") and so is the one they arrive in ("Ravi rolled in from the island"). The rider list shows 🏝 or 🌃 next to each name.
- **Races and Manhunt stay on the island.** The portal stays shut while you're in a race or a hunt, and riding through it takes you out of a lobby you were waiting in. New riders always start on the island.
- **Smooth on every device.** The city is built a little at a time in quiet moments soon after you join, so the trip through the portal is instant. It's about 50 draw calls, with its glow faked rather than lit. On the Low preset only the signs are reflected, and on Eco nothing is.

## 1.5 · Radio search fixed · 22 Oct 2026

- **Radio song search works again.** The public Invidious servers it used have gone offline: the last working one returns errors, and none still allow API searches.
- **New `/api/search` function:** searches with the official YouTube Data API v3. The key stays on the server (`YOUTUBE_API_KEY` in Vercel), and only embeddable videos are returned, with lengths.
- **Caching:** every result is cached by Vercel for a day, so the suggestion chips and repeat searches don't use up the free quota (about 100 new searches a day).
- **Fallbacks:** a browser-side key if one is built in, then Invidious, as a last resort.
- **Clearer message:** if the key isn't set up yet, the Songs tab says so (instead of "try again"). Live radio is unaffected.
- **Search is live:** the key is set up on the site.
- **New logo:** the neon helmet badge is now the home-screen app icon, and the browser tab shows the helmet inside its orange-and-cyan ring (the full badge turns to a blur at 16 px).

## 1.4 · Phones and joining from any network · 22 Oct 2026

- **Landscape + full screen:**
  - The first tap anywhere goes full screen and locks landscape (browsers need a tap before they allow full screen).
  - Holding the phone upright shows a "turn your phone sideways" screen.
  - New web app manifest and icons: Add to Home Screen opens CruiseWay full-screen in landscape with no browser bars.
- **Thumb controls:**
  - Drag on the left half of the screen for analogue steering.
  - GAS, BRAKE (hold to reverse) and DRIFT on the right, plus WHEELIE on the bike and a ⚡ button when you have a Manhunt power-up.
  - Pause, camera, reset and vehicle buttons along the top.
  - Several fingers work at once.
- **Map:** tap the minimap to open it. Pinch to zoom, drag to pan, tap spots, and long-press to drop a waypoint (quick taps never drop pins). A Close button was added.
- **Compact HUD** for short landscape screens. The pause menu's Controls tab explains the touch controls.
- **Phone extras:** Low graphics by default, vibration on hits, tags, checkpoints and power-ups (Android), and the screen stays awake while riding.
- **The radio is PC-only:** its YouTube player needs a large visible box, and phones play music from their own apps alongside the game.
- **Joining from any network:** the TURN relay is now switched on, running on Cloudflare's free TURN service. Players whose networks can't connect directly (the Mac join failures, strict home routers, mobile data) now connect through the relay. `/api/ice` reports `"relay": true`, and the relay was confirmed to hand out connections.

## 1.3 · Manhunt · 22 Oct 2026

- **New mode, Manhunt:** tag with vehicles for 3+ riders. The 1-2 star race spots are now purple Manhunt arenas.
- **Lobby:** the host chooses 3, 5 or 8 minutes. The lobby waits until 3 riders are in.
- **Start:** one random rider is IT and gets a 5 s pause while the runners scatter. The IT starts in the middle; runners start 170-260 m out.
- **Tagging:** touch a runner to pass IT on. The host checks each tag (swept, so fast passes count). The new IT waits 2 s, and there are no tag-backs for 3 s.
- **Shrinking zone:** a holographic ring about 1 km across that follows the ground. It closes after 20 s to about 220 m by 90% of the round, and it's shown on the map.
- **Power-ups for the IT** every 15-20 s, used with E: Nitro (4 s burst), Radar (see every runner for 6 s) and Shockwave (slows runners within 60 m).
- **Seeing each other:**
  - The IT has a red beacon and a red ring on the map.
  - Runners see the distance to the IT and a red edge glow when it's within 70 m.
  - The IT's minimap hides runners beyond 150 m unless Radar is on.
- **End:** whoever is IT at the end loses and everyone else wins (counted on the leaderboard). Results show time as IT and tags.

## 1.2 · Smooth roads, better car sound · 22 Oct 2026

- **No more jumps at junctions and bends:**
  - Roads now level out smoothly into the round junction pads, so there's no step at their rim.
  - Where two roads (or two parts of a hairpin) are about equally close, their heights blend instead of flipping between them.
  - Vertical speed comes from the slope you're driving on, not from how far the ground moved in the last 1/120 s, so a small step can't fling you up at 9 m/s.
  - Tyres stay planted over small crests and dips, like real suspension.
  - Results: across 202 km of road lanes in three worlds, sharp-bump spots went from 964 to 182 (0 at junctions), and the worst kink is a third as sharp. Riding at 100 km/h through 30 junctions on each vehicle, neither left the ground once.
- **New car engine sound:**
  - The hypercar now uses an ElevenLabs-generated car clip supplied by the project owner, replacing the Porsche recording.
  - It plays as overlapping random slices from four under-load stretches (about 5.6 s in all), so there's no repeating cycle.
  - Every slice is pitch-corrected, so the revs alone set the pitch.
  - The idle is the clip's coasting stretch.
  - **Softer and smoother:** a gentle low-pass takes the harsh top end off, opening slightly as the revs rise, and longer 0.5 s slices make the sound flow more evenly.
  - **Builds up as you pull away:** it starts quiet and swells to full volume by about 55 km/h, with slower fades between idle and driving.
  - Gear-change clunks and pops stay.
  - A sport-exhaust version (distortion, rasp and overrun crackle) was tried and removed because it sounded harsh.

## 1.1 · Hypercar, menus and joining · 22 Oct 2026

- **Hypercar:**
  - A second ride, an original single-seat hypercar: a low carbon body, a bubble canopy, carved fenders, side pods with chrome blades, a tall rear wing on struts, and turbine wheels with sidewall stripes in your colour.
  - Its own sound: a real Porsche flat-six recording (CC BY-SA 3.0, John64 on Wikimedia Commons), with idle, cruise and full-throttle loops following a seven-speed gearbox.
  - **Gear changes you can hear (car and bike):**
    - Upshifts: a brief ignition cut, a gearbox clunk and selector tick, and exhaust pops when you shift high in the revs.
    - Downshifts: a rev-matching blip, and crackles when you brake off the throttle.
    - The car gets the full version; the bike's is quicker and lighter, like a quickshifter.
  - Its own handling: faster (~210 km/h), quicker off the line, more grip, a little body roll, and no wheelies.
  - Its own cockpit view, with a steering yoke and dash under the canopy.
  - Model fixes after the first look:
    - The tail is solid (it was see-through from behind).
    - The diffuser fins sit on an angled panel under the tail instead of dangling below it.
    - The tyres are solid 3D tyres with a rounded tread and both sidewalls (they looked hollow).
- **V opens the vehicle picker**, with a studio render of each ride in your colour. Press 1 or 2, or click.
  - Your choice is remembered, and other players see it on your ghost.
  - You can't switch mid-race.
- **Tyres sit on the road:** roads are drawn a few cm above the ground they follow, so tyres used to sink in. Now they ride on the surface. The body also lifts where the ground under a tyre rises (dips), and the car's wheels no longer tip with the body when it rolls in corners.
- **Esc menu** split into General, Graphics, Audio and Controls tabs.
- **Start menu:** asks for your name first. Invite links join right after the name. This fixes guests joining under the wrong name, or as "Driver".
- **Joining:** a sturdier handshake, and TURN relay support via `/api/ice` for players on different networks (needs the env vars, see README).

## 1.0 · Day, night and weather · 22 Oct 2026

**Day cycle**
- The world runs on a fixed 20-tick-a-second clock, like Minecraft. A full day is 24,000 ticks (20 minutes).
- The sun rises, crosses the sky and sets. The colours move through dawn, noon, golden hour, dusk and a starry night with a moon.
- The headlight comes on at dusk and in fog, rain and storms. Reflections on the bike dim at night.
- The time and the weather show under the minimap.

**Weather**
- Spells of sunny, cloudy, foggy, rainy, snowy and thunderstorm weather, each lasting a few minutes. Each one blends into the next over about a minute: clouds roll in first, then the rain or snow starts.
- The order follows realistic rules:
  - Rain, snow and storms only come out of a cloudy sky, and storms ease off into rain.
  - A slowly drifting temperature makes clouds rain when it's warm and snow when it's cold.
  - Rain never turns straight into snow or the other way round: at least two dry spells come in between.
  - Fog favours dawn and night.
  - Over time it works out to about 35% sunny, 22% cloudy, 14% foggy, 12% rain, 10% snow and 7% thunderstorms.
- **Foggy:** thick fog cuts visibility to about 150 m.
- **Rainy:** rain streaks, grey skies, and roads that get darker and shinier, with puddles reflecting the sky. They dry slowly afterwards.
- **Snowy:** falling flakes. After a few minutes of snow, the ground, trees and roadsides are covered and the grass is buried. It melts away afterwards, faster in rain.
- **Thunderstorm:** heavy rain, a dark sky and wind, forked lightning bolts that light up the clouds and land, and thunder. Close strikes crack and boom; far ones roll for seconds. Thunder arrives after the flash, at the speed of sound.
- Rain and snow catch your headlight at night.
- Wet roads and snow cost a little grip.
- Everyone in a world sees the same time and weather: the host's clock and weather key are shared when you join.
- New setting in the Esc menu, **Weather: Live / Always sunny**. Always sunny applies to your screen only.
- Rain and snow drop counts follow the graphics preset. Each is a single GPU draw call.

## 0.9 · YouTube radio · 22 Oct 2026

**Radio (Q)**
- Songs now come from YouTube: search for any song and play it, free and with no sign-in.
- A small YouTube player sits in the bottom-left corner while a song plays. YouTube requires it to stay visible, so closing it (✕) pauses the song.
- Drag the player by its grip to any corner; it snaps there and remembers your choice. While you ride it fades to half, and hovering brings it back.
- Suggestion chips: Popular, Chill, Lo-Fi, Driving, Synthwave, Rock, Hip-Hop, EDM and Bollywood.
- When a song ends, the next one in the list plays. Videos that can't be embedded are skipped.
- Search uses public Invidious servers and fails over between them. Set `VITE_YOUTUBE_API_KEY` to use the official YouTube search instead.
- Live radio stations are unchanged.
- The player lives in its own module, `src/radio/youtube.js`, with `search(query)`, `play(id)`, `pause()`, `setVolume(0-100)` and an `ended` event.

**Deploys:** the Vercel project is now connected to GitHub. Pull requests get preview links, and merging into `main` goes live.

## 0.8 · Wheelies and smoother cornering · 22 Oct 2026

**Wheelies**
- Hold Shift (gamepad: X) above 40 km/h to lift the front wheel.
- A bar under the speedometer drains while you're up, then recharges after a short rest.
- While up, steering is about 5× weaker and the bike wobbles, so you have to keep correcting. In return you get a small speed boost.
- Hitting a wall or tree, braking or slowing down drops the front wheel.
- Friends see your wheelies on your ghost bike.
- In the cockpit and nose cameras the view pivots up with the bike and looks past it, so the sky fills the screen, the horizon drops to the bottom edge and only the top of the dash peeks into view. The look-up eases in over about a second and settles back when the front comes down.

**Cornering in races**
- Barriers sit about 2.8 m past the road edge, up from 1.1 m, so there's room to run wide.
- Brushing a wall slides you along it and turns the bike to follow it. Only head-on hits cost a lot of speed.
- Slightly sharper steering at high speed.

**Fixed:** a hit before audio was unlocked could abort a frame.

## 0.7 · Barriers, sound, radio and launch · 21 Oct 2026

**Launch**
- Deployed to Vercel at [cruiseway.vercel.app](https://cruiseway.vercel.app). It's a static site, and multiplayer runs peer-to-peer, so there's no game server.

**Race barriers**
- Holographic walls line both sides of the route while you race.
- They follow the road edge (narrower on dirt) and close off side roads at junctions.
- Hitting one pushes you back onto the track and costs speed: the harder the hit, the bigger the loss.
- Checkpoints count in order. Shortcuts no longer skip the route.

**Sound**
- Riding uses two recorded clips: one on tarmac, one on grass and dirt. They follow engine revs through a six-speed gearbox and crossfade as you leave or rejoin the road.
- Thumps for landings, tree hits and barrier hits; a splash when riding into water.
- Countdown beeps, checkpoint and finish chimes, the race-spot prompt, button ticks.
- A calm, generative zen soundtrack that never loops the same way.
- Esc menu: music and effects on/off, plus master, music and effects volume.

**Radio (Q)**
- Search and play full songs from Audius, or live internet radio stations from radio-browser.info.
- Recently played, trending suggestions with genre chips, and a now-playing mini player (play/pause, next, volume).
- The zen music fades out while the radio plays.

## 0.6 · Laptop performance, CruiseWay name, tidy codebase · 21 Oct 2026

**Performance:** on an Intel integrated GPU, with the same scene:
- triangles drawn per frame: 951k → 405k
- trees drawn into the shadow map: 478k triangles → 0
- draw calls: 221 → 170

**What changed**
- Graphics presets Eco, Low, Medium and High, plus Auto. Auto lowers resolution, then the preset, if frames run long, and never renders above native resolution.
- Frame-rate cap: 30, 60 or Max (default 60). The menu backdrop runs at 30.
- Lighter trees. Tree shadows on High only.
- Nothing is drawn behind the full-screen map.
- F3 performance overlay: FPS, CPU time, draw calls, triangles.
- The mouse cursor hides while riding and shows in menus; Alt+C toggles it.
- Renamed from "Convoy" to **CruiseWay** everywhere.
- Source reorganised into folders by purpose (`core/`, `network/`, `vehicle/`, `race/`, `ui/`, `audio/`, `radio/`, `world/generation/`, `world/rendering/`), with a folder guide in the README.

## 0.5 · Concept bike and cockpit dashboard · 21 Oct 2026

- A new hubless concept superbike:
  - glowing translucent tyres on open rims
  - a faceted lower body and a sculpted glossy upper body
  - colours paired to each player
- Cockpit view from the saddle, with a live digital speedometer on the steering head.
- The race lobby always runs its full 15 seconds; any member can press Start now.

## 0.4 · Smoother riding and race guidance · 21 Oct 2026

**Smoothness**
- The bike is drawn smoothly between physics updates.
- New cameras: chase (soft lag, rolls with the lean), far chase, cockpit, nose.
- Gentler lean angles.

**Races and GPS**
- 15-second lobbies before a race.
- The route on the map shrinks behind you as you ride it.
- TURN AROUND warning when riding the wrong way on a race route, or away from your GPS route.

## 0.3 · The island · 21 Oct 2026

**World**
- A finite island of about 8×8 km, with a coastline, sea and lakes.
- A road network: paved roads meeting at junctions, dirt roads, and dead-end trails.

**Race spots**
- Nine race spots, each with a fixed route, a name, and a difficulty rated against the island's other spots.
- Ride up, accept READY TO RACE?, gather friends, race.

**Map and GPS**
- A satellite-style map with spot cards, waypoints and GPS routing along the roads.
- A rotating minimap.

**Bike and riding**
- An enclosed streamliner bike.
- Grip that depends on the surface.
- Riding into water puts you back on the road.

**Fixed:** the bike no longer sinks into the road on climbs.

## 0.2 · Golden-hour hills · 21 Oct 2026

- One landscape, rebuilt for looks:
  - smooth rolling hills, with a road that runs along the hillsides
  - textured ground, swaying grass, forests
  - a cloudy golden-hour sky with haze that glows toward the sun
- Terrain builds in a background worker with distance-based detail, so hills reach about 2 km out without stuttering.
- A sport bike with leaning and suspension. Tree trunks are solid.

## 0.1 · First playable · 21 Oct 2026

- An endless procedural road and world, generated from a seed so every player sees the same place.
- Ghost multiplayer for up to 6 players: share a 5-letter world code, ride together as see-through bikes with name tags.
- Host-run races with a countdown and checkpoints, results, and a session wins leaderboard.
- Keyboard, gamepad and touch controls.
