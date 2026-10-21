// In-game radio: any song from YouTube (played in the official YouTube
// player, see youtube.js) and live internet radio stations from the
// community-run radio-browser.info directory. No account needed.
//
// Items look like:
//   { kind: 'video',   id (YouTube video id), title, artist, art, duration }
//   { kind: 'station', id, title, artist (tags/country), art, url }

import { YouTubeRadio } from './youtube.js';

const RADIO_HOSTS = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info'];
const RECENT_KEY = 'cruiseway:radioRecent';
const VOLUME_KEY = 'cruiseway:radioVolume';

// Suggestion chips: each is just a search run for you.
export const SUGGESTIONS = {
  Popular: 'top hit songs',
  Chill: 'chill songs playlist',
  'Lo-Fi': 'lofi hip hop',
  Driving: 'driving songs',
  Synthwave: 'synthwave',
  Rock: 'rock songs',
  'Hip-Hop': 'hip hop songs',
  EDM: 'edm songs',
  Bollywood: 'bollywood songs',
};

export class Radio {
  constructor({ videoContainer, youtubeKey = '' } = {}) {
    // songs: the YouTube player (must stay visible while it plays)
    this.yt = new YouTubeRadio({ container: videoContainer, width: 240, height: 200, apiKey: youtubeKey });
    this.yt.on('ended', () => this.next());
    this.yt.on('playing', () => { this.remember(this.current); this.emit(); });
    this.yt.on('paused', () => this.emit());
    this.yt.on('error', () => {
      // usually "the owner doesn't allow embedding": skip to the next one
      if (this.current?.kind !== 'video') return;
      this.error = "This one can't be played here, skipping…";
      this.emit();
      setTimeout(() => this.next(), 1200);
    });
    // stations: a plain audio element
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
  get playing() {
    if (!this.current) return false;
    return this.current.kind === 'video' ? this.yt.playing : !this.audio.paused;
  }

  setVolume(v) {
    this.volume = v;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* private mode */ }
    this.applyVolume();
  }
  setMaster(v) { this.masterVolume = v; this.applyVolume(); }
  applyVolume() {
    const v = Math.max(0, Math.min(1, this.volume * this.masterVolume));
    this.audio.volume = v;
    this.yt.setVolume(v * 100);
  }

  // ---- playback ---------------------------------------------------------------------

  async play(item, list = [item]) {
    this.queue = list;
    this.index = Math.max(0, list.indexOf(item));
    this.current = item;
    this.error = null;
    this.emit();
    try {
      if (item.kind === 'video') {
        this.audio.pause();
        await this.yt.play(item.id);
      } else {
        this.yt.pause();
        this.audio.src = item.url;
        await this.audio.play();
        this.remember(item);
        this.countStationClick(item.id);
      }
    } catch (e) {
      if (e.name !== 'AbortError') { this.error = 'Playback failed — try another.'; this.emit(); }
    }
  }

  toggle() {
    if (!this.current) return;
    if (this.current.kind === 'video') { if (this.yt.playing) this.yt.pause(); else this.yt.play(); return; }
    if (this.audio.paused) this.audio.play().catch(() => {}); else this.audio.pause();
  }

  pause() {
    if (this.current?.kind === 'video') this.yt.pause(); else this.audio.pause();
  }

  next() {
    if (!this.queue.length) return;
    const i = (this.index + 1) % this.queue.length;
    this.play(this.queue[i], this.queue);
  }

  stop() {
    this.yt.stop();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.current = null;
    this.emit();
  }

  remember(item) {
    if (!item) return;
    this.recent = [item, ...this.recent.filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, 20);
    save(RECENT_KEY, this.recent);
  }

  // ---- YouTube (songs) ----------------------------------------------------------

  async searchSongs(query) {
    return (await this.yt.search(query, 25)).map((v) => ({
      kind: 'video', id: v.id, title: v.title, artist: v.author, art: v.thumb, duration: v.duration,
    }));
  }

  suggested(chip = 'Popular') { return this.searchSongs(SUGGESTIONS[chip] || SUGGESTIONS.Popular); }

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
