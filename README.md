# Convoy

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
  - You must pass each checkpoint, but any route counts, so off-road shortcuts are fair game.
  - <kbd>R</kbd> takes you back to your last checkpoint.
  - Results at the end, and the session leaderboard counts wins.
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
src/
  main.js          menus, wiring, map overlay
  game.js          scene, camera, ghosts, GPS, spots, lobbies + races
  net.js           PeerJS host/guest transport
  physics.js       bike handling, suspension, surfaces, tree collisions
  bike.js          the streamliner model and tuning
  markers.js       start/checkpoint/finish gates and beacon
  map.js           satellite map, minimap, GPS drawing
  ui.js            HUD and overlays
  input.js         keyboard, gamepad, touch
  world/
    network.js     road network: junctions, paved/dirt roads, trails, routing
    spots.js       race spots, routes, difficulty and names
    world.js       chunk streaming (LOD), trees, roads, junctions, water, spot beacons
    terrainGen.js  island height, chunks, trees, map image (shared with worker)
    terrain.worker.js  builds chunks off the main thread
    grass.js       streaming grass field around the rider
    materials.js   ground/road/grass shaders, haze, procedural textures
    sky.js         golden-hour light, sky dome, clouds
    noise.js       seeded RNG + simplex noise
```

Inspired by the calm open-road feel of games like slowroads.io. All code and art here is original.
