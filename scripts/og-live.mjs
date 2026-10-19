// Live share images (1200x630) that preview what's on the page, redrawn only when what they show changes:
//   og/p/<player-slug>.jpg     every player page: headshot, number, position, stats, salary, signed through
//   og/gp/<date>-<opp>.jpg     every upcoming game page: matchup, date, tip, TV, records, the series
//   og/cap.jpg og/schedule.jpg og/assets.jpg og/moves.jpg   the main pages, with their current numbers
// og/live.json keeps a fingerprint of each card (so unchanged cards are skipped) and the version that
// build-pages.mjs adds to the image address, so X, iMessage and Slack fetch the new picture after a change.
// Run by .github/workflows/videos.yml before build-pages. Needs playwright-core and Chrome (CHROME_PATH); skips if missing.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
function grab(name) {
  const at = html.indexOf(`\nconst ${name}=`); if (at < 0) throw new Error('missing ' + name);
  let i = at + name.length + 8, d = 0, q = null; const st = i;
  for (; i < html.length; i++) { const c = html[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c; else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') { d--; if (d === 0) { i++; break; } }
    else if (d === 0 && (c === ';' || c === '\n')) break; }
  return Function('return (' + html.slice(st, i) + ')')();
}
const PLAYERS = grab('PLAYERS'), ROSTER = grab('ROSTER'), SCHEDULE = grab('SCHEDULE'), TV = grab('TV'), CAVS_TV = grab('CAVS_TV');
const TSTATS = grab('TSTATS'), TSTATS_PREV = grab('TSTATS_PREV'), H2H_PREV = grab('H2H_PREV'), STANDINGS = grab('STANDINGS');
const TEAM_SALARY = grab('TEAM_SALARY'), TAX_BILL = grab('TAX_BILL'), LINES = grab('LINES'), HARDCAP = grab('HARDCAP');
const EXC = grab('EXC'), PICKS = grab('PICKS'), TX = grab('TX'), SCORES = grab('SCORES'), SEASON = grab('SEASON'), TEAMS = grab('TEAMS'), GNICK = grab('GNICK');
let PJ = {}; try { PJ = JSON.parse(await readFile(new URL('pdata/players.json', root), 'utf8')); } catch {}
let state = {}; try { state = JSON.parse(await readFile(new URL('og/live.json', root), 'utf8')); } catch {}

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const M = v => '$' + (v / 1e6).toFixed(1) + 'M';
const POS = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center', G: 'Guard', F: 'Forward', 'G-F': 'Guard / Forward', 'F-G': 'Forward / Guard', 'C-F': 'Center / Forward', 'F-C': 'Forward / Center' };
const todayET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const results = SEASON.results || '';
const rec = s => { const w = [...s].filter(x => x === 'W').length; return w + '–' + (s.length - w); };
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

const MARK = `<svg viewBox="0 0 100 100" width="34" height="34"><path d="M14 26L40 50L14 74" stroke="#F2B231" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="70" cy="64" r="20" fill="#F2B231"/><path d="M50 64H90M70 44V84M57 49C63 55 63 73 57 79M83 49C77 55 77 73 83 79" stroke="#860038" stroke-width="2.5" fill="none"/></svg>`;
const BASE = `@font-face{font-family:Archivo;src:url(../fonts/archivo-latin-wdth-normal.woff2);font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:'Geist Mono';src:url(../fonts/geist-mono-latin-wght-normal.woff2);font-weight:100 900}
@font-face{font-family:'Saira Condensed';src:url(../fonts/saira-condensed-latin-800-normal.woff2);font-weight:800}
@font-face{font-family:'Saira Condensed';src:url(../fonts/saira-condensed-latin-600-normal.woff2);font-weight:600}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;overflow:hidden;background:radial-gradient(1100px 700px at 20% 0%,#9b0a45,#5c0027 75%);color:#fff;font-family:Archivo,sans-serif;position:relative}
body:after{content:'';position:absolute;left:0;right:0;bottom:0;height:10px;background:#F2B231}
.ft{position:absolute;left:64px;right:64px;bottom:34px;display:flex;justify-content:space-between;align-items:center;font:600 20px 'Geist Mono',monospace;color:rgba(255,255,255,.75)}
.wm{display:flex;align-items:center;gap:10px;font:700 26px 'Geist Mono',monospace;color:#fff}.wm em{font-style:normal;color:#F2B231}
.k{font:700 22px 'Geist Mono',monospace;letter-spacing:3px;color:#F2B231;text-transform:uppercase}
.big{font:800 112px/0.92 'Saira Condensed',sans-serif;text-transform:uppercase;letter-spacing:.5px}
.chip{display:inline-block;background:rgba(255,255,255,.14);padding:7px 15px;font:700 21px Archivo;margin-right:8px}.chip.g{background:#F2B231;color:#4a0020}
.n3{display:flex;gap:56px}.n3 b{display:block;font:800 64px/1 'Geist Mono',monospace}.n3 small{font:700 18px Archivo;letter-spacing:2px;color:#F4D6DD;text-transform:uppercase}`;
const page = (css, body, path) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}${css}</style></head><body>${body}<div class="ft"><span>cavsdatabase.com/${path}</span><span class="wm">${MARK}cavs<em>_db</em></span></div></body></html>`;

const cards = [];   // [file, html]

/* players */
for (const P of PLAYERS) {
  const [num, name, pos, ht, , , age, exp, , , draft, tw, id] = P;
  const rs = (PJ[name] && PJ[name].rs) || [];
  const cur = rs.filter(r => r[0] === '2026–27').reduce((a, r) => (!a || r[2] > a[2] ? r : a), null);
  const prev = rs.filter(r => r[0] === '2025–26').reduce((a, r) => (!a || r[2] > a[2] ? r : a), null);
  const row = cur && cur[2] >= 5 ? cur : prev, season = row && row[0];
  const R = ROSTER.find(x => x[0] === name), y = R ? R[2] : null;
  const sal = y ? (Array.isArray(y[0]) ? y[0][0] : y[0]) : null;
  let last = -1; if (y) y.forEach((v, i) => { if (typeof v === 'number' || Array.isArray(v)) last = i; });
  const thru = last >= 0 ? (2026 + last) + '–' + String(27 + last).padStart(2, '0') : '';
  const deal = tw === 'TW' ? 'Two-way contract' : sal ? M(sal) + ' this season' + (thru ? ' · signed through ' + thru : '') : '';
  const [f, i2] = String(ht).split('-');
  const stats = row ? [['PTS', row[5]], ['REB', row[6]], ['AST', row[7]]].map(([k, v]) => `<div><b>${(+v).toFixed(1)}</b><small>${k} · ${season}</small></div>`).join('')
    : `<div><b>${f}′${i2}″</b><small>Height</small></div><div><b>${age}</b><small>Age</small></div><div><b>${draft ? draft[0] : 'UDFA'}</b><small>${draft ? 'Draft · #' + draft[2] : 'Undrafted'}</small></div>`;
  const nm = esc(name).replace(' ', '<br>');
  cards.push([`og/p/${slug(name)}.jpg`, page(`.hs{position:absolute;right:10px;bottom:96px;height:470px;-webkit-mask-image:linear-gradient(#000 80%,transparent)}.num{position:absolute;right:40px;top:20px;font:800 300px/1 'Saira Condensed';color:rgba(255,255,255,.08)}
.L{position:absolute;left:64px;top:62px;width:640px}.st{display:flex;gap:34px;margin-top:34px}.st div{border-left:4px solid #F2B231;padding-left:14px}.st b{display:block;font:800 60px/1 'Geist Mono',monospace}.st small{font:700 18px Archivo;letter-spacing:2px;color:#F4D6DD}
.ct{margin-top:30px;font:600 25px Archivo}`,
    `<div class="num">${esc(num)}</div>${id ? `<img class="hs" src="../img/h/${id}.png" onerror="this.remove()">` : ''}<div class="L"><div class="k">#${esc(num)} · ${POS[pos] || esc(pos)}</div><div class="big" style="margin-top:14px;${name.length > 18 ? 'font-size:96px' : ''}">${nm}</div><div class="st">${stats}</div><div class="ct">${esc(deal)}</div></div>`,
    'players/' + slug(name))]);
}

