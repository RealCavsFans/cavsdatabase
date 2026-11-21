// Nov 16 (Luka): nightly spot check of the NBA game store (the source of every league-wide number) against ESPN's box scores,
// an independent copy of the same games. For each regular season game of the last few days: every player's minutes, points,
// rebounds, assists, steals, blocks and turnovers, NBA vs ESPN. Plus sanity checks on the counted league rates
// (pdata/league-rates.json): each team's minutes add up to the game's length and no rate passes 100%.
// Writes data/espn-check.json; scripts/health.mjs reports any difference. Usage: node scripts/espn-check.mjs <nba-data dir>.
// Exits 0 on any problem (the next run catches up).
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
const SEASON = process.env.SEASON || CUR_SEASON, DIR = path.join(process.argv[2] || 'nba-data', SEASON), OUT = 'data/espn-check.json', DAYS = +(process.env.DAYS || 4);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const ini = n => { const w = String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z ]/g, '').trim().split(/\s+/); return w[0][0] + w[w.length - 1]; };   // Cam / Cameron Johnson
const nm = n => String(n || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const ESPN_AB = { NYK: 'NY', GSW: 'GS', SAS: 'SA', NOP: 'NO', UTA: 'UTAH', WAS: 'WSH' };
async function get(u) { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return r.json(); } catch {} await new Promise(r => setTimeout(r, 2000)); } return null; }
let idx; try { idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')); } catch { console.log('espn-check: no NBA store here'); process.exit(0); }
let prev = {}; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
const out = { checked: new Date().toISOString(), games: prev.games || {}, sanity: [] };
const cut = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
const mins = s => { const m = /PT(\d+)M([\d.]+)S/.exec(s || ''); return m ? +m[1] + +m[2] / 60 : 0; };
const sbCache = {};
for (const [gid, row] of Object.entries(idx)) {
  if (!/^002/.test(gid) || row[0] < cut) continue;
  if (out.games[gid] && out.games[gid].s === row[5] && out.games[gid].status === 'ok') continue;
  try {
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, gid + '.json.gz'))));
    const NB = {}; for (const T of [raw.box.homeTeam, raw.box.awayTeam]) for (const p of T.players || []) { const s = p.statistics || {}; if (!(mins(s.minutes) > 0)) continue;
      NB[nm(p.name)] = { n: p.name, t: T.teamTricode, min: Math.round(mins(s.minutes)), pts: s.points, reb: s.reboundsTotal, ast: s.assists, stl: s.steals, blk: s.blocks, to: s.turnovers }; }
    const d = row[0]; sbCache[d] = sbCache[d] || await get(ESPN + 'scoreboard?dates=' + d + '&limit=50');
    const teams = [row[1], row[2]].map(a => ESPN_AB[a] || a);
    const ev = (sbCache[d]?.events || []).find(e => { const ab = (e.competitions?.[0]?.competitors || []).map(c => c.team.abbreviation); return teams.every(t => ab.includes(t)); });
    if (!ev) { out.games[gid] = { d, g: row[1] + '@' + row[2], s: row[5], status: 'no ESPN game' }; continue; }
    const sum = await get(ESPN + 'summary?event=' + ev.id); const ES = {};
    for (const tb of sum?.boxscore?.players || []) { const st = tb.statistics?.[0] || {}, N = st.names || st.labels || [], ix = k => N.indexOf(k);
      for (const a of st.athletes || []) { if (!a.stats || !a.stats.length) continue; const v = k => { const i = ix(k); return i < 0 ? null : +String(a.stats[i]).split('-')[0]; };
        const o = { min: v('MIN'), pts: v('PTS'), reb: v('REB'), ast: v('AST'), stl: v('STL'), blk: v('BLK'), to: v('TO') }; ES[nm(a.athlete.displayName)] = o; ES['~' + ini(a.athlete.displayName)] = ES['~' + ini(a.athlete.displayName)] ? 'dup' : o; } }
    if (!Object.keys(ES).length) { out.games[gid] = { d, g: row[1] + '@' + row[2], s: row[5], status: 'ESPN box not ready' }; continue; }
    const diffs = [];
    for (const [k, a] of Object.entries(NB)) { let b = ES[k]; if (!b) { const x = ES['~' + ini(a.n)]; if (x && x !== 'dup') b = x; } if (!b) { if (a.min >= 3) diffs.push(`${a.n}: in NBA box, not ESPN's`); continue; }
      for (const f of ['pts', 'reb', 'ast', 'stl', 'blk', 'to']) if (b[f] != null && a[f] !== b[f]) diffs.push(`${a.n} ${f.toUpperCase()} NBA ${a[f]} vs ESPN ${b[f]}`);
      if (b.min != null && Math.abs(a.min - b.min) > 1) diffs.push(`${a.n} MIN NBA ${a.min} vs ESPN ${b.min}`); }
    out.games[gid] = { d, g: row[1] + '@' + row[2], s: row[5], status: 'ok', espn: ev.id, diffs };
  } catch (e) { out.games[gid] = { d: row[0], g: row[1] + '@' + row[2], s: row[5], status: 'error ' + String(e).slice(0, 80) }; }
}
/* keep two weeks of results */
const keep = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
for (const k of Object.keys(out.games)) if (out.games[k].d < keep) delete out.games[k];
/* sanity checks on the counted league rates */
try { const J = JSON.parse(fs.readFileSync('pdata/league-rates.json', 'utf8')), C = J.cols, at = (r, k) => r[2 + C.indexOf(k)];
  for (const r of Object.values(J.p)) { const q = (a, b) => b > 0 ? a / b : null, nm2 = r[0];
    const rates = { 'AST%': q(at(r, 'ast'), at(r, 'tFGM') - at(r, 'fgm')), 'STL%': q(at(r, 'stl'), at(r, 'pd')), 'BLK%': q(at(r, 'blk'), at(r, 'o2A')), 'ORB%': q(at(r, 'oreb'), at(r, 'tORB') + at(r, 'oDRB')), 'DRB%': q(at(r, 'dreb'), at(r, 'tDRB') + at(r, 'oORB')), 'USG%': q(at(r, 'fga') + .44 * at(r, 'fta') + at(r, 'to'), at(r, 'tFGA') + .44 * at(r, 'tFTA') + at(r, 'tTO')) };
    for (const [k, v] of Object.entries(rates)) if (v != null && (v < 0 || v > 1) && at(r, 'sec') >= 600) out.sanity.push(`${nm2} ${k} ${(v * 100).toFixed(1)}%`); }
  const cache = JSON.parse(fs.readFileSync('data/league-rates-cache.json', 'utf8')).g || {};
  for (const [gid, g] of Object.entries(cache)) { const byT = {}; for (const r of Object.values(g.p || {})) byT[r[1]] = (byT[r[1]] || 0) + r[3];
    for (const [t, sec] of Object.entries(byT)) { const len = (g.t && g.t[t] && g.t[t][5]) || 2880; if (Math.abs(sec - 5 * len) > 90) out.sanity.push(`${gid} ${t}: player minutes add to ${(sec / 60).toFixed(1)}, game is ${(5 * len / 60).toFixed(0)}`); } }
} catch (e) { out.sanity.push('could not run: ' + String(e).slice(0, 80)); }
/* Nov 16 (Luka): our play-by-play +/- (the live box score, live-core.js) against the NBA's final box for the same games. A free throw
   around a substitution can move 1 point (about 1 in 200 player games, the NBA's own feed order); anything bigger is flagged */
