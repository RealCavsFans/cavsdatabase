// Pulls the official Cleveland Cavaliers YouTube feed and writes videos.json for the site.
// Runs on a schedule from .github/workflows/videos.yml. Node 20+, no dependencies.
import { writeFile, readFile } from 'node:fs/promises';

const CHANNEL = 'UCOdS-I1sYkKWhtTjMUWP_TA'; // @cavs
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;
const OUT = new URL('../videos.json', import.meta.url);
const KEEP = 150; // the feed returns the latest 15; keep a running archive

const unescape = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pick = (xml, tag) => (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '';

const res = await fetch(FEED, { headers: { 'user-agent': 'cavsdatabase.com video feed' } });
if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);
const xml = await res.text();

const fresh = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
  id: pick(e, 'yt:videoId'),
  title: unescape(pick(e, 'title')),
  published: pick(e, 'published'),
})).filter(v => v.id && v.title);

let old = [];
try { old = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const byId = new Map([...old, ...fresh].map(v => [v.id, v]));
const all = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, KEEP);

await writeFile(OUT, JSON.stringify(all, null, 1) + '\n');
console.log(`videos.json: ${all.length} videos (${fresh.length} in feed)`);
