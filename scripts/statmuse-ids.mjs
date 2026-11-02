// StatMuse game ids for the live page's backup feed (Nov 2). The /pbp worker needs each game's StatMuse address
// (e.g. 10-31-2026-cle-at-mil-78711), but StatMuse serves Cloudflare's servers a short schedule page without most
// games. GitHub's servers get the full page, so the morning job saves every Cavs game id here and the worker reads
// pdata/statmuse-games.json from the site. Ids are listed well before tip-off. Exits 0 on any problem.
import fs from 'node:fs';
const OUT = new URL('../pdata/statmuse-games.json', import.meta.url);
const now = new Date(), yr = now.getUTCFullYear() + (now.getUTCMonth() >= 7 ? 1 : 0);
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' };
let J = { how: 'StatMuse game ids for Cavs games, keyed M-D-YYYY (no leading zeros), for the /pbp backup feed', games: {} };
try { J = { ...J, ...JSON.parse(fs.readFileSync(OUT, 'utf8')) }; } catch {}
try {
  const r = await fetch(`https://www.statmuse.com/nba/team/cleveland-cavaliers-42/schedule/${yr}`, { headers: UA, signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const h = await r.text(); let n = 0;
  for (const m of h.matchAll(/(\d{1,2}-\d{1,2}-\d{4})-([a-z]+)-at-([a-z]+)-(\d+)/g)) {
    if (m[2] !== 'cle' && m[3] !== 'cle') continue;
    const slug = m[0]; if (J.games[m[1]] !== slug) { J.games[m[1]] = slug; n++; }
  }
  console.log(`statmuse ids: ${Object.keys(J.games).length} Cavs games (${n} new or changed)`);
  if (n) { J.updated = now.toISOString(); fs.writeFileSync(OUT, JSON.stringify(J, null, 1)); }
} catch (e) { console.log('statmuse ids skipped:', e.message); }
