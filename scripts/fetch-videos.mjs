// Pulls the official Cleveland Cavaliers YouTube feed and writes videos.json for the site.
// Runs on a schedule from .github/workflows/videos.yml. Node 20+, no dependencies.
// If YouTube doesn't answer, it keeps the existing videos.json and exits cleanly with a warning.
import { writeFile, readFile } from 'node:fs/promises';

const CHANNEL = 'UCOdS-I1sYkKWhtTjMUWP_TA'; // @cavs
const FEEDS = [
  `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
  `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CHANNEL.slice(2)}`, // the channel's uploads playlist
];
const OUT = new URL('../videos.json', import.meta.url);
const KEEP = 150;

const warn = m => console.log(`::warning::${m}`);
const unescape = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pick = (xml, tag) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getFeed() {
  for (const url of FEEDS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com video feed)', accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.8' } });
        const body = await res.text();
        if (res.ok && body.includes('<entry>')) return body;
        warn(`${url} attempt ${attempt}: HTTP ${res.status}, ${body.length} bytes`);
      } catch (e) {
        warn(`${url} attempt ${attempt}: ${e.message}`);
      }
      await sleep(3000 * attempt);
    }
  }
  return null;
}

// Preferred: YouTube Data API (reliable from GitHub's servers). Set the YT_API_KEY repository secret.
async function fromApi(key) {
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=UU${CHANNEL.slice(2)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) { warn(`YouTube Data API: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); return null; }
  const data = await res.json();
  return (data.items || []).map(i => ({
    id: i.snippet?.resourceId?.videoId,
    title: i.snippet?.title,
    published: i.snippet?.publishedAt,
  })).filter(v => v.id && v.title && v.title !== 'Private video' && v.title !== 'Deleted video');
}

let fresh = null;
if (process.env.YT_API_KEY) fresh = await fromApi(process.env.YT_API_KEY);
if (!fresh || !fresh.length) {
  if (!process.env.YT_API_KEY) warn('YT_API_KEY secret not set; trying the public feed');
  const xml = await getFeed();
  if (!xml) { warn('No video source answered; keeping existing videos.json'); process.exit(0); }
  fresh = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: pick(e, 'yt:videoId'),
    title: unescape(pick(e, 'title')),
    published: pick(e, 'published'),
  })).filter(v => v.id && v.title);
}

let old = [];
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const byId = new Map([...old, ...fresh].map(v => [v.id, v]));
const all = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, KEEP);

await writeFile(OUT, JSON.stringify(all, null, 1) + '\n');
console.log(`::notice::videos.json: ${all.length} videos (${fresh.length} in feed)`);
