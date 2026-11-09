// NBA Cup group standings (Nov 9, 2026, Luka: NBA.com first, ESPN as the backup).
// Group-stage games and results come from the NBA's own schedule file (the same file NBA.com's schedule reads):
//   <NBA_BASE>/staticData/scheduleLeagueV2_1.json   games labeled "Emirates NBA Cup" with the group in gameSubLabel
// Backup: ESPN's scoreboard for the group-stage dates, games whose notes name an NBA Cup group.
// Standings follow the NBA's group-stage rules: record, then head-to-head, then point differential in group games,
// then points scored in group games. The wild card is the best second-place team in each conference.
// Writes pdata/nba-cup.json and the Cavs' Cup record in index.html (SEASON.cup). Runs from late October to mid-December.
// Exits 0 on any problem and keeps the last data.
import fs from 'node:fs';
const NBA_BASE = 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA';   // same base as nba-ids.mjs

const now = new Date(), md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
if (!process.env.FORCE && !(md >= 1025 || md <= 105)) { console.log('nba-cup: outside the Cup window'); process.exit(0); }
const OUT = new URL('../pdata/nba-cup.json', import.meta.url), IDX = new URL('../index.html', import.meta.url);
const get = async (u, text) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(60000) }); if (r.ok) return text ? r.text() : JSON.parse(await r.text()); console.log('HTTP', r.status, u); } catch (e) { console.log(String(e).slice(0, 120)); } await new Promise(r => setTimeout(r, 4000)); } return null; };
const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);
const ESPN2NBA = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };

/* games: [{group, home, away, hs, as, final}] */
async function fromNBA() {
  const j = await get(NBA_BASE + '/staticData/scheduleLeagueV2_1.json');
  if (!j || !j.leagueSchedule) return null;
  const out = [];
  for (const d of j.leagueSchedule.gameDates || []) for (const g of d.games || []) {
    const lab = `${g.gameLabel || ''} ${g.gameSubLabel || ''} ${g.gameSubtype || ''}`;
    const m = /(East|West)\s+Group\s+([A-C])/i.exec(lab); if (!m || !/cup|in-season/i.test(lab)) continue;
    out.push({ group: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} Group ${m[2].toUpperCase()}`, home: g.homeTeam.teamTricode, away: g.awayTeam.teamTricode, hs: +g.homeTeam.score || 0, as: +g.awayTeam.score || 0, final: g.gameStatus === 3 });
  }
  return out.length >= 50 ? out : (console.log('nba-cup: NBA schedule has only', out.length, 'group games'), null);
}
/* the 2026 group draw, checked against the NBA's schedule on Nov 9, 2026; refreshed from the saved file whenever the NBA source has run */
const DRAW = (() => { const d = {}; const add = (g, ts) => ts.forEach(t => d[t] = g);
  try { const p = JSON.parse(fs.readFileSync(OUT, 'utf8')); if (p.source && /NBA/.test(p.source)) { for (const [g, r] of Object.entries(p.groups || {})) add(g, r.map(x => x.t)); if (Object.keys(d).length === 30) return d; } } catch {}
  add('East Group A', ['DET', 'ORL', 'TOR', 'MIL', 'BKN']); add('East Group B', ['CLE', 'MIA', 'PHI', 'NYK', 'IND']); add('East Group C', ['BOS', 'ATL', 'WAS', 'CHI', 'CHA']);
  add('West Group A', ['DAL', 'DEN', 'HOU', 'PHX', 'UTA']); add('West Group B', ['MIN', 'OKC', 'NOP', 'LAC', 'MEM']); add('West Group C', ['GSW', 'SAS', 'LAL', 'POR', 'SAC']); return d; })();
async function fromESPN() {
  const y = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  /* one day at a time (ESPN refuses long date ranges) */
  const evs = []; for (let d = new Date(Date.UTC(y, 9, 25)); d <= new Date(Date.UTC(y, 10, 30)) && d <= now; d.setUTCDate(d.getUTCDate() + 1)) { const j = await get(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d.toISOString().slice(0, 10).replace(/-/g, '')}`); if (j && j.events) evs.push(...j.events); }
  if (!evs.length) return null;
  const out = [];
  for (const e of evs) {
    const c = (e.competitions || [])[0] || {}, txt = JSON.stringify(c.notes || []) + ' ' + JSON.stringify(c.type || {});
    /* ESPN only says "NBA Cup - Group Play", so each team's group comes from the draw (fixed for the season) */
    if (!/cup/i.test(txt) || !/group/i.test(txt)) continue;
    const h = c.competitors.find(x => x.homeAway === 'home'), a = c.competitors.find(x => x.homeAway === 'away'), ab = t => ESPN2NBA[t.team.abbreviation] || t.team.abbreviation;
    const grp = DRAW[ab(h)]; if (!grp || DRAW[ab(a)] !== grp) continue;
    out.push({ group: grp, home: ab(h), away: ab(a), hs: +h.score || 0, as: +a.score || 0, final: !!(c.status && c.status.type && c.status.type.completed) });
  }
  return out.length ? out : (console.log('nba-cup: ESPN has no group games'), null);   /* ESPN lists games played so far (plus today's), not the whole group schedule */
}