out.pm = { games: 0, players: 0, off1: 0, flags: [] };
try { const { createRequire } = await import('module'); const C2 = createRequire(import.meta.url)('../live-core.js'); const { loadFixes, applyFixes } = await import('./nba-fixes.mjs'); const FX = loadFixes(path.dirname(DIR));
  for (const [gid, row] of Object.entries(idx)) { if (!/^002/.test(gid) || row[0] < cut) continue; const f = path.join(DIR, gid + '.json.gz'); if (!fs.existsSync(f)) continue;
    const raw = applyFixes(JSON.parse(zlib.gunzipSync(fs.readFileSync(f))), FX[gid]); const D = C2.prep(C2.slimSummary(C2.fromNBA({ game: raw.box }, { game: raw.pbp }))); if (!D.plays.length) continue;
    const R = C2.deriveCore(D, D.plays, 'all'), bx = raw.box.game || raw.box, off = {}; out.pm.games++;
    for (const t of ['homeTeam', 'awayTeam']) for (const q of (bx[t] || {}).players || []) off[String(q.personId)] = q.statistics && q.statistics.plusMinusPoints;
    for (const [id, b] of Object.entries(R.B)) { if (!(b.min > 0) || off[id] == null) continue; out.pm.players++; const d = Math.round(b.pm) - Math.round(off[id]); if (d === 0) continue; if (Math.abs(d) === 1) out.pm.off1++; else out.pm.flags.push(`${gid} ${D.P[id].name}: ours ${b.pm}, NBA ${off[id]}`); } } } catch (e) { out.pm.flags.push('could not run: ' + String(e).slice(0, 80)); }
console.log(`espn-check: +/- vs NBA box: ${out.pm.players} player games, ${out.pm.off1} off by 1, ${out.pm.flags.length} flags`);
fs.mkdirSync('data', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const G = Object.values(out.games), bad = G.filter(x => x.diffs && x.diffs.length);
console.log(`espn-check: ${G.filter(x => x.status === 'ok').length} games compared, ${bad.length} with differences, ${out.sanity.length} sanity flags`);
bad.forEach(x => console.log(' ', x.d, x.g, x.diffs.slice(0, 4).join('; '))); out.sanity.slice(0, 10).forEach(x => console.log('  sanity:', x));
