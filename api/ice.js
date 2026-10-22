// Vercel serverless function: GET /api/ice
//
// Hands the game the ICE servers (STUN + TURN) its peer-to-peer connections
// use. TURN relays traffic when two players' networks can't connect directly,
// which is common across different home routers and mobile hotspots.
//
// TURN credentials are minted here, short-lived, so the secret key never
// reaches the browser. Set ONE of these in Vercel (Project → Settings →
// Environment Variables), then redeploy:
//
//   Cloudflare TURN (free tier: 1,000 GB/month)
//     CF_TURN_KEY_ID      the TURN key's ID
//     CF_TURN_API_TOKEN   the TURN key's API token
//
//   any other TURN provider with fixed credentials
//     TURN_URLS           comma-separated, e.g. turn:host:3478,turns:host:443?transport=tcp
//     TURN_USERNAME
//     TURN_CREDENTIAL
//
// With neither set, only STUN is returned (players on strict networks may
// fail to connect).

const STUN = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };

export default async function handler(req, res) {
  let iceServers = [STUN];
  try {
    const { CF_TURN_KEY_ID: id, CF_TURN_API_TOKEN: token } = process.env;
    if (id && token) {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      });
      if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
      const j = await r.json();
      const list = Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
      // browsers time out on port 53, which Cloudflare also offers
      iceServers = list.map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }));
    } else if (process.env.TURN_URLS) {
      iceServers.push({
        urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    }
  } catch (e) {
    console.error('ice:', e.message);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ iceServers, relay: iceServers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn'))) });
}
