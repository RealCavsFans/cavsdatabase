// NBA substitution fix finder (Nov 3). The NBA's play-by-play sometimes names the wrong player in a substitution, which
// throws off minutes, plus-minus and lineups for the rest of that period. For each stored game where our build's minutes
// don't match the NBA's own box score, this tries every single-player correction to that team's substitutions (swap the
// named player for another player on the team) and keeps the one that makes every player's minutes match. Only an edit
// that brings ALL of that team's minutes within 36 seconds of the box score is accepted; anything less is reported, not saved.
//
//   node scripts/nba-fixfind.mjs <nba-data dir> [--season 2025-26] [--days 7] [--out file] [gameId ...]
// Corrections go to --out (default <nba-data dir>/fixes.json, the nightly job's file). Hand-checked corrections live in
// pdata/nba-fixes.json; both files are applied wherever the NBA games are read (game archive, checks, league numbers).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { loadFixes, applyFixes as apply } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const A = process.argv.slice(2), opt = k => { const i = A.indexOf(k); if (i < 0) return null; const v = A[i + 1]; A.splice(i, 2); return v; };
const CUR = (() => { const d = new Date(), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const s = m >= 8 ? y : y - 1; return s + '-' + String(s + 1).slice(2); })();
const SEASON = opt('--season') || CUR, DAYS = +(opt('--days') || 0);
const ND = A.shift() || 'nba-data', OUTF = opt('--out') || path.join(ND, 'fixes.json'), ONLY = A;
const own = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : {}, fixes = loadFixes(ND);
const secOf = iso => { const m = /PT(\d+)M([\d.]+)S/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : 0; };
// minutes error per team: sum of |ours - box| seconds over that team's players
function err(raw) {
  let out; try { out = C.fromNBA({ game: raw.box }, { game: raw.pbp }); } catch { return null; }
  const D = C.prep(out), R = C.deriveCore(D, D.plays, 'all'), e = {};
  const per = Math.max(4, raw.box.period || 4), gameSec = 4 * 720 + (per - 4) * 300;
  for (const t of [raw.box.homeTeam, raw.box.awayTeam]) { let s = 0, worst = 0;
    for (const p of t.players || []) { const b = R.B[String(p.personId)], d = Math.abs((b ? b.min : 0) - secOf((p.statistics || {}).minutes)); s += d; worst = Math.max(worst, d); }
    // five on the floor the whole game: 5-man lineup time has to equal the game length too (a wrong fix can match minutes with 4 or 6 on the floor)
    const tm = D.teams.find(x => (t.players || []).some(p => (D.roster[x.id] || []).includes(String(p.personId))));
    const L5 = tm ? Object.values(((R.L[tm.id] || {})[5]) || {}).reduce((a, l) => a + l.sec, 0) : gameSec, ld = Math.abs(L5 - gameSec);
    s += ld * 5; worst = Math.max(worst, ld > 2 ? 999 : 0);
    e[t.teamId] = { s, worst }; }
  return e;
}
const idx = JSON.parse(fs.readFileSync(path.join(ND, SEASON, 'index.json'), 'utf8'));
const cut = DAYS ? new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10).replace(/-/g, '') : '';
const ids = ONLY.length ? ONLY : Object.keys(idx).filter(g => !cut || idx[g][0] >= cut);
let found = 0, left = [];
for (const gid of ids) {
  const load = () => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ND, SEASON, gid + '.json.gz'))));
  const raw = load(); apply(raw, fixes[gid] || []);
  const e0 = err(raw); if (!e0) continue;
  for (const t of [raw.box.homeTeam, raw.box.awayTeam]) {
    if (e0[t.teamId].worst <= 36) continue;
    const roster = (t.players || []).map(p => p.personId);
    const subs = raw.pbp.actions.filter(a => a.actionType === 'substitution' && a.teamId === t.teamId);
    // up to three corrections, each the single best one; kept only if together they make every minute match
    const edits = []; let cur = e0[t.teamId], best = null;
    for (let step = 0; step < 3 && cur.worst > 36; step++) {
      best = null;
      for (const a of subs) for (const pid of roster) {
        if (pid === a.personId) continue;
        const p = t.players.find(x => x.personId === pid), edit = { action: a.actionNumber, set: { personId: pid, playerName: p.familyName, playerNameI: p.nameI }, was: a.playerNameI, why: 'substitution named the wrong player (minutes then match the NBA box score)' };
        const r2 = load(); apply(r2, [...(fixes[gid] || []), ...edits, edit]); const e = err(r2); if (!e) continue;
        if (!best || e[t.teamId].s < best.e.s) best = { edit, e: e[t.teamId] };
      }
      if (!best || best.e.s >= cur.s) break;
      edits.push(best.edit); cur = best.e;
    }
    if (edits.length && cur.worst <= 36) { (fixes[gid] = fixes[gid] || []).push(...edits); (own[gid] = own[gid] || []).push(...edits); found += edits.length; apply(raw, edits);
      edits.forEach(ed => console.log(gid, t.teamTricode, `action ${ed.action}: ${ed.was} -> ${ed.set.playerNameI}`)); console.log(`  minutes off ${Math.round(e0[t.teamId].s)}s -> ${Math.round(cur.s)}s`); }
    else { left.push(gid + ' ' + t.teamTricode); console.log(gid, t.teamTricode, 'no fix found', `(best ${Math.round(cur.s)}s off, worst player ${Math.round(cur.worst)}s)`); }
  }
}
if (found || fs.existsSync(OUTF)) fs.writeFileSync(OUTF, JSON.stringify(Object.fromEntries(Object.entries(own).sort()), null, 1) + '\n');
console.log(`${found} fixes saved; ${left.length} team-games still off: ${left.join(', ')}`);
