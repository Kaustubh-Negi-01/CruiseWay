import { SUGGESTIONS } from '../radio/radio.js';

// The radio panel (Q) and the mini player at the bottom of the screen.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (t) => (t ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '');

export class RadioPanel {
  constructor(radio) {
    this.radio = radio;
    this.el = $('#radio');
    this.body = $('#radioBody');
    this.source = 'songs';     // 'songs' | 'live'
    this.genre = 'Popular';
    this.query = '';
    this.lists = {};           // cached result lists by key
    this.reqId = 0;

    this.el.querySelectorAll('[data-src]').forEach((b) => (b.onclick = () => this.setSource(b.dataset.src)));
    $('#radioClose').onclick = () => this.close();
    $('#radioSearch').addEventListener('submit', (e) => { e.preventDefault(); this.search($('#radioQuery').value.trim()); });
    $('#radioQuery').addEventListener('input', (e) => { if (!e.target.value.trim() && this.query) this.search(''); });
    this.renderGenres();

    // mini player
    $('#npToggle').onclick = () => {
      // the YouTube player has to be visible to play, so bring it back first
      if (radio.current?.kind === 'video' && this.videoHidden) { this.videoHidden = false; this.renderPlayer(); }
      radio.toggle();
    };
    $('#ytHide').onclick = () => { this.videoHidden = true; radio.pause(); this.renderPlayer(); };
    radio.on(() => { if (radio.playing && radio.current?.kind === 'video') this.videoHidden = false; });
    $('#npNext').onclick = () => radio.next();
    $('#npOpen').onclick = () => this.toggle();
    const vol = $('#npVolume');
    vol.value = Math.round(radio.volume * 100);
    vol.addEventListener('input', () => radio.setVolume(vol.value / 100));
    radio.on(() => { this.renderPlayer(); if (this.isOpen) this.markPlaying(); });
    this.renderPlayer();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  open() {
    this.el.classList.remove('hidden');
    this.render();
    // focus the search box without the Q that opened the panel landing in it
    setTimeout(() => $('#radioQuery').focus(), 0);
  }

  close() {
    this.el.classList.add('hidden');
    $('#radioQuery').blur();
  }

  setSource(src) {
    this.source = src;
    this.genre = 'Popular';
    this.query = '';
    $('#radioQuery').value = '';
    $('#radioQuery').placeholder = src === 'songs' ? 'Search any song on YouTube' : 'Search stations, genres, countries';
    this.el.querySelectorAll('[data-src]').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
    this.renderGenres();
    this.render();
  }

  renderGenres() {
    const box = $('#radioGenres');
    box.classList.toggle('hidden', this.source !== 'songs');
    box.innerHTML = '';
    for (const g of Object.keys(SUGGESTIONS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g;
      b.classList.toggle('on', g === this.genre);
      b.onclick = () => { this.genre = g; this.query = ''; $('#radioQuery').value = ''; this.renderGenres(); this.render(); };
      box.appendChild(b);
    }
  }

  search(q) {
    this.query = q;
    this.render();
  }

  // Recently played + suggestions, or search results.
  async render() {
    const id = ++this.reqId;
    const r = this.radio;
    const recent = r.recent.filter((x) => (this.source === 'songs' ? x.kind === 'video' : x.kind === 'station')).slice(0, 6);
    const key = this.query ? `${this.source}:q:${this.query}` : `${this.source}:s:${this.genre || ''}`;
    const title = this.query ? `Results for “${esc(this.query)}”`
      : this.source === 'songs' ? `Suggested · ${esc(this.genre)}` : 'Popular stations';
    const head = !this.query && recent.length ? `<h3>Recently played</h3>${this.listHTML(recent, 'recent')}` : '';
    this.body.innerHTML = `${head}<h3>${title}</h3><div class="radio-status">Loading…</div>`;
    try {
      let list = this.lists[key];
      if (!list) {
        list = this.query
          ? (this.source === 'songs' ? await r.searchSongs(this.query) : await r.searchStations(this.query))
          : (this.source === 'songs' ? await r.suggested(this.genre) : await r.topStations());
        this.lists[key] = list;
      }
      if (id !== this.reqId) return;
      this.currentLists = { recent, main: list };
      this.body.innerHTML = `${head}<h3>${title}</h3>` + (list.length ? this.listHTML(list, 'main') : '<div class="radio-status">Nothing found. Try another search.</div>');
      this.bind();
    } catch {
      if (id !== this.reqId) return;
      this.currentLists = { recent, main: [] };
      this.body.innerHTML = `${head}<h3>${title}</h3><div class="radio-status err">Couldn't reach the song search right now. Try again in a moment, or use Live radio.</div>`;
      this.bind();
    }
  }

  listHTML(list, which) {
    return `<ul class="radio-list">${list.map((it, i) => `
      <li><button class="radio-row" data-list="${which}" data-i="${i}">
        ${it.art ? `<img src="${esc(it.art)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'art-fallback',textContent:'${esc((it.title[0] || '♪').toUpperCase())}'}))">` : `<span class="art-fallback">${esc((it.title[0] || '♪').toUpperCase())}</span>`}
        <span class="meta"><b>${esc(it.title)}</b><small>${esc(it.artist)}</small></span>
        <span class="dur">${it.kind === 'station' ? '<i class="live">LIVE</i>' : mmss(it.duration)}</span>
      </button></li>`).join('')}</ul>`;
  }

  bind() {
    this.body.querySelectorAll('.radio-row').forEach((b) => {
      b.onclick = () => {
        const list = this.currentLists[b.dataset.list];
        this.radio.play(list[Number(b.dataset.i)], list);
      };
    });
    this.markPlaying();
  }

  markPlaying() {
    const cur = this.radio.current;
    this.body.querySelectorAll('.radio-row').forEach((b) => {
      const it = this.currentLists?.[b.dataset.list]?.[Number(b.dataset.i)];
      b.classList.toggle('playing', !!cur && !!it && it.kind === cur.kind && it.id === cur.id);
    });
  }

  renderPlayer() {
    const r = this.radio, it = r.current, np = $('#nowPlaying');
    np.classList.toggle('hidden', !it);
    const video = !!it && it.kind === 'video' && !this.videoHidden;
    $('#ytCard').classList.toggle('hidden', !video);
    document.body.classList.toggle('video-on', video);
    if (!it) return;
    $('#npArt').innerHTML = it.art ? `<img src="${esc(it.art)}" alt="">` : `<span class="art-fallback">${esc((it.title[0] || '♪').toUpperCase())}</span>`;
    $('#npTitle').textContent = it.title;
    $('#npArtist').textContent = r.error || it.artist;
    $('#npToggle').textContent = r.playing ? '❚❚' : '▶';
    $('#npToggle').title = r.playing ? 'Pause' : 'Play';
  }
}
