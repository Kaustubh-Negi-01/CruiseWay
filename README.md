# CruiseWay

**▶ Play now: [cruiseway.vercel.app](https://cruiseway.vercel.app)**. It runs in the browser on any laptop or phone, with nothing to install (on phones you can also add it to your home screen as an app). See [CHANGELOG.md](CHANGELOG.md) for everything that's been built so far.

An open-world island ride made to share with friends: hills under a day-night sky with changing weather, a whole network of roads and dirt tracks, race spots, and Manhunt arenas dotted around the map.

Create a world, send the 5-letter code (or the invite link) to up to 5 friends, and ride together on a superbike or a hypercar. Other riders show up as see-through ghosts with name tags.

## Features

- **An island to explore.** About 8×8 km, with a coastline and the sea all round, and lakes in some valleys. Rolling hills, pine forests, lone trees and knee-high grass that sways in the wind, under a sky with drifting clouds and haze that glows toward the sun.
- **Day, night and weather.**
  - The world keeps time in fixed ticks, like Minecraft: 20 ticks a second, and 24,000 ticks (20 real minutes) to a full day. You get sunrise, a bright noon, golden hour, a purple dusk, and a starry night with a moon. Your headlight comes on at dusk and in bad weather.
  - Random weather that blends smoothly from one kind to the next over about a minute:
    - **Sunny:** the classic look.
    - **Cloudy:** a grey sky, the in-between weather before rain or snow and after it clears.
    - **Foggy:** thick fog, about 150 m of visibility.
    - **Rainy:** rain, grey skies, and roads that turn dark and shiny with puddles.
    - **Snowy:** snowflakes. If it keeps snowing for a few minutes, the grass, trees and roadsides turn white.
    - **Thunderstorm:** heavy rain, a dark sky, lightning bolts that light up the clouds, and rolling thunder that arrives after the flash.
  - The order is realistic, not random:
    - Rain and snow only come from a cloudy sky, and storms ease off into rain.
    - A slowly drifting temperature decides whether clouds bring rain and storms (warm) or snow (cold). Rain never turns straight into snow or back: at least two dry spells come in between.
    - Fog is most likely at dawn and at night.
  - Everyone in a world shares the same clock and weather. The time and weather show under the minimap.
  - Wet roads and snow cost a little grip.
- **A road network.** Paved roads meet at junctions, with dashed centre lines on straights and double lines through bends. Dirt roads and dead-end trails lead into the hills, and everywhere in between is open ground you can ride across.
- **Same world for everyone.** The world seed decides everything (terrain, roads, trees and race spots), so every player builds the identical island on their own device. Terrain builds in a background worker with distance-based detail, so you can see about 2 km without stutter.
- **The ride: an enclosed streamliner superbike.** Fat tyres, glowing hubless rims, and light strips in your colour. It leans into corners, and its suspension follows the ground smoothly. Grip differs on tarmac, dirt and grass. Tree trunks are solid. Ride into the sea and you're put back on the road.
- **Two rides (V).**
  - **Hubless superbike:** leans into corners and pulls wheelies.
  - **Hypercar:** an original single-seater with a bubble canopy and a tall rear wing. It's faster and grippier, with no wheelies.
  - Switch any time outside a race. Your pick is remembered, and other players see your vehicle.
- **Manhunt (3+ riders).** Tag, with vehicles, at the purple arena spots (the island's 1-2 star spots).
  - **Lobby:** ride up and join. The host picks the round length (3, 5 or 8 min). It starts once at least 3 riders are in.
  - **Tagging:** one random rider is IT and gets a 5 s pause so the others can scatter. Touch a runner to pass IT on. The new IT waits 2 s and can't tag the person who tagged them for 3 s.
  - **The zone:** play is inside a holographic ring about 1 km across. It starts shrinking after 20 s and ends around 220 m.
  - **Power-ups:** the IT gets one every 15-20 s, used with **E**. Nitro is a 4 s speed burst, Radar reveals every runner for 6 s, and Shockwave slows runners within 60 m for 3 s.
  - **Seeing each other:** runners see a red beacon over the IT, and the screen edge glows red when the IT is within 70 m. The IT's minimap only shows runners within 150 m, unless Radar is on.
  - **Winning:** whoever is IT when time runs out loses, and everyone else wins. Results show each rider's time as IT and tags made.
- **Map and GPS.**
  - Press <kbd>M</kbd> for a satellite-style map of the island.
  - Click a race spot to see its card: length, checkpoints, twistiness, climbing, dirt %, and your best time. Manhunt arenas have their own card with the rules.
  - Press *Set route* for turn-by-turn GPS along the roads, or click anywhere on the map to drop a waypoint.
  - The minimap rotates with you and shows your route.
- **Race spots.**
  - Nine spots on every island, each with a name and a difficulty from 1 to 5 stars. Difficulty comes from length, twistiness, climbing and dirt, ranked against the other spots on that island.
  - The 3-5 star spots (Hard, Expert, Extreme) are race spots with a fixed route along the network. The 1-2 star spots are Manhunt arenas (see above).
  - Ride up to a spot and *READY TO RACE?* pops up. Accept, and a lobby opens for 15 seconds so friends can ride over and join. Any member can press *Start now*.
  - Then everyone spawns on the same start line for a frozen 3-2-1, then go.
  - Holographic barriers line both sides of the route while you race, with room to run wide in bends. Brush one and you slide along it; hit one head-on and you lose a lot of speed. Racing is about clean lines, not shortcuts.
  - Checkpoints count in order.
  - <kbd>R</kbd> takes you back to your last checkpoint.
  - Results at the end, and the session leaderboard counts wins.
- **Sound:**
  - The bike uses two recordings: one on tarmac and one on grass and dirt. They follow engine revs through a six-speed gearbox and crossfade as you leave or rejoin the road.
  - The hypercar uses its own recording, played as overlapping slices so it never audibly loops. It's softened by a gentle filter, follows the revs through a seven-speed gearbox, and swells in from quiet as you pull away.
  - Gear changes you can hear on both: a brief cut, a gearbox clunk, exhaust pops high in the revs, and a blip on downshifts.
  - Generated in code: thumps for landings, tree and barrier hits, and splashes; countdown beeps and checkpoint and finish chimes; rain, storm wind and thunder; a calm generative zen soundtrack.
  - Music and effects can each be turned on or off and set in volume in the Esc menu.
- **Radio (Q):**
  - Search any song on YouTube and play it, free and with no sign-in. Or tune in to live internet radio stations from radio-browser.info.
  - Songs play in a small YouTube player in the bottom-left corner. YouTube's rules require the player to stay visible while it plays, so hiding it pauses the song. Drag it by its grip to any corner; it fades while you ride.
  - Recently played, suggestion chips (Chill, Lo-Fi, Driving, Synthwave and more), and a now-playing mini player with play/pause, next and volume. When a song ends, the next result plays. Videos whose owners don't allow embedding are skipped.
  - The zen music fades out while the radio plays.
- **Controls:** keyboard, gamepad, and thumb controls on phones.
- **On phones:**
  - The game plays in landscape and full screen: the first tap anywhere switches to full screen and locks landscape. Holding the phone upright shows a "turn sideways" screen.
  - **Add to Home Screen** installs it as an app that opens straight into full-screen landscape.
  - **Controls:** drag on the left half to steer (analogue), or switch on **Tilt** in Esc > General and turn the phone like a steering wheel (Low / Medium / High sensitivity; a thumb on the left side still takes over). GAS / BRAKE / DRIFT and WHEELIE sit on the right, a ⚡ button appears for Manhunt power-ups, and pause, camera, reset and vehicle buttons sit along the top.
  - **Map:** tap the minimap for the big map. Pinch to zoom, drag to move, tap a spot for its card, and hold for half a second to drop a waypoint.
  - **Extras:** starts on the Low graphics preset, vibrates on hits and tags (Android), and keeps the screen awake while you ride.
  - **Radio:** it stays on PC, because its YouTube player needs a big box on screen. Play music from your phone's own music app instead; it mixes with the game.

| Key | Action |
| --- | --- |
| W A S D / arrows | Ride |
| Space | Rear brake / slide |
| Shift (hold, 40+ km/h) | Wheelie. Watch the bar under the speedometer; steering gets twitchy. |
| R | Reset to road (in a race: last checkpoint) |
| C | Cycle camera |
| V | Choose your vehicle: superbike or hypercar |
| E | Manhunt: use the IT's power-up |
| M | Map |
| Q | Radio |
| Enter / Backspace | Accept / dismiss a race prompt |
| Alt + C | Show / hide the mouse cursor (hidden while riding) |
| F3 | Performance overlay (FPS, CPU time, draw calls, triangles) |
| Esc | Menu |

## Graphics settings

Open the Esc menu to change these. They're remembered on each device.

| Preset | What it does |
| --- | --- |
| **Auto** (default on PC) | Runs Medium. If your machine can't hold the frame rate, it lowers resolution (down to 0.6×), then steps down to Low and then Eco. It never renders above native resolution. |
| **Eco** | Coolest and quietest. 30 FPS, 0.7× resolution, no shadows, no anti-aliasing, short view distance, sparse grass. |
| **Low** (default on phones) | 0.85× resolution, no anti-aliasing, vehicle shadow only, lighter terrain and grass. |
| **Medium** | Native resolution, anti-aliasing, vehicle shadow only, about 1.5 km view. |
| **High** | Up to 1.5× on HiDPI screens, tree shadows, full terrain detail, about 1.9 km view. |

Rain and snow use fewer drops on lighter presets. They're drawn on the GPU in one draw call each, so weather costs almost nothing on the CPU. The **Weather** setting can be **Live** (the shared forecast) or **Always sunny**, which applies to your screen only.

There's a separate frame-rate cap: 30, 60 (default) or Max. The game doesn't draw the 3D world while the full-screen map is open, and the menu backdrop runs at 30 FPS. Anti-aliasing can only change on a page reload.

## How multiplayer works

There is no game server. The host's browser *is* the server:

- The world code maps to the host's [PeerJS](https://peerjs.com) id.
- Guests open a WebRTC data channel straight to the host.
- The host relays positions 15 times a second and runs the roster, race lobbies and results.
- The free public PeerJS broker is used only to introduce browsers to each other.

Because of this, the whole game deploys as static files, and the world closes when the host leaves.

Players on different networks often can't connect directly, because home routers and mobile hotspots block it. Then the connection goes through a TURN relay. The game gets its STUN and TURN servers from a small Vercel function, `api/ice.js`, which mints short-lived TURN credentials so no secret ends up in the page.

The live site's relay is set up and running on Cloudflare's free TURN service, so players on any network can join.

**To set up a relay on your own deployment (one time):**
1. Create a free Cloudflare account. In the dashboard, open Realtime → TURN Server and create a TURN key. The free tier covers 1,000 GB a month.
2. In Vercel, open Project → Settings → Environment Variables. Add `CF_TURN_KEY_ID` (the key ID) and `CF_TURN_API_TOKEN` (the API token), then redeploy.
3. To check it worked, open `https://cruiseway.vercel.app/api/ice`. It should show `"relay": true`.

Any other TURN provider works too: set `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL` instead. Without a relay, players on strict networks see "couldn't connect to the host's network".

## Run locally

```bash
npm install
npm run dev
```

To test multiplayer on one machine, open two browser windows side by side. One creates a world and the other joins with the code. A tab that's in the background stops rendering, but it keeps relaying network traffic.

## Deployment

The game is live at **https://cruiseway.vercel.app**, hosted on Vercel as the `cruiseway` project. It's a static site: Vercel runs `npm run build` and serves the `dist` folder. There's no game server, because multiplayer runs peer-to-peer between players' browsers.

The Vercel project is connected to this GitHub repo. Every pull request gets its own preview deployment, and merging into `main` publishes to production automatically.

To publish by hand from a local checkout that's linked to the project:

```bash
npx vercel deploy --prod
```

Optional: song search uses public [Invidious](https://invidious.io) servers, which can be busy or go offline. For more reliable search, create a YouTube Data API v3 key and set it as the `VITE_YOUTUBE_API_KEY` environment variable (in Vercel: Project → Settings → Environment Variables, then redeploy). Restrict the key to your site's domain, because it ends up in the page.

Invite friends with a link that includes your world code: `https://cruiseway.vercel.app/?join=CODE`.

Netlify, Cloudflare Pages and GitHub Pages would work the same way, since it's a static site.

## Project layout

```
index.html                 page shell: menus, HUD, overlays (markup only)
src/
  main.js                  entry point: wires menus, settings, cursor, map overlay

  core/                    the game itself
    game.js                main loop, cameras, ghosts, GPS, race spots,
                           lobbies and races, graphics presets
    input.js               keyboard, gamepad and touch controls

  network/
    net.js                 PeerJS host/guest connection (world codes)

  vehicle/
    bike.js                the bike model, its tuning, cockpit speedometer
    physics.js             riding physics: grip, lean, suspension, collisions
    car.js                 the hypercar model and its tuning
    vehicles.js            the list of rides for the V menu

  modes/
    manhunt.js             Manhunt: rules, tags, power-ups, zone, results (host + players)
    arena.js               the shrinking holographic zone wall

  race/
    markers.js             start / checkpoint / finish gates and beacon
    barriers.js            holographic race walls + keeping racers inside them

  radio/
    radio.js               radio: YouTube songs + live stations, queue, recents
    youtube.js             standalone YouTube player + search (IFrame API, Invidious)

  audio/
    sound.js               sound engine: riding sounds, impacts, race chimes, settings
    music.js               generative zen soundtrack
    weather.js             rain, wind and thunder sounds

  mobile/
    mobile.js              phone detection, full screen + landscape, haptics, screen wake
    touchControls.js       thumb controls (analogue steering, pedals, buttons)

  ui/
    hud.js                 HUD, prompts, results, performance overlay
    map.js                 satellite map, minimap, GPS drawing
    radioPanel.js          radio panel (Q) and now-playing mini player
    style.css              all styling

  world/
    climate/
      climate.js           world clock (20 ticks/s), weather forecast, snow + wet build-up
    generation/            pure maths, shared with the background worker
      noise.js             seeded random + noise
      terrainGen.js        island height, terrain chunks, trees, map image
      network.js           road network + GPS routing
      spots.js             race spots, routes, difficulty, names
      terrain.worker.js    builds terrain off the main thread
    rendering/             three.js side of the world
      world.js             chunk streaming, roads, trees, water, beacons
      materials.js         shaders: ground, roads, grass, haze
      grass.js             grass around the rider
      sky.js               sun, moon, stars, clouds and light through the day
      weather.js           rain, snow and lightning effects
```

Where to look:
- **Handling feels off:** `src/vehicle/physics.js` (the tuning numbers are at the top of `src/vehicle/bike.js`).
- **Race rules:** `src/core/game.js`, in the race section.
- **How the island looks:** `src/world/`.
- **Buttons and menus:** `index.html` and `src/ui/`.

Inspired by the calm open-road feel of games like slowroads.io. All code and art here is original.

## Credits

- Radio: songs play through the official [YouTube](https://www.youtube.com) embedded player, so they're streamed by YouTube, with its ads and rules. Search goes through public [Invidious](https://invidious.io) servers, or the YouTube Data API if a key is set. Live stations come from the community directory [radio-browser.info](https://www.radio-browser.info). No music is bundled with the game.
- Riding sound: the three recordings in `public/audio/` were supplied by the project owner: a sportbike riding foley clip (`engine-road.mp3`), an ElevenLabs-generated off-road clip (`engine-offroad.mp3`), and an ElevenLabs-generated car clip for the hypercar (`engine-car.mp3`). The other effects and the music are generated in code.
