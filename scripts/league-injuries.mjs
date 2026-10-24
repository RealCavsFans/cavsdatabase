// League-wide games missed to injury, for the Cavs' rank in the injury report box.
// Each run: (1) saves ESPN's league injury list for today (one request, every team),
// (2) for every final regular-season game not yet counted, marks a player as having missed it if he was listed Out
// that day (the latest list saved before tip) and didn't play. Days before we started saving lists are backfilled
// from each game's ESPN summary (its injury section, plus players marked did-not-play for a reason other than a coach's decision).
// Writes pdata/league-injuries.json. Exits 0 on any problem.
import fs from 'fs';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const OUT = 'pdata/league-injuries.json';
const SEASON = '2026-27', START = '2026-10-20';
async function get(u) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return r.json(); console.log('HTTP', r.status, u); }
    catch (e) { console.log(String(e), u); }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}
const etDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(d));
let J = { season: SEASON, snaps: {}, games: {}, note: '' };
try { J = Object.assign(J, JSON.parse(fs.readFileSync(OUT, 'utf8'))); } catch {}
const today = etDay(Date.now());

/* 1) today's league injury list: { team abbr: [[name, status]] } */
const inj = await get(`${ESPN}injuries`);
if (inj && Array.isArray(inj.injuries)) {
  const snap = {};
  for (const t of inj.injuries) {
    const list = t.injuries || [];
    const ab = list[0]?.athlete?.team?.abbreviation || t.abbreviation || t.team?.abbreviation || t.displayName;
    for (const x of list) {
      const nm = x.athlete?.displayName; const ta = x.athlete?.team?.abbreviation || ab; if (!nm || !ta) continue;
      (snap[ta] = snap[ta] || []).push([nm, x.status || x.type?.description || '']);
    }
  }
  if (Object.keys(snap).length) { J.snaps[today] = snap; console.log('snapshot', today, Object.keys(snap).length, 'teams'); }
} else console.log('no injury list from ESPN');

/* 2) every final regular-season game since opening night that isn't counted yet */
for (let d = new Date(START + 'T12:00:00Z'); etDay(d) <= today; d = new Date(d.getTime() + 864e5)) {
  const day = etDay(d);
  const sb = await get(`${ESPN}scoreboard?dates=${day.replace(/-/g, '')}&seasontype=2`); if (!sb) continue;
  for (const e of sb.events || []) {
    const c = e.competitions?.[0]; if (!c?.status?.type?.completed || J.games[e.id]) continue;
    const teams = c.competitors.map(x => x.team.abbreviation);
    const sum = await get(`${ESPN}summary?event=${e.id}`); if (!sum) continue;
    const played = {};   // team -> names who played
    const dnp = {};      // team -> names marked did-not-play for injury/illness
    for (const tb of sum.boxscore?.players || []) {
      const ab = tb.team?.abbreviation; const st = tb.statistics?.[0]; played[ab] = new Set(); dnp[ab] = new Set();
      for (const a of st?.athletes || []) { const nm = a.athlete?.displayName; if (!nm) continue; if (!a.didNotPlay) played[ab].add(nm); else if (a.reason && !/coach/i.test(a.reason)) dnp[ab].add(nm); }
    }
    const snapDays = Object.keys(J.snaps).filter(x => x <= day).sort(); const snap = snapDays.length && snapDays[snapDays.length - 1] === day ? J.snaps[day] : null;
    const out = {};
    for (const ab of teams) {
      const o = new Set(dnp[ab] || []);
      if (snap) (snap[ab] || []).filter(([, s]) => /^out$/i.test(s)).forEach(([nm]) => { if (!played[ab]?.has(nm)) o.add(nm); });
      else { const ij = (sum.injuries || []).find(x => x.team?.abbreviation === ab); (ij?.injuries || []).filter(i => /^out$/i.test(i.status || '')).forEach(i => { const nm = i.athlete?.displayName; if (nm && !played[ab]?.has(nm)) o.add(nm); }); }
      out[ab] = [...o];
    }
    J.games[e.id] = { d: day, t: teams, out, src: snap ? 'list' : 'summary' };
  }
}
/* 3) totals per team */
const T = {};
for (const g of Object.values(J.games)) for (const ab of g.t) { const x = T[ab] = T[ab] || { gp: 0, missed: 0, players: {} }; x.gp++; for (const nm of g.out[ab] || []) { x.missed++; x.players[nm] = (x.players[nm] || 0) + 1; } }
J.teams = T; J.updated = new Date().toISOString();
const firstSnap = Object.keys(J.snaps).sort()[0];
J.note = firstSnap ? `Daily injury lists saved from ${firstSnap}; earlier games from each game's ESPN summary.` : 'Games from each game’s ESPN summary.';
// keep only the last 10 days of raw lists
for (const k of Object.keys(J.snaps)) if (k < etDay(Date.now() - 10 * 864e5)) delete J.snaps[k];
fs.mkdirSync('pdata', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(J));
console.log('games counted', Object.keys(J.games).length, 'teams', Object.keys(T).length, 'CLE', JSON.stringify(T.CLE || {}));
