import { TerrainGen } from './terrainGen.js';

// Builds terrain chunk data and the map image off the main thread.
let gen = null;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new TerrainGen(m.seed);
    return;
  }
  if (!gen) return;
  if (m.type === 'chunk') {
    const d = gen.buildChunk(m.cx, m.cz, m.seg);
    self.postMessage(
      { type: 'chunk', key: m.key, seg: m.seg, ...d },
      [d.pos.buffer, d.nor.buffer, d.road.buffer, d.kind.buffer, d.trees.buffer],
    );
  } else if (m.type === 'map') {
    const px = gen.mapImage(m.size);
    self.postMessage({ type: 'map', size: m.size, px }, [px.buffer]);
  }
};
