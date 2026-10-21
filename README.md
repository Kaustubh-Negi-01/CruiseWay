# Convoy

An endless, relaxing open-road drive in the browser, built to be shared with friends.

Create a world, send the 5-letter code (or the invite link) to up to 5 friends, and cruise together. Other players show up as see-through ghost cars with name tags. When the host feels like it, they set a start and finish on the map and send a race invite. Everyone who accepts is moved to the same start line, frozen for a 3-2-1 countdown, and then it's a free-for-all. You have to pass each checkpoint, but you can take any route, so cutting corners through the hills is fair game.

## Features

- **Endless procedural world.** The world seed decides everything, so every player builds the identical road, terrain and trees on their own device.
- **World options picked by the host:** landscape (Meadows, Autumn, Desert, Alpine), time of day (Dawn, Midday, Sunset, Night), weather (Clear, Overcast, Fog, Rain, Snow), and an optional seed.
- **3 rides:** car, motorbike and bus. In free roam everyone picks their own ride. In a race the host picks one ride for everyone.
- **Ghost multiplayer** for up to 6 players. There are no collisions, and positions are interpolated so ghosts move smoothly.
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
| W A S D / arrows | Drive |
| Space | Handbrake / drift |
| R | Reset to road (in a race: last checkpoint) |
| C | Cycle camera |
| M | Map |
| Esc | Menu (change ride, leave) |

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
  physics.js       arcade vehicle model
  vehicles.js      ride specs and low-poly models
  markers.js       start/checkpoint/finish gates and beacon
  map.js           minimap / full map / race picker
  ui.js            HUD and overlays
  input.js         keyboard, gamepad, touch
  world/
    road.js        deterministic endless road
    world.js       terrain chunks, scenery, road meshes
    sky.js         lighting, sky, fog, rain/snow
    settings.js    world options
    noise.js       seeded RNG + simplex noise
```

Inspired by the calm open-road feel of games like slowroads.io. All code and art here is original.
