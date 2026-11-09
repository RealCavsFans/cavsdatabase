// Name pronunciations (Nov 8, 2026). Once a day, looks for each Cavs player's own recording in the NBA's pronunciation
// guide for the newest season (cdn.nba.com/logos/nba/playername-audio/<season>/<team>/<firstLAST>_<NBA id>.wav) and for
// the Cavs page of the written guide (nba.com/news/cleveland-cavaliers-<season>-pronunciation-guide). New clips and
// respellings go into PRON and PRON_TX in index.html; a player keeps last season's clip until this season's appears.
//
//   node scripts/pron-update.mjs          prints what changed; writes index.html only when something did
import fs from 'fs';

const html = fs.readFileSync('index.html', 'utf8');
const grab = n => { const m = new RegExp('(^|[\\n;])const ' + n + '=').exec(html); if (!m) throw new Error('missing ' + n); const i = m.index + m[1].length - 1; let j = i + n.length + 8, d = 0; const st = j; for (; j < html.length; j++) { const c = html[j]; if (c === '{' || c === '[') d++; else if (c === '}' || c === ']') { d--; if (!d) { j++; break; } } } return [Function('return ' + html.slice(st, j))(), st, j]; };
const [PLAYERS] = grab('PLAYERS'), [PRON, p0, p1] = grab('PRON'), [PRON_TX, t0, t1] = grab('PRON_TX');
const d = new Date(), y = d.getUTCMonth() + 1 >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, SEASON = y + '-' + String(y + 1).slice(2);
const UA = { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' };
const ok = async u => { try { const r = await fetch(u, { headers: { ...UA, Range: 'bytes=0-15' }, signal: AbortSignal.timeout(15000) }); const b = r.ok ? Buffer.from(await r.arrayBuffer()) : null; return !!b && b.slice(0, 4).toString() === 'RIFF'; } catch { return false; } };   /* a real WAV, not an error page */
if (process.env.PROBE) { console.log('probe', await ok('https://cdn.nba.com/logos/nba/playername-audio/2025-26/cle/donovanMITCHELL_1628378.wav')); process.exit(0); }
/* the guide's file names: first name in lowercase letters, last name in capitals, suffix kept (craigPORTER_JR_1641854) */
const fileOf = (n, id) => { const parts = n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z .-]/g, '').split(' '); const suf = /^(Jr\.?|Sr\.?|II|III|IV)$/i.test(parts[parts.length - 1]) ? parts.pop().replace('.', '').toUpperCase() : ''; const first = parts.shift().toLowerCase().replace(/[^a-z]/g, ''); return first + parts.join('').toUpperCase().replace(/[^A-Z]/g, '') + (suf ? '_' + suf : '') + '_' + id; };

const changes = [];
for (const r of PLAYERS) {
  const n = r[1], id = r[r.length - 1]; if (!/^\d+$/.test(String(id))) continue;
  if (String(PRON[n] || '').startsWith(SEASON + '/')) continue;   // already on this season's clip
  const f = fileOf(n, id);
  for (const tm of ['cle']) { const path = `${SEASON}/${tm}/${f}`; if (await ok(`https://cdn.nba.com/logos/nba/playername-audio/${path}.wav`)) { changes.push(`${n}: ${SEASON} clip`); PRON[n] = path; break; } }
}
/* the written respellings, from the Cavs page of this season's guide */
try {
  const r = await fetch(`https://www.nba.com/news/cleveland-cavaliers-${SEASON}-pronunciation-guide`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (r.ok) {
    const txt = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
    for (const p of PLAYERS) { const n = p[1], esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = txt.match(new RegExp(esc + '\\s*[:\\-–—(]\\s*([A-Za-z][A-Za-z\'\\- ]{1,40}?[A-Z][A-Za-z\'\\-]*)\\s*\\)?(?=\\s|$)'));
      if (m && /[A-Z]{2,}/.test(m[1]) && /-/.test(m[1]) && PRON_TX[n] !== m[1].trim()) { PRON_TX[n] = m[1].trim(); changes.push(`${n}: respelling ${PRON_TX[n]}`); } }
  } else console.log(`pron-update: no ${SEASON} Cavs guide page yet (${r.status})`);
} catch (e) { console.log('pron-update: guide page unavailable', e.message); }

if (!changes.length) { console.log(`pron-update: nothing new for ${SEASON}`); process.exit(0); }
let out = html.slice(0, p0) + JSON.stringify(PRON) + html.slice(p1, t0) + JSON.stringify(PRON_TX) + html.slice(t1);
fs.writeFileSync('index.html', out);
console.log('pron-update:\n  ' + changes.join('\n  '));
