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
import { CUR_SEASON, PREV_SEASON, START, END } from './season.mjs';   // Nov 21: the season from one place
import fs from 'node:fs';
const SEASON = CUR_SEASON, NOW = Date.now(), H = 36e5;
const J = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const issues = [], ok = [];
const age = (ts) => { const t = Date.parse(ts || ''); return isNaN(t) ? null : (NOW - t) / H; };
const etToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const inSeason = etToday >= START && etToday <= END;

/* 1. freshness: [label, file, max hours, how to read the timestamp, in-season only, after-game]
   Nov 22 audit: the jobs that run on Luka's computer only save (and only move their date) when NBA.com's numbers change,
   so a stretch with no Cavs game used to look stale. With after-game set, the limit counts from the newest archived Cavs
   game the file hasn't caught up to: no game since its date means it is current. */
const ARCH = J(`live-archive/${SEASON}/index.json`) || [];
const lastEt = ARCH.map(g => g.et).filter(Boolean).sort().pop() || null;
const FRESH = [
  ['League feed (ranks, team lines)', 'pdata/league.json', 30, j => j.updated, true],
  ['League rates (usage, rates, counted possessions)', 'pdata/league-rates.json', 30, j => j.updated, true],
  ['Game archive (season stats, player season lines)', `live-archive/${SEASON}/season.json`, 30, j => j.updated, true],
  ['Shot contest (NBA tracking, nightly from Luka\'s computer)', 'pdata/defender.json', 54, j => j.updated + 'T23:59:00-05:00', true, true],
  ['Play types, hustle and tracking (NBA.com, nightly from Luka\'s computer)', 'pdata/tracking.json', 54, j => j.updated + 'T23:59:00-05:00', true, true],
  ['Matchups (NBA tracking, nightly from Luka\'s computer)', 'pdata/matchups.json', 54, j => j.updated + 'T23:59:00-05:00', true, true],
  ['Comparable seasons', 'pdata/comps.json', 8 * 24, j => j.updated + 'T23:59:00-05:00', true],
  ['Career stats (Basketball Reference, weekly)', 'pdata/careers.json', 8 * 24 + 12, j => j.updated, false],
  ['Player careers (play-by-play, nightly)', 'pdata/careers-pbp.json', 50, j => j.updated, false],
  ['Referees (NBA box scores, nightly)', 'pdata/refs.json', 50, j => j.updated, true],
  ['League salaries (Capsheets, weekly)', 'pdata/league-salaries.json', 8 * 24 + 12, j => j.updated + 'T23:59:00-05:00', true],
  ['League games missed (official injury report, daily)', 'pdata/league-injuries-nba.json', 54, j => j.updated, true],
];
for (const [lab, f, max, ts, seasonal, afterGame] of FRESH) {
  if (seasonal && !inSeason) continue;
  const j = J(f); if (!j) { issues.push(`${lab}: ${f} missing or unreadable`); continue; }
  let a = age(ts(j)); if (a == null) { issues.push(`${lab}: no timestamp in ${f}`); continue; }
  if (afterGame && lastEt) { a = String(j.updated).slice(0, 10) >= lastEt ? 0 : age(lastEt + 'T23:59:00-05:00'); }
  if (a > max) issues.push(`${lab}: ${afterGame ? 'not updated since the ' + lastEt + ' game, ' : 'last updated '}${Math.round(a)} hours ago (limit ${max})`); else ok.push(`${lab} ${Math.round(age(ts(j)))}h`);
}
/* Nov 22 audit: NBA.com possessions (nightly from Luka's computer) only commits when a game is added, so check coverage:
   every archived game more than two days old has NBA.com's count */
{ const P = J('data/poss-nba.json'); if (inSeason && P && P.games) { const late = ARCH.filter(g => !P.games[g.id] && age(g.et + 'T23:59:00-05:00') > 54).map(g => g.et);
  late.length ? issues.push(`NBA.com possessions (nightly from Luka's computer): no count for ${late.length} game${late.length > 1 ? 's' : ''} (${late.slice(-3).join(', ')})`) : ok.push(`NBA.com possessions ${Object.keys(P.games).length} games`); } }

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
  /* Nov 20 audit: every column of every Cavs row against the NBA's own box score saved in the archive (nb) */
  { const gf = J(`live-archive/${SEASON}/${g.id}.json`), sg = (SJ.games || []).find(x => x.id === g.id);
    if (gf && gf.nb && sg && sg.pl) { const off = [];
      for (const id of sg.pl) { const n = gf.nb[id], nm = (SJ.P[id] || {}).name, r = b.box.find(x => x[0] === nm); if (!n || !r) continue;
        const want = [n[1], n[8] + n[9], n[10], n[15], `${n[2]}-${n[3]}`, `${n[4]}-${n[5]}`, `${n[6]}-${n[7]}`, n[11], n[12], n[13], n[8], n[14]], have = [r[2], r[3], r[4], r[5], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14]].map(String);
        const lab = ['pts', 'reb', 'ast', '+/-', 'fg', '3pt', 'ft', 'stl', 'blk', 'to', 'oreb', 'pf'];
        want.forEach((w, i) => { if (String(w).replace(/^\+/, '') !== String(have[i]).replace(/^\+/, '')) off.push(`${nm} ${lab[i]} ${have[i]} (NBA ${w})`); }); }
      if (off.length) issues.push(`box.json: ${d} ${g.opp} differs from the NBA box: ${off.slice(0, 3).join(', ')}${off.length > 3 ? ` (+${off.length - 3} more)` : ''}`); } }
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