let src = 'NBA.com schedule', games = await fromNBA();
if (!games) { src = 'ESPN (backup)'; games = await fromESPN(); }
if (!games) { console.log('nba-cup: no source answered; keeping the last data'); process.exit(0); }

/* standings */
const G = {};
for (const g of games) for (const t of [g.home, g.away]) { const grp = G[g.group] || (G[g.group] = {}); grp[t] = grp[t] || { t, w: 0, l: 0, pf: 0, pa: 0, gp: 0, left: 0 }; }
for (const g of games) { const grp = G[g.group], H = grp[g.home], A = grp[g.away]; if (!g.final) { H.left++; A.left++; continue; }
  H.gp++; A.gp++; H.pf += g.hs; H.pa += g.as; A.pf += g.as; A.pa += g.hs; if (g.hs > g.as) { H.w++; A.l++; } else { A.w++; H.l++; } }
const pct = x => x.gp ? x.w / x.gp : 0;
const h2h = (a, b) => { let w = 0; for (const g of games) if (g.final && ((g.home === a && g.away === b) || (g.home === b && g.away === a))) w += ((g.home === a) === (g.hs > g.as)) ? 1 : -1; return w; };
const groups = {};
for (const [name, T] of Object.entries(G)) {
  const rows = Object.values(T).sort((a, b) => pct(b) - pct(a) || b.w - a.w || -h2h(a.t, b.t) || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.t.localeCompare(b.t));
  rows.forEach((r, i) => { r.rank = i + 1; r.pd = r.pf - r.pa; });
  groups[name] = rows.map(({ t, w, l, pd, pf, gp, left, rank }) => ({ t, w, l, pd, pf, gp, left, rank }));
}
const wild = {};
for (const conf of ['East', 'West']) {
  const seconds = Object.entries(groups).filter(([n]) => n.startsWith(conf)).map(([, r]) => r[1]).filter(Boolean);
  const best = seconds.sort((a, b) => pct(b) - pct(a) || b.w - a.w || b.pd - a.pd || b.pf - a.pf)[0]; if (best) wild[conf] = best.t;
}
const cleGroup = Object.entries(groups).find(([, r]) => r.some(x => x.t === 'CLE'));
const cle = cleGroup ? Object.assign({ group: cleGroup[0] }, cleGroup[1].find(x => x.t === 'CLE')) : null;
const out = { source: src, updated: now.toISOString(), rules: 'record, head-to-head, point differential and points scored in group games; wild card = best second-place team in each conference', groups, wildcard: wild, cle };

const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
if (!prev || JSON.stringify({ ...prev, updated: 0 }) !== JSON.stringify({ ...out, updated: 0 })) { fs.writeFileSync(OUT, JSON.stringify(out)); console.log('nba-cup: saved from', src); }
else console.log('nba-cup: no changes');
if (cle) {
  const rec = `${cle.w}–${cle.l}`, html = fs.readFileSync(IDX, 'utf8'), next = html.replace(/(const SEASON=\{[^}]*?cup:')[^']*(')/, `$1${rec}$2`);
  if (next !== html) { fs.writeFileSync(IDX, next); console.log('nba-cup: SEASON.cup =', rec); }
  console.log(`nba-cup: CLE ${cle.group} ${rec}, ${cle.rank} of ${cleGroup[1].length}, PD ${cle.pd >= 0 ? '+' : ''}${cle.pd}, ${cle.left} left; wild cards ${JSON.stringify(wild)}`);
}
