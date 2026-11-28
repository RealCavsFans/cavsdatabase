// Locked test games and drills for the NBA-feed build (Nov 3). Runs before every publish, so a change to live-core.js that
// breaks the numbers never reaches the site. Three saved games (tests/nba/): a regular Cavs game, a Cavs overtime game, and
// a 2025-26 game where the NBA named the wrong player in a substitution (its correction must still apply).
//   1. locked games    every player's minutes and every box column match the NBA's own box score exactly
//   2. live replay     the game rebuilt as if live, a quarter at a time: no errors, 5 on the floor, scores only go up
//   3. bad-data drills missing shot coordinates, a player missing from the box, duplicated and shuffled plays, no plays:
//                      the build must not crash, and what it can count still adds up
//   node scripts/regress.mjs        exits 1 and lists the failures if anything is off
import fs from 'fs';
import zlib from 'zlib';
import { createRequire } from 'module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const DIR = new URL('../tests/nba/', import.meta.url), FIX = loadFixes();
const fails = [], ok = m => console.log('ok  ' + m), bad = m => { fails.push(m); console.log('FAIL ' + m); };
const secOf = iso => { const m = /PT(\d+)M([\d.]+)S/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : 0; };
const load = f => { const r = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(f, DIR)))); applyFixes(r, FIX[r.gameId]); return r; };
const build = (box, actions) => { const D = C.prep(C.fromNBA({ game: box }, { game: { ...box, actions } })); return { D, R: C.deriveCore(D, D.plays, 'all') }; };
const COLS = [['points', 'pts'], ['fieldGoalsMade', 'fgm'], ['fieldGoalsAttempted', 'fga'], ['threePointersMade', 'tpm'], ['threePointersAttempted', 'tpa'], ['freeThrowsMade', 'ftm'], ['freeThrowsAttempted', 'fta'], ['reboundsOffensive', 'oreb'], ['reboundsDefensive', 'dreb'], ['assists', 'ast'], ['steals', 'stl'], ['blocks', 'blk'], ['turnovers', 'to'], ['foulsPersonal', 'pf'], ['plusMinusPoints', 'pm']];
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.json.gz')).sort()) {
  const raw = load(f), B = raw.box, tag = `${raw.gameId} ${B.awayTeam.teamTricode}@${B.homeTeam.teamTricode}`, acts = raw.pbp.actions;
  /* 1. locked game */
  let R, D; try { ({ R, D } = build(B, acts)); } catch (e) { bad(`${tag}: build failed: ${e.message}`); continue; }
  const diffs = [];
  for (const t of [B.homeTeam, B.awayTeam]) for (const p of t.players || []) { const q = p.statistics || {}, b = R.B[String(p.personId)], bs = secOf(q.minutes);
    if (!b) { if (bs > 0) diffs.push(`${p.nameI} missing`); continue; }
    if (Math.abs(b.min - bs) > 36) diffs.push(`${p.nameI} min ${(bs / 60).toFixed(1)}/${(b.min / 60).toFixed(1)}`);
    for (const [k, o] of COLS) if ((q[k] || 0) !== (b[o] || 0)) diffs.push(`${p.nameI} ${o} ${q[k] || 0}/${b[o] || 0}`); }
  diffs.length ? bad(`${tag}: differs from the NBA box (NBA/ours): ${diffs.slice(0, 6).join('; ')}`) : ok(`${tag}: every player's minutes and box line match the NBA`);
  const per = Math.max(4, B.period || 4), gameSec = 4 * 720 + (per - 4) * 300;
  for (const t of D.teams) { const L5 = Object.values(((R.L[t.id] || {})[5]) || {}).reduce((a, l) => a + l.sec, 0); if (Math.abs(L5 - gameSec) > 2) bad(`${tag}: ${t.abbr} lineup time ${(L5 / 60).toFixed(1)} min vs ${gameSec / 60}`); }
  /* 2. live replay: the feed a quarter at a time */
  try { let last = [0, 0]; const sorted = acts.slice().sort((a, b) => a.period - b.period || a.orderNumber - b.orderNumber);
    for (let q = 1; q <= per; q++) { const cut = sorted.filter(a => a.period <= q), { R: Rq, D: Dq } = build({ ...B, gameStatus: q < per ? 2 : 3 }, cut);
      const pts = Dq.teams.map(t => Rq.T[t.id].pts); if (pts[0] < last[0] || pts[1] < last[1]) bad(`${tag}: replay score went down after Q${q}`); last = pts;
      const sec = 4 * 720 * Math.min(q, 4) / 4 + Math.max(0, q - 4) * 300; for (const t of Dq.teams) { const L5 = Object.values(((Rq.L[t.id] || {})[5]) || {}).reduce((a, l) => a + l.sec, 0); if (Math.abs(L5 - sec) > 2) bad(`${tag}: replay ${t.abbr} lineup time after Q${q} ${(L5 / 60).toFixed(1)} vs ${sec / 60}`); } }
    ok(`${tag}: live replay, quarter by quarter`); } catch (e) { bad(`${tag}: replay crashed: ${e.message}`); }
  /* 3. drills */
  const drill = (name, mutate, check) => { try { const r = JSON.parse(JSON.stringify(raw)); mutate(r); const out = build(r.box, r.pbp.actions); const m = check ? check(out, r) : ''; m ? bad(`${tag}: drill "${name}": ${m}`) : ok(`${tag}: drill "${name}"`); } catch (e) { bad(`${tag}: drill "${name}" crashed: ${e.message}`); } };
  const fga = o => o.D.teams.reduce((s, t) => s + o.R.T[t.id].fga, 0), FGA = [B.homeTeam, B.awayTeam].reduce((s, t) => s + (t.players || []).reduce((a, p) => a + (p.statistics.fieldGoalsAttempted || 0), 0), 0);
  drill('no shot coordinates', r => r.pbp.actions.forEach(a => { delete a.xLegacy; delete a.yLegacy; delete a.x; delete a.y; }), o => fga(o) !== FGA ? `shots ${fga(o)} vs ${FGA}` : '');
  drill('no shot coordinates or distance', r => r.pbp.actions.forEach(a => { delete a.xLegacy; delete a.yLegacy; delete a.shotDistance; }), o => fga(o) !== FGA ? `shots ${fga(o)} vs ${FGA}` : '');
  drill('a player missing from the box', r => { const t = r.box.homeTeam; t.players = t.players.filter(p => p.personId !== t.players[t.players.length - 1].personId); });
  drill('plays out of order', r => r.pbp.actions.reverse(), o => fga(o) !== FGA ? `shots ${fga(o)} vs ${FGA}` : '');
  drill('a play sent twice', r => { const i = r.pbp.actions.findIndex(a => a.actionType === 'rebound'); r.pbp.actions.splice(i, 0, { ...r.pbp.actions[i] }); });
  drill('no plays yet', r => { r.pbp.actions = []; });
  drill('a play with no player', r => { const a = r.pbp.actions.find(a => a.actionType === 'turnover' && a.personId); a.personId = 0; delete a.playerName; delete a.playerNameI; });
}
/* Nov 13 audit: GitHub refuses a workflow file with the same key twice in one block (it then fails with "No jobs were run"
   on every push), so check every workflow for repeated keys at the same level */
{ const fs2 = await import('node:fs'); const dir = new URL('../.github/workflows/', import.meta.url);
  for (const f of fs2.readdirSync(dir).filter(x => /\.ya?ml$/.test(x))) {
    const lines = fs2.readFileSync(new URL(f, dir), 'utf8').split('\n'); const stack = []; let dup = null;
    lines.forEach((ln, i) => { if (dup || /^\s*(#|$)/.test(ln)) return; const m = ln.match(/^(\s*)(- )?([A-Za-z_][\w-]*):(\s|$)/); if (!m) return;
      const ind = m[1].length + (m[2] ? 2 : 0); while (stack.length && (stack[stack.length - 1].ind > ind || (m[2] && stack[stack.length - 1].ind >= ind))) stack.pop();
      let top = stack[stack.length - 1]; if (!top || top.ind !== ind) { top = { ind, keys: new Set() }; stack.push(top); }
      if (top.keys.has(m[3])) dup = `${f} line ${i + 1}: "${m[3]}" repeated`; top.keys.add(m[3]); });
    dup ? bad(`workflow: ${dup}`) : ok(`workflow ${f}: no repeated keys`); } }
/* Nov 13 (Luka): wording rules: these are never hyphenated. Nov 22 house style check: every source page, the newsletter and
   share-image scripts, not just the two main pages. Also: no pink (named pinks, or a new light wine tint not already
   approved), no ASCII "->" arrows in what readers see, and no "61.0%"-style zero decimals typed into page text. */
{ const fs2 = await import('fs'), { execSync } = await import('child_process');
  let files = []; try { files = execSync('git ls-files "*.html" "*.mjs" "*.js" "*.css"', { encoding: 'utf8' }).split('\n').filter(f => f && !/^(history|tests|node_modules)\//.test(f) && f !== 'scripts/regress.mjs'); } catch { files = ['index.html', 'live.src.html']; }
  const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const OKTINT = new Set('f7e6ea f4d6dd e7c6ce f3d9e3 e8c9d3 d98ea6 e9b9c8 f2d5df c98aa3 d08ea2 d9a9b8 e3c4ce ff4d4d ff6b6b ff9b9b'.split(' '));
  const hsl = h => { const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; if (!d) return [0, 0, l]; let H = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; H *= 60; if (H < 0) H += 360; return [H, d / (1 - Math.abs(2 * l - 1)), l]; };
  const probs = [];
  for (const f of files) { let t = ''; try { t = fs2.readFileSync(f, 'utf8'); } catch { continue; } const c = noComments(t);
    const hy = c.match(/\b(hard-cap\w*|most-used|trade-eligible|regular-season)\b/gi); if (hy) probs.push(`${f}: ${[...new Set(hy)].join(', ')} should not be hyphenated`);
    const pk = c.match(/(?:[:,(]\s*|['\"])(?:hot|deep|light)?pink\b(?![|\w])/gi); if (pk) probs.push(`${f}: pink color (${[...new Set(pk)].join(', ')})`);
    const nt = [...new Set([...c.matchAll(/#([0-9a-f]{6})\b/gi)].map(m => m[1].toLowerCase()).filter(h => { const [H, s, l] = hsl(h); return (H >= 290 || H <= 8) && s > .35 && l > .62 && !OKTINT.has(h); }))];
    if (nt.length) probs.push(`${f}: new pink-looking color${nt.length > 1 ? 's' : ''} #${nt.join(', #')} (wine tints read pink; use gray or an approved tint)`);
    if (/\.html$/.test(f)) { const vis = c.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ');
      if (/\s-(>|&gt;)\s/.test(vis)) probs.push(`${f}: ASCII "->" in page text (use → or ↗)`);
      const z = vis.match(/\b\d+\.0%/g); if (z) probs.push(`${f}: zero decimal percentage typed in page text (${[...new Set(z)].slice(0, 3).join(', ')})`); } }
  probs.length ? probs.forEach(p => bad('house style: ' + p)) : ok(`house style: ${files.length} source files (hyphens, pink, arrows, zero decimals)`); }
/* Nov 16 (Luka): every inline script on the main and live pages must parse, or the page sits on "Loading…" */
{ const fs2 = await import('node:fs'), vm = await import('node:vm');
  for (const f of ['index.html', 'live.src.html']) { let t = ''; try { t = fs2.readFileSync(f, 'utf8'); } catch { continue; } let n = 0, err = '';
    for (const m of t.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/(?:ld\+)?json|text\/template)")[^>]*>([\s\S]*?)<\/script>/g)) { n++; try { new vm.Script(m[1], { filename: f }); } catch (e) { err = `script ${n}: ${e.message}`; break; } }
    err ? bad(`syntax in ${f}: ${err}`) : ok(`syntax ${f}: ${n} inline scripts parse`); } }
console.log(fails.length ? `\n${fails.length} failure(s)` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