/* 3. one number, one value (Nov 19 audit): the Cavs' season rates are figured once, from the game archive's totals (every point over
   every counted possession; rebounds of missed shots with team rebounds), and every copy elsewhere must match it */
{ const gs = (SJ.games || []).filter(g => g.t && g.u), sum = (k, i) => gs.reduce((t, g) => t + (+g[k][i] || 0), 0);
  if (gs.length && gs.every(g => g.t[12] > 0 && g.u[12] > 0)) {
    const A = { ortg: 100 * sum('t', 0) / sum('t', 12), drtg: 100 * sum('u', 0) / sum('u', 12) };
    const fr = gs.every(g => g.t.length > 14 && g.u.length > 14);
    if (fr) A.orb = 100 * sum('t', 13) / (sum('t', 13) + sum('u', 14));
    const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.051, r1 = x => Math.round(x * 10) / 10;
    const html = fs.readFileSync('index.html', 'utf8'), cst = n => { const m = new RegExp('const ' + n + '=(\\{[\\s\\S]*?\\});').exec(html); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
    const TS = cst('TSTATS'), FF = cst('FFR'), CR = J('pdata/cle-rates.json');
    const cmp = (lab, have, want) => { if (!near(have, r1(want))) issues.push(`${lab} is ${have}, the game archive's totals give ${r1(want).toFixed(1)}`); };
    if (TS && TS.CLE && TS.CLE[0] + TS.CLE[1] === gs.length) { cmp('Team stats ORTG (index.html TSTATS)', TS.CLE[4], A.ortg); cmp('Team stats DRTG (index.html TSTATS)', TS.CLE[5], A.drtg); }
    if (CR && CR.season === SEASON && CR.g === gs.length) { cmp('Tonight vs the season ORTG (cle-rates)', CR.ortg, A.ortg); cmp('Tonight vs the season DRTG (cle-rates)', CR.drtg, A.drtg); if (A.orb != null) cmp('Tonight vs the season OREB% (cle-rates)', CR.orb, A.orb); }
    if (FF && FF.CLE && fr && TS && TS.CLE && TS.CLE[0] + TS.CLE[1] === gs.length && (FF.CLE[16] == null || FF.CLE[16] === gs.length)) {   /* Nov 21: the preview holds only fully counted games, so compare once tonight's is in */ const o = FF.CLE[5], od = FF.CLE[14]; if (!near(r1(100 * o / (o + od)), r1(A.orb)) && Math.abs(100 * o / (o + od) - A.orb) > 0.3) issues.push(`Four factors preview OREB% (index.html FFR) is ${(100 * o / (o + od)).toFixed(1)}, the game archive gives ${A.orb.toFixed(1)}`); }
    /* the league feed's Cavs games count the same possessions and rebounds as the archive, game by game */
    const lgBy = {}; Object.values(L.tg || {}).forEach(x => { const z = x.t || [], i = z.findIndex(y => y.ab === 'CLE'); if (i >= 0 && z.length === 2) lgBy[x.d] = [z[i], z[1 - i]]; });
    const off = gs.filter(g => { const p = lgBy[g.et]; return p && p[0].np != null && (p[0].pts !== g.t[0] || p[1].pts !== g.u[0] || p[0].np !== g.t[12] || p[1].np !== g.u[12] || (fr && p[0].forb != null && (p[0].forb !== g.t[13] || p[0].fdrb !== g.t[14]))); }).map(g => g.et);
    if (off.length) issues.push(`League feed and game archive count different possessions or rebounds for: ${off.join(', ')}`); else ok.push('one number, one value');
  } }

/* Nov 20 (Luka): career totals = locked history (Basketball Reference through last season) + this season from our archive.
   (1) the locked games count agrees with the hand-checked career line in pdata/players.json; (2) where Basketball Reference's
   own line for this season has caught up to ours (same games), it must agree on points, rebounds and assists. */
{ const CJ = J('pdata/careers.json'), PJ = J('pdata/players.json') || {};
  if (CJ && CJ.players) {
    const nk = x => x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
    const byName = {}; for (const [id, p] of Object.entries(SJ.P || {})) byName[nk(p.name)] = id;
    const bad = []; let n = 0;
    for (const [k, c] of Object.entries(CJ.players)) { if (!c.past) continue; n++;
      const pj = PJ[c.name]; if (pj && Array.isArray(pj.career) && pj.career[0] != null && pj.career[0] !== c.past.games) bad.push(`${c.name}: ${c.past.games} career games through 2025-26 on Basketball Reference, ${pj.career[0]} in players.json`);
      const id = byName[k], b = id && (SJ.B || {})[id], g = id && (SJ.gp || {})[id];
      if (c.cur && b && g) { if (c.cur.games > g) bad.push(`${c.name}: Basketball Reference has ${c.cur.games} games this season, our archive ${g}`);
        else if (c.cur.games === g && (c.cur.pts !== b.pts || c.cur.trb !== b.oreb + b.dreb || c.cur.ast !== b.ast)) bad.push(`${c.name}: this season ${c.cur.pts}/${c.cur.trb}/${c.cur.ast} pts/reb/ast on Basketball Reference, ${b.pts}/${b.oreb + b.dreb}/${b.ast} in our archive`); } }
    if (bad.length) issues.push('Career totals: ' + bad.join('; ')); else if (n) ok.push(`career totals agree (${n} players)`);
  } }

/* Nov 21 (Luka): the 'Career by season' row for this season (pdata/careers-pbp.json, NBA box score) must match the season line
   (the game archive) for every Cavs player: same games, same totals. A row a game behind is still catching up (the game store
   and player careers run after each final); past 12 hours behind, or different totals for the same games, is an issue. */
{ const CP = J('pdata/careers-pbp.json'); if (CP && CP.players) { const bad = [], lag = []; let n = 0;
  const age = (Date.now() - Date.parse(CP.updated || 0)) / 36e5;
  for (const [id, b] of Object.entries(SJ.B || {})) { const g = (SJ.gp || {})[id], c = ((CP.players[id] || {}).s || {})[SEASON]; if (!c || !g) continue; const l = c.CLE || Object.values(c).find(x => x.gp >= g); if (!l) continue; n++;
    const nm = ((SJ.P || {})[id] || {}).name || id;
    if (l.gp < g) { lag.push(nm); continue; }
    const k = [['pts', 'pts'], ['fgm', 'fgm'], ['fga', 'fga'], ['tpm', 'tpm'], ['tpa', 'tpa'], ['ftm', 'ftm'], ['fta', 'fta'], ['oreb', 'oreb'], ['dreb', 'dreb'], ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['tov', 'to'], ['gs', 'gs']].filter(([a, z]) => (l[a] || 0) !== (b[z] || 0)).map(([a, z]) => `${a} ${l[a] || 0} vs ${b[z] || 0}`);
    if (l.gp > g) k.unshift(`games ${l.gp} vs ${g}`); if (Math.abs(l.sec - b.min) > 60 * l.gp) k.push(`minutes ${Math.round(l.sec / 60)} vs ${Math.round(b.min / 60)}`);
    if (k.length) bad.push(`${nm} (${k.join(', ')})`); }
  if (bad.length) issues.push('Career by season row for this season differs from his season line: ' + bad.join('; '));
  if (lag.length && age > 12) issues.push(`Career by season rows ${Math.round(age)}h old and a game behind for: ${lag.join(', ')}`);
  if (!bad.length && n) ok.push(lag.length ? `career rows catching up (${lag.length} a game behind)` : `career rows match the season lines (${n} players)`); } }

/* Nov 21 (Luka): one season everywhere. The scripts read it from scripts/season.mjs (it turns over Aug 1); the pages and a few
   workflow paths still name it, so this flags any that didn't move with it. */
{ const rd = f => { try { return fs.readFileSync(f, 'utf8') } catch { return null } }, bad = [], html = rd('index.html') || '', live = rd('live.src.html');   /* a sparse checkout may not have every file: check what's there */
  if (html) { const s0 = (/const SEASONS=\['(\d{4})–(\d\d)'/.exec(html) || []).slice(1).join('-'); if (s0 !== CUR_SEASON) bad.push(`index.html SEASONS starts with ${s0 || '?'}`); }
  if (live) { const a0 = (/const ARCH_SEASONS=\['([\d-]+)'/.exec(live) || [])[1]; if (a0 !== CUR_SEASON) bad.push(`live.src.html ARCH_SEASONS starts with ${a0 || '?'}`); }
  let wf = []; try { wf = fs.readdirSync('.github/workflows') } catch {} for (const f of wf) { const t = fs.readFileSync('.github/workflows/' + f, 'utf8'); const seen = [...new Set([...t.matchAll(/\b(20\d\d-\d\d)\b/g)].map(m => m[1]))].filter(x => +x.slice(2, 4) + 1 === +x.slice(5) % 100 || x.slice(5) === String(+x.slice(2, 4) + 1).padStart(2, '0')); const top = seen.sort().pop(); if (top && top !== CUR_SEASON && top >= PREV_SEASON) bad.push(`${f} names ${top}`); }
  if (bad.length) issues.push(`Season is ${CUR_SEASON} but: ` + bad.join('; ')); else ok.push('one season everywhere (' + CUR_SEASON + ')'); }

const out = { checked: new Date().toISOString(), issues, ok };
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/data-check.json', JSON.stringify(out, null, 1) + '\n');
fs.rmSync('data/data-check-alert.txt', { force: true });
console.log(issues.length ? 'OFF' : 'ok ', ok.join(' · '));
issues.forEach(x => console.log('    ' + x));
if (issues.length) { fs.writeFileSync('data/data-check-alert.txt', issues.slice(0, 8).join('\n') + (issues.length > 8 ? `\n(+${issues.length - 8} more)` : '')); process.exit(2); }
