// Box score accuracy check (Nov 1). The site's box scores come from ESPN's free feed (saved in live-archive/). Each
// morning this compares every finished Cavs game not yet checked against Basketball Reference's box score: points,
// rebounds, assists, made and attempted shots (2s, 3s, free throws) and minutes for every player on both teams, plus
// the final score. Writes data/bbr-check.json; the daily health check reports any game that differs.
// Games are rechecked for three days after they're played (stat corrections land late), then left alone.
// Exits 0 on any problem.
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const OUT = new URL('data/bbr-check.json', root);
const SEASON = '2026-27';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com facts-only Cavs reference)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
// ESPN / site abbreviations to Basketball Reference team codes (only the ones that differ)
const BR = { BKN: 'BRK', CHA: 'CHO', PHX: 'PHO', WSH: 'WAS', GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA' };
const br = a => BR[a] || a;

let C = { how: 'Each finished Cavs game compared with Basketball Reference: per player PTS, REB, AST, FG, 3P, FT made/attempted, minutes (within 1), and the final score.', games: {} };
try { C = { ...C, ...JSON.parse(fs.readFileSync(OUT, 'utf8')) }; } catch {}
let idx = [];
try { idx = JSON.parse(fs.readFileSync(new URL(`live-archive/${SEASON}/index.json`, root), 'utf8')); } catch { console.log('no live archive index'); process.exit(0); }

const now = Date.now();
const todo = idx.filter(g => {
  const age = (now - Date.parse(g.date)) / 864e5;
  if (age < 0.4) return false;                                   // give Basketball Reference the night to post
  const c = C.games[g.id];
  return !c || (c.status !== 'match' && age < 3) || (c.status === 'match' && age < 1.5 && !c.second);
}).slice(-6);
if (!todo.length) { console.log('nothing to check'); process.exit(0); }

async function page(u) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (r && r.ok) return (await r.text()).replace(/<!--|-->/g, '');
    if (r && r.status === 404) return null;
    console.log('retry', u, r && r.status); await sleep(20000);
  }
  return null;
}
const cellsOf = tr => Object.fromEntries([...tr.matchAll(/data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(c => [c[1], c[2].replace(/<[^>]+>/g, '').trim()]));
function brTeam(html, code) {
  const i = html.indexOf(`id="box-${code}-game-basic"`); if (i < 0) return null;
  const t = html.slice(i, html.indexOf('</table>', i));
  const players = {};
  for (const m of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = cellsOf(m[1]);
    if (!c.player || c.player === 'Starters' || c.player === 'Reserves' || c.player === 'Team Totals' || !c.mp || /Did Not|Not With|Inactive|Suspended/i.test(c.mp + (c.reason || ''))) continue;
    const [mm, ss] = c.mp.split(':').map(Number);
    players[norm(c.player)] = { name: c.player, min: mm + (ss || 0) / 60, pts: +c.pts, reb: +c.trb, ast: +c.ast, fg: `${c.fg}-${c.fga}`, '3p': `${c.fg3}-${c.fg3a}`, ft: `${c.ft}-${c.fta}` };
  }
  const tot = (t.match(/<tfoot>([\s\S]*?)<\/tfoot>/) || [])[1];
  return { players, pts: tot ? +cellsOf(tot).pts : null };
}
function ourTeam(box, cle) {
  const t = (box.players || []).find(p => (String(p.team && p.team.id) === '5') === cle); if (!t) return null;
  const S = t.statistics[0], at = k => S.names.indexOf(k);
  const players = {};
  for (const a of S.athletes || []) {
    if (a.didNotPlay || !a.stats || !a.stats.length) continue;
    const v = k => a.stats[at(k)];
    if (!+v('MIN') && v('MIN') !== '0') continue;
    players[norm(a.athlete.displayName)] = { name: a.athlete.displayName, min: +v('MIN'), pts: +v('PTS'), reb: +v('REB'), ast: +v('AST'), fg: v('FG'), '3p': v('3PT'), ft: v('FT') };
  }
  return { players };
}
function compare(label, ours, theirs, diffs) {
  for (const [k, b] of Object.entries(theirs.players)) {
    const a = ours.players[k];
    if (!a) { if (b.min >= 1) diffs.push(`${label}: ${b.name} played ${Math.round(b.min)} min on Basketball Reference but isn't in our box score`); continue; }
    for (const f of ['pts', 'reb', 'ast', 'fg', '3p', 'ft']) if (String(a[f]) !== String(b[f])) diffs.push(`${b.name} ${f.toUpperCase()}: ours ${a[f]}, Basketball Reference ${b[f]}`);
    if (Math.abs(a.min - b.min) > 1.01) diffs.push(`${b.name} minutes: ours ${a.min}, Basketball Reference ${b.min.toFixed(1)}`);
  }
  for (const [k, a] of Object.entries(ours.players)) if (!theirs.players[k] && a.min >= 1) diffs.push(`${label}: ${a.name} is in our box score but not on Basketball Reference's`);
}

for (const g of todo) {
  const home = g.ha === 'home' ? 'CLE' : br(g.opp), opp = br(g.opp);
  const url = `https://www.basketball-reference.com/boxscores/${g.et.replace(/-/g, '')}0${home}.html`;
  const html = await page(url); await sleep(3600);
  const prev = C.games[g.id];
  if (!html) { C.games[g.id] = { et: g.et, opp: g.opp, status: 'missing', url, at: new Date().toISOString() }; console.log(g.et, g.opp, 'not on Basketball Reference yet'); continue; }
  let game = null;
  try { game = JSON.parse(fs.readFileSync(new URL(`live-archive/${SEASON}/${g.id}.json`, root), 'utf8')); } catch {}
  const box = game && game.boxscore; if (!box) { console.log(g.et, 'no saved box score'); continue; }
  const bc = brTeam(html, 'CLE'), bo = brTeam(html, opp), oc = ourTeam(box, true), oo = ourTeam(box, false);
  if (!bc || !bo || !oc || !oo) { C.games[g.id] = { et: g.et, opp: g.opp, status: 'unreadable', url, at: new Date().toISOString() }; console.log(g.et, g.opp, 'could not read a box score'); continue; }
  const diffs = [];
  if (bc.pts != null && bc.pts !== g.cle) diffs.push(`Cavs final score: ours ${g.cle}, Basketball Reference ${bc.pts}`);
  if (bo.pts != null && bo.pts !== g.os) diffs.push(`${g.opp} final score: ours ${g.os}, Basketball Reference ${bo.pts}`);
  compare('Cavs', oc, bc, diffs); compare(g.opp, oo, bo, diffs);
  C.games[g.id] = { et: g.et, opp: g.opp, status: diffs.length ? 'diff' : 'match', diffs: diffs.length ? diffs : undefined, url, at: new Date().toISOString(),
    second: prev && prev.status === 'match' ? true : undefined, players: Object.keys(bc.players).length + Object.keys(bo.players).length };
  console.log(g.et, g.opp, diffs.length ? diffs.length + ' differences' : 'match', diffs.slice(0, 5).join(' | '));
}
C.checked = new Date().toISOString();
fs.mkdirSync(new URL('data/', root), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(C, null, 1));
