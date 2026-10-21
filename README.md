# Convoy

An endless golden-hour ride through rolling hills, made to share with friends.

Create a world, send the 5-letter code (or the invite link) to up to 5 friends, and ride together. Other riders show up as see-through ghost bikes with name tags. When the host feels like it, they set a start and finish on the map and send a race invite. Everyone who accepts is moved to the same start line, frozen for a 3-2-1 countdown, and then it's a free-for-all. You have to pass each checkpoint, but you can take any route, so cutting across the hills and weaving through forests is fair game.

## Features

- **Endless procedural landscape.** Smooth rolling hills and a road that rides along the hillsides through gentle cuts. Around it: knee-high grass that sways in the wind, pine forests, lone trees and heather, under a golden-hour sky with drifting clouds and haze that glows toward the sun.
- **Same world for everyone.** The world seed decides everything, so every player builds the identical road, hills and trees on their own device. Terrain builds in a background worker with distance-based detail, so hills stretch about 2 km out without stuttering.
- **One sport bike** with a tucked-in rider. It leans into corners, and its suspension soaks up the terrain, so riding off-road feels smooth. Tree trunks are solid, so forest shortcuts take some weaving.
- **Ghost multiplayer** for up to 6 players. There are no collisions between riders, and positions are interpolated so ghosts move smoothly.
- **Host-run races:**
  - Pick the start and finish on the map, or use the quick "3 / 6 / 10 km from me" buttons.
  - Choose how far apart checkpoints are.
  - Invites with accept/decline, then a frozen countdown.
  - <kbd>R</kbd> takes you back to your last checkpoint.
  - Live standings during the race.
  - After the first finisher, everyone else gets 60 more seconds.
- **Session leaderboard** of race wins per player. It lives only as long as the world does.
- **Controls:** keyboard, gamepad and on-screen touch controls.

| Key | Action |
| --- | --- |
| W A S D / arrows | Ride |
| Space | Rear brake / slide |
| R | Reset to road (in a race: last checkpoint) |
| C | Cycle camera |
| M | Map |
| Esc | Menu |

## How multiplayer works

There is no game server. The host's browser *is* the server:

- The world code maps to the host's [PeerJS](https://peerjs.com) id.
- Guests open a WebRTC data channel straight to the host.
- The host relays positions 15 times a second and runs the roster and races.
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
  main.js          menus, wiring, race-setup panel
  game.js          scene, camera, ghosts, session protocol + race logic
  net.js           PeerJS host/guest transport
  physics.js       motorbike handling, suspension, tree collisions
  bike.js          the bike + rider model and tuning
  markers.js       start/checkpoint/finish gates and beacon
  map.js           minimap / full map / race picker
  ui.js            HUD and overlays
  input.js         keyboard, gamepad, touch
  world/
    road.js        deterministic endless road
    world.js       chunk streaming (LOD), trees, road meshes
    terrainGen.js  height function, chunk + tree generation (shared with worker)
    terrain.worker.js  builds chunks off the main thread
    grass.js       streaming grass field around the rider
    materials.js   ground/road/grass shaders, haze, procedural textures
    sky.js         golden-hour light, sky dome, clouds
    noise.js       seeded RNG + simplex noise
```

Inspired by the calm open-road feel of games like slowroads.io. All code and art here is original.
