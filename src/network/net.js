import { Peer } from 'peerjs';

// Peer-to-peer networking. The host's browser is the server: every guest
// connects only to the host, and the host relays state to everyone else.
// The world code maps directly to the host's peer id, so no backend is needed.

const PREFIX = 'cruiseway-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 6;

// STUN finds each player's public address; TURN relays the connection when
// two networks can't reach each other directly. The deployed site serves
// short-lived TURN credentials from /api/ice (see api/ice.js); without it
// we fall back to STUN only.
const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let icePromise = null;
function iceServers() {
  icePromise ||= fetch('/api/ice', { signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((j) => (Array.isArray(j.iceServers) && j.iceServers.length ? j.iceServers : FALLBACK_ICE))
    .catch(() => FALLBACK_ICE);
  return icePromise;
}
const peerOptions = async () => ({ debug: 0, config: { iceServers: await iceServers() } });

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.conns = new Map(); // host: guestId -> DataConnection
    this.hostConn = null;   // guest: connection to host
    this.listeners = {};
    this.closed = false;
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, ...a) { for (const fn of this.listeners[evt] || []) fn(...a); }

  get id() { return this.peer?.id; }

  // ---- host -------------------------------------------------------------

  async host(tries = 4) {
    this.isHost = true;
    const opts = await peerOptions();
    return new Promise((resolve, reject) => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, opts);
      let opened = false;
      peer.on('open', () => {
        opened = true;
        this.peer = peer;
        this.code = code;
        resolve(code);
      });
      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          if (err.type === 'unavailable-id' && tries > 0) this.host(tries - 1).then(resolve, reject);
          else reject(friendlyError(err));
        } else if (err.type !== 'peer-unavailable') {
          console.warn('peer error', err);
        }
      });
      peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
      peer.on('connection', (conn) => this.acceptGuest(conn));
    });
  }

  acceptGuest(conn) {
    // listen straight away: a guest's first message can beat the 'open' event
    conn.on('data', (msg) => { if (this.conns.get(conn.peer) === conn) this.emit('message', conn.peer, msg); });
    conn.on('open', () => {
      if (this.conns.size >= MAX_PLAYERS - 1) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.conns.set(conn.peer, conn);
      const gone = () => {
        if (this.conns.delete(conn.peer)) this.emit('leave', conn.peer);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
  }

  broadcast(msg, exceptId) {
    for (const [id, c] of this.conns) if (id !== exceptId && c.open) c.send(msg);
  }

  sendTo(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) c.send(msg);
  }

  kick(id) {
    const c = this.conns.get(id);
    if (c) c.close();
  }

  // ---- guest ------------------------------------------------------------

  async join(code) {
    this.isHost = false;
    const opts = await peerOptions();
    return new Promise((resolve, reject) => {
      const peer = new Peer(opts);
      this.peer = peer;
      let connected = false;
      const timer = setTimeout(() => {
        if (!connected) { peer.destroy(); reject(new Error("Found the world but couldn't connect to the host's network. Try again, or have the host check their connection.")); }
      }, 15000);
      peer.on('error', (err) => {
        if (!connected) { clearTimeout(timer); peer.destroy(); reject(friendlyError(err)); }
      });
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => {
          connected = true;
          clearTimeout(timer);
          this.hostConn = conn;
          this.code = code;
          resolve();
        });
        conn.on('data', (msg) => this.emit('message', 'host', msg));
        conn.on('close', () => { if (!this.closed) this.emit('hostLost'); });
        conn.on('error', () => { if (!this.closed) this.emit('hostLost'); });
      });
    });
  }

  send(msg) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  }

  close() {
    this.closed = true;
    for (const c of this.conns.values()) c.close();
    this.hostConn?.close();
    this.peer?.destroy();
  }
}

function friendlyError(err) {
  const map = {
    'peer-unavailable': 'No world found with that code. It may have closed.',
    'network': 'Network problem — check your connection.',
    'server-error': 'The matchmaking server is unreachable right now.',
    'browser-incompatible': 'This browser does not support WebRTC.',
    'unavailable-id': 'Could not create a world code, please try again.',
  };
  return new Error(map[err.type] || err.message || 'Connection failed.');
}
