// Game-high history for the recap's "most since" lines (Nov 1).
// Reads Basketball Reference regular-season game logs: every Cavs team game since 1970–71, and the career game logs
// of every player who has played for the Cavs this season. Keeps, per stat, only the games that beat every later game
// (a "staircase"), which is all the recap needs to say "most since <date>" or "career high".
// Writes pdata/highs-hist.json. History stops at the end of last season; this season's games come from the live archive.
// Players already in the file are skipped unless FULL=1, so the weekly run only fetches new Cavs.
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const OUT = new URL('pdata/highs-hist.json', root);
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const LAST = 2026;   // last finished season (2025–26), by Basketball Reference's end-year
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com facts-only Cavs reference)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;
async function page(u) {
  for (let i = 0; i < 3; i++) {
    if (calls++) await sleep(3600);   // Basketball Reference allows about 20 requests a minute
    const r = await fetch(u, { headers: UA }).catch(() => null);
    if (r && r.ok) return (await r.text()).replace(/<!--|-->/g, '');
    if (r && r.status === 404) return null;
    console.log('retry', u, r && r.status); await sleep(30000);
  }
  return null;
}
const rows = (html, table) => {
  const i = html.indexOf(`id="${table}"`); if (i < 0) return [];
  const t = html.slice(i, html.indexOf('</table>', i));
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => Object.fromEntries([...m[1].matchAll(/data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => [c[1], c[2].replace(/<[^>]+>/g, '').trim()]))).filter(r => /^\d{4}-\d\d-\d\d$/.test(r.date || ''));
};
const STATS = { pts: 'points', reb: 'rebounds', ast: 'assists', fgm: 'made field goals', tpm: 'made threes', stl: 'steals', blk: 'blocks' };
/* newest first; keep a game only if it beats every newer game kept so far */
const stair = (games, k) => { const out = []; let best = -1; for (const g of games.slice().sort((a, b) => b.d.localeCompare(a.d))) { const v = g[k]; if (v == null || isNaN(v)) continue; if (v > best) { out.push([g.d, v, g.tm || undefined, g.opp].filter(x => x !== undefined)); best = v; } } return out; };
const num = v => v === '' || v == null ? null : +v;

let H = { how: 'Regular-season game logs from Basketball Reference. Per stat, only the games that beat every later game.', through: `${LAST - 1}–${String(LAST).slice(2)}`, team: null, teamFrom: null, players: {} };
try { const old = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (!process.env.FULL) H = { ...H, ...old, through: H.through }; } catch {}

/* team: every season's game log, built once (FULL=1 rebuilds) */
if (!H.team || process.env.FULL) {
  const games = []; let from = null;
  for (let y = 1971; y <= LAST; y++) {
    const h = await page(`https://www.basketball-reference.com/teams/CLE/${y}/gamelog/`); if (!h) continue;
    const rs = rows(h, 'team_game_log_reg'); if (!rs.length) continue; from = from || y;
    for (const r of rs) games.push({ d: r.date, opp: r.opp_name_abbr, pts: num(r.team_game_score), reb: num(r.trb), ast: num(r.ast), fgm: num(r.fg), tpm: num(r.fg3), stl: num(r.stl), blk: num(r.blk) });
    console.log('team', y, rs.length);
  }
  H.team = Object.fromEntries(Object.keys(STATS).map(k => [k, stair(games, k)])); H.teamFrom = from;
}

/* players: everyone who has played for the Cavs this season */
const S = JSON.parse(fs.readFileSync(new URL('live-archive/2026-27/season.json', root), 'utf8'));
const ids = JSON.parse(fs.readFileSync(new URL('pdata/bbr-ids.json', root), 'utf8'));
for (const pid of Object.keys(S.gp || {})) {
  const name = S.P[pid].name, k = norm(name); if (H.players[k] && !process.env.FULL) continue;
  const b = ids[k]; if (!b) { console.log('no Basketball Reference id for', name); continue; }
  const main = await page(`https://www.basketball-reference.com/players/${b[0]}/${b}.html`); if (!main) continue;
  const yrs = [...new Set([...main.matchAll(new RegExp(`/players/${b[0]}/${b}/gamelog/(\\d{4})`, 'g'))].map(m => +m[1]))].filter(y => y <= LAST).sort();
  const games = [];
  for (const y of yrs) {
    const h = await page(`https://www.basketball-reference.com/players/${b[0]}/${b}/gamelog/${y}`); if (!h) continue;
    for (const r of rows(h, 'player_game_log_reg')) { if (!r.mp || /Did Not|Inactive|Not With|Suspended/i.test(r.mp)) continue; games.push({ d: r.date, tm: r.team_name_abbr, opp: r.opp_name_abbr, pts: num(r.pts), reb: num(r.trb), ast: num(r.ast), fgm: num(r.fg), tpm: num(r.fg3), stl: num(r.stl), blk: num(r.blk) }); }
  }
  H.players[k] = { name, bbr: b, games: games.length, s: Object.fromEntries(Object.keys(STATS).map(s => [s, stair(games, s)])) };
  console.log(name, yrs.join(','), games.length, 'games');
}
H.updated = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(H));
console.log('wrote pdata/highs-hist.json', fs.statSync(OUT).size, 'bytes');
