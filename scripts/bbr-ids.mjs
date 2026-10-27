// Basketball Reference player IDs for every NBA player this season and last, so the live page can link
// opponents straight to their Basketball Reference page instead of a search.
// Reads the two league per-game pages (2 requests) and writes pdata/bbr-ids.json: { normalized name: id }.
// Run daily by .github/workflows/morning.yml (by hand: bbr-ids.yml).
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const UA = 'Mozilla/5.0 (compatible; cavsdatabase-ids/1.0; +https://cavsdatabase.com)';
const now = new Date(), endYr = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
let old = {};
try { old = JSON.parse(await readFile(new URL('pdata/bbr-ids.json', root), 'utf8')); } catch {}
const ids = { ...old };
let got = 0;
for (const yr of [endYr - 1, endYr]) {
  try {
    const r = await fetch(`https://www.basketball-reference.com/leagues/NBA_${yr}_per_game.html`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.log(yr, r.status); continue; }
    const html = await r.text();
    for (const m of html.matchAll(/href="\/players\/[a-z]\/([a-z.'-]+\d\d)\.html">([^<]+)<\/a>/g)) { ids[norm(m[2].replace(/&#39;/g, "'").replace(/&amp;/g, '&'))] = m[1]; got++; }
  } catch (e) { console.log(yr, String(e)); }
  await new Promise(r => setTimeout(r, 4000));
}
console.log('rows read', got, 'players', Object.keys(ids).length);
if (got) await writeFile(new URL('pdata/bbr-ids.json', root), JSON.stringify(Object.fromEntries(Object.entries(ids).sort())));
