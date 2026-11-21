// Team numbers for the site, built from ESPN box scores instead of a daily web fetch.
// Reads the team game lines that fetch-league.mjs keeps in pdata/league.json (L.tg) and rewrites these
// index.html constants: TSTATS, FFR, NRTG, L14, OPP_FORM, STANDINGS, MPG, SCORES and SEASON.results.
// Ratings use Basketball Reference's possession formula; checked against BBRef's 2025-26 finals
// (per-game stats and four-factor inputs matched exactly; ratings within 0.2).
// Leaves everything alone before the first regular-season game. Exits 0 on any problem (keeps the old data).
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html0 = await readFile(new URL('index.html', root), 'utf8');
let L; try { L = JSON.parse(await readFile(new URL('pdata/league.json', root), 'utf8')); } catch { console.log('team stats: no league.json'); process.exit(0); }
/* ESPN's lines first; a pbpstats backup line (src: 'pbpstats') only counts when ESPN never delivered that game */
const games = (() => { const all = Object.values(L.tg || {}); const key = g => g.d + '|' + (g.t || []).map(t => t.ab).sort().join('-');
  const espn = new Set(all.filter(g => g.src !== 'pbpstats').map(key)); return all.filter(g => g.src !== 'pbpstats' || !espn.has(key(g))); })();
if (!games.length) { console.log('team stats: no games yet'); process.exit(0); }

const SITE = { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };
const EAST = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS'];
const WEST = ['DAL', 'DEN', 'GSW', 'HOU', 'LAC', 'LAL', 'MEM', 'MIN', 'NOP', 'OKC', 'PHX', 'POR', 'SAC', 'SAS', 'UTA'];
const CENTRAL = ['CHI', 'CLE', 'DET', 'IND', 'MIL'];
const ALL = new Set([...EAST, ...WEST]);
const ab = x => SITE[x] || x;
const r1 = x => Math.round(x * 10) / 10;
const etDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

/* one row per team per game */
const rows = [];
for (const g of games) {
  if (g.cupFinal || !g.t || g.t.length !== 2) continue;
  const [a, b] = g.t.map(t => ({ ...t, ab: ab(t.ab) }));
  if (!ALL.has(a.ab) || !ALL.has(b.ab)) continue;
  rows.push({ d: g.d, per: g.per, me: a, op: b }, { d: g.d, per: g.per, me: b, op: a });
}
rows.sort((x, y) => x.d < y.d ? -1 : x.d > y.d ? 1 : 0);
/* Nov 16 (Luka): first choice, possessions counted from the NBA's own play-by-play for every team (scripts/league-rates.mjs),
   the same count the season stats page uses; pbpstats next; the box score estimate last */
let CT = {}; try { const j = JSON.parse(await readFile(new URL('pdata/league-rates.json', root), 'utf8')); for (const [k, v] of Object.entries(j.t || {})) CT[ab(k)] = v; } catch {}
const ctDay = {}; for (const [k, v] of Object.entries(CT)) for (const r of v) ctDay[k + '|' + r[0]] = r;
/* the Cavs' counted possessions from the game archive (live-archive/<season>/season.json, five-man rows) */
let ARCH = null; try { const S = JSON.parse(await readFile(new URL(`live-archive/${CUR_SEASON}/season.json`, root), 'utf8')); /* Nov 19 audit: each game's team possession count (games[].t[12] / u[12]), the number the season page and game log divide by; the five-man units' sum ran 1 to 3 short (a possession across a substitution) */ let pf = 0, pa = 0, po = 0, pd = 0; for (const g of S.games || []) { if (!g.t || !g.u) continue; pf += g.t[0]; pa += g.u[0]; po += g.t[12] || 0; pd += g.u[12] || 0; } if (po && pd && (S.games || []).every(g => g.t && g.t[12] > 0 && g.u[12] > 0)) ARCH = { g: (S.games || []).length, pf, pa, po, pd }; } catch {}
const possOf = (t, o) => t.fga + 0.4 * t.fta - 1.07 * (t.orb / ((t.orb + o.drb) || 1)) * (t.fga - t.fgm) + t.tov;

