// Push alerts through OneSignal. Run every 10 minutes by .github/workflows/push.yml.
// Six kinds, each only to people who turned that kind on (OneSignal tags tip/final/tx/inj/qtr/run = '1'):
//   tip   30 minutes before a Cavs regular season or playoff game
//   final the final score, minutes after the game ends (ESPN's Cavs schedule)
//   qtr   end of each quarter: score and each team's leading scorer (ESPN live game data)
//   run   a 10–0 run by either team in the current or previous quarter (ESPN live game data)
//   tx    new Cavs transactions in index.html TX
//   inj   changes to the Cavs injury report in index.html INJURIES
// Transactions and injuries go out once a day at most, between 8 AM and 10 PM Eastern, in one message per person
// (people with both on get a single combined alert), so nobody gets more than three alerts in a day.
// Nothing is sent unless the repository variable PUSH_LIVE is "true"; otherwise it logs what it would send.
// State (what went out, last seen transactions and injury report) lives in data/push-state.json.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const APP = '3db75ca9-d797-40c7-8c53-c0711b41e956';
const SITE = 'https://cavsdatabase.com';
const LIVE = process.env.PUSH_LIVE === 'true';
const KEY = process.env.ONESIGNAL_API_KEY || '';
const NOW = process.env.PUSH_NOW ? new Date(process.env.PUSH_NOW) : new Date();
const STATE_F = 'data/push-state.json';

const html = await readFile('index.html', 'utf8');
// read a top-level constant's literal value out of index.html
function grab(name) {
  const at = html.indexOf(`const ${name}=`);
  if (at < 0) throw new Error('missing ' + name);
  let i = at + name.length + 7, depth = 0, q = null;
  const start = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { i++; break; } }
    else if (depth === 0 && (c === ';' || c === '\n')) break;
  }
  return Function('return (' + html.slice(start, i) + ')')();
}
const SCHEDULE = grab('SCHEDULE'), TV = grab('TV'), CAVS_TV = grab('CAVS_TV'), GNICK = grab('GNICK');
const TX = grab('TX'), INJURIES = grab('INJURIES');

let S = {};
try { S = JSON.parse(await readFile(STATE_F, 'utf8')); } catch {}
S.sent ||= {};
const first = !S.tx;   // first run: remember the current transactions and injuries without alerting anyone

// Eastern time helpers
const etParts = d => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
const p = etParts(NOW);
const today = `${p.year}-${p.month}-${p.day}`, hourET = +p.hour + +p.minute / 60;
const etOffset = date => { const d = new Date(date + 'T12:00:00Z'); const h = +etParts(d).hour; return 12 - h; }; // 4 (EDT) or 5 (EST)
const tipTime = (date, hm) => { const [h, m] = hm.split(':').map(Number); return new Date(Date.parse(date + 'T00:00:00Z') + ((h % 12 + 12) + etOffset(date)) * 3600e3 + m * 60e3); };
const fmtTime = hm => hm + ' PM ET';
const slug = (date, opp) => `${date}-${opp.toLowerCase()}`;
const nick = a => GNICK[a] || a;

const out = [];   // [key, kind filter, heading, body, url]
const filt = (...pairs) => pairs.map(([k, rel, v]) => ({ field: 'tag', key: k, relation: rel, value: v }));

// 1. tip-off: 40 to 5 minutes before tip (GitHub's scheduler can run a few minutes late)
for (const [date, opp, ha, hm] of SCHEDULE) {
  if (date !== today) continue;
  const mins = (tipTime(date, hm) - NOW) / 60e3;
  if (mins > 40 || mins < 5) continue;
  const net = TV[date] || CAVS_TV;
  out.push([`tip:${date}`, filt(['tip', '=', '1']), `Cavs ${ha === 'H' ? 'vs' : 'at'} ${nick(opp)} · ${fmtTime(hm)}`, `Tip-off in ${Math.round(mins / 5) * 5} minutes · ${net}`, `${SITE}/games/${slug(date, opp)}`]);
}

