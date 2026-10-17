// Cavs & Coffee: builds the morning-after email from the site's own data and hands it to Buttondown.
//   node scripts/newsletter.mjs auto   (the 7 AM run: only if the Cavs played yesterday and it hasn't gone out)
//   node scripts/newsletter.mjs test   (latest final, or the preseason finale before the opener; test copy to the owner only)
// Nothing reaches subscribers unless the repo variable NEWSLETTER_LIVE is "true". Until then every issue is a
// Buttondown draft plus a test copy to the newsletter owner. Needs BUTTONDOWN_API_KEY, and Playwright/Chrome to read the site's data.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname } from 'node:path';

const MODE = process.argv[2] || 'auto';
const LIVE = process.env.NEWSLETTER_LIVE === 'true';
const KEY = process.env.BUTTONDOWN_API_KEY;
const root = new URL('../', import.meta.url);
const SITE = 'https://cavsdatabase.com';
const API = 'https://api.buttondown.com/v1';
const NICK = { ATL: 'Hawks', BOS: 'Celtics', BKN: 'Nets', CHA: 'Hornets', CHI: 'Bulls', CLE: 'Cavs', DAL: 'Mavericks', DEN: 'Nuggets', DET: 'Pistons', GSW: 'Warriors', HOU: 'Rockets', IND: 'Pacers', LAC: 'Clippers', LAL: 'Lakers', MEM: 'Grizzlies', MIA: 'Heat', MIL: 'Bucks', MIN: 'Timberwolves', NOP: 'Pelicans', NYK: 'Knicks', OKC: 'Thunder', ORL: 'Magic', PHI: '76ers', PHX: 'Suns', POR: 'Trail Blazers', SAC: 'Kings', SAS: 'Spurs', TOR: 'Raptors', UTA: 'Jazz', WAS: 'Wizards' };
const etDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const etHour = () => +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date());
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const long = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const short = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/* ---------- read the site's data by loading the page, the same way the prerender does ---------- */
async function siteData() {
  const require = createRequire(import.meta.url);
  let pw = null; for (const m of ['playwright', 'playwright-core']) { try { pw = require(m); break; } catch {} }
  if (!pw) throw new Error('Playwright not available');
  const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
  const server = createServer(async (req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; try { const b = await readFile(new URL('.' + p, root)); res.writeHead(200, { 'content-type': T[extname(p)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  const browser = await pw.chromium.launch(opts);
  const page = await browser.newPage({ timezoneId: 'America/New_York' });
  await page.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
  const md = (process.env.NL_TODAY || etDate()).slice(5);
  const d = await page.evaluate(md => {
    const tvw = d => { const t = tvFor(d); return [t.nat, t.loc].filter(Boolean)[0] || ''; };
    return { SCHEDULE, SCORES, SEASON, PRESEASON, TEAMS, INJURIES, HISTORY, L14, TX: TX.slice(0, 60), DATES,
      PL: PLAYERS.map(p => [p[1], p[12]]), tv: Object.fromEntries(SCHEDULE.map(g => [g[0], tvw(g[0])])), radio: (radioFor(SCHEDULE[0][0]).cavs || '').split(' · ')[0],
      box: Object.fromEntries(SCHEDULE.map(g => [g[0], boxUrl(g[0])])), tips: Object.fromEntries(SCHEDULE.map(g => [g[0], tipOf(g).toISOString()])),
      TS: (typeof TSTATS === 'object' && TSTATS.CLE && TSTATS.CLE[0] + TSTATS.CLE[1] >= 5) ? TSTATS : (typeof TSTATS_PREV === 'object' ? TSTATS_PREV : {}), TS_CUR: !!(typeof TSTATS === 'object' && TSTATS.CLE && TSTATS.CLE[0] + TSTATS.CLE[1] >= 5),
      STANDINGS: typeof STANDINGS === 'object' ? STANDINGS : [], REST: typeof REST === 'object' ? REST : {}, INJ_UPDATED: typeof INJ_UPDATED === 'string' ? INJ_UPDATED : '',
      OTD: window.otdFacts ? window.otdFacts(md).slice(0, 1).map(f => [md, String(f.y), f.t]) : [] };
  }, md);
  await browser.close(); server.close();
  return d;
}

/* ---------- the email: two designs from the same content (NL_DESIGN = paper | sports) ---------- */
const DESIGN = (process.env.NL_DESIGN || 'paper').toLowerCase() === 'sports' ? 'sports' : 'paper';
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const F = { sans: 'Arial,Helvetica,sans-serif', serif: "Georgia,'Times New Roman',serif", cond: "'Saira Condensed','Arial Narrow',Arial,Helvetica,sans-serif", mono: "'Geist Mono','SF Mono',Menlo,Consolas,'Courier New',monospace" };
const md2 = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const wkd = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/* everything both designs show, worked out once */
function prep(D, g, score, top, boxLink, opts) {
  const [cs, os] = score.split('-').map(Number), win = cs > os, issueDay = opts.issueDay, md = issueDay.slice(5);
  const rec = (D.SEASON.results || '').replace(/[^WL]/g, ''); const w = (rec.match(/W/g) || []).length, l = rec.length - w;
  const [tn, tl] = (top || '').split(': ');
  const fresh = x => x.date && Date.parse(x.date) > opts.sinceTs;
  const rcfItems = opts.rcf?.items || [];
  const recap = rcfItems.find(x => /recap/i.test(x.title) && x.date && x.date.slice(0, 10) >= g[0]);
  const nickU = (NICK[g[1]] || '').toUpperCase();
  const hl = (opts.news?.highlights || []).find(x => x.date.slice(0, 10) >= g[0] && Date.parse(x.date) - Date.parse(g[0] + 'T12:00:00Z') < 3 * 864e5 && x.title.toUpperCase().includes(nickU));
  const reads = [...rcfItems.filter(x => x !== recap && fresh(x)).map(x => ({ ...x, src: 'RealCavsFans' })), ...(opts.news?.articles || []).filter(fresh)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const play = []; [...(opts.news?.videos || []).map(x => ({ ...x, kind: 'video' })), ...(opts.news?.podcasts || []).map(x => ({ ...x, kind: 'podcast' }))].filter(fresh).sort((a, b) => b.date.localeCompare(a.date)).forEach(x => { if (!play.some(p => p.src === x.src)) play.push(x); });
  const txText = x => x.k === 'trade' ? `Traded ${(x.sent || []).join(', ')} to ${(x.w || []).join('/')} for ${(x.got || []).join(', ')}` : (x.t || x.p || '');
  const moves = D.TX.filter(x => x.d > opts.since && x.d <= issueDay).sort((a, b) => a.d.localeCompare(b.d)).map(x => [md2(x.d), txText(x) + (x.note ? ' · ' + x.note : '')]);
  const tg = D.SCHEDULE.find(x => x[0] === issueDay), nx = tg || D.SCHEDULE.find(x => x[0] > g[0] && x[0] > issueDay);
  const week = D.DATES.filter(x => x[0] >= issueDay && x[0] <= etDate(new Date(Date.parse(issueDay + 'T12:00:00Z') + 6 * 864e5)) && !(nx && x[0] === nx[0] && /opener|vs |at /i.test(x[1]))).slice(0, 3).map(x => [wkd(x[0]), md2(x[0]), x[1]]);
  const otd = (D.OTD || [])[0] || D.HISTORY.find(h => h[0] === md);
  // up next: records and ratings with league ranks, then any injuries as one line
  let tape = [], nxInfo = null;
  if (nx) {
    const o = nx[1], TS = D.TS || {}, all = Object.values(TS), i = D.SCHEDULE.indexOf(nx);
    const rr = D.REST[nx[0]] || []; const rest = rr[0] === 0 ? 'Back-to-back' : rr[0] == null ? (i === 0 ? 'Season opener' : '') : rr[0] + ' day' + (rr[0] === 1 ? '' : 's') + ' rest';
    nxInfo = { o, home: nx[2] === 'H', date: nx[0], tip: nx[3], tv: D.tv[nx[0]] || '', radio: D.radio, rest, slug: nx[0] + '-' + o.toLowerCase(), tonight: !!tg, season: D.TS_CUR ? '2026–27' : '2025–26' };
    if (TS.CLE && TS[o]) tape = [['Record', t => t[0] / Math.max(1, t[0] + t[1]), 1, t => t[0] + '–' + t[1]], ['Off rating', t => t[4], 1, t => t[4].toFixed(1)], ['Def rating', t => t[5], 0, t => t[5].toFixed(1)], ['Net rating', t => t[4] - t[5], 1, t => { const x = t[4] - t[5]; return (x > 0 ? '+' : '') + x.toFixed(1); }]]
      .map(([lab, f, hi, fm]) => { const rk = t => ord(1 + all.filter(u => hi ? f(u) > f(t) : f(u) < f(t)).length); return [lab, fm(TS.CLE), rk(TS.CLE), fm(TS[o]), rk(TS[o])]; });
  }
  const inj = D.INJURIES.map(([n, , what, st]) => [n, what.toLowerCase(), st]);
  // standings: five East rows around the Cavs (regular season only)
  const E = (D.STANDINGS || []).filter(t => t[1] === 'E').sort((x, y) => (y[2] - y[3]) - (x[2] - x[3]) || y[2] - x[2]);
  let stand = []; const ci = E.findIndex(t => t[0] === 'CLE');
  if (ci >= 0 && E.some(t => t[2] + t[3] > 0)) { const a = Math.max(0, Math.min(ci - 2, E.length - 5)), L = E[0]; stand = E.slice(a, a + 5).map((t, k) => { const gb = ((L[2] - t[2]) + (t[3] - L[3])) / 2; return [a + k + 1, t[0] === 'CLE' ? 'Cleveland' : (D.TEAMS[t[0]] || t[0]), t[2] + '–' + t[3], gb ? (gb % 1 ? gb.toFixed(1) : String(gb)) : '—', t[0] === 'CLE']; }); }
  return { g, cs, os, win, issueDay, md, w, l, hasRec: rec.length > 0, tn, tl, recap, hl, reads, play, moves, week, otd, nx: nxInfo, tape, inj, stand, tq: opts.trivia, shot: opts.milestone || (() => { if (opts.preseason || !rec.length) return ''; const last = rec[rec.length - 1]; let n = 0; for (let k = rec.length - 1; k >= 0 && rec[k] === last; k--) n++; return n >= 3 ? (last === 'W' ? `The Cavs have won ${n} straight.` : `The Cavs have lost ${n} straight.`) : ''; })(),
    pid: n => (D.PL.find(p => p[0] === n) || [])[1], where: (g[2] === 'H' ? 'vs ' : 'at ') + D.TEAMS[g[1]], whereShort: g[2] === 'H' ? 'Rocket Arena' : 'at ' + D.TEAMS[g[1]].split(' ').slice(-1)[0], boxLink, preseason: opts.preseason, test: opts.test, TEAMS: D.TEAMS };
}
const fontLink = `<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@800&family=Geist+Mono:wght@700&display=swap" rel="stylesheet"><!--<![endif]-->`;
const wrapOpen = bg => `${fontLink}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F2"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${bg}">
<tr><td><a href="${SITE}"><img src="${SITE}/nl/header.png" width="600" alt="Cavs &amp; Coffee · the morning after every Cavs game · presented by cavs_db" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>`;
const footer = (rule) => `<tr><td style="padding:30px 28px 26px;text-align:center;font:12px/1.7 ${F.sans};color:#5D646C">${rule || ''}
<a href="${SITE}"><img src="${SITE}/nl/logo.png" width="130" alt="cavs_db" style="display:inline-block;width:130px;height:auto;border:0;margin-bottom:6px"></a><br>
<a href="${SITE}" style="color:#7A1F33;font-weight:700;text-decoration:none">cavsdatabase.com</a> &nbsp;·&nbsp; <a href="https://www.buymeacoffee.com/cavsdb" style="color:#7A1F33;font-weight:700;text-decoration:none">&#9749; Buy cavs_db a coffee</a><br>
Independent fan reference, not affiliated with the Cavaliers or the NBA.</td></tr></table></td></tr></table>`;
const T = (inner, attrs = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${attrs}>${inner}</table>`;

/* ========== Morning Paper: warm paper, centered headings with a gold tick, serif for stories ========== */
function renderPaper(x) {
  const P = { bg: '#FBF8F3', rule: '#E7E1D8', wine: '#7A1F33', ink: '#101419', fg2: '#2F363E', muted: '#5D646C' };
  const K = t => `<tr><td style="padding:26px 26px 0;text-align:center"><div style="font:800 11px ${F.sans};letter-spacing:2.4px;text-transform:uppercase;color:${P.wine}">${t}</div><div style="width:28px;height:2px;background:#F2B231;margin:7px auto 12px;font-size:0;line-height:0">&nbsp;</div></td></tr>`;
  const sep = `<tr><td style="padding:24px 26px 0"><div style="height:1px;background:${P.rule};font-size:0;line-height:0">&nbsp;</div></td></tr>`;
  const B = inner => `<tr><td style="padding:0 26px">${inner}</td></tr>`;
  const li = (main, o = {}) => T(`<tr>${o.left ? `<td width="${o.lw || 86}" valign="top" style="padding:10px 8px 10px 0;font:700 11.5px ${F.mono};color:${P.muted};white-space:nowrap">${o.left}</td>` : ''}<td valign="top" style="padding:9px 0;font:14px/1.45 ${F.sans};color:${P.ink}">${main}${o.meta ? `<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${o.meta}</div>` : ''}</td>${o.right ? `<td align="right" valign="top" style="padding:9px 0 9px 10px;font:700 12.5px ${F.sans};color:#9A6A00;white-space:nowrap">${o.right}</td>` : ''}</tr>`, `style="border-bottom:1px solid ${P.rule}"`);
  const a = (h, t) => `<a href="${esc(h)}" style="color:${P.ink};font-weight:700;text-decoration:none">${t}</a>`;
  const ic = k => `<span style="color:#860038;font:15px ${F.sans}">${k === 'video' ? '&#9654;' : '&#127911;'}</span>`;
  const s = [];
  s.push(`<tr><td style="padding:16px 26px 0;text-align:center;font:700 11px ${F.mono};letter-spacing:1px;color:${P.wine}">${esc(long(x.issueDay).toUpperCase())}${x.test ? ' · <span style="color:#C8102E">TEST COPY</span>' : ''}</td></tr>`);
  if (x.otd) s.push(K('This day in Cavs history'), `<tr><td style="padding:0 26px;text-align:center"><div style="font:800 26px/1 ${F.cond};color:${P.ink}">${esc(x.otd[1])}</div><div style="font:14.5px/1.5 ${F.serif};color:${P.fg2};margin-top:6px">${esc(x.otd[2])}</div></td></tr>`, sep);
  if (x.tq) s.push(K('Daily trivia'), B(`<div style="text-align:center;font:700 14.5px/1.4 ${F.sans};color:${P.ink};margin-bottom:8px">${esc(x.tq.q)}</div>${T(x.tq.c.map((c, k) => `<tr><td style="padding:7px 4px;border-${k ? 'bottom' : 'top'}:1px solid ${P.rule};${k ? '' : `border-bottom:1px solid ${P.rule};`}font:13px ${F.sans};color:${P.ink}"><b style="color:${P.wine};font-family:${F.mono};margin-right:8px">${'ABCD'[k]}</b>${esc(c)}</td></tr>`).join(''))}<div style="text-align:center;font:12px ${F.sans};color:${P.muted};margin-top:8px">Answer at the bottom</div>`), sep);
  // last game
  s.push(K(x.preseason ? 'Last game · preseason' : 'Last game'));
  s.push(`<tr><td style="padding:0 26px;text-align:center"><div style="font:800 44px/1 ${F.cond};color:${P.ink};white-space:nowrap">CLE ${x.cs} <span style="color:#B9B2A8">&ndash;</span> ${x.os} ${x.g[1]} <span style="display:inline-block;vertical-align:middle;background:${x.win ? '#F2B231' : 'transparent'};border:2px solid ${x.win ? '#F2B231' : '#860038'};color:${x.win ? P.ink : '#860038'};font:800 11px ${F.sans};letter-spacing:1px;padding:2px 6px;margin-left:4px">${x.win ? 'W' : 'L'}</span></div>
<div style="font:13px ${F.sans};color:${P.muted};margin-top:8px">${esc(x.where)} · ${esc(short(x.g[0]))}${x.hasRec ? ` · Cavs ${x.w}–${x.l}` : ''} · <a href="${esc(x.boxLink)}" style="color:${P.wine};font-weight:700;text-decoration:none">Box score</a></div>
${x.tn ? `<div style="font:16px/1.5 ${F.serif};color:${P.fg2};margin-top:12px"><b style="font-family:${F.sans};color:${P.ink}">${esc(x.tn)}</b> led the Cavs with ${esc((x.tl || '').replace(/ pts/, ' points').replace(/ reb/, ' rebounds').replace(/, (\d+) ast/, ' and $1 assists'))}.</div>` : ''}</td></tr>`);
  if (x.hl) s.push(`<tr><td style="padding:14px 26px 0"><a href="${esc(x.hl.link)}"><img src="https://i.ytimg.com/vi/${esc(x.hl.id)}/hq720.jpg" width="548" alt="Watch the full game highlights" style="display:block;width:100%;height:auto;border:0"></a></td></tr>`);
  if (x.hl || x.recap) s.push(B(`${x.hl ? li(a(x.hl.link, '&#9654;&nbsp; Full game highlights'), { meta: 'NBA · YouTube' }) : ''}${x.recap ? li(a(x.recap.link, esc(x.recap.title)), { meta: 'RealCavsFans recap' }) : ''}`));
  if (x.shot) s.push(`<tr><td style="padding:14px 26px 0;text-align:center"><div style="font:800 10px ${F.sans};letter-spacing:1.6px;color:${P.wine}">ESPRESSO SHOT</div><div style="font:italic 15.5px/1.5 ${F.serif};color:${P.ink};margin-top:4px">${esc(x.shot)}</div></td></tr>`);
  s.push(sep);
  // up next / tonight
  if (x.nx) {
    const n = x.nx;
    s.push(K(n.tonight ? 'Tonight' : 'Up next'), `<tr><td style="padding:0 26px;text-align:center"><div style="font:800 32px/1 ${F.cond};color:${P.ink}">CLE ${n.home ? 'vs' : 'at'} ${n.o}</div><div style="font:13px ${F.sans};color:${P.muted};margin-top:6px">${esc(short(n.date))} · ${esc(n.tip)} PM ET${n.tv ? ' · ' + esc(n.tv) : ''} · ${esc(n.radio)}${n.rest ? ' · ' + esc(n.rest) : ''}</div></td></tr>`);
    if (x.tape.length) s.push(`<tr><td style="padding:14px 26px 0">${T(`<tr><td style="padding:0 0 6px;font:800 11px ${F.cond};font-size:15px;color:#860038">CLE</td><td align="center" style="padding:0 0 6px;font:700 10px ${F.sans};letter-spacing:1px;color:${P.muted}">${n.season} · LEAGUE RANK</td><td align="right" style="padding:0 0 6px;font:800 15px ${F.cond};color:${P.ink}">${n.o}</td></tr>` + x.tape.map(([lab, a1, r1, b1, r2]) => `<tr><td style="padding:6px 0;border-top:1px solid ${P.rule};font:700 14px ${F.mono};color:${P.ink}">${a1} <span style="font:400 11px ${F.sans};color:${P.muted}">${r1}</span></td><td align="center" style="padding:6px 0;border-top:1px solid ${P.rule};font:700 10px ${F.sans};letter-spacing:1px;text-transform:uppercase;color:${P.muted}">${lab}</td><td align="right" style="padding:6px 0;border-top:1px solid ${P.rule};font:700 14px ${F.mono};color:${P.ink}"><span style="font:400 11px ${F.sans};color:${P.muted}">${r2}</span> ${b1}</td></tr>`).join(''))}</td></tr>`);
    if (x.inj.length) s.push(`<tr><td style="padding:12px 26px 0;font:13px/1.5 ${F.sans};color:${P.fg2};text-align:center"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">INJURIES</b>&nbsp; ${x.inj.map(([nm, what, st]) => `${esc(nm)} (${esc(what)}, ${esc(st.toLowerCase())})`).join(' · ')}</td></tr>`);
    s.push(`<tr><td style="padding:10px 26px 0;text-align:center"><a href="${SITE}/games/${n.slug}" style="font:700 13px ${F.sans};color:${P.wine};text-decoration:none">Full game preview &rarr;</a></td></tr>`, sep);
  }
  if (x.stand.length) s.push(K('East standings'), B(T(x.stand.map(([rk, nm, wl, gb, me]) => `<tr><td width="28" style="padding:7px 0;border-bottom:1px solid ${P.rule};font:700 12px ${F.mono};color:${P.muted}">${rk}</td><td style="padding:7px 0;border-bottom:1px solid ${P.rule};font:${me ? 700 : 400} 14px ${F.sans};color:${me ? '#860038' : P.ink}">${esc(nm)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid ${P.rule};font:700 13.5px ${F.mono};color:${me ? '#860038' : P.ink}">${wl}</td><td width="48" align="right" style="padding:7px 0;border-bottom:1px solid ${P.rule};font:700 12.5px ${F.mono};color:${P.muted}">${gb}</td></tr>`).join(''))), sep);
  if (x.reads.length) s.push(K('Morning reads'), B(x.reads.map(r => li(a(r.link, esc(r.title)), { meta: `${esc(r.src)} · ${esc(md2(r.date.slice(0, 10)))}` })).join('')), sep);
  if (x.play.length) s.push(K('Press play'), B(x.play.map(p => T(`<tr><td width="26" valign="top" style="padding:9px 0">${ic(p.kind)}</td><td valign="top" style="padding:9px 0;font:14px/1.45 ${F.sans}">${a(p.link, esc(p.title))}<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${esc(p.src)}${p.dur ? ' · ' + esc(p.dur) : ''} · ${esc(md2(p.date.slice(0, 10)))}</div></td></tr>`, `style="border-bottom:1px solid ${P.rule}"`)).join('')), sep);
  if (x.moves.length) s.push(K('Transactions'), B(x.moves.map(([d, t]) => li(esc(t), { left: esc(d), lw: 60 })).join('')), `<tr><td style="padding:10px 26px 0;text-align:center"><a href="${SITE}/transactions" style="font:700 13px ${F.sans};color:${P.wine};text-decoration:none">Every Cavs move &rarr;</a></td></tr>`, sep);
  if (x.week.length) s.push(K('This week'), B(x.week.map(([wd, d, t]) => li(esc(t), { left: `${esc(wd)} ${esc(d)}`, lw: 96 })).join('')), `<tr><td style="padding:10px 26px 0;text-align:center"><a href="${SITE}/schedule" style="font:700 13px ${F.sans};color:${P.wine};text-decoration:none">Full schedule &rarr;</a></td></tr>`, sep);
  if (x.tq) s.push(`<tr><td style="padding:22px 26px 0;text-align:center;font:12.5px ${F.sans};color:${P.muted}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">TRIVIA ANSWER</b>&nbsp; ${String.fromCharCode(65 + x.tq.a)}. ${esc(x.tq.c[x.tq.a])}</td></tr>`);
  s.push(`<tr><td style="padding:26px 26px 0;text-align:center"><div style="font:800 10px ${F.sans};letter-spacing:1.6px;color:${P.muted};margin-bottom:8px">MORE ON CAVSDATABASE.COM</div><div style="font:700 13px/2 ${F.sans}">${[['Roster', 'roster'], ['Cap sheet', 'cap'], ['Draft picks', 'assets'], ['Injuries', '#inj'], ['Staff', 'staff']].map(([t, r]) => `<a href="${SITE}/${r}" style="color:${P.wine};text-decoration:none">${t}</a>`).join(' &nbsp;·&nbsp; ')}</div></td></tr>`);
  return wrapOpen(P.bg) + s.join('\n') + footer();
}

/* ========== Sports Page: old school newspaper, double rules, condensed heads, boxed linescore ========== */
function renderSports(x) {
  const P = { bg: '#F7F3EC', dot: '#B9B2A8', wine: '#860038', ink: '#101419', fg2: '#2F363E', muted: '#5D646C' };
  const K = (t, link) => `<tr><td style="padding:24px 24px 0">${T(`<tr><td style="font:800 21px/1 ${F.cond};text-transform:uppercase;color:${P.ink};padding-bottom:5px;border-bottom:1px solid ${P.ink}">${t}</td><td align="right" valign="bottom" style="padding-bottom:5px;border-bottom:1px solid ${P.ink};font:700 12px ${F.sans};white-space:nowrap">${link ? `<a href="${link[1]}" style="color:#7A1F33;text-decoration:none">${link[0]} &rarr;</a>` : ''}</td></tr>`)}</td></tr>`;
  const B = inner => `<tr><td style="padding:8px 24px 0">${inner}</td></tr>`;
  const li = (main, o = {}) => T(`<tr>${o.left ? `<td width="${o.lw || 86}" valign="top" style="padding:9px 8px 9px 0;font:700 11.5px ${F.mono};color:${P.muted};white-space:nowrap">${o.left}</td>` : ''}<td valign="top" style="padding:8px 0;font:14px/1.45 ${F.sans};color:${P.ink}">${main}${o.meta ? `<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${o.meta}</div>` : ''}</td></tr>`, `style="border-bottom:1px dotted ${P.dot}"`);
  const a = (h, t) => `<a href="${esc(h)}" style="color:${P.ink};font-weight:700;text-decoration:none">${t}</a>`;
  const s = [];
  s.push(`<tr><td style="padding:12px 24px 0"><div style="border-bottom:3px double ${P.ink};padding-bottom:9px;text-align:center;font:700 11px ${F.mono};letter-spacing:1px;color:${P.ink}">${esc(long(x.issueDay).toUpperCase())} · CLEVELAND${x.test ? ' · <span style="color:#C8102E">TEST COPY</span>' : ''}</div></td></tr>`);
  if (x.otd) s.push(K('This day in Cavs history · ' + esc(x.otd[1])), B(`<div style="font:16px/1.55 ${F.serif};color:${P.fg2}"><span style="float:left;font:800 46px/40px ${F.cond};color:${P.wine};padding:4px 6px 0 0">${esc(x.otd[2].charAt(0))}</span>${esc(x.otd[2].slice(1))}</div>`));
  if (x.tq) s.push(K('Daily trivia'), B(`<div style="font:700 16px/1.4 ${F.serif};color:${P.ink};margin-bottom:6px">${esc(x.tq.q)}</div>${x.tq.c.map((c, k) => li(`<b style="color:${P.wine};font-family:${F.mono};margin-right:8px">${'ABCD'[k]}</b>${esc(c)}`)).join('')}<div style="font:12px ${F.sans};color:${P.muted};margin-top:6px">Answer at the bottom</div>`));
  // last game: boxed linescore, winner reversed out in ink
  const cell = (ab, pts, won, nm) => `<td width="50%" align="center" style="padding:10px 0 9px;color:${won ? P.ink : P.muted};${won ? 'border-bottom:4px solid #860038;' : ''}"><div style="font:800 20px/1 ${F.cond}">${ab}</div><div style="font:700 36px/1.15 ${F.mono}">${pts}</div><div style="font:11px ${F.sans};color:${P.muted}">${esc(nm)}</div></td>`;
  s.push(K(x.preseason ? 'Last game · preseason' : 'Last game', ['Box score', esc(x.boxLink)]));
  s.push(B(`${T(`<tr>${cell('CLE', x.cs, x.win, 'Cavaliers')}${cell(x.g[1], x.os, !x.win, NICK[x.g[1]] || '')}</tr>`, `style="border:2px solid ${P.ink}"`)}<div style="font:12px ${F.sans};color:${P.muted};margin-top:6px;text-align:center">FINAL · ${esc(x.where.toUpperCase())} · ${esc(short(x.g[0]).toUpperCase())}${x.hasRec ? ` · CAVS ${x.w}–${x.l}` : ''}</div>
${x.tn ? `<div style="font:16px/1.55 ${F.serif};color:${P.fg2};margin-top:10px"><b style="font-family:${F.sans};color:${P.ink}">${esc(x.tn)}</b> led the Cavs with ${esc((x.tl || '').replace(/ pts/, ' points').replace(/ reb/, ' rebounds').replace(/, (\d+) ast/, ' and $1 assists'))}.</div>` : ''}`));
  if (x.hl) s.push(`<tr><td style="padding:12px 24px 0"><a href="${esc(x.hl.link)}"><img src="https://i.ytimg.com/vi/${esc(x.hl.id)}/hq720.jpg" width="552" alt="Watch the full game highlights" style="display:block;width:100%;height:auto;border:0"></a></td></tr>`);
  if (x.hl || x.recap) s.push(B(`${x.hl ? li(a(x.hl.link, '&#9654;&nbsp; Full game highlights'), { meta: 'NBA · YouTube' }) : ''}${x.recap ? li(a(x.recap.link, esc(x.recap.title)), { meta: 'RealCavsFans recap' }) : ''}`));
  if (x.shot) s.push(B(`<div style="border:1px solid ${P.ink};padding:9px 11px;margin-top:4px;font:15px/1.5 ${F.serif};color:${P.ink}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">ESPRESSO SHOT</b>&nbsp; ${esc(x.shot)}</div>`));
  if (x.nx) {
    const n = x.nx;
    s.push(K(n.tonight ? 'Tonight' : 'Up next', ['Preview', `${SITE}/games/${n.slug}`]), B(`<div style="font:800 26px/1 ${F.cond};color:${P.ink}">CLE ${n.home ? 'vs' : 'at'} ${n.o}</div><div style="font:13px ${F.sans};color:${P.muted};margin:4px 0 4px">${esc(short(n.date))} · ${esc(n.tip)} PM ET${n.tv ? ' · ' + esc(n.tv) : ''} · ${esc(n.radio)}${n.rest ? ' · ' + esc(n.rest) : ''}</div>`));
    if (x.tape.length) s.push(B(T(`<tr><td style="padding:4px 0;font:800 14px ${F.cond};color:${P.wine}">CLE</td><td align="center" style="font:700 9.5px ${F.sans};letter-spacing:1px;color:${P.muted}">${n.season} · RANK</td><td align="right" style="font:800 14px ${F.cond};color:${P.ink}">${n.o}</td></tr>` + x.tape.map(([lab, a1, r1, b1, r2]) => `<tr><td style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 13.5px ${F.mono}">${a1} <span style="font:400 11px ${F.sans};color:${P.muted}">${r1}</span></td><td align="center" style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 10px ${F.sans};letter-spacing:1px;text-transform:uppercase;color:${P.muted}">${lab}</td><td align="right" style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 13.5px ${F.mono}"><span style="font:400 11px ${F.sans};color:${P.muted}">${r2}</span> ${b1}</td></tr>`).join(''))));
    if (x.inj.length) s.push(B(`<div style="font:13px/1.5 ${F.sans};color:${P.fg2};padding-top:6px;border-top:1px dotted ${P.dot}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">INJURIES</b>&nbsp; ${x.inj.map(([nm, what, st]) => `${esc(nm)} (${esc(what)}, ${esc(st.toLowerCase())})`).join(' · ')}</div>`));
  }
  if (x.stand.length) s.push(K('East standings'), B(T(x.stand.map(([rk, nm, wl, gb, me]) => `<tr><td width="26" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 12px ${F.mono};color:${P.muted}">${rk}</td><td style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:${me ? 700 : 400} 14px ${F.sans};color:${me ? P.wine : P.ink}">${esc(nm)}</td><td align="right" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 13.5px ${F.mono}">${wl}</td><td width="46" align="right" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 12.5px ${F.mono};color:${P.muted}">${gb}</td></tr>`).join(''))));
  if (x.reads.length) s.push(K('Morning reads'), B(x.reads.map(r => li(a(r.link, esc(r.title)), { meta: `${esc(r.src)} · ${esc(md2(r.date.slice(0, 10)))}` })).join('')));
  if (x.play.length) s.push(K('Press play'), B(x.play.map(p => li(`<span style="display:inline-block;width:20px;color:${P.wine}">${p.kind === 'video' ? '&#9654;' : '&#127911;'}</span>${a(p.link, esc(p.title))}`, { meta: `<span style="display:inline-block;width:20px"></span>${esc(p.src)}${p.dur ? ' · ' + esc(p.dur) : ''} · ${esc(md2(p.date.slice(0, 10)))}` })).join('')));
  if (x.moves.length) s.push(K('Transactions'), B(x.moves.map(([d, t]) => li(esc(t), { left: esc(d), lw: 60 })).join('')));
  if (x.week.length) s.push(K('This week'), B(x.week.map(([wd, d, t]) => li(esc(t), { left: `${esc(wd)} ${esc(d)}`, lw: 96 })).join('')));
  if (x.tq) s.push(`<tr><td style="padding:18px 24px 0;text-align:center;font:12.5px ${F.sans};color:${P.muted}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">TRIVIA ANSWER</b>&nbsp; ${String.fromCharCode(65 + x.tq.a)}. ${esc(x.tq.c[x.tq.a])}</td></tr>`);
  return wrapOpen(P.bg) + s.join('\n') + footer(`<div style="border-top:3px double ${P.ink};margin:0 0 18px;font-size:0;line-height:0">&nbsp;</div>`);
}

function build(D, g, score, top, boxLink, opts) { const x = prep(D, g, score, top, boxLink, opts); return `<!-- Cavs & Coffee · ${DESIGN} design · built by cavsdatabase.com -->\n` + (DESIGN === 'sports' ? renderSports(x) : renderPaper(x)); }

/* ---------- Buttondown ---------- */
async function bd(path, method, body) {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Token ' + KEY, 'Content-Type': 'application/json', 'X-API-Version': '2026-04-01' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
}

const sentFile = new URL('data/newsletter-sent.json', root);
let sent = {}; try { sent = JSON.parse(await readFile(sentFile, 'utf8')); } catch {}
const DRY = process.env.NL_DRY === '1';
if (!KEY && !DRY) { console.log('::warning::BUTTONDOWN_API_KEY missing, nothing to do'); process.exit(0); }
const today = process.env.NL_TODAY || etDate(); // NL_TODAY: preview a given morning (dry runs)
if (MODE === 'auto' && etHour() !== 7) { console.log('not 7 AM ET, skipping'); process.exit(0); }

const D = await siteData();
let box = {}; try { box = JSON.parse(await readFile(new URL('box.json', root), 'utf8')); } catch {}
let rcf = null; try { rcf = JSON.parse(await readFile(new URL('rcf.json', root), 'utf8')); } catch {}
let news = null; try { news = JSON.parse(await readFile(new URL('news.json', root), 'utf8')); } catch {}
let trivia = []; try { trivia = JSON.parse(await readFile(new URL('data/trivia.json', root), 'utf8')); } catch {}
const yesterday = etDate(new Date(Date.now() - 864e5));
let g, score, preseason = false;
if (MODE === 'auto') {
  g = D.SCHEDULE.find(x => x[0] === yesterday);
  if (!g) { console.log('no Cavs game yesterday'); process.exit(0); }
  if (sent[g[0]]) { console.log('already sent for', g[0]); process.exit(0); }
  score = D.SCORES[g[0]] || (box[g[0]]?.status === 'final' && box[g[0]].score);
  if (!score) { console.log('no final yet for', g[0]); process.exit(0); }
} else {
  g = [...D.SCHEDULE].reverse().find(x => x[0] < today && (D.SCORES[x[0]] || box[x[0]]?.status === 'final'));
  if (g) score = D.SCORES[g[0]] || box[g[0]].score;
  else { const p = D.PRESEASON[D.PRESEASON.length - 1]; g = [p[0], p[1], p[2]]; score = p[4]; preseason = true; }
}
const b = box[g[0]] || {};
// since: the game the last issue covered, or the game before this one
const lastIssue = Object.keys(sent).filter(d => d < g[0]).sort().pop();
const prevGame = [...D.SCHEDULE].reverse().find(x => x[0] < g[0])?.[0];
const since = lastIssue || prevGame || etDate(new Date(Date.parse(g[0] + 'T12:00:00Z') - 3 * 864e5));
const lastSent = Object.values(sent).map(x => x.at).filter(Boolean).sort().pop();
const sinceTs = lastSent ? Date.parse(lastSent) : Date.parse(since + 'T12:00:00Z');
// milestone watch / records: career and Cavs totals (through last season) plus this season's box scores
let MS = null; try { MS = JSON.parse(await readFile(new URL('data/milestones.json', root), 'utf8')); } catch {}
function milestone() {
  if (!MS || preseason) return '';
  const regs = new Set(D.SCHEDULE.map(x => x[0]));
  const add = upto => { const t = {}; for (const [d, gm] of Object.entries(box)) { if (!regs.has(d) || d > upto || !gm.box) continue; for (const [n, , pts, reb, ast] of gm.box) { const o = t[n] || (t[n] = { GP: 0, PTS: 0, REB: 0, AST: 0 }); o.GP++; o.PTS += +pts || 0; o.REB += +reb || 0; o.AST += +ast || 0; } } return t; };
  const prevDay = [...D.SCHEDULE].reverse().find(x => x[0] < g[0])?.[0] || '0000';
  const now = add(g[0]), was = add(prevDay);
  const W = { PTS: 'points', REB: 'rebounds', AST: 'assists', GP: 'games' }, LIST = { PTS: 'scoring', REB: 'rebounding', AST: 'assists', GP: 'games played' };
  const steps = { PTS: v => v >= 10000 ? 5000 : 0, REB: v => v >= 5000 ? 2500 : 0, AST: v => v >= 5000 ? 2500 : 0, GP: v => v >= 500 ? 250 : 0 };
  const near = { PTS: 100, REB: 30, AST: 30, GP: 1 };
  const fmt = n => n.toLocaleString('en-US');
  const ordn = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const hits = [], watch = [];
  for (const [n, b] of Object.entries(MS.players)) {
    const Z = { GP: 0, PTS: 0, REB: 0, AST: 0 }, a1 = now[n] || Z, a0 = was[n] || Z;
    const played = (now[n]?.GP || 0) > (was[n]?.GP || 0);
    for (const k of ['PTS', 'REB', 'AST', 'GP']) {
      const c1 = b.career[k] + a1[k], c0 = b.career[k] + a0[k];
      // career round numbers
      const st = steps[k](c1); if (st && played && Math.floor(c1 / st) > Math.floor(c0 / st)) hits.push([3, `${n} reached ${fmt(Math.floor(c1 / st) * st)} career ${W[k]} last night.`]);
      const st2 = steps[k](c1 + near[k]), nx = st2 ? (Math.floor(c1 / st2) + 1) * st2 : Infinity;
      if (isFinite(nx) && nx - c1 <= near[k] && nx > c1) watch.push([nx - c1, `Milestone watch: ${n} is ${fmt(nx - c1)} ${nx - c1 === 1 ? W[k].replace(/s$/, '') : W[k]} from ${fmt(nx)} for his career.`]);
      // Cavs all-time lists (top 10)
      const L = MS.franchise[k]; if (!L) continue;
      const v1 = b.cavs[k] + a1[k], v0 = b.cavs[k] + a0[k];
      const others = L.filter(([m]) => m !== n);
      const rk = v => 1 + others.filter(([, x]) => x > v).length;
      if (played && rk(v1) < rk(v0) && rk(v1) <= 10) { const passed = others.filter(([, x]) => x <= v1 && x > v0).reverse().map(([m]) => m); const lst = passed.length > 1 ? passed.slice(0, -1).join(', ') + ' and ' + passed[passed.length - 1] : passed[0]; hits.push([2, `${n} passed ${lst} for ${ordn(rk(v1))} on the Cavs' all-time ${LIST[k]} list.`]); }
      else { const ahead = others.filter(([, x]) => x > v1).pop(); if (ahead && rk(v1) <= 11 && ahead[1] - v1 + 1 <= near[k]) watch.push([ahead[1] - v1 + 1, `Milestone watch: ${n} is ${fmt(ahead[1] - v1 + 1)} ${W[k]} from passing ${ahead[0]} for ${ordn(rk(v1) - 1)} on the Cavs' all-time ${LIST[k]} list.`]); }
    }
  }
  if (hits.length) return hits.sort((x, y) => y[0] - x[0])[0][1];
  return watch.length ? watch.sort((x, y) => x[0] - y[0])[0][1] : '';
}
const tq = trivia.length ? trivia[Object.keys(sent).length % trivia.length] : null;
const html = build(D, g, score, b.top || '', b.url || D.box[g[0]] || SITE + '/schedule', { issueDay: today, rcf, news, trivia: tq, since, sinceTs, milestone: milestone(), test: MODE === 'test' || !LIVE, preseason });
const [cs, os] = score.split('-').map(Number);
const subj = `${MODE === 'test' || !LIVE ? `[Test · ${DESIGN === 'sports' ? 'Sports Page' : 'Morning Paper'}] ` : ''}☕ Final: Cavs ${cs}, ${NICK[g[1]] || g[1]} ${os}${b.top ? ' · ' + b.top.split(':')[0].split(' ').slice(-1)[0] + ' ' + (b.top.match(/(\d+) pts/) || [])[1] : ''}`;
await mkdir(new URL('nl/', root), { recursive: true });
await writeFile(new URL('nl/last-issue.html', root), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(subj)}</title><body style="margin:0">${html}</body>`);

if (DRY) { console.log('dry run:', subj); process.exit(0); }
const email = await bd('/emails', 'POST', { subject: subj, body: html, status: 'draft' });
console.log('draft created', email.id);
if (LIVE && MODE === 'auto') {
  await bd('/emails/' + email.id, 'PATCH', { status: 'about_to_send' });
  console.log('sent to subscribers');
} else {
  await bd('/emails/' + email.id + '/send-draft', 'POST', {});
  console.log('test copy sent to the newsletter owner');
}
if (MODE === 'auto') { sent[g[0]] = { id: email.id, live: LIVE, at: new Date().toISOString() }; await writeFile(sentFile, JSON.stringify(sent, null, 1) + '\n'); }
