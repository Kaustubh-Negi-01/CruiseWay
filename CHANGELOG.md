# Changelog

Everything built so far, newest first. Live at **https://cruiseway.vercel.app**.

## 0.9 · YouTube radio

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

## 0.8 · Wheelies and smoother cornering

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

## 0.7 · Barriers, sound, radio and launch

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

## 0.6 · Laptop performance, CruiseWay name, tidy codebase

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

## 0.5 · Concept bike and cockpit dashboard

- A new hubless concept superbike:
  - glowing translucent tyres on open rims
  - a faceted lower body and a sculpted glossy upper body
  - colours paired to each player
- Cockpit view from the saddle, with a live digital speedometer on the steering head.
- The race lobby always runs its full 15 seconds; any member can press Start now.

## 0.4 · Smoother riding and race guidance

**Smoothness**
- The bike is drawn smoothly between physics updates.
- New cameras: chase (soft lag, rolls with the lean), far chase, cockpit, nose.
- Gentler lean angles.

**Races and GPS**
- 15-second lobbies before a race.
- The route on the map shrinks behind you as you ride it.
- TURN AROUND warning when riding the wrong way on a race route, or away from your GPS route.

## 0.3 · The island

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

## 0.2 · Golden-hour hills

- One landscape, rebuilt for looks:
  - smooth rolling hills, with a road that runs along the hillsides
  - textured ground, swaying grass, forests
  - a cloudy golden-hour sky with haze that glows toward the sun
- Terrain builds in a background worker with distance-based detail, so hills reach about 2 km out without stuttering.
- A sport bike with leaning and suspension. Tree trunks are solid.

## 0.1 · First playable

- An endless procedural road and world, generated from a seed so every player sees the same place.
- Ghost multiplayer for up to 6 players: share a 5-letter world code, ride together as see-through bikes with name tags.
- Host-run races with a countdown and checkpoints, results, and a session wins leaderboard.
- Keyboard, gamepad and touch controls.