// 2. final score, from ESPN's Cavs schedule (NBA.com's feeds don't answer from GitHub's servers)
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const getJ = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); };
const seasonYear = NOW.getUTCMonth() >= 7 ? NOW.getUTCFullYear() + 1 : NOW.getUTCFullYear();
try {
  const sched = await getJ(`${ESPN}teams/5/schedule?season=${seasonYear}`);
  for (const e of sched.events || []) {
    const c = e.competitions && e.competitions[0]; if (!c || !c.status || !c.status.type.completed) continue;
    const age = (NOW - Date.parse(e.date)) / 864e5;
    const date = new Date(Date.parse(e.date) - 5 * 3600e3).toISOString().slice(0, 10);
    if (age > 1.6 || S.sent[`final:${date}`] || first && !S.init) continue;
    const cle = c.competitors.find(x => x.id === '5'), opp = c.competitors.find(x => x.id !== '5'); if (!cle || !opp) continue;
    const cs = +(cle.score && (cle.score.value ?? cle.score.displayValue ?? cle.score)), os = +(opp.score && (opp.score.value ?? opp.score.displayValue ?? opp.score));
    const rec = (cle.record || []).find(r => r.type === 'total');
    const ab = opp.team.abbreviation, tri = { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' }[ab] || ab;
    out.push([`final:${date}`, filt(['final', '=', '1']), `Final: Cavs ${cs}, ${nick(tri)} ${os}`,
      `${cs > os ? 'Cavs win' : 'Cavs lose'}${rec ? ` · ${rec.displayValue || rec.summary} on the season` : ''} · Recap and box score`, `${SITE}/games/${slug(date, tri)}`]);
  }
} catch (e) { console.log('final scores: ESPN unavailable,', e.message); }

// 2b. live game: end of each quarter and big runs, built with the live page's own code (live-core.js)
try {
  const sb = await getJ(`${ESPN}scoreboard`);
  const ev = (sb.events || []).find(e => e.competitions[0].competitors.some(c => c.id === '5'));
  const st = ev && ev.status.type.state;
  if (ev && st !== 'pre') {
    const { createRequire } = await import('node:module');
    const C = createRequire(import.meta.url)('../live-core.js');
    const D = C.prep(await getJ(`${ESPN}summary?event=${ev.id}`)), R = C.deriveCore(D, D.plays, 'all');
    const cle = D.focus, opp = D.other, sc = t => t.ha === 'home' ? R.hs : R.as;
    const lead = (t, per) => { const q = {}; for (const p of R.plays) if (p.per <= per && p.sc && p.val > 0 && D.P[p.ids[0]] && D.P[p.ids[0]].team === t.id) q[p.ids[0]] = (q[p.ids[0]] || 0) + p.val; const b = Object.entries(q).sort((a, b) => b[1] - a[1])[0]; return b ? `${D.P[b[0]].last} ${b[1]}` : ''; };
    const url = `${SITE}/live.html?g=${ev.id}`;
    // quarter breaks (the final buzzer is covered by the final-score alert)
    for (const p of R.plays) if (p.type === 'End Period' && !(p.per >= 4 && p.hs !== p.as)) {
      const cs = cle.ha === 'home' ? p.hs : p.as, os = cle.ha === 'home' ? p.as : p.hs;
      const name = p.per === 2 ? 'Halftime' : p.per <= 4 ? `End of the ${['1st', '2nd', '3rd', '4th'][p.per - 1]}` : `End of ${C.pname(p.per)}`;
      out.push([`qtr:${ev.id}:${p.per}`, filt(['qtr', '=', '1']), `${name}: Cavs ${cs}, ${opp.name} ${os}`, `Leaders: ${lead(cle, p.per)} · ${lead(opp, p.per)} · Live stats`, url]);
    }
    // big runs, only while they're still news (this quarter or last)
    const now = R.lp ? R.lp.per : 0;
    for (const r of R.runs) if (r.pts >= 10 && r.end.per >= now - 1) {
      const t = r.t === cle.id ? cle : opp;
      out.push([`run:${ev.id}:${r.start.id}`, filt(['run', '=', '1']), `${t.id === '5' ? 'Cavs' : 'The ' + t.name} on a ${r.pts}–0 run`, `Cavs ${sc(cle)}, ${opp.name} ${sc(opp)} · ${C.pname(r.end.per)} ${r.end.clock} · Live stats`, url]);
    }
  }
} catch (e) { console.log('live game alerts: unavailable,', e.message); }

// 3 + 4. transactions and injury report changes
const txKey = t => `${t.d}|${t.k}|${t.p}`;
const txNow = TX.map(txKey);
const injNow = Object.fromEntries(INJURIES.map(([n, , what, st]) => [n, `${st}|${what}`]));
if (first) { S.tx = txNow; S.inj = injNow; S.init = today; console.log('first run: remembered', txNow.length, 'transactions and', Object.keys(injNow).length, 'injuries'); }
const seenTx = new Set(S.tx || []);
const newTx = TX.filter(t => !seenTx.has(txKey(t)) && (NOW - Date.parse(t.d + 'T12:00:00Z')) / 864e5 < 4);
const injLines = [];
for (const [n, v] of Object.entries(injNow)) {
  const [st, what] = v.split('|'), was = S.inj?.[n];
  if (!was) injLines.push(`${n} (${what.toLowerCase()}): ${st.toLowerCase()}`);
  else if (was !== v) injLines.push(`${n} now ${st.toLowerCase()}`);
}
for (const n of Object.keys(S.inj || {})) if (!injNow[n]) injLines.push(`${n} off the injury report`);
const dayOK = hourET >= 8 && hourET < 22, morningSent = S.sent[`news:${today}`];
if (!first && dayOK && !morningSent && (newTx.length || injLines.length)) {
  const txLine = newTx.slice(0, 3).map(t => t.t).join(' · ') + (newTx.length > 3 ? ` · +${newTx.length - 3} more` : '');
  const injLine = injLines.slice(0, 3).join(' · ') + (injLines.length > 3 ? ` · +${injLines.length - 3} more` : '');
  const txHead = newTx.length === 1 ? 'Cavs transaction' : `${newTx.length} Cavs transactions`, injHead = 'Cavs injury report';
  if (newTx.length && injLines.length) {
    out.push([`news:${today}:both`, filt(['tx', '=', '1'], ['inj', '=', '1']), 'Cavs moves and injury report', `${txLine} · ${injLine}`, `${SITE}/moves`]);
    out.push([`news:${today}:tx`, filt(['tx', '=', '1'], ['inj', '!=', '1']), txHead, txLine, `${SITE}/moves`]);
    out.push([`news:${today}:inj`, filt(['inj', '=', '1'], ['tx', '!=', '1']), injHead, injLine, `${SITE}/roster`]);
  } else if (newTx.length) out.push([`news:${today}:tx`, filt(['tx', '=', '1']), txHead, txLine, `${SITE}/moves`]);
  else out.push([`news:${today}:inj`, filt(['inj', '=', '1']), injHead, injLine, `${SITE}/roster`]);
  S.sent[`news:${today}`] = NOW.toISOString();
  S.tx = txNow; S.inj = injNow;
} else if (!first && !newTx.length && !injLines.length) { S.tx = txNow; S.inj = injNow; }

// send
const uuid = k => { const h = createHash('sha1').update('cavsdb-push:' + k).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
let failed = 0;
for (const [key, filters, heading, body, url] of out) {
  if (S.sent[key]) continue;
  console.log(`${LIVE ? 'SEND' : 'DRY RUN (PUSH_LIVE is not "true")'} ${key}\n  ${heading}\n  ${body}\n  ${url}`);
  if (LIVE) {
    if (!KEY) { console.log('  ONESIGNAL_API_KEY is missing'); failed++; continue; }
    const r = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Key ${KEY}` },
      body: JSON.stringify({ app_id: APP, target_channel: 'push', headings: { en: heading }, contents: { en: body }, url, filters, idempotency_key: uuid(key), chrome_web_icon: `${SITE}/icon-256.png` })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.errors && !/no.*subscri|not subscribed/i.test(JSON.stringify(j.errors))) { console.log('  OneSignal error', r.status, JSON.stringify(j)); failed++; continue; }
    console.log('  sent', j.id || '', j.errors ? JSON.stringify(j.errors) : '');
  }
  S.sent[key] = NOW.toISOString();
}
// keep two weeks of history
for (const [k, v] of Object.entries(S.sent)) if (NOW - Date.parse(v) > 14 * 864e5) delete S.sent[k];
await writeFile(STATE_F, JSON.stringify(S, null, 1) + '\n');
if (!out.length) console.log('nothing to send');
if (failed) process.exit(1);
