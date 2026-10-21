// YouTubeRadio: a small, self-contained module that searches YouTube and plays
// results through the official YouTube IFrame Player API.
//
//   const yt = new YouTubeRadio({ container: el, apiKey: 'optional' });
//   const results = await yt.search('lofi hip hop');   // [{ id, title, author, duration, thumb }]
//   yt.play(results[0].id);    // load + play a video
//   yt.pause(); yt.play();     // pause / resume
//   yt.setVolume(70);          // 0-100
//   yt.on('ended', () => …);   // also: 'playing', 'paused', 'error', 'ready'
//
// The player must stay visible: YouTube's embed rules require a viewport of
// at least 200×200 px and don't allow hidden or audio-only playback. Give the
// module a container that is shown on screen while music plays.
//
// Search: if an `apiKey` (YouTube Data API v3) is given, it's used first;
// otherwise public Invidious servers are tried in turn (their list is fetched
// from api.invidious.io), falling back from one to the next.

const IFRAME_API = 'https://www.youtube.com/iframe_api';
const INVIDIOUS_DIRECTORY = 'https://api.invidious.io/instances.json?sort_by=type,users';
const INVIDIOUS_SEEDS = ['invidious.f5.si'];
const MIN_SIZE = 200;

let apiPromise = null;
function loadIframeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = IFRAME_API;
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('YouTube player could not load')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export class YouTubeRadio {
  constructor({ container, width = 240, height = 200, apiKey = '' } = {}) {
    if (!container) throw new Error('YouTubeRadio needs a container element');
    this.container = container;
    this.width = Math.max(MIN_SIZE, width);
    this.height = Math.max(MIN_SIZE, height);
    this.apiKey = apiKey;
    this.listeners = {};
    this.volume = 70;
    this.player = null;
    this.ready = null;
    this.instances = null;   // working Invidious servers, best first
    this.playing = false;
    this.currentId = null;
  }

  // ---- events ---------------------------------------------------------------

  on(event, fn) { (this.listeners[event] ||= new Set()).add(fn); return () => this.listeners[event].delete(fn); }
  emit(event, data) { for (const fn of this.listeners[event] || []) fn(data); }

  // ---- player ------------------------------------------------------------------

  // Creates the IFrame player on first use.
  init() {
    if (this.ready) return this.ready;
    this.ready = loadIframeApi().then((YT) => new Promise((resolve) => {
      const host = document.createElement('div');
      this.container.appendChild(host);
      this.player = new YT.Player(host, {
        width: this.width,
        height: this.height,
        playerVars: { autoplay: 1, controls: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: () => { this.player.setVolume(this.volume); this.emit('ready'); resolve(this.player); },
          onStateChange: (e) => this.onState(e.data),
          // 2 bad id, 5 html5 error, 100 removed/private, 101/150 embedding disabled by the owner
          onError: (e) => { this.playing = false; this.emit('error', { code: e.data, videoId: this.currentId }); },
        },
      });
    }));
    return this.ready;
  }

  onState(state) {
    const S = window.YT.PlayerState;
    if (state === S.PLAYING) { this.playing = true; this.emit('playing'); }
    else if (state === S.PAUSED) { this.playing = false; this.emit('paused'); }
    else if (state === S.ENDED) { this.playing = false; this.emit('ended', this.currentId); }
  }

  // play(videoId) loads and plays a video; play() with no id resumes.
  async play(videoId) {
    const p = await this.init();
    if (videoId && videoId !== this.currentId) {
      this.currentId = videoId;
      p.loadVideoById(videoId);
    } else {
      p.playVideo();
    }
  }

  pause() { this.player?.pauseVideo(); }

  stop() {
    this.player?.stopVideo();
    this.currentId = null;
    this.playing = false;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Math.round(v)));
    this.player?.setVolume?.(this.volume);
  }

  // ---- search --------------------------------------------------------------------

  // Returns up to `limit` videos: { id, title, author, duration (s), thumb }.
  async search(query, limit = 20) {
    query = String(query || '').trim();
    if (!query) return [];
    if (this.apiKey) {
      try { return await this.searchOfficial(query, limit); } catch { /* fall through to Invidious */ }
    }
    return this.searchInvidious(query, limit);
  }

  async searchOfficial(query, limit) {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=${Math.min(50, limit)}&q=${encodeURIComponent(query)}&key=${this.apiKey}`;
    const j = await getJSON(url);
    return (j.items || []).map((it) => ({
      id: it.id.videoId, title: decode(it.snippet.title), author: decode(it.snippet.channelTitle),
      duration: 0, thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
    }));
  }

  async searchInvidious(query, limit) {
    const servers = await this.invidiousServers();
    let lastError = null;
    for (const host of servers) {
      try {
        const j = await getJSON(`https://${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, 7000);
        if (!Array.isArray(j)) throw new Error('unexpected reply');
        // this one works: try it first next time
        this.instances = [host, ...servers.filter((h) => h !== host)];
        return j.filter((v) => v.type === 'video' && v.videoId && !v.liveNow).slice(0, limit).map((v) => ({
          id: v.videoId, title: v.title, author: v.author, duration: v.lengthSeconds || 0,
          thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        }));
      } catch (e) { lastError = e; }
    }
    throw lastError || new Error('No search server available');
  }

  // Public Invidious servers that allow API use, best known first.
  async invidiousServers() {
    if (this.instances) return this.instances;
    let list = [];
    try {
      const dir = await getJSON(INVIDIOUS_DIRECTORY, 6000);
      list = dir.filter(([, i]) => i.type === 'https' && i.api).map(([host]) => host);
    } catch { /* directory down: use the seeds */ }
    this.instances = [...new Set([...list, ...INVIDIOUS_SEEDS])];
    return this.instances;
  }
}

async function getJSON(url, timeout = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.json();
}

function decode(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}