/* upcoming games */
const TS = (TSTATS.CLE && TSTATS.CLE[0] + TSTATS.CLE[1] > 0) ? TSTATS : null;
const recOf = a => { const s = STANDINGS.find(x => x[0] === a); if (s && s[2] + s[3] > 0) return ['2026–27', s[2] + '–' + s[3]]; const t = TSTATS_PREV[a]; return t ? ['2025–26', t[0] + '–' + t[1]] : ['', '']; };
SCHEDULE.forEach((g, i) => {
  const [d, o, ha, hm] = g; if (results[i] || SCORES[d] || d < todayET) return;
  const met = SCHEDULE.slice(0, i).map((x, k) => [x, results[k]]).filter(([x, r]) => x[1] === o && r);
  const mw = met.filter(([, r]) => r === 'W').length;
  const lp = H2H_PREV[o] || [], lw = lp.filter(x => x[2] > x[3]).length;
  const ser = met.length ? `Season series: Cavs ${mw}–${met.length - mw}` : lp.length ? `Last season: Cavs ${lw}–${lp.length - lw}` : '';
  const dl = new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const net = TV[d] || CAVS_TV, kick = i === 0 ? 'Season opener · Game preview' : `Game ${i + 1} of 82 · Game preview`;
  const [cs, cr] = recOf('CLE'), [os, orr] = recOf(o);
  cards.push([`og/gp/${d}-${o.toLowerCase()}.jpg`, page(`.T{position:absolute;left:64px;right:64px;top:80px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center}
.tm{font:800 170px/0.9 'Saira Condensed'}.tm.r{text-align:right}.tm small{display:block;font:700 22px Archivo;letter-spacing:2px;color:#F4D6DD;margin-top:8px}.tm span{display:block;font:600 34px 'Saira Condensed';letter-spacing:1px;text-transform:uppercase;color:#fff;opacity:.85}
.at{font:600 48px 'Saira Condensed';color:#F2B231;text-align:center}.when{position:absolute;left:64px;right:64px;top:370px;text-align:center;font:700 34px Archivo}.when span{color:#F2B231}
.row{position:absolute;left:64px;right:64px;top:440px;display:flex;justify-content:center}`,
    `<div class="k" style="position:absolute;left:64px;top:38px">${kick}</div><div class="T"><div class="tm">CLE<span>Cavaliers</span><small>${cs} · ${cr}</small></div><div class="at">${ha === 'H' ? 'vs' : 'at'}</div><div class="tm r">${o}<span>${esc(GNICK[o] || TEAMS[o])}</span><small>${os} · ${orr}</small></div></div>
<div class="when">${dl} <span>·</span> ${hm} PM ET <span>·</span> ${esc(net)}</div>
<div class="row">${ser ? `<span class="chip g">${ser}</span>` : ''}<span class="chip">Tale of the tape</span><span class="chip">Injuries</span><span class="chip">How to watch</span></div>`,
    `games/${d}-${o.toLowerCase()}`)]);
});

