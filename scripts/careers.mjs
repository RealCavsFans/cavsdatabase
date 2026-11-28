// Career stats for every Cavs player (Nov 17, Luka): season by season from each player's Basketball Reference page.
// One page per player (per game, advanced and playoff tables are all on it). Writes pdata/careers.json:
//   { updated, how, players: { normName: { name, bbr, pg:[row...], adv:[row...], po:[row...] } } }
// Each row keeps Basketball Reference's own column names (data-stat), as numbers where they are numbers.
// Seasons through the current one; a player traded mid-season has a 2TM/3TM total row plus one row per team.
import { CUR_SEASON, PREV_SEASON } from './season.mjs';   // Nov 21: the season from one place
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const OUT = new URL('pdata/careers.json', root);
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com facts-only Cavs reference)' };
const SEASON_BBR = CUR_SEASON, PREV_BBR = PREV_SEASON;
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
const KEEP = /^(year_id|age|team_name_abbr|team_id|lg_id|comp_name_abbr|pos|games|g|games_started|gs|mp_per_g|mp|fg_per_g|fga_per_g|fg_pct|fg3_per_g|fg3a_per_g|fg3_pct|fg2_pct|efg_pct|ft_per_g|fta_per_g|ft_pct|orb_per_g|drb_per_g|trb_per_g|ast_per_g|stl_per_g|blk_per_g|tov_per_g|pf_per_g|pts_per_g|per|ts_pct|fg3a_per_fga_pct|fta_per_fga_pct|usg_pct|ast_pct|trb_pct|stl_pct|blk_pct|tov_pct|ws|ws_per_48|bpm|vorp|awards|fg|fga|fg3|fg3a|ft|fta|orb|drb|trb|ast|stl|blk|tov|pf|pts)$/;
const cell = v => { const t = v.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); return t !== '' && /^-?\.?\d[\d.]*$/.test(t) ? +t : t; };
/* every row of one table (body and footer), keyed by Basketball Reference's data-stat names */
const table = (html, id) => {
  const i = html.search(new RegExp(`<table[^>]*id="${id}"`)); if (i < 0) return [];
  const t = html.slice(i, html.indexOf('</table>', i));
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => {
    const o = {}; for (const c of m[1].matchAll(/<t[dh][^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)) if (KEEP.test(c[1])) o[c[1]] = cell(c[2]);
    return o;
  }).filter(r => typeof r.year_id === 'string' && (/^\d{4}-\d\d$/.test(r.year_id) || /career|yrs?$/i.test(r.year_id)) || typeof r.year_id === 'number');
};
const pick = (html, ids) => { for (const id of ids) { const r = table(html, id); if (r.length) return r; } return []; };

/* who: everyone with a player page (PLAYERS in index.html) plus anyone who has played for the Cavs this season */
const names = new Set();
const idx = fs.readFileSync(new URL('index.html', root), 'utf8');
{ const i = idx.indexOf('const PLAYERS=['), j = idx.indexOf('];', i); for (const m of idx.slice(i, j).matchAll(/^\s*\['[^']*','([^']+)'/gm)) names.add(m[1]); }
try { const S = JSON.parse(fs.readFileSync(new URL(`live-archive/${CUR_SEASON}/season.json`, root), 'utf8')); for (const pid of Object.keys(S.gp || {})) names.add(S.P[pid].name); } catch {}
const ids = JSON.parse(fs.readFileSync(new URL('pdata/bbr-ids.json', root), 'utf8'));

let C = { how: 'Season by season from Basketball Reference player pages: per game, advanced and playoffs.', players: {} };
try { C = { ...C, ...JSON.parse(fs.readFileSync(OUT, 'utf8')) }; } catch {}
for (const name of names) {
  const k = norm(name), b = ids[k]; if (!b) { console.log('no Basketball Reference id for', name); continue; }
  const h = await page(`https://www.basketball-reference.com/players/${b[0]}/${b}.html`); if (!h) { console.log('no page for', name); continue; }
  const pg = pick(h, ['per_game_stats', 'per_game']), adv = pick(h, ['advanced']), po = pick(h, ['per_game_stats_post', 'playoffs_per_game']);
  if (!pg.length) { console.log('no per game table for', name); continue; }
  /* Nov 20 (Luka): exact career totals. Past seasons don't change, so "past" (the career row minus this season's row, from the
     totals table) is locked history; the player page adds this season from our own game archive (the NBA's box), so the career
     line is current every night. "cur" is Basketball Reference's own line for this season, kept only to cross-check ours. */
  const tot = pick(h, ['totals_stats', 'totals']); let past = null, cur = null;
  if (tot.length) {
    const TK = ['games', 'games_started', 'mp', 'fg', 'fga', 'fg3', 'fg3a', 'ft', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pts'];
    const car = tot.find(r => /yrs?$|career/i.test(String(r.year_id)) && !r.team_name_abbr), rows = tot.filter(r => r.year_id === SEASON_BBR);
    const c0 = rows.find(r => /\dTM$/.test(r.team_name_abbr || '')) || (rows.length === 1 ? rows[0] : null);
    const v = (r, k2) => typeof r[k2] === 'number' ? r[k2] : 0;
    if (car) { past = { thru: PREV_BBR }; cur = c0 ? {} : null; for (const k2 of TK) { past[k2] = v(car, k2) - (c0 ? v(c0, k2) : 0); if (c0) cur[k2] = v(c0, k2); } }
  }
  C.players[k] = { name, bbr: b, pg, adv, po, past, cur };
  console.log(name, pg.length, 'rows,', adv.length, 'advanced,', po.length, 'playoff');
}
C.updated = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(C));
console.log('wrote pdata/careers.json', fs.statSync(OUT).size, 'bytes,', Object.keys(C.players).length, 'players');
