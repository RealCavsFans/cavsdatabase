// Push alerts through OneSignal. Run every 10 minutes by .github/workflows/push.yml.
// Four kinds, each only to people who turned that kind on (OneSignal tags tip/final/tx/inj = '1'):
//   tip   30 minutes before a Cavs regular season or playoff game
//   final the final score, minutes after the game ends (NBA.com schedule feed, the same one box.json uses)
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

// 2. final score, from NBA.com's schedule feed (regular season, play-in, playoffs and NBA Cup; not preseason)
try {
  const r = process.env.PUSH_FEED ? { ok: true, json: async () => JSON.parse(await readFile(process.env.PUSH_FEED, 'utf8')) } : await fetch('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const games = (await r.json()).leagueSchedule.gameDates.flatMap(d => d.games)
    .filter(g => (g.homeTeam?.teamTricode === 'CLE' || g.awayTeam?.teamTricode === 'CLE') && !String(g.gameId).startsWith('001'));
  let w = 0, l = 0;
  const rows = games.map(g => {
    const d = String(g.gameCode).slice(0, 8), date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const home = g.homeTeam.teamTricode === 'CLE', cle = home ? g.homeTeam : g.awayTeam, opp = home ? g.awayTeam : g.homeTeam;
    return { date, fin: g.gameStatus === 3, cs: cle.score, os: opp.score, opp: opp.teamTricode, reg: String(g.gameId).startsWith('002') };
  }).sort((a, b) => a.date.localeCompare(b.date));
  for (const g of rows) {
    if (!g.fin) continue;
    if (g.reg) g.cs > g.os ? w++ : l++;
    g.rec = `${w}–${l}`;
    const age = (NOW - Date.parse(g.date + 'T12:00:00Z')) / 864e5;
    if (age > 1.6 || S.sent[`final:${g.date}`] || first && !S.init) continue;
    const won = g.cs > g.os, opp = nick(g.opp);
    out.push([`final:${g.date}`, filt(['final', '=', '1']),
      `Final: Cavs ${g.cs}, ${opp} ${g.os}`,
      `${won ? 'Cavs win' : 'Cavs lose'}${g.reg ? ` · ${g.rec} on the season` : ''} · Recap and box score`,
      `${SITE}/games/${slug(g.date, g.opp)}`]);
  }
} catch (e) { console.log('final scores: feed unavailable,', e.message); }

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
