# CruiseWay

**▶ Play now: [cruiseway.vercel.app](https://cruiseway.vercel.app)**. It runs in the browser on any laptop or phone, with nothing to install (on phones you can also add it to your home screen as an app). See [CHANGELOG.md](CHANGELOG.md) for everything that's been built so far.

An open-world island ride made to share with friends: hills under a day-night sky with changing weather, a whole network of roads and dirt tracks, race spots, and Manhunt arenas dotted around the map. Portals at either end of the island lead to Hikari, a neon city that's always night, with a rooftop parkour line across its skyline.

Create a world, send the 5-letter code (or the invite link) to up to 5 friends, and ride together on a superbike or a hypercar. Other riders show up as see-through ghosts with name tags, drawn where they are right now.

## Features

- **An island to explore.** About 8×8 km, with a coastline and the sea all round, and lakes in some valleys. Rolling hills, pine forests, lone trees and knee-high grass that sways in the wind, under a sky with drifting clouds and haze that glows toward the sun.
- **Day, night and weather.**
  - The world keeps time in fixed ticks, like Minecraft: 20 ticks a second, and 24,000 ticks (20 real minutes) to a full day. You get sunrise, a bright noon, golden hour, a purple dusk, and a starry night with a moon. Your headlight comes on at dusk and in bad weather.
  - Random weather that blends smoothly from one kind to the next over about a minute:
    - **Sunny:** the classic look.
    - **Cloudy:** a grey sky, the in-between weather before rain or snow and after it clears.
    - **Foggy:** thick fog, about 150 m of visibility.
    - **Rainy:** rain, grey skies, and roads that turn dark and shiny with puddles. Drops fall straight down or slant with the wind, however fast you're going.
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
- **Jumps and landings.**
  - In the air, W / S pitch the nose down / up and A / D roll, so you can line up your landing. Keys you were already holding at takeoff don't count until you let go, so keeping W down off a ramp won't send you in nose-first.
  - The nose also follows the arc a little by itself, and a roll you let go of slowly rights itself.
  - Land lined up with the ground and you keep your speed. Land crooked or very hard and you lose some (up to 40%).
  - After a big drop the suspension squats and is damped harder for a moment, so it settles in one go.
- **Two rides (V).**
  - **Hubless superbike:** leans into corners and pulls wheelies.
  - **Hypercar:** an original single-seater with a bubble canopy and a tall rear wing. It's faster and grippier, with no wheelies. At speed, the handbrake (Space) plus steering throws it into a drift: about 25° sideways at full lock, keeping most of your speed, with grip coming back as you let go.
  - Switch any time outside a race. Your pick is remembered, and other players see your vehicle.
- **Hikari, the neon city (a second map).** Huge portals stand at the island's east and west ends. Ride through one to reach a Tokyo-inspired city that's always night:
  - The map came first, so it's easy to find your way:
    - a 10 × 10 grid of blocks inside a ring road lit purple;
    - the Loop, a boulevard round downtown lit cyan;
    - two central avenues meeting at a scramble crossing;
    - the Harbor (warehouses and container yards) to the west, where the portal home stands;
    - the Circuit District (a tech campus) to the east;
    - the bay north and south.
  - Shops at the edge, mid-rise blocks, and towers up to about 270 m inside the Loop, with lit windows, neon blade signs, shop signs, billboards and LED screens (all names invented).
  - Damp streets with faint reflections, and the city's own weather (drizzle, rain, fog, the odd thunderstorm).
  - **The Skyway:** a rooftop parkour line across the north row of blocks, about 0.7 km long and up to 23 m up. Glowing hard-light ramps climb from the street, bridges span the streets between roofs, pink launch lips throw you across gaps, and it ends with a 20 m drop back to the street.
  - One race and one Manhunt arena, each with a single flag:
    - **Hikari Grand Circuit** (3–5 km): a new route every race. It runs from the flag through the streets to the Skyway, over all of it, and back to the flag by other streets, never through the same crossing twice. The host picks the route as the race starts, and every rider gets the same one. Its gates, walls and drive line follow it up into the air. Fall off the Skyway and you're put back on it, a short run-up before where you fell. (No best time is kept, since the route changes.)
    - **Scramble Square** (Manhunt).
  - Buildings are solid, and the map, GPS and R reset all work there.
  - In the city your bike takes on a cyberpunk look (same handling), with a live speedo on its screen in first person.
  - You only see riders in the same world as you, and both worlds are told when someone crosses. The rider list shows 🏝 or 🌃 by each name. The portal stays shut during races and Manhunt.
- **Theme song.** CruiseWay's theme, "Apex Pursuit", plays on the menus while you type your name and create or join a world. Pressing *Create & drive* or *Join* fades it out in under a second, so the world appears in silence. (Browsers only allow sound after your first tap or key press, so it may start then.) A menu left open in a background tab stays quiet.
- **Drive line.** Chevrons on the road along your race or GPS route, coloured blue (keep going), yellow (ease off) or red (brake), from each bend's speed limit and your speed. On by default; Esc → General turns it off.
- **Island Odyssey, the island mega-event.** One extra flag (gold) on every island, next to the race spots:
  - **The circuit:** every paved road and dirt trail on the island in one ride (roughly 60–75 km of road), never riding the same road twice, and back to the flag at the end.
  - **Sky jumps:** where the roads don't join up, a giant launch ramp at the crossing throws you through the sky to the next road to ride, over lakes, forests and roads you've already done. There are 13–15 per island, up to about 300 m high and 12 s in the air. Each flight is a fixed arc that always lands on the road; you only do the stunts.
  - **Boosters:** glowing pads on the road and on each ramp's run-up get you up to speed.
  - **Two modes, chosen at the flag:**
    - **Zen Parkour** (just you, any time): no timer, no walls, nothing to lose, and the sky held at golden hour. <kbd>F</kbd> takes you back to the run-up of the last ramp you jumped, to practise it again.
    - **Parkour Race** (with whoever joins the lobby): gates and walls like any race, scored on time minus stunt points (1,000 points take a second off).
  - **Stunts in the air:** <kbd>W</kbd>/<kbd>S</kbd> frontflips and backflips, <kbd>A</kbd>/<kbd>D</kbd> flat 360s, <kbd>Q</kbd>/<kbd>E</kbd> barrel rolls (with W/S: corkscrews), each with its own momentum. Hold <kbd>Space</kbd> to grab: points build faster, but let go before you land or you bail. Keys already held at takeoff don't count until you let go.
  - **Combos and Overdrive:** a combo counter shows your tricks, points and multiplier. Near the ground, with no stunt keys held, an assist rights you. Land upright and the combo turns into an Overdrive boost; land sketchy and you keep half and get no boost; land on your roof (or still grabbing) and you bail.
  - **Resets keep you moving:** <kbd>R</kbd> puts you back at the last checkpoint already doing 80 km/h. Landing in deep water does the same straight away.
- **Finish cinematic.** Crossing a race finish cuts to a short in-game cinematic of your ride: camera cuts, then fireworks. Skip, Space, Enter or Esc ends it, and then the results appear.
- **Manhunt (3+ riders).** Tag, with vehicles, at the purple arena spots (the island's 1-2 star spots, and Scramble Square in Hikari).
  - **Lobby:** ride up and join. The host picks the round length (3, 5 or 8 min). It starts once at least 3 riders are in.
  - **Tagging:** one random rider is IT and gets a 5 s pause so the others can scatter. Touch a runner to pass IT on. The new IT waits 2 s and can't tag the person who tagged them for 3 s.
  - **The zone:** play is inside a holographic ring about 1 km across. It starts shrinking after 20 s and ends around 220 m.
  - **Power-ups:** the IT gets one every 15-20 s, used with **E**. Nitro is a 4 s speed burst, Radar reveals every runner for 6 s, and Shockwave slows runners within 60 m for 3 s.
  - **Seeing each other:** runners see a red beacon over the IT, and the screen edge glows red when the IT is within 70 m. The IT's minimap only shows runners within 150 m, unless Radar is on.
  - **Winning:** whoever is IT when time runs out loses, and everyone else wins. Results show each rider's time as IT and tags made.
- **Map and GPS.**
  - Press <kbd>M</kbd> for a satellite-style map of the island, or a night-time city guide in Hikari (with the Skyway in pink).
  - Click a race spot to see its card: length, checkpoints, twistiness, climbing, dirt %, and your best time. Manhunt arenas have their own card with the rules.
  - Press *Set route* for turn-by-turn GPS along the roads, or click anywhere on the map to drop a waypoint.
  - The minimap rotates with you and shows your route.
- **Race spots.**
  - Nine spots on every island, each with a name and a difficulty from 1 to 5 stars. Difficulty comes from length, twistiness, climbing and dirt, ranked against the other spots on that island.
  - The 3-5 star spots (Hard, Expert, Extreme) are race spots with a fixed route along the network. The 1-2 star spots are Manhunt arenas (see above).
  - Ride up to a spot and *READY TO RACE?* pops up. Accept, and a lobby opens for 15 seconds so friends can ride over and join. Any member can press *Start now*.
  - Then everyone spawns on the same start line for a frozen 3-2-1, then go.
  - While you race (or hunt), nothing else is on show: the other flags and the portals disappear from the world, the minimap and the map, and come back when it's over.
  - Holographic barriers line both sides of the route while you race, standing 4.6 m beyond the road edge, so there's room to run wide in bends. Brush one and you slide along it; hit one head-on and you lose a lot of speed. Racing is about clean lines, not shortcuts.
  - Checkpoints count in order.
  - <kbd>R</kbd> takes you back to your last checkpoint (in Hikari, to a short run-up before where you got to).
  - Results at the end, and the session leaderboard counts wins.
  - The leaderboard (riders and their wins, top left) is hidden while you ride. <kbd>Tab</kbd> shows and hides it. When a race or a Manhunt round ends, it shows for a few seconds and then slowly fades away.
- **Sound:**
  - The bike uses two recordings: one on tarmac and one on grass and dirt. They follow engine revs through a six-speed gearbox and crossfade as you leave or rejoin the road.
  - The hypercar uses its own recording, played as overlapping slices so it never audibly loops. It's softened by a gentle filter, follows the revs through a seven-speed gearbox, and swells in from quiet as you pull away.
  - Gear changes you can hear on both: a brief cut, a gearbox clunk, exhaust pops high in the revs, and a blip on downshifts.
  - Generated in code: thumps for landings, tree and barrier hits, and splashes; countdown beeps and checkpoint and finish chimes; rain, storm wind and thunder; a calm generative zen soundtrack.
  - The theme song on the menus (see above).
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
  - **Controls:** drag on the left half to steer (analogue). GAS / BRAKE / DRIFT and WHEELIE sit on the right, a ⚡ button appears for Manhunt power-ups, and pause, camera, reset and vehicle buttons sit along the top.
  - **Map:** tap the minimap for the big map. Pinch to zoom, drag to move, tap a spot for its card, and hold for half a second to drop a waypoint.
  - **Extras:** starts on the Low graphics preset, vibrates on hits and tags (Android), and keeps the screen awake while you ride.
  - **Radio:** it stays on PC, because its YouTube player needs a big box on screen. Play music from your phone's own music app instead; it mixes with the game.

| Key | Action |
| --- | --- |
| W A S D / arrows | Ride. In the air: W / S pitch the nose down / up and A / D roll, to line up your landing (keys already held at takeoff don't count until you let go). |
| Space | Rear brake / slide. In the car at speed, with steering: drift. |
| Shift (hold, 40+ km/h) | Wheelie. Watch the bar under the speedometer; steering gets twitchy. |
| R | Reset to road (in a race: last checkpoint; in Hikari, a short run-up before where you got to) |
| C | Cycle camera |
| V | Choose your vehicle: superbike or hypercar |
| E | Manhunt: use the IT's power-up. Mega-event, in the air: barrel roll right |
| M | Map |
| Tab | Show / hide the leaderboard |
| Q | Radio. Mega-event, in the air: barrel roll left (the radio stays shut during the event) |
| F | Mega-event, Zen Parkour: back to the run-up of the last ramp you jumped |
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
- The host relays positions 20 times a second and runs the roster, race lobbies and results.
- Each update carries the rider's velocity, so their ghost keeps moving between updates and is drawn slightly ahead (to make up for the network delay). Small corrections blend in rather than jump, so in a race you can see who's really in front.
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

**Radio song search (one time).** The radio searches YouTube through a small Vercel function, `api/search.js`, which uses the official YouTube Data API v3. The key stays on the server, and every search is cached for a day, so repeat searches and the suggestion chips are free. The free quota allows about 100 new searches a day.
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (any name).
2. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key**, then copy it. Click the key, and under **API restrictions** choose **Restrict key → YouTube Data API v3**, then save.
4. In Vercel, open Project → Settings → Environment Variables. Add `YOUTUBE_API_KEY` with that key (for Production and Preview), then redeploy.
5. To check it worked, open `https://cruiseway.vercel.app/api/search?q=coldplay`. It should list songs.

Without the key, the radio's Songs tab says search isn't switched on, and Live radio still works.

Invite friends with a link that includes your world code: `https://cruiseway.vercel.app/?join=CODE`.

Netlify, Cloudflare Pages and GitHub Pages would work the same way, since it's a static site.

## Project layout

```
index.html                 page shell: menus, HUD, overlays (markup only)
src/
  main.js                  entry point: wires menus, settings, cursor, map overlay, theme song

  core/                    the game itself
    game.js                main loop, cameras, ghosts, GPS, race spots,
                           lobbies and races, graphics presets
    input.js               keyboard, gamepad and touch controls

  network/
    net.js                 PeerJS host/guest connection (world codes)

  vehicle/
    bike.js                the bike model, its tuning, cockpit speedometer
    physics.js             riding physics: grip, lean, suspension, collisions, air control, landings,
                           sky-jump flights
    stunts.js              mega-event stunts: flips, 360s, rolls, grabs, combos, landing grades
    car.js                 the hypercar model and its tuning
    cityBike.js            the bike's city look (loads public/models/cyberbike.glb)
    vehicles.js            the list of rides for the V menu

  modes/
    manhunt.js             Manhunt: rules, tags, power-ups, zone, results (host + players)
    arena.js               the shrinking holographic zone wall

  race/
    markers.js             start / checkpoint / finish gates and beacon
    driveLine.js           the drive line: chevrons along a race or GPS route
    finishCine.js          the race-finish cinematic: camera shots and fireworks
    megaEvent.js           the island mega-event: Zen Parkour, Parkour Race, Overdrive, resets
    megaProps.js           its launch ramps and booster pads (meshes, and solid ground for the physics)
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
    portal.js              the portals between the island and the city (video + stand-in)
    city/                  Hikari, the neon city
      cityGen.js           the layout: streets, the Loop, districts, buildings, signs,
                           lights, containers, the Skyway (roofs, decks, 3D ground),
                           the race and Manhunt spots (from the seed)
      cityMap.js           the city's map picture
      city.js              its meshes and shaders: buildings, wet streets, neon, glow,
                           the Skyway's hard-light decks
      signs.js             the neon sign artwork (one atlas, drawn in code)
      citySky.js           the night sky, haze and the city's weather
    climate/
      climate.js           world clock (20 ticks/s), weather forecast, snow + wet build-up
    generation/            pure maths, shared with the background worker
      noise.js             seeded random + noise
      terrainGen.js        island height, terrain chunks, trees, map image
      network.js           road network + GPS routing
      spots.js             race spots, routes, difficulty, names
      terrain.worker.js    builds terrain off the main thread
      megaCircuit.js       the mega-event circuit: every road once, sky jumps, ramps, flights
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

Inspired by the calm open-road feel of games like slowroads.io. All code and art here is original, except the city bike model (see Credits).

## Credits

- City bike model: "Cyberpunk bike" (https://skfb.ly/6RAYJ) by daCruz is licensed under Creative Commons Attribution-NonCommercial (http://creativecommons.org/licenses/by-nc/4.0/). `public/models/cyberbike.glb` is that model trimmed for the game (rescaled, wheels separated so they spin, texture saved as JPEG). It is **not** covered by this project's MIT license, and it may not be used commercially. If CruiseWay ever makes money (ads, paid versions, sponsorships), this model must be replaced first.

- Radio: songs play through the official [YouTube](https://www.youtube.com) embedded player, so they're streamed by YouTube, with its ads and rules. Search uses the official YouTube Data API through the site's own `/api/search` function, with public [Invidious](https://invidious.io) servers as a last-resort fallback. Live stations come from the community directory [radio-browser.info](https://www.radio-browser.info). No music is bundled with the game.
- Portal: `public/video/portal.mp4` is a clip supplied by the project owner, cropped to the ring, faded to black round it and re-encoded for the game.
- Theme song: `public/audio/theme.m4a` is "Apex Pursuit", supplied by the project owner (the sound track of their clip, copied out without re-encoding).
- Riding sound: the three recordings in `public/audio/` were supplied by the project owner: a sportbike riding foley clip (`engine-road.mp3`), an ElevenLabs-generated off-road clip (`engine-offroad.mp3`), and an ElevenLabs-generated car clip for the hypercar (`engine-car.mp3`). The other effects and the music are generated in code.
