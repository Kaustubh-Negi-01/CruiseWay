# CruiseWay

An open-world island ride made to share with friends: golden-hour hills, a whole network of roads and dirt tracks, and race spots dotted around the map.

Create a world, send the 5-letter code (or the invite link) to up to 5 friends, and ride together. Other riders show up as see-through ghost bikes with name tags.

## Features

- **An island to explore.** About 8×8 km, with a coastline and the sea all round, and lakes in some valleys. Rolling hills, pine forests, lone trees and knee-high grass that sways in the wind, all under a golden-hour sky with drifting clouds and haze that glows toward the sun.
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
  - Holographic barriers line both sides of the route while you race. Brushing one pushes you back onto the track and costs you speed, so racing is about clean lines, not shortcuts.
  - Checkpoints count in order.
  - <kbd>R</kbd> takes you back to your last checkpoint.
  - Results at the end, and the session leaderboard counts wins.
- **Sound (all generated live, no audio files):**
  - riding: a deep petrol twin engine with a six-speed gearbox (it shifts as you speed up and burbles when you lift off), tyre roar that changes on tarmac, dirt and grass, and wind that builds with speed
  - tyre screech and scrub when you brake, slide or lean hard
  - thumps for landings, tree and barrier hits, and splashes
  - countdown beeps and checkpoint and finish chimes
  - a calm generative zen soundtrack
  - music and effects can each be turned on or off and set in volume in the Esc menu
- **Controls:** keyboard, gamepad and on-screen touch controls.

| Key | Action |
| --- | --- |
| W A S D / arrows | Ride |
| Space | Rear brake / slide |
| R | Reset to road (in a race: last checkpoint) |
| C | Cycle camera |
| M | Map |
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

## Deploy to Vercel

1. Push this repo to GitHub.
2. On vercel.com choose **Add New → Project** and import the repo. Vercel detects Vite automatically: the build command is `npm run build` and the output folder is `dist`.
3. Deploy, then share `https://<your-app>.vercel.app/?join=CODE` links.

Netlify, Cloudflare Pages and GitHub Pages work the same way, because it's a static site.

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

  audio/
    sound.js               sound engine: riding sounds, impacts, race chimes, settings
    music.js               generative zen soundtrack

  ui/
    hud.js                 HUD, prompts, results, performance overlay
    map.js                 satellite map, minimap, GPS drawing
    style.css              all styling

  world/
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
      sky.js               sky, sun, clouds, reflections
```

Where to look:
- **Handling feels off:** `src/vehicle/physics.js` (the tuning numbers are at the top of `src/vehicle/bike.js`).
- **Race rules:** `src/core/game.js`, in the race section.
- **How the island looks:** `src/world/`.
- **Buttons and menus:** `index.html` and `src/ui/`.

Inspired by the calm open-road feel of games like slowroads.io. All code and art here is original.

## Credits

- Engine recordings in `public/audio/` were supplied by the project owner: a sportbike riding foley clip (`engine-road.mp3`) and an ElevenLabs-generated off-road clip (`engine-offroad.mp3`). Everything else, including the other sounds and the music, is generated in code.
