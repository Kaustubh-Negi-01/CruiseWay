import { Peer } from 'peerjs';

// Peer-to-peer networking. The host's browser is the server: every guest
// connects only to the host, and the host relays state to everyone else.
// The world code maps directly to the host's peer id, so no backend is needed.

const PREFIX = 'cruiseway-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 6;

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

  host(tries = 4) {
    this.isHost = true;
    return new Promise((resolve, reject) => {
      const code = makeCode();
      const peer = new Peer(PREFIX + code, { debug: 0 });
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
    conn.on('open', () => {
      if (this.conns.size >= MAX_PLAYERS - 1) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 300);
        return;
      }
      this.conns.set(conn.peer, conn);
      conn.on('data', (msg) => this.emit('message', conn.peer, msg));
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

  join(code) {
    this.isHost = false;
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      let connected = false;
      const timer = setTimeout(() => {
        if (!connected) { peer.destroy(); reject(new Error('Could not reach that world. Check the code and try again.')); }
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
