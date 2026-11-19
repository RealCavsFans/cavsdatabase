// Data check (Nov 19, 2026 audit): once a day, every feed the site reads is held to two rules.
//   1. Fresh: each file's own timestamp is newer than its limit (a feed that quietly stops would otherwise keep old numbers up).
//   2. In step: the files that describe the same games agree with the game archive (live-archive/<season>), which the season
//      stats page and the player pages' season lines read:
//        box.json (player-page game logs)  every archived game is final there with a box score, the same Cavs points,
//                                           and the same Cavs players' points
//        pdata/league.json (ranks)          has every archived Cavs game
//        pdata/league-rates.json            counts every archived Cavs game (counted possessions for team ratings)
//        pdata/dunks.json                   counted from every archived game
//        Cleveland Charge                   every Charge game with a result has its box score in pdata/charge-box.json
// Writes data/data-check.json and data/data-check-alert.txt (when something is off). Exits 2 when something is off.
//   node scripts/data-check.mjs
import fs from 'node:fs';
const SEASON = '2026-27', NOW = Date.now(), H = 36e5;
const J = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const issues = [], ok = [];
const age = (ts) => { const t = Date.parse(ts || ''); return isNaN(t) ? null : (NOW - t) / H; };
const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const inSeason = etToday >= '2026-10-20' && etToday <= '2027-04-12';

/* 1. freshness: [label, file, max hours, how to read the timestamp, in-season only] */
const FRESH = [
  ['League feed (ranks, team lines)', 'pdata/league.json', 30, j => j.updated, true],
  ['League rates (usage, rates, counted possessions)', 'pdata/league-rates.json', 30, j => j.updated, true],
  ['Game archive (season stats, player season lines)', `live-archive/${SEASON}/season.json`, 30, j => j.updated, true],
  ['Shot contest (NBA tracking, nightly from Luka\'s computer)', 'pdata/defender.json', 54, j => j.updated + 'T23:59:00-05:00', true],
  ['Matchups (NBA tracking, nightly from Luka\'s computer)', 'pdata/matchups.json', 54, j => j.updated + 'T23:59:00-05:00', true],
  ['Comparable seasons', 'pdata/comps.json', 8 * 24, j => j.updated + 'T23:59:00-05:00', true],
  ['Career stats (Basketball Reference, weekly)', 'pdata/careers.json', 8 * 24 + 12, j => j.updated, false],
];
for (const [lab, f, max, ts, seasonal] of FRESH) {
  if (seasonal && !inSeason) continue;
  const j = J(f); if (!j) { issues.push(`${lab}: ${f} missing or unreadable`); continue; }
  const a = age(ts(j)); if (a == null) { issues.push(`${lab}: no timestamp in ${f}`); continue; }
  if (a > max) issues.push(`${lab}: last updated ${Math.round(a)} hours ago (limit ${max})`); else ok.push(`${lab} ${Math.round(a)}h`);
}

/* 2. in step with the game archive */
const ix = J(`live-archive/${SEASON}/index.json`) || [];
const SJ = J(`live-archive/${SEASON}/season.json`) || {}, box = J('box.json') || {}, L = J('pdata/league.json') || {}, LR = J('pdata/league-rates.json') || {}, DK = J('pdata/dunks.json') || {};
const ma = s => { const m = /(\d+)-(\d+)/.exec(String(s || '')); return m ? [+m[1], +m[2]] : [0, 0]; };
let boxOk = 0;
for (const g of ix) {
  const d = g.et;
  const b = box[d];
  if (!b || b.status !== 'final' || !(b.box || []).length) { issues.push(`box.json: ${d} ${g.opp} has no box score (player game logs miss this game)`); continue; }
  const pts = b.box.reduce((t, r) => t + (+r[2] || 0), 0), cle = +String(b.score || '').split('-')[0];
  if (pts !== cle) issues.push(`box.json: ${d} ${g.opp} player points add to ${pts}, the score says ${cle}`);
  /* the same Cavs players played in both (archive: season.json games[].pl) */
  { const sg = (SJ.games || []).find(x => x.id === g.id); if (sg && sg.pl) { const A = new Set(sg.pl.map(id => (SJ.P[id] || {}).name)), Bx = new Set(b.box.filter(r => parseFloat(r[1]) > 0).map(r => r[0]));
      const onlyA = [...A].filter(x => !Bx.has(x)), onlyB = [...Bx].filter(x => !A.has(x));
      if (onlyA.length || onlyB.length) issues.push(`box.json: ${d} ${g.opp} players differ from the archive (${[...onlyA.map(x => 'archive only: ' + x), ...onlyB.map(x => 'box only: ' + x)].slice(0, 4).join(', ')})`); } }
  boxOk++;
}
ok.push(`box.json ${boxOk}/${ix.length} games`);
const tgD = new Set(Object.values(L.tg || {}).filter(x => (x.t || []).some(y => y.ab === 'CLE')).map(x => x.d));
const miss = ix.filter(g => !tgD.has(g.et)).map(g => g.et);
if (miss.length) issues.push(`League feed is missing Cavs game(s): ${miss.join(', ')}`); else ok.push(`league feed ${tgD.size} Cavs games`);
const ctD = new Set(((LR.t || {}).CLE || []).map(r => r[0]));
const missR = ix.filter(g => !ctD.has(g.et)).map(g => g.et);
/* the NBA's play-by-play can take a few hours after the final; only a game more than a day old counts as missing */
const lateR = missR.filter(d => (NOW - Date.parse(d + 'T23:59:00-05:00')) / H > 24);
if (lateR.length) issues.push(`League rates have no counted possessions for: ${lateR.join(', ')} (team ratings fall back to the estimate for those games)`); else ok.push('league rates in step');
if (DK.games != null && DK.games < ix.length) issues.push(`Dunks counted from ${DK.games} games, the archive has ${ix.length}`); else if (DK.games != null) ok.push('dunks in step');
{ const html = fs.readFileSync('index.html', 'utf8'); const m = /const CHARGE=\{[\s\S]*?games:(\[[\s\S]*?\]\])\};?/.exec(html); const CB = J('pdata/charge-box.json') || {};
  if (m) { const gs = Function('return ' + m[1])(); const done = gs.filter(g => /^[WL] /.test(g[4] || '') && g[6]); const ids = done.map(g => (/gameId\/(\d+)/.exec(g[6]) || [])[1]).filter(Boolean);
    const lack = ids.filter(id => !CB[id]); if (lack.length) issues.push(`Charge: ${lack.length} finished game(s) without a saved box score`); else ok.push(`Charge ${ids.length} games`);
    const old = Object.values(CB).filter(g => (g.lines || []).some(l => l.length < 13)).length; if (old) issues.push(`Charge: ${old} saved game(s) without free throws (TS% can't be shown)`); } }

const out = { checked: new Date().toISOString(), issues, ok };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/data-check.json', JSON.stringify(out, null, 1) + '\n');
fs.rmSync('data/data-check-alert.txt', { force: true });
console.log(issues.length ? 'OFF' : 'ok ', ok.join(' · '));
issues.forEach(x => console.log('    ' + x));
if (issues.length) { fs.writeFileSync('data/data-check-alert.txt', issues.slice(0, 8).join('\n') + (issues.length > 8 ? `\n(+${issues.length - 8} more)` : '')); process.exit(2); }