/* cap */
{
  const L = Object.fromEntries(LINES.map(l => [l[0], l[1]])), room = L[HARDCAP] - TEAM_SALARY, lo = LINES[0][1] - 1, hi = LINES[LINES.length - 1][1] + 4;
  const pct = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)).toFixed(1);
  const lab = { 'Salary cap': 'Cap', 'Luxury tax': 'Tax', 'First apron': 'Apron 1', 'Second apron': 'Apron 2' };
  const roomTxt = room >= 1 ? '$' + room.toFixed(1) + 'M' : room > 0 ? '$' + Math.round(room * 1000) + 'K' : '$0';
  cards.push(['og/cap.jpg', page(`.L{position:absolute;left:64px;top:56px}.n3{margin-top:26px}
.bar{position:absolute;left:64px;right:64px;top:388px;height:34px;background:rgba(255,255,255,.12)}.bar i{position:absolute;left:0;top:0;bottom:0;background:#F2B231}.bar s{position:absolute;top:-12px;bottom:-12px;width:3px;background:#fff}.bar s em{position:absolute;top:60px;left:-55px;width:113px;font:700 17px 'Geist Mono';font-style:normal;color:#F4D6DD;text-align:center}`,
    `<div class="L"><div class="k">2026–27 Salary cap</div><div class="big" style="font-size:96px;margin-top:10px">Cavs cap sheet</div><div class="n3"><div><b>$${TEAM_SALARY.toFixed(1)}M</b><small>Team salary</small></div><div><b>$${TAX_BILL.toFixed(1)}M</b><small>Tax bill</small></div><div><b>${roomTxt}</b><small>Under hard cap</small></div></div></div>
<div class="bar"><i style="width:${pct(TEAM_SALARY)}%"></i>${Object.keys(lab).filter(k => L[k]).map(k => `<s style="left:${pct(L[k])}%"><em>${lab[k]}</em></s>`).join('')}</div>`, 'cap')]);
}

/* schedule */
{
  const played = results.length, nx = SCHEDULE.find((g, i) => !results[i] && !SCORES[g[0]] && g[0] >= todayET);
  const nxt = nx ? `${nx[2] === 'H' ? 'vs' : 'at'} ${esc(GNICK[nx[1]] || TEAMS[nx[1]])} · ${new Date(nx[0] + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${nx[3]} PM ET` : 'Season complete';
  const strip = SCHEDULE.slice(0, 82).map((g, i) => `<i class="${results[i] === 'W' ? 'w' : results[i] === 'L' ? 'l' : ''}"></i>`).join('');
  cards.push(['og/schedule.jpg', page(`.L{position:absolute;left:64px;top:56px;right:64px}.n3{margin-top:22px;gap:48px}.n3 b{font-size:52px}.nx{position:absolute;right:0;top:150px;text-align:right;font:700 30px Archivo}.nx span{color:#F2B231;font:700 20px 'Geist Mono';letter-spacing:3px;display:block;margin-bottom:6px}
.st{position:absolute;left:64px;right:64px;top:440px;display:flex;gap:3px;height:34px;align-items:flex-end}.st i{flex:1;height:14px;background:rgba(255,255,255,.18)}.st i.w{height:34px;background:#F2B231}.st i.l{height:24px;background:rgba(255,255,255,.55)}`,
    `<div class="L"><div class="k">Every game · TV and radio</div><div class="big" style="font-size:96px;margin-top:10px">2026–27 Schedule</div><div class="n3"><div><b>${rec(results)}</b><small>Record</small></div><div><b>${played}/82</b><small>Played</small></div><div><b>${esc(SEASON.eastRank || '—')}</b><small>East</small></div></div><div class="nx"><span>${played ? 'NEXT GAME' : 'SEASON OPENER'}</span>${nxt}</div></div><div class="st">${strip}</div>`, 'schedule')]);
}

