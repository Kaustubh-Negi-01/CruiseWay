import { TerrainGen } from './terrainGen.js';

// Builds terrain chunk data off the main thread so the ride never hitches.
let gen = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new TerrainGen(m.seed);
    return;
  }
  if (m.type === 'chunk' && gen) {
    const d = gen.buildChunk(m.cx, m.cz, m.seg);
    self.postMessage(
      { type: 'chunk', key: m.key, seg: m.seg, ...d },
      [d.pos.buffer, d.nor.buffer, d.road.buffer, d.trees.buffer],
    );
  }
};
