// Vercel serverless function: GET /api/search?q=...
//
// Song search for the radio, through the official YouTube Data API v3.
// The API key stays here on the server (set YOUTUBE_API_KEY in Vercel:
// Project → Settings → Environment Variables, then redeploy).
//
// Every answer is cached by Vercel's CDN for a day, so the same search (and
// the radio's suggestion chips) costs nothing after the first time. The
// free quota is 10,000 units a day; a new search costs about 101 units
// (search + video durations), so roughly 100 new searches a day.
//
// Reply: { items: [{ id, title, author, duration (s), thumb }] }

const API = 'https://www.googleapis.com/youtube/v3';

export default async function handler(req, res) {
  const key = process.env.YOUTUBE_API_KEY;
  const q = String(req.query?.q || '').trim().slice(0, 100);
  if (!key) { res.status(503).json({ error: 'not-configured' }); return; }
  if (!q) { res.status(400).json({ error: 'empty' }); return; }
  try {
    const params = new URLSearchParams({
      part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true',
      maxResults: '25', q, key, safeSearch: 'moderate',
    });
    const s = await fetch(`${API}/search?${params}`);
    if (!s.ok) throw new Error('search ' + s.status + ' ' + (await s.text()).slice(0, 200));
    const found = (await s.json()).items || [];
    const ids = found.map((it) => it.id?.videoId).filter(Boolean);
    // durations (1 unit for all of them)
    const lengths = {};
    if (ids.length) {
      const v = await fetch(`${API}/videos?${new URLSearchParams({ part: 'contentDetails', id: ids.join(','), key })}`);
      if (v.ok) for (const it of (await v.json()).items || []) lengths[it.id] = isoSeconds(it.contentDetails?.duration);
    }
    const items = found.filter((it) => it.id?.videoId).map((it) => ({
      id: it.id.videoId,
      title: decode(it.snippet.title),
      author: decode(it.snippet.channelTitle),
      duration: lengths[it.id.videoId] || 0,
      thumb: it.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${it.id.videoId}/mqdefault.jpg`,
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ items });
  } catch (e) {
    console.error('youtube search:', e.message);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'search-failed' });
  }
}

// "PT4M33S" -> 273
function isoSeconds(d) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

// YouTube titles come HTML-escaped
function decode(s) {
  return String(s || '').replace(/&(#39|quot|amp|lt|gt);/g, (_, c) => ({ '#39': "'", quot: '"', amp: '&', lt: '<', gt: '>' }[c]));
}
