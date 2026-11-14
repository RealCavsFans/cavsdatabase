// RealCavsFans YouTube uploads (@realcavsfanscom) -> rcf-videos.json, shown only on the Media page.
// Runs from .github/workflows/videos.yml. YouTube Data API first (YT_API_KEY secret), public feed as backup.
// Writes the file only when the video list changes, so quiet runs don't trigger a page rebuild.
import { writeFile, readFile } from 'node:fs/promises';

const CHANNEL = 'UCcGbex5p0EHdYQq_8WHlVEg'; // @realcavsfanscom
const OUT = new URL('../rcf-videos.json', import.meta.url);
const KEEP = 24;
const warn = m => console.log(`::warning::rcf-videos: ${m}`);
const unescape = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function fromApi(key) {
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=${KEEP}&playlistId=UU${CHANNEL.slice(2)}&key=${key}`);
    if (!r.ok) { warn(`API HTTP ${r.status}`); return null; }
    const d = await r.json();
    return (d.items || []).map(i => ({ id: i.snippet?.resourceId?.videoId, title: i.snippet?.title, published: i.snippet?.publishedAt }))
      .filter(v => v.id && v.title && !/^(Private|Deleted) video$/.test(v.title));
  } catch (e) { warn(`API ${e.message}`); return null; }
}
async function fromFeed() {
  for (const u of [`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`, `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CHANNEL.slice(2)}`]) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com video feed)' } });
      const t = await r.text();
      if (!r.ok || !t.includes('<entry>')) continue;
      return [...t.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
        id: (e.match(/<yt:videoId>(.*?)</) || [])[1], title: unescape((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''), published: (e.match(/<published>(.*?)</) || [])[1] || '',
      })).filter(v => v.id && v.title);
    } catch (e) { warn(`feed ${e.message}`); }
  }
  return null;
}

let vids = process.env.YT_API_KEY ? await fromApi(process.env.YT_API_KEY) : null;
if (!vids || !vids.length) vids = await fromFeed();
if (!vids || !vids.length) { warn('no source answered; keeping the existing file'); process.exit(0); }
vids = vids.sort((a, b) => b.published.localeCompare(a.published)).slice(0, KEEP);
const next = JSON.stringify(vids, null, 1) + '\n';
let prev = ''; try { prev = await readFile(OUT, 'utf8'); } catch {}
if (prev === next) { console.log('rcf-videos.json unchanged'); process.exit(0); }
await writeFile(OUT, next);
console.log(`::notice::rcf-videos.json: ${vids.length} videos`);
