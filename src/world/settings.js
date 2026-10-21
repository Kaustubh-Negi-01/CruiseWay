// World options the host picks when creating a world. They travel to every
// guest on join, so the whole lobby renders the same place.

export const BIOMES = {
  meadow: {
    label: 'Meadows',
    ground: [0x5f8f3a, 0x7aa64a, 0x4d7a30],
    rock: 0x7d7468,
    high: 0x8a8f7a,
    trees: ['pine', 'oak'],
    treeDensity: 0.55,
    mountain: 70,
    hill: 14,
  },
  autumn: {
    label: 'Autumn',
    ground: [0x8a8a3c, 0xa0883a, 0x6e7a34],
    rock: 0x7a6a5c,
    high: 0x8a7f6a,
    trees: ['autumn', 'pine'],
    treeDensity: 0.6,
    mountain: 55,
    hill: 12,
  },
  desert: {
    label: 'Desert',
    ground: [0xd6b07a, 0xc99b62, 0xe0bf8a],
    rock: 0xa86a44,
    high: 0xb87a50,
    trees: ['cactus', 'rock'],
    treeDensity: 0.18,
    mountain: 60,
    hill: 9,
  },
  alpine: {
    label: 'Alpine',
    ground: [0xe8edf2, 0xd5dde6, 0xf4f7fa],
    rock: 0x6b6f78,
    high: 0xffffff,
    trees: ['snowpine', 'pine'],
    treeDensity: 0.45,
    mountain: 130,
    hill: 18,
  },
};

export const TIMES = {
  dawn:   { label: 'Dawn',   sun: [0.6, 0.18], sky: 0xf2b8a0, horizon: 0xffd6b0, sunColor: 0xffc49a, sunI: 1.6, amb: 0.55, night: false },
  day:    { label: 'Midday', sun: [0.3, 0.9],  sky: 0x7fb6ea, horizon: 0xcfe6f7, sunColor: 0xffffff, sunI: 2.6, amb: 0.8, night: false },
  sunset: { label: 'Sunset', sun: [-0.7, 0.12], sky: 0xe0785a, horizon: 0xf7b06a, sunColor: 0xff9a5a, sunI: 1.8, amb: 0.5, night: false },
  night:  { label: 'Night',  sun: [0.2, 0.6],  sky: 0x0b1226, horizon: 0x1a2440, sunColor: 0x8899cc, sunI: 0.35, amb: 0.18, night: true },
};

export const WEATHER = {
  clear:    { label: 'Clear',    fog: 0.0019, precip: null },
  overcast: { label: 'Overcast', fog: 0.0028, precip: null, grey: 0.45 },
  fog:      { label: 'Fog',      fog: 0.0075, precip: null, grey: 0.6 },
  rain:     { label: 'Rain',     fog: 0.0035, precip: 'rain', grey: 0.55 },
  snow:     { label: 'Snow',     fog: 0.004, precip: 'snow', grey: 0.5 },
};

export const DEFAULT_SETTINGS = {
  seed: '',
  biome: 'meadow',
  time: 'day',
  weather: 'clear',
};

export function sanitizeSettings(s = {}) {
  return {
    seed: String(s.seed || '').slice(0, 32) || randomSeed(),
    biome: BIOMES[s.biome] ? s.biome : 'meadow',
    time: TIMES[s.time] ? s.time : 'day',
    weather: WEATHER[s.weather] ? s.weather : 'clear',
  };
}

export function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}
