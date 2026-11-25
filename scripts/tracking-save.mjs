// Saves the play types / hustle / tracking pull (scripts/tracking-pull.js, run in the browser) as pdata/tracking.json.
//   node scripts/tracking-save.mjs <file holding window.__TRK, joined from its slices>
// Checks the shape first and changes nothing if it looks wrong. Prints "no change" when only the date would move.
import fs from 'node:fs';
const f = process.argv[2]; if (!f) { console.error('usage: node scripts/tracking-save.mjs <file> [out]'); process.exit(2) }
let raw = fs.readFileSync(f, 'utf8').trim();
if (raw.startsWith('"')) raw = JSON.parse(raw);           // the javascript tool may hand the string back JSON-quoted
const j = JSON.parse(raw);
const bad = [];
const teams = Object.keys(j.t || {});
if (!/^\d{4}-\d\d$/.test(j.season || '')) bad.push('season');
if (teams.length !== 30) bad.push(teams.length + ' teams in t');
for (const [ab, x] of Object.entries(j.t || {})) for (const k of ['hu','dr','cs','pu','to','pa','el','po','pn']) if (!Array.isArray(x[k]) || x[k].length !== j.cols[k].length) bad.push(ab + ' ' + k);
const P = Object.entries(j.p || {});
if (P.length < 8) bad.push(P.length + ' Cavs players');
for (const [id, x] of P) if (!x.n || !(x.gp >= 0) || !Array.isArray(x.hu)) bad.push('player ' + id);
for (const k of ['off','def']) { const T = j.pt?.t?.[k] || {}; if (Object.keys(T).length < (k === 'off' ? 11 : 7)) bad.push('play types ' + k); for (const [t, m] of Object.entries(T)) if (Object.keys(m).length !== 30) bad.push(k + ' ' + t + ' has ' + Object.keys(m).length + ' teams') }
if (!j.pt?.t?.off?.Isolation?.CLE) bad.push('no CLE play types');
if (bad.length) { console.error('tracking-save: not saved:', bad.slice(0, 8).join('; ')); process.exit(1) }
j.updated = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const out = process.argv[3] || 'pdata/tracking.json';  // Nov 25: past seasons save to pdata/tracking-<season>.json
let old = null; try { old = JSON.parse(fs.readFileSync(out, 'utf8')) } catch {}
const same = old && JSON.stringify({ ...old, updated: '' }) === JSON.stringify({ ...j, updated: '' });
if (same) { console.log('no change'); process.exit(0) }
const ord = { season: j.season, updated: j.updated, source: j.source, cols: j.cols, q: j.q, pt: j.pt, p: j.p, t: j.t };
fs.writeFileSync(out, JSON.stringify(ord));
const c = j.t.CLE, g = c.gp;
console.log(`tracking: ${P.length} Cavs players, CLE ${g} games, ${(c.dr[0] / g).toFixed(1)} drives and ${(c.hu[2] / g).toFixed(1)} deflections a game, ${fs.statSync(out).size} bytes`);