/* assets */
{
  const firsts = PICKS.filter(p => p[1] === '1st'), left = EXC.reduce((t, e) => t + e[1] - e[4].reduce((a, u) => a + u[2], 0), 0);
  const L = Object.fromEntries(LINES.map(l => [l[0], l[1]])), room = L[HARDCAP] - TEAM_SALARY;
  cards.push(['og/assets.jpg', page(`.L{position:absolute;left:64px;top:56px;right:64px}.n3{margin-top:26px}.yrs{position:absolute;left:64px;right:64px;top:400px;display:flex;gap:10px}.yrs span{flex:1;padding:16px 0;text-align:center;font:800 34px 'Geist Mono';background:rgba(255,255,255,.12)}.yrs span.h{background:#F2B231;color:#4a0020}`,
    `<div class="L"><div class="k">Draft picks &amp; exceptions</div><div class="big" style="font-size:96px;margin-top:10px">Cavs assets</div><div class="n3"><div><b>${firsts.length}</b><small>Firsts held</small></div><div><b>${M(left * 1)}</b><small>Exceptions left</small></div><div><b>${room > 0 ? '$' + Math.round(room * 1000) + 'K' : '$0'}</b><small>Usable under hard cap</small></div></div></div>
<div class="yrs">${Array.from({ length: 7 }, (_, k) => 2027 + k).map(y => `<span class="${firsts.some(p => +p[0] === y) ? 'h' : ''}">${y}</span>`).join('')}</div>`, 'assets')]);
}

/* transactions */
{
  const t = [...TX].sort((a, b) => b.d.localeCompare(a.d))[0], n = TX.length;
  const dl = new Date(t.d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  cards.push(['og/moves.jpg', page(`.L{position:absolute;left:64px;top:56px;right:64px}.lt{margin-top:40px;border-left:6px solid #F2B231;padding-left:22px}.lt span{display:block;font:700 20px 'Geist Mono';letter-spacing:3px;color:#F2B231}.lt b{display:block;font:700 44px/1.15 Archivo;margin-top:8px}.cnt{position:absolute;left:64px;top:470px;font:600 24px Archivo;color:#F4D6DD}`,
    `<div class="L"><div class="k">Every Cavs move since 2017</div><div class="big" style="font-size:96px;margin-top:10px">Transactions</div><div class="lt"><span>LATEST · ${dl.toUpperCase()}</span><b>${esc(t.t)}</b></div></div><div class="cnt">${n} trades, signings, extensions and waivers</div>`, 'moves')]);
}

/* draw only what changed */
const fp = h => createHash('sha1').update(h).digest('hex').slice(0, 10);
const need = cards.filter(([f, h]) => !state[f] || state[f] !== fp(h));
if (!need.length) { console.log('og-live: nothing changed'); process.exit(0); }
const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);
const pw = (() => { for (const m of ['playwright-core', 'playwright']) { try { return require(m); } catch {} } return null; })();
if (!pw) { console.log('og-live: playwright missing, skipped'); process.exit(0); }
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await pw.chromium.launch(opts); const pg = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await mkdir(new URL('og/p/', root), { recursive: true }); await mkdir(new URL('og/gp/', root), { recursive: true });
const tmp = new URL('og/_live.html', root);
for (const [f, h] of need) {
  await writeFile(tmp, h); await pg.goto(tmp.href); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(60);
  await pg.screenshot({ path: new URL(f, root).pathname, type: 'jpeg', quality: 86 }); state[f] = fp(h);
}
await unlink(tmp).catch(() => {}); await browser.close();
// forget cards for games that have been played (their final card in og/g takes over)
for (const f of Object.keys(state)) if (f.startsWith('og/gp/') && !cards.some(([c]) => c === f)) { delete state[f]; await unlink(new URL(f, root)).catch(() => {}); }
await writeFile(new URL('og/live.json', root), JSON.stringify(state, null, 1) + '\n');
console.log('og-live: drew', need.length, 'of', cards.length);
