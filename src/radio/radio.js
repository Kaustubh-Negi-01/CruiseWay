// In-game radio: songs from Audius (artists upload and share their own
// tracks; its public API allows apps to search and stream them) and live
// internet radio stations from the community-run radio-browser.info
// directory. Neither needs an account or API key.
//
// Items look like:
//   { kind: 'track',   id, title, artist, art, duration }
//   { kind: 'station', id, title, artist (tags/country), art, url }

const APP = 'CruiseWay';
const AUDIUS_DISCOVERY = 'https://api.audius.co';
const RADIO_HOSTS = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info'];
const RECENT_KEY = 'cruiseway:radioRecent';
const VOLUME_KEY = 'cruiseway:radioVolume';

export const GENRES = ['Chill', 'Lo-Fi', 'Electronic', 'Hip-Hop/Rap', 'Rock', 'Ambient', 'House', 'Pop'];

export class Radio {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.crossOrigin = null;
    this.queue = [];          // the list the current item was played from
    this.index = -1;
    this.current = null;
    this.listeners = new Set();
    this.recent = load(RECENT_KEY, []);
    this.volume = Number(localStorage.getItem(VOLUME_KEY) ?? 0.7);
    this.masterVolume = 1;
    this.applyVolume();
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('playing', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
    this.audio.addEventListener('error', () => {
      if (!this.current) return;
      this.error = 'Could not play that one, skipping…';
      this.emit();
      setTimeout(() => this.next(), 1200);
    });
  }

  // ---- state + events -------------------------------------------------------------

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  get playing() { return !!this.current && !this.audio.paused; }

  setVolume(v) {
    this.volume = v;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* private mode */ }
    this.applyVolume();
  }
  setMaster(v) { this.masterVolume = v; this.applyVolume(); }
  applyVolume() { this.audio.volume = Math.max(0, Math.min(1, this.volume * this.masterVolume)); }

  // ---- playback ---------------------------------------------------------------------

  async play(item, list = [item]) {
    this.queue = list;
    this.index = Math.max(0, list.indexOf(item));
    this.current = item;
    this.error = null;
    this.emit();
    try {
      this.audio.src = item.kind === 'track' ? await this.trackUrl(item.id) : item.url;
      await this.audio.play();
      this.remember(item);
      if (item.kind === 'station') this.countStationClick(item.id);
    } catch (e) {
      if (e.name !== 'AbortError') { this.error = 'Playback failed — try another.'; this.emit(); }
    }
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {}); else this.audio.pause();
  }

  next() {
    if (!this.queue.length) return;
    const i = (this.index + 1) % this.queue.length;
    this.play(this.queue[i], this.queue);
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.current = null;
    this.emit();
  }

  remember(item) {
    this.recent = [item, ...this.recent.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, 20);
    save(RECENT_KEY, this.recent);
  }

  // ---- Audius (songs) -----------------------------------------------------------

  async audiusHost() {
    if (this.host) return this.host;
    try {
      const j = await getJSON(AUDIUS_DISCOVERY);
      this.host = j.data?.[Math.floor(Math.random() * j.data.length)] || AUDIUS_DISCOVERY;
    } catch { this.host = AUDIUS_DISCOVERY; }
    return this.host;
  }

  async trackUrl(id) { return `${await this.audiusHost()}/v1/tracks/${id}/stream?app_name=${APP}`; }

  async searchTracks(query) {
    const h = await this.audiusHost();
    const j = await getJSON(`${h}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=30&app_name=${APP}`);
    return tracks(j.data);
  }

  async trending(genre) {
    const h = await this.audiusHost();
    const g = genre ? `&genre=${encodeURIComponent(genre)}` : '';
    const j = await getJSON(`${h}/v1/tracks/trending?limit=30${g}&app_name=${APP}`);
    return tracks(j.data);
  }

  // ---- radio-browser (live stations) ------------------------------------------------

  async radioGet(path) {
    for (const h of RADIO_HOSTS) {
      try { return await getJSON(h + path); } catch { /* try the next server */ }
    }
    throw new Error('Station directory unreachable');
  }

  async searchStations(query) {
    const q = encodeURIComponent(query);
    const [byName, byTag] = await Promise.all([
      this.radioGet(`/json/stations/search?name=${q}&limit=20&hidebroken=true&is_https=true&order=clickcount&reverse=true`),
      this.radioGet(`/json/stations/search?tag=${q}&limit=20&hidebroken=true&is_https=true&order=clickcount&reverse=true`),
    ]);
    const seen = new Set();
    return stations([...byName, ...byTag].filter((s) => !seen.has(s.stationuuid) && seen.add(s.stationuuid)));
  }

  async topStations() {
    return stations(await this.radioGet('/json/stations/search?limit=30&hidebroken=true&is_https=true&order=clickcount&reverse=true'));
  }

  // radio-browser asks apps to report plays so popular stations rank well
  countStationClick(uuid) { this.radioGet(`/json/url/${uuid}`).catch(() => {}); }
}

// ---- helpers -----------------------------------------------------------------------------

async function getJSON(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

function tracks(list = []) {
  return list
    .filter((t) => t.is_streamable !== false && !t.is_delete)
    .map((t) => ({
      kind: 'track', id: t.id, title: t.title, artist: t.user?.name || 'Unknown artist',
      art: t.artwork?.['150x150'] || '', duration: t.duration || 0,
    }));
}

function stations(list = []) {
  return list
    .filter((s) => s.url_resolved && s.url_resolved.startsWith('https'))
    .map((s) => ({
      kind: 'station', id: s.stationuuid, title: (s.name || 'Station').trim().slice(0, 80),
      artist: [s.tags?.split(',').slice(0, 3).join(', '), s.countrycode].filter(Boolean).join(' · ') || 'Live radio',
      art: s.favicon && s.favicon.startsWith('https') ? s.favicon : '', url: s.url_resolved,
    }));
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}
