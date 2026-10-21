# CruiseWay

**▶ Play now: [cruiseway.vercel.app](https://cruiseway.vercel.app)**. It runs in the browser on any laptop, with nothing to install. See [CHANGELOG.md](CHANGELOG.md) for everything that's been built so far.

An open-world island ride made to share with friends: golden-hour hills, a whole network of roads and dirt tracks, and race spots dotted around the map.

Create a world, send the 5-letter code (or the invite link) to up to 5 friends, and ride together. Other riders show up as see-through ghost bikes with name tags.

## Features

- **An island to explore.** About 8×8 km, with a coastline and the sea all round, and lakes in some valleys. Rolling hills, pine forests, lone trees and knee-high grass that sways in the wind, under a sky with drifting clouds and haze that glows toward the sun.
- **Day, night and weather.**
  - The world keeps time in fixed ticks, like Minecraft: 20 ticks a second, and 24,000 ticks (20 real minutes) to a full day. You get sunrise, a bright noon, golden hour, a purple dusk, and a starry night with a moon. The bike's headlight comes on at dusk and in bad weather.
  - Random weather that blends smoothly from one kind to the next over about a minute:
    - **Sunny:** the classic look.
    - **Foggy:** thick fog, about 150 m of visibility.
    - **Rainy:** rain, grey skies, and roads that turn dark and shiny with puddles.
    - **Snowy:** snowflakes. If it keeps snowing for a few minutes, the grass, trees and roadsides turn white.
    - **Thunderstorm:** heavy rain, a dark sky, lightning bolts that light up the clouds, and rolling thunder that arrives after the flash.
  - Everyone in a world shares the same clock and weather. The time and weather show under the minimap.
  - Wet roads and snow cost a little grip.
- **A road network.** Paved roads meet at junctions, with dashed centre lines on straights and double lines through bends. Dirt roads and dead-end trails lead into the hills, and everywhere in between is open ground you can ride across.
- **Same world for everyone.** The world seed decides everything (terrain, roads, trees and race spots), so every player builds the identical island on their own device. Terrain builds in a background worker with distance-based detail, so you can see about 2 km without stutter.
- **The ride: an enclosed streamliner superbike.** Fat tyres, glowing hubless rims, and light strips in your colour. It leans into corners, and its suspension follows the ground smoothly. Grip differs on tarmac, dirt and grass. Tree trunks are solid. Ride into the sea and you're put back on the road.
- **Map and GPS.**
  - Press <kbd>M</kbd> for a satellite-style map of the island.
  - Click a race spot to see its card: length, checkpoints, twistiness, climbing, dirt %, and your best time.
  - Press *Set route* for turn-by-turn GPS along the roads, or click anywhere on the map to drop a waypoint.
  - The minimap rotates with you and shows your route.
- **Race spots.**
  - Nine spots on every island. Each has a fixed route along the network, a name, and a difficulty from Easy to Extreme. Difficulty comes from length, twistiness, climbing and dirt, ranked against the other spots on that island.
  - Ride up to a spot and *READY TO RACE?* pops up. Accept, and a lobby opens for 15 seconds so friends can ride over and join. Any member can press *Start now*.
  - Then everyone spawns on the same start line for a frozen 3-2-1, then go.
  - Holographic barriers line both sides of the route while you race, with room to run wide in bends. Brush one and you slide along it; hit one head-on and you lose a lot of speed. Racing is about clean lines, not shortcuts.
  - Checkpoints count in order.
  - <kbd>R</kbd> takes you back to your last checkpoint.
  - Results at the end, and the session leaderboard counts wins.
- **Sound:**
  - Riding uses two recordings: one on tarmac and one on grass and dirt. They follow engine revs through a six-speed gearbox and crossfade as you leave or rejoin the road.
  - Generated in code: thumps for landings, tree and barrier hits, and splashes; countdown beeps and checkpoint and finish chimes; rain, storm wind and thunder; a calm generative zen soundtrack.
  - Music and effects can each be turned on or off and set in volume in the Esc menu.
- **Radio (Q):**
  - Search any song on YouTube and play it, free and with no sign-in. Or tune in to live internet radio stations from radio-browser.info.
  - Songs play in a small YouTube player in the bottom-left corner. YouTube's rules require the player to stay visible while it plays, so hiding it pauses the song. Drag it by its grip to any corner; it fades while you ride.
  - Recently played, suggestion chips (Chill, Lo-Fi, Driving, Synthwave and more), and a now-playing mini player with play/pause, next and volume. When a song ends, the next result plays. Videos whose owners don't allow embedding are skipped.
  - The zen music fades out while the radio plays.
- **Controls:** keyboard, gamepad and on-screen touch controls.

| Key | Action |
| --- | --- |
| W A S D / arrows | Ride |
| Space | Rear brake / slide |
| Shift (hold, 40+ km/h) | Wheelie. Watch the bar under the speedometer; steering gets twitchy. |
| R | Reset to road (in a race: last checkpoint) |
| C | Cycle camera |
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
| **Auto** (default) | Runs Medium. If your machine can't hold the frame rate, it lowers resolution (down to 0.6×), then steps down to Low and then Eco. It never renders above native resolution. |
| **Eco** | Coolest and quietest. 30 FPS, 0.7× resolution, no shadows, no anti-aliasing, short view distance, sparse grass. |
| **Low** | 0.85× resolution, no anti-aliasing, bike shadow only, lighter terrain and grass. |
| **Medium** | Native resolution, anti-aliasing, bike shadow only, about 1.5 km view. |
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

Known limitation: on some very strict networks (some corporate or campus Wi-Fi) WebRTC can't connect peers directly. Fixing that means adding a TURN server to the `Peer` config in `src/net.js`.

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
- Riding sound: the two recordings in `public/audio/` were supplied by the project owner: a sportbike riding foley clip (`engine-road.mp3`) and an ElevenLabs-generated off-road clip (`engine-offroad.mp3`). The other effects and the music are generated in code.