const F = ['pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'orb', 'drb', 'tov', 'forb', 'fdrb'];   /* forb/fdrb (Nov 19 audit): rebounds of missed shots with team rebounds, NBA.com's OREB%/DREB% */
const A = {};
for (const r of rows) {
  const a = A[r.me.ab] || (A[r.me.ab] = { g: 0, w: 0, mp: 0, res: [], ...Object.fromEntries(F.flatMap(f => [[f, 0], ['o' + f, 0]])) });
  a.g++; if (r.me.pts > r.op.pts) a.w++; a.mp += 240 + 25 * Math.max(0, r.per - 4);
  for (const f of F) { a[f] += r.me[f] ?? (f === 'forb' ? NaN : f === 'fdrb' ? NaN : 0); a['o' + f] += r.op[f] ?? (f === 'forb' || f === 'fdrb' ? NaN : 0); }
  { const c = ctDay[r.me.ab + '|' + r.d], ok = c && c[3] === r.me.pts && c[4] === r.op.pts;
    /* Nov 19 audit: each side's own possessions, so a stretch's net rating is ORTG minus DRTG the way the season number is */
    a.res.push({ d: r.d, w: r.me.pts > r.op.pts, net: r.me.pts - r.op.pts, pf: r.me.pts, pa: r.op.pts, po: ok ? c[1] : possOf(r.me, r.op), pd: ok ? c[2] : possOf(r.op, r.me) });
    /* Nov 21 (Luka: keep it consistent): the four factors only from games whose rebounds of missed shots (team rebounds included) are
       counted, so a game the play-by-play hasn't reached yet (the night of it) never flips a team back to box-score rebounds */
    if ([r.me.forb, r.me.fdrb, r.op.forb, r.op.fdrb].every(Number.isFinite)) { const q = a.ff || (a.ff = { g: 0, po: 0, pd: 0, ...Object.fromEntries(F.flatMap(f => [[f, 0], ['o' + f, 0]])) });
      q.g++; q.po += ok ? c[1] : possOf(r.me, r.op); q.pd += ok ? c[2] : possOf(r.op, r.me); for (const f of F) { q[f] += r.me[f] || 0; q['o' + f] += r.op[f] || 0; } } }
}
const TSTATS = {}, FFR = {}, NRTG = {}, L14 = {}, OPP_FORM = {};
/* season ratings from pbpstats' play-by-play possession counts (the way NBA.com counts them) when pbpstats is caught up
   with the same number of games for that team; otherwise the box-score estimate below stays (Oct 30) */
let PBT = null; try { const j = JSON.parse(await readFile(new URL('pdata/pbp-teams.json', root), 'utf8')); if (j && j.T) PBT = j.T; } catch {}
const PBK = Object.fromEntries(Object.keys(PBT || {}).map(k => [ab(k), k]));
const today = etDay(), from14 = etDay(new Date(Date.parse(today + 'T12:00:00Z') - 14 * 864e5));
for (const [k, a] of Object.entries(A)) {
  const g = a.g, me = Object.fromEntries(F.map(f => [f, a[f]])), op = Object.fromEntries(F.map(f => [f, a['o' + f]]));
  const P = 0.5 * (possOf(me, op) + possOf(op, me));
  let ortg = 100 * a.pts / P, drtg = 100 * a.opts / P, pace = 48 * (2 * P) / (2 * (a.mp / 5));
  const cl = CT[k] || [], cPts = cl.reduce((s, r) => s + r[3], 0), cOpts = cl.reduce((s, r) => s + r[4], 0);
  /* Nov 19 audit: game by game, counted possessions wherever the NBA play-by-play has the game and the estimate only for a game it
     doesn't have yet (it used to drop the whole team to the estimate when one game was missing, e.g. the morning after a game);
     the Cavs use the game archive's own count, the exact number the season stats page shows */
  let cnt = 0, po = 0, pd = 0; for (const r of rows.filter(r => r.me.ab === k)) { const c = ctDay[k + '|' + r.d]; if (c && c[3] === r.me.pts && c[4] === r.op.pts) { po += c[1]; pd += c[2]; cnt++; } else { po += possOf(r.me, r.op); pd += possOf(r.op, r.me); } }
  if (k === 'CLE' && ARCH && ARCH.g === g && ARCH.pf === a.pts && ARCH.pa === a.opts) { po = ARCH.po; pd = ARCH.pd; cnt = g; }
  if (cnt) { ortg = 100 * a.pts / po; drtg = 100 * a.opts / pd; pace = 48 * ((po + pd) / 2) / (a.mp / 5); }
  else { const x = PBT && PBT[PBK[k]]; if (x && x.GamesPlayed === g && x.OffPoss > 0 && x.DefPoss > 0 && x.Points === a.pts && x.OpponentPoints === a.opts) { ortg = 100 * x.Points / x.OffPoss; drtg = 100 * x.OpponentPoints / x.DefPoss; if (x.Pace) pace = x.Pace; } }
  TSTATS[k] = [a.w, g - a.w, r1(a.pts / g), r1(a.opts / g), r1(ortg), r1(drtg), r1(pace), r1(100 * a.tpm / (a.tpa || 1)), r1(ortg - drtg)];   // [8] (Nov 20 audit): net rating from the exact ratings, not the two rounded ones
  /* Nov 19 audit: the rebound slots hold rebounds of missed shots with team rebounds when every game has them (the live page's and NBA.com's OREB%), box score otherwise */
  /* [16] games counted, [17] [18] counted possessions per game on offense and defense over those games (TOV% uses them) */
  const q = a.ff, rb = f => q ? ({ orb: 'forb', drb: 'fdrb', oorb: 'oforb', odrb: 'ofdrb' }[f] || f) : f, src = q || a, n = q ? q.g : g;
  FFR[k] = ['fgm', 'fga', 'tpm', 'ftm', 'fta', 'orb', 'drb', 'tov', 'ofgm', 'ofga', 'otpm', 'oftm', 'ofta', 'oorb', 'odrb', 'otov'].map(f => r1(src[rb(f)] / n));
  if (q) FFR[k].push(q.g, r1(q.po / q.g), r1(q.pd / q.g));
  NRTG[k] = [r1(ortg - drtg), g];
  /* last 14 days (ending yesterday): points margin per 100 possessions over those games, i.e. the pace-weighted mean of game net ratings */
  const w = a.res.filter(x => x.d >= from14 && x.d < today);
  /* when the window holds every game so far, use the season number so the two match (same possession count) */
  if (w.length) L14[k] = [w.length === g ? r1(ortg - drtg) : r1(100 * (w.reduce((s, x) => s + x.pf, 0) / w.reduce((s, x) => s + x.po, 0) - w.reduce((s, x) => s + x.pa, 0) / w.reduce((s, x) => s + x.pd, 0))), w.length];
  OPP_FORM[k] = a.res.slice(-5).map(x => x.w ? 'W' : 'L').join('');
}
const STANDINGS = Object.entries(A).map(([k, a]) => [k, EAST.includes(k) ? 'E' : 'W', a.w, a.g - a.w]);

/* Cavs: scores and results in schedule order, and conference / division rank by win pct (ties: ESPN-free simple order; the daily task may override) */
const grab = name => { const m = html0.match(new RegExp('const ' + name + '=(\\[[\\s\\S]*?\\]);\\n')); return m ? Function('return ' + m[1])() : null; };
const SCHEDULE = grab('SCHEDULE') || [];
const cle = rows.filter(r => r.me.ab === 'CLE');
const byDate = Object.fromEntries(cle.map(r => [r.d, r]));
const SCORES = {}; let results = '';
for (const [d] of SCHEDULE) { const r = byDate[d]; if (!r) break; SCORES[d] = `${r.me.pts}-${r.op.pts}`; results += r.me.pts > r.op.pts ? 'W' : 'L'; }

/* minutes per game for Cavs players, named as in PLAYERS */
const norm = n => String(n).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const names = [...html0.matchAll(/\['\d+','([^']+)','[^']*','/g)].map(m => m[1]);
const byNorm = Object.fromEntries(names.map(n => [norm(n), n]));
const MPG = {};
for (const p of Object.values(L.players || {})) if (p.t === 'CLE' && p.g > 0 && byNorm[norm(p.n)]) MPG[byNorm[norm(p.n)]] = r1(p.min / p.g);

/* write: rates keep one decimal (110.0, not 110) like the hand-entered data; counts stay whole */
const INT = { TSTATS: [0, 1], NRTG: [1], L14: [1], FFR: [], MPG: [] };
let CUR = '';
const num = (x, i) => INT[CUR] && !INT[CUR].includes(i) ? x.toFixed(1) : String(x);
const lit = v => { const f = (x, i) => typeof x === 'number' ? num(x, i) : Array.isArray(x) ? '[' + x.map((y, k) => f(y, k)).join(',') + ']' : x && typeof x === 'object' ? '{' + Object.entries(x).map(([k, y]) => JSON.stringify(k) + ':' + f(y, -1)).join(',') + '}' : JSON.stringify(x); return f(v, -1); };
/* write */
let html = html0, changed = [];
const put = (name, val) => {
  CUR = name;
  const re = new RegExp('const ' + name + '=([\\s\\S]*?);( *(?:/\\*[^\\n]*)?)\\n');
  const m = html.match(re); if (!m) { console.log('team stats: missing ' + name); return; }
  const next = `const ${name}=${lit(val)};${m[2]}\n`;
  if (m[0] !== next) { html = html.replace(m[0], next); changed.push(name); }
};
put('TSTATS', TSTATS); put('FFR', FFR); put('NRTG', NRTG); put('L14', L14); put('OPP_FORM', OPP_FORM);
put('STANDINGS', STANDINGS); put('SCORES', SCORES); if (Object.keys(MPG).length) put('MPG', MPG);
{ const m = html.match(/const SEASON=\{results:'([WL]*)'/); if (m && m[1] !== results) { html = html.replace(m[0], `const SEASON={results:'${results}'`); changed.push('SEASON.results'); } }
if (!changed.length) { console.log('team stats: no changes'); process.exit(0); }
html = html.replace(/const SITE_UPDATED='\d{4}-\d\d-\d\d'/, `const SITE_UPDATED='${today}'`);
await writeFile(new URL('index.html', root), html);
console.log('team stats: updated ' + changed.join(', ') + ` (${rows.length / 2} games)`);
