// Position groups for the positional percentiles on the live/season pages (Nov 14, 2026, Luka).
// Reads Basketball Reference's league play-by-play page (one request), which estimates the share of each player's minutes
// spent at PG, SG, SF, PF and C from who was on the floor with him. Each player goes in the group where he played the most:
//   G = PG + SG, F = SF + PF, C = C.   Players with no estimate yet fall back to their listed position on the same page.
// Writes pdata/positions.json { season, updated, P: { normalized name: [group, PG%, SG%, SF%, PF%, C%, minutes] } }.
// Run daily by .github/workflows/morning.yml. Exits 0 on any problem and keeps the old file.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const UA = 'Mozilla/5.0 (compatible; cavsdatabase-pos/1.0; +https://cavsdatabase.com)';
const now = new Date(), yr = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const dec = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
try {
  const r = await fetch(`https://www.basketball-reference.com/leagues/NBA_${yr}_play-by-play.html`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.log('bbr-pos: HTTP', r.status); process.exit(0); }
  const html = (await r.text()).replace(/<!--|-->/g, '');
  const P = {};
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cell = k => { const m = new RegExp(`data-stat="${k}"[^>]*>([\\s\\S]*?)</t[dh]>`).exec(row[1]); return m ? dec(m[1]) : ''; };
    const name = cell('name_display') || cell('player'); if (!name || /^player$/i.test(name)) continue;
    const pct = [1, 2, 3, 4, 5].map(i => parseFloat(cell('pct_' + i)) || 0);
    const mp = parseFloat(cell('mp')) || 0, pos = cell('pos');
    const k = norm(name); if (P[k] && P[k][6] >= mp) continue;   /* traded players: keep the row with the most minutes (the season total) */
    const g = pct[0] + pct[1], f = pct[2] + pct[3], c = pct[4];
    let grp = g + f + c > 0 ? (c >= g && c >= f ? 'C' : g >= f ? 'G' : 'F') : (/C/.test(pos) && !/F/.test(pos) ? 'C' : /G/.test(pos) ? 'G' : /F|C/.test(pos) ? 'F' : '');
    if (!grp) continue;
    P[k] = [grp, ...pct, mp];
  }
  const n = Object.keys(P).length;
  if (n < 150) { console.log('bbr-pos: only', n, 'players read; keeping the old file'); process.exit(0); }
  const out = { season: `${yr - 1}-${String(yr).slice(2)}`, updated: now.toISOString().slice(0, 10), P: Object.fromEntries(Object.entries(P).sort()) };
  let old = null; try { old = JSON.parse(await readFile(new URL('pdata/positions.json', root), 'utf8')); } catch {}
  if (old && JSON.stringify(old.P) === JSON.stringify(out.P)) { console.log('bbr-pos: no change'); process.exit(0); }
  await writeFile(new URL('pdata/positions.json', root), JSON.stringify(out));
  const cnt = { G: 0, F: 0, C: 0 }; Object.values(P).forEach(v => cnt[v[0]]++);
  console.log('bbr-pos:', n, 'players', JSON.stringify(cnt));
} catch (e) { console.log('bbr-pos:', String(e).slice(0, 200)); }
process.exit(0);
