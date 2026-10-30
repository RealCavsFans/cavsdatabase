// Cavs & Coffee: builds the freshly brewed email from the site's own data and hands it to Buttondown.
//   node scripts/newsletter.mjs auto   (the morning run: sends at 6:19 AM ET, only if the Cavs played yesterday and it hasn't gone out)
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
const unent = s => String(s ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&(amp|quot|apos|lt|gt);/g, (_, e) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[e]);
const pslug = t => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => unent(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      TS: (typeof TSTATS === 'object' && TSTATS.CLE && TSTATS.CLE[0] + TSTATS.CLE[1] >= 1) ? TSTATS : (typeof TSTATS_PREV === 'object' ? TSTATS_PREV : {}), TS_CUR: !!(typeof TSTATS === 'object' && TSTATS.CLE && TSTATS.CLE[0] + TSTATS.CLE[1] >= 1),
      STANDINGS: typeof STANDINGS === 'object' ? STANDINGS : [], REST: typeof REST === 'object' ? REST : {}, INJ_UPDATED: typeof INJ_UPDATED === 'string' ? INJ_UPDATED : '',
      OTD: window.otdFacts ? window.otdFacts(md).slice(0, 1).map(f => [md, String(f.y), f.t]) : [],
      WOW: [...(typeof HIST_X === 'object' ? HIST_X.filter(x => ['highlight', 'perf', 'title'].includes(x[2])).map(x => [x[0], x[1], x[3]]) : []), ...HISTORY.map(h => [h[0], h[1], h[2]])] };
  }, md);
  await browser.close(); server.close();
  return d;
}

/* ---------- the email: the Sports Page design ---------- */
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const F = { sans: 'Arial,Helvetica,sans-serif', serif: "Georgia,'Times New Roman',serif", cond: "'Saira Condensed','Arial Narrow',Arial,Helvetica,sans-serif", mono: "'Geist Mono','SF Mono',Menlo,Consolas,'Courier New',monospace" };
const md2 = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const wkd = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/* everything the email shows, worked out once */
function prep(D, g, score, top, boxLink, opts) {
  const [cs, os] = score.split('-').map(Number), win = cs > os, issueDay = opts.issueDay, md = issueDay.slice(5);
  const rec = (D.SEASON.results || '').replace(/[^WL]/g, ''); const w = (rec.match(/W/g) || []).length, l = rec.length - w;
  const [tn, tl] = (top || '').split(': ');
  const fresh = x => x.date && Date.parse(x.date) > opts.sinceTs;
  const rcfItems = opts.rcf?.items || [];
  const recap = rcfItems.find(x => /recap/i.test(x.title) && x.date && x.date.slice(0, 10) >= g[0]);
  const nickU = (NICK[g[1]] || '').toUpperCase();
  const hl = (opts.news?.highlights || []).find(x => x.date.slice(0, 10) >= g[0] && Date.parse(x.date) - Date.parse(g[0] + 'T12:00:00Z') < 3 * 864e5 && x.title.toUpperCase().includes(nickU)) || (/nba\.com\/game\//.test(boxLink) ? { link: boxLink.replace(/\/box-score$/, ''), nba: true } : null);
  const reads = [...rcfItems.filter(x => x !== recap && fresh(x)).map(x => ({ ...x, src: 'RealCavsFans' })), ...(opts.news?.articles || []).filter(fresh)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const play = []; [...(opts.news?.videos || []).map(x => ({ ...x, kind: 'video' })), ...(opts.news?.podcasts || []).map(x => ({ ...x, kind: 'podcast' }))].filter(fresh).sort((a, b) => b.date.localeCompare(a.date)).forEach(x => { if (!play.some(p => p.src === x.src)) play.push(x); });
  const txText = x => x.k === 'trade' ? `Traded ${(x.sent || []).join(', ')} to ${(x.w || []).join('/')} for ${(x.got || []).join(', ')}` : (x.t || x.p || '');
  const moves = D.TX.filter(x => x.d > opts.since && x.d <= issueDay).sort((a, b) => a.d.localeCompare(b.d)).map(x => [md2(x.d), txText(x) + (x.note ? ' · ' + x.note : '')]);
  const tg = D.SCHEDULE.find(x => x[0] === issueDay), nx = tg || D.SCHEDULE.find(x => x[0] > g[0] && x[0] > issueDay);
  const week = D.DATES.filter(x => x[0] >= issueDay && x[0] <= etDate(new Date(Date.parse(issueDay + 'T12:00:00Z') + 6 * 864e5)) && !(nx && x[0] === nx[0] && /opener|vs |at /i.test(x[1]))).slice(0, 3).map(x => [wkd(x[0]), md2(x[0]), x[1]]);
  const otd = (() => { const used = new Set(opts.usedOtd || []); for (let k = 0; k <= 14; k++) for (const sg of k ? [-1, 1] : [0]) { const d = new Date(issueDay + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + sg * k); const m = d.toISOString().slice(5, 10); const f = (D.WOW || []).filter(x => x[0] === m && !used.has(x[0] + '|' + x[1])).sort((a, b) => b[1] - a[1])[0]; if (f) return [f[0], String(f[1]), f[2], k]; } return null; })();
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
  return { g, cs, os, win, issueDay, md, w, l, hasRec: rec.length > 0, tn, tl, recap, hl, reads, play, moves, week, otd, nx: nxInfo, tape, inj, stand, tq: opts.trivia, shot: opts.milestone || '', sotn: opts.sotn || null, names: (D.PL || []).map(p => p[0]),
    pid: n => (D.PL.find(p => p[0] === n) || [])[1], qs: opts.qs || null, where: (g[2] === 'H' ? 'vs ' : 'at ') + D.TEAMS[g[1]], whereShort: g[2] === 'H' ? 'Rocket Arena' : 'at ' + D.TEAMS[g[1]].split(' ').slice(-1)[0], boxLink, preseason: opts.preseason, test: opts.test, TEAMS: D.TEAMS };
}
const fontLink = `<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@800&family=Geist+Mono:wght@700&display=swap" rel="stylesheet"><!--<![endif]-->`;
const wrapOpen = bg => `<meta name="viewport" content="width=device-width,initial-scale=1">${fontLink}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F2"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${bg}">
<tr><td><a href="${SITE}"><img src="${SITE}/nl/header.png" width="600" alt="Cavs &amp; Coffee · freshly brewed after every game · presented by cavs_db" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>`;
const footLinks = [['Roster', 'roster'], ['Cap sheet', 'cap'], ['Draft picks', 'assets'], ['Injuries', '#inj'], ['Staff', 'staff'], ['Live stats', 'live']];
const footer = (rule) => `<tr><td style="padding:26px 16px 26px;text-align:center;font:12px/1.7 ${F.sans};color:#5D646C">${rule || ''}
<div style="font:800 12px ${F.cond};letter-spacing:.12em;text-transform:uppercase;color:#101419;margin-bottom:2px">More on <a href="${SITE}" style="color:#860038;text-decoration:none">cavsdatabase.com</a></div>
${[footLinks.slice(0, 3), footLinks.slice(3)].map(row => `<div style="font:700 12.5px/1.9 ${F.sans};white-space:nowrap">${row.map(([t, r]) => `<a href="${SITE}/${r}" style="color:#860038;text-decoration:none">${t}</a>`).join(' &nbsp;·&nbsp; ')}</div>`).join('')}
<div style="margin:14px 0 12px"><a href="https://www.buymeacoffee.com/cavsdb" style="display:inline-block;border:1px solid #D9D4CC;padding:5px 12px;color:#860038;font:700 12px ${F.sans};text-decoration:none">&#9749; Buy cavs_db a coffee</a></div>
<div style="font:600 11px/1.5 ${F.sans};color:#5D646C;margin-bottom:8px">Add us to your contacts so we land in your inbox.</div>
<div style="font:10.5px/1.7 ${F.sans};color:#8A8F96"><span style="white-space:nowrap">Independent fan site, not affiliated with the Cavs or NBA.</span><br><span style="white-space:nowrap;color:#8A8F96;text-decoration:none">Cavs Database · P.O.&zwnj; Box 151 · West Jeff&zwnj;erson, OH 43&zwnj;162</span><!--UNSUB--></div></td></tr></table></td></tr></table>`;
const T = (inner, attrs = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${attrs}>${inner}</table>`;

/* quarter-by-quarter line score, newspaper style */
function lineScore(x, P) {
  const n = x.qs.cle.length, lab = k => k < 4 ? String(k + 1) : (n > 5 ? 'OT' + (k - 3) : 'OT');
  const th = t => `<td align="center" style="padding:4px 0;font:700 10px ${F.sans};letter-spacing:1px;color:${P.muted}">${t}</td>`;
  const td = (v, b) => `<td align="center" style="padding:4px 0;font:${b ? 700 : 400} 13px ${F.mono};color:${P.ink}">${v}</td>`;
  const row = (ab, q, tot, cav) => `<tr style="border-top:1px dotted ${P.dot}"><td style="padding:4px 0;font:800 14px ${F.cond};color:${cav ? P.wine : P.ink}">${ab}</td>${q.map(v => td(v)).join('')}${td(tot, 1)}</tr>`;
  return T(`<tr><td width="56"></td>${x.qs.cle.map((_, k) => th(lab(k))).join('')}${th('F')}</tr>${row('CLE', x.qs.cle, x.cs, 1)}${row(x.g[1], x.qs.opp, x.os, 0)}`, `style="margin-top:8px;border-collapse:collapse"`);
}

/* coffee score box: on a win the Cavs half fills with coffee (crema and steam on top);
   on a loss it drains, leaving a stain line and drips off the edge. A roast label sets the mood by margin.
   Images are extras: with images off, the solid fill and the label still carry it. */
function roast(x) {
  const m = Math.abs(x.cs - x.os), ot = x.qs && x.qs.cle && x.qs.cle.length > 4;
  if (x.win) return ot ? { t: 'DOUBLE SHOT', bg: '#860038', fg: '#FFFFFF', line: 'Double shot. Needed the extra.' }
    : m >= 15 ? { t: 'DARK ROAST', bg: '#3B2216', fg: '#F2B231', line: 'Dark roast. A strong brew.' }
    : m >= 6 ? { t: 'MEDIUM ROAST', bg: '#A9744A', fg: '#FFFFFF', line: 'Medium roast. Smooth W.' }
    : { t: 'LIGHT ROAST', bg: '#E9D6BE', fg: '#101419', line: 'Light roast, but still a W.' };
  return m >= 15 ? { t: 'BURNT', bg: '#101419', fg: '#B9B2A8', line: 'Burnt. Dump it and brew again.' }
    : { t: 'DECAF', bg: '#E3E5E0', fg: '#101419', line: 'Decaf. Fresh pot tomorrow.' };
}
function coffeeBox(x, P, cell) {
  const CO = '#6B3E26', PAPER = '#FFFDF8', r = roast(x);
  const chip = `<div style="margin-top:6px"><span style="display:inline-block;background:${r.bg};color:${r.fg};font:800 10px ${F.sans};letter-spacing:1.4px;padding:4px 8px">${r.t}</span></div>`;
  const img = (f, w) => `<img src="${SITE}/nl/${f}.png" width="${w}" alt="" style="display:block;width:${w === '100%' ? '100%' : w + 'px'};height:auto;border:0;margin:0 auto">`;
  const cav = (bg, fg, sub, dim, pad) => `<td width="50%" align="center" bgcolor="${bg}" style="background:${bg};padding:${pad}"><div style="font:800 20px/1 ${F.cond};color:${fg}">CLE</div><div style="font:700 36px/1.15 ${F.mono};color:${dim ? '#9A948B' : fg}">${x.cs}</div><div style="font:11px ${F.sans};color:${sub}">Cavaliers</div>${chip}</td>`;
  const opp = (pad) => cell(x.g[1], x.os, !x.win, NICK[x.g[1]] || '').replace('<td ', '<td valign="middle" ').replace('padding:10px 0 9px;', `padding:${pad};`).replace(/border-bottom:4px solid [^;]+;/, '');
  const box = rows => T(rows, `bgcolor="${PAPER}" style="border:2px solid ${P.ink};background:${PAPER};border-collapse:collapse"`);
  if (x.win) return box(`<tr><td width="50%" style="padding:6px 0 0">${img('steam', 42)}</td><td width="50%"></td></tr><tr><td width="50%" style="padding:0;line-height:0;font-size:0">${img('crema', '100%')}</td><td width="50%"></td></tr><tr>${cav(CO, PAPER, '#E9D6BE', false, '2px 0 10px')}${opp('2px 0 10px')}</tr>`);
  return box(`<tr>${cav(PAPER, '#9A948B', P.muted, true, '16px 0 2px')}${opp('16px 0 2px')}</tr><tr><td width="50%" bgcolor="${PAPER}" style="background:${PAPER};padding:0 10px 6px;line-height:0;font-size:0">${img('ring', '100%')}</td><td></td></tr>`)
    + T(`<tr><td width="50%" style="padding:0 0 0 2px;line-height:0;font-size:0"><img src="${SITE}/nl/drip.png" width="100%" alt="" style="display:block;width:100%;height:auto;border:0;margin-top:-3px"></td><td width="50%"></td></tr>`);
}

/* ========== Sports Page: old school newspaper, double rules, condensed heads, boxed linescore ========== */
function renderSports(x) {
  const P = { bg: '#F7F3EC', dot: '#B9B2A8', wine: '#860038', ink: '#101419', fg2: '#2F363E', muted: '#5D646C' };
  const K = (t, link, sz) => `<tr><td style="padding:24px 14px 0">${T(`<tr><td style="font:800 ${sz || 21}px/1 ${F.cond};text-transform:uppercase;color:${P.ink};padding-bottom:6px;border-bottom:3px solid ${P.ink}">${t}</td><td align="right" valign="bottom" style="padding-bottom:6px;border-bottom:3px solid ${P.ink};font:700 12px ${F.sans};white-space:nowrap">${link ? `<a href="${link[1]}" style="color:#860038;text-decoration:none">${link[0]} &rarr;</a>` : ''}</td></tr>`)}</td></tr>`;
  const B = inner => `<tr><td style="padding:8px 14px 0">${inner}</td></tr>`;
  const li = (main, o = {}) => T(`<tr>${o.left ? `<td width="${o.lw || 86}" valign="top" style="padding:9px 8px 9px 0;font:700 11.5px ${F.mono};color:${P.muted};white-space:nowrap">${o.left}</td>` : ''}<td valign="top" style="padding:8px 0;font:14px/1.45 ${F.sans};color:${P.ink}">${main}${o.meta ? `<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${o.meta}</div>` : ''}</td></tr>`, `style="border-bottom:1px dotted ${P.dot}"`);
  const a = (h, t) => `<a href="${esc(h)}" style="color:${P.ink};font-weight:700;text-decoration:none">${t}</a>`;
  const s = [];
  s.push(`<tr><td style="padding:12px 14px 0"><div style="border-bottom:3px double ${P.ink};padding-bottom:9px;text-align:center;font:700 11px ${F.mono};letter-spacing:1px;color:${P.ink}"><span style="color:${P.wine}">&gt;</span> ${esc(new Date(x.issueDay + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase())}${x.test ? ' · <span style="color:#C8102E">TEST</span>' : ''}</div><div style="height:2px;background:#F2B231;margin-top:2px;font-size:0;line-height:0">&nbsp;</div></td></tr>`);
  if (x.otd) s.push(K('Cavs history · ' + esc(new Date('2000-' + x.otd[0] + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })) + ', ' + esc(x.otd[1]), null, 17), B(`<div style="font:14.5px/1.5 ${F.serif};color:${P.fg2}"><span style="float:left;font:800 38px/33px ${F.cond};color:${P.wine};padding:3px 5px 0 0">${esc(x.otd[2].charAt(0))}</span>${esc(x.otd[2].slice(1))}</div>`));
  /* trivia: question, then the four choices in a 2 x 2 grid to keep it short */
  if (x.tq) { const opt = k => `<td width="50%" valign="top" style="padding:5px 8px 5px 0;font:13px/1.35 ${F.sans};color:${P.ink}"><b style="color:${P.wine};font-family:${F.mono};margin-right:6px">${'ABCD'[k]}</b>${esc(x.tq.c[k] ?? '')}</td>`;
    s.push(K('Daily trivia', null, 17), B(`<div style="font:700 14.5px/1.4 ${F.serif};color:${P.ink};margin-bottom:2px">${esc(x.tq.q)}</div>${T(`<tr>${opt(0)}${opt(1)}</tr><tr>${opt(2)}${opt(3)}</tr>`)}<div style="font:11.5px ${F.sans};color:${P.muted};margin-top:2px">Answer at the bottom</div>`)); }
  // last game: boxed linescore, winner reversed out in ink
  const cell = (ab, pts, won, nm) => `<td width="50%" align="center" style="padding:10px 0 9px;${won ? 'border-bottom:4px solid #F2B231;' : 'border-bottom:4px solid transparent;'}"><div style="font:800 20px/1 ${F.cond};color:${P.ink}">${ab}</div><div style="font:700 36px/1.15 ${F.mono};color:${won ? P.ink : '#9A948B'}">${pts}</div><div style="font:11px ${F.sans};color:${P.muted}">${esc(nm)}</div></td>`;
  s.push(K(x.preseason ? 'Last game · preseason' : 'Last game' + (x.hasRec ? ` · ${x.w}–${x.l}` : ''), ['Box score', esc(x.boxLink)]));
  s.push(B(`${coffeeBox(x, P, cell)}${x.qs ? lineScore(x, P) : ''}<div style="font:italic 15px ${F.serif};color:${P.fg2};margin-top:8px;text-align:center">${roast(x).line}</div>
${x.tn ? `<div style="font:16px/1.55 ${F.serif};color:${P.fg2};margin-top:10px"><a href="${SITE}/players/${pslug(x.tn)}" style="font-family:${F.sans};font-weight:700;color:${P.ink};text-decoration:none;border-bottom:2px solid #F2B231">${esc(x.tn)}</a> led the Cavs with ${esc((x.tl || '').replace(/ pts/, ' points').replace(/ reb/, ' rebounds').replace(/, (\d+) ast/, ' and $1 assists'))}.</div>` : ''}${x.sotn ? `<div style="font:13.5px/1.5 ${F.sans};color:${P.fg2};margin-top:6px"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">STAT OF THE NIGHT</b>&nbsp; ${x.sotn[1]} ${esc(x.sotn[2])} from <a href="${SITE}/players/${pslug(x.sotn[0])}" style="color:${P.ink};font-weight:700;text-decoration:none;border-bottom:2px solid #F2B231">${esc(x.sotn[0].split(' ').slice(-1)[0])}</a>, ${esc(x.sotn[3])} above his average</div>` : ''}`));
  /* email can't play video (Gmail and Outlook strip players), so this is built to look like one: the video's own frame plus a player bar; a tap opens it on YouTube */
  if (x.hl && x.hl.id) s.push(`<tr><td style="padding:12px 14px 0"><a href="${esc(x.hl.link)}" style="text-decoration:none"><img src="https://i.ytimg.com/vi/${esc(x.hl.id)}/hq720.jpg" width="572" alt="Play the full game highlights" style="display:block;width:100%;height:auto;border:0">${T(`<tr><td bgcolor="#101419" style="background:#101419;padding:10px 12px;font:800 13px ${F.sans};letter-spacing:.5px;color:#FFFFFF"><span style="display:inline-block;background:#C8102E;color:#FFFFFF;padding:3px 9px;margin-right:8px">&#9654;</span>PLAY HIGHLIGHTS</td><td bgcolor="#101419" align="right" style="background:#101419;padding:10px 12px;font:12px ${F.sans};color:#B9B2A8;white-space:nowrap">${x.hl.src === 'Cavs' ? 'Cavs' : 'NBA'} on YouTube</td></tr>`)}</a></td></tr>`);
  if (x.hl || x.recap) s.push(B(`${x.hl && !x.hl.id ? li(a(x.hl.link, '&#9654;&nbsp; Full game highlights'), { meta: x.hl.nba ? 'NBA.com' : 'NBA · YouTube' }) : ''}${x.recap ? li(a(x.recap.link, esc(x.recap.title)), { meta: 'RealCavsFans recap' }) : ''}`));
  if (x.shot) s.push(B(`<div style="border-left:3px solid #F2B231;background:#FFFDF8;padding:9px 12px;margin-top:6px;font:15px/1.5 ${F.serif};color:${P.ink}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">ESPRESSO SHOT</b>&nbsp; ${(() => { let t = esc(x.shot); const nm = (x.names || []).find(n => t.includes(esc(n))); return nm ? t.replace(esc(nm), `<a href="${SITE}/players/${pslug(nm)}#ch-his" style="color:${P.ink};font-weight:700;text-decoration:none;border-bottom:2px solid #F2B231">${esc(nm)}</a>`) : t; })()}</div>`));
  if (x.nx) {
    const n = x.nx;
    s.push(K(n.tonight ? 'Tonight' : 'Up next', ['Preview', `${SITE}/games/${n.slug}`]), B(`<div style="font:800 26px/1 ${F.cond};color:${P.ink}"><span style="color:${P.wine}">CLE</span> ${n.home ? 'vs' : 'at'} ${n.o}</div><div style="font:13px ${F.sans};color:${P.muted};margin:4px 0 4px">${esc(short(n.date))} · ${esc(n.tip)} PM ET${n.tv ? ' · ' + esc(n.tv) : ''} · ${esc(n.radio)}</div>`));
    if (x.tape.length) s.push(B(T(`<tr><td style="padding:4px 0;font:800 14px ${F.cond};color:${P.wine}">CLE</td><td align="center" style="font:700 9.5px ${F.sans};letter-spacing:1px;color:${P.muted}">${n.season} · RANK</td><td align="right" style="font:800 14px ${F.cond};color:${P.ink}">${n.o}</td></tr>` + x.tape.map(([lab, a1, r1, b1, r2]) => `<tr><td style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 13.5px ${F.mono};color:${P.wine}">${a1} <span style="font:400 11px ${F.sans};color:${P.muted}">${r1}</span></td><td align="center" style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 10px ${F.sans};letter-spacing:1px;text-transform:uppercase;color:${P.muted}">${lab}</td><td align="right" style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 13.5px ${F.mono}"><span style="font:400 11px ${F.sans};color:${P.muted}">${r2}</span> ${b1}</td></tr>`).join(''))));
    if (x.inj.length) s.push(B(`<div style="font:13px/1.5 ${F.sans};color:${P.fg2};padding-top:6px;border-top:1px dotted ${P.dot}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">INJURIES</b>&nbsp; ${x.inj.map(([nm, what, st]) => `${esc(nm)} (${esc(what)}, ${esc(st.toLowerCase())})`).join(' · ')}</div>`));
  }
  if (x.stand.length) s.push(K('East standings'), B(T(x.stand.map(([rk, nm, wl, gb, me]) => `<tr><td width="26" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 12px ${F.mono};color:${P.muted}">${rk}</td><td style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:${me ? 700 : 400} 14px ${F.sans};color:${me ? P.wine : P.ink}">${esc(nm)}</td><td align="right" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 13.5px ${F.mono};color:${me ? P.wine : P.ink}">${wl}</td><td width="46" align="right" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 12.5px ${F.mono};color:${P.muted}">${gb}</td></tr>`).join(''))));
  if (x.reads.length) s.push(K('Morning reads'), B(x.reads.map(r => li(a(r.link, esc(r.title)), { meta: `${esc(r.src)} · ${esc(md2(r.date.slice(0, 10)))}` })).join('')));
  if (x.play.length) s.push(K('Press play'), B(x.play.map(p => T(`<tr><td width="24" valign="top" style="padding:9px 0;font:14px ${F.sans};color:${P.wine}">${p.kind === 'video' ? '&#9654;' : '&#127911;'}</td><td valign="top" style="padding:8px 0;font:14px/1.45 ${F.sans}">${a(p.link, esc(p.title))}<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${esc(p.src)}${p.dur ? ' · ' + esc(p.dur) : ''} · ${esc(md2(p.date.slice(0, 10)))}</div></td></tr>`, `style="border-bottom:1px dotted ${P.dot}"`)).join('')));
  if (x.moves.length) s.push(K('Transactions'), B(x.moves.map(([d, t]) => li(esc(t), { left: esc(d), lw: 60 })).join('')));
  if (x.week.length) s.push(K('This week'), B(x.week.map(([wd, d, t]) => li(esc(t), { left: `${esc(wd)} ${esc(d)}`, lw: 96 })).join('')));
  if (x.tq) s.push(`<tr><td style="padding:14px 14px 0;text-align:center;font:italic 11px ${F.sans};color:${P.muted}">Trivia answer: ${String.fromCharCode(65 + x.tq.a)}. ${esc(x.tq.c[x.tq.a])}</td></tr>`);
  /* pass it on: each subscriber's own Buttondown referral link (Settings → General → Referrals must be on). Its own boxed card so it doesn't run into the footer */
  s.push(`<tr><td style="padding:20px 14px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${P.dot};border-bottom:1px solid ${P.dot}"><tr><td style="padding:10px 4px;text-align:center;font:12.5px/1.5 ${F.sans};color:${P.fg2}">Know a Cavs fan who&rsquo;d want this with their coffee? <a href="https://buttondown.com/cavscoffee/?referral_code={{ subscriber.referral_code }}" style="color:${P.wine};font-weight:700;text-decoration:none;white-space:nowrap">Share your link &rarr;</a></td></tr></table></td></tr>`);
  return wrapOpen(P.bg) + s.join('\n') + footer(`<div style="border-top:4px double #F2B231;margin:0 0 18px;font-size:0;line-height:0">&nbsp;</div>`);
}

function build(D, g, score, top, boxLink, opts) { const x = prep(D, g, score, top, boxLink, opts);
  // inbox preview line (hidden in the email itself)
  const pre = [x.tn ? `${x.tn.split(' ').slice(-1)[0]} led the way` : '', x.nx ? (x.nx.tonight ? `tonight ${x.nx.home ? 'vs' : 'at'} ${NICK[x.nx.o] || x.nx.o}` : `next up ${x.nx.home ? 'vs' : 'at'} ${NICK[x.nx.o] || x.nx.o} ${wkd(x.nx.date)}`) : '', 'injuries, the morning reads and today\u2019s trivia'].filter(Boolean).join(' · ');
  return `<!-- Cavs & Coffee · built by cavsdatabase.com -->\n<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:transparent">${esc(pre.charAt(0).toUpperCase() + pre.slice(1))}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>\n` + renderSports(x); }

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
/* Issues go out at 6:19 AM ET, for June 19, 2016. Runs start between 5 and 8 AM ET; an early run builds the issue, then waits for 6:19 to send. */
if (MODE === 'auto' && (etHour() < 5 || etHour() > 7)) { console.log('outside the 5–8 AM ET window, skipping'); process.exit(0); }
const msTo619 = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).formatToParts(new Date()).map(x => [x.type, +x.value])); return ((6 * 60 + 19) * 60 - (p.hour * 3600 + p.minute * 60 + p.second)) * 1000; };

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
  // send now: the latest game goes straight to subscribers, but never twice
  if (MODE === 'now') {
    if (!LIVE) { console.log('NEWSLETTER_LIVE is false, send now is paused'); process.exit(0); }
    if (sent[g[0]]?.live) { console.log('already sent for', g[0]); process.exit(0); }
  }
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
const otdKey = (() => { const x = prep(D, g, score, b.top || '', b.url || D.box[g[0]] || SITE + '/schedule', { issueDay: today, rcf, news, trivia: null, since, sinceTs, usedOtd: Object.values(sent).map(v => v.otd).filter(Boolean).slice(-60) }); return x.otd ? x.otd[0] + '|' + x.otd[1] : null; })();
// stat of the night: removed Oct 29 (Luka's call)
const sotn = null;
const ourBox = preseason ? (b.url || D.box[g[0]] || SITE + '/schedule') : `${SITE}/games/${g[0]}-${String(g[1]).toLowerCase()}`;
const html = build(D, g, score, b.top || '', ourBox, { issueDay: today, rcf, news, trivia: tq, since, sinceTs, qs: b.qs, milestone: milestone(), sotn, usedOtd: Object.values(sent).map(v => v.otd).filter(Boolean).slice(-60), test: !(LIVE && MODE !== 'test'), preseason });
const [cs, os] = score.split('-').map(Number);
const topBit = b.top ? b.top.split(':')[0].split(' ').slice(-1)[0] + ' ' + (b.top.match(/(\d+) pts/) || [])[1] : '';
const msBit = (() => { const m = (milestone() || '').match(/^(?!Milestone watch)(\S+ )?(\S+) (reached [\d,]+ career \w+|passed .+? for \d+\w+ on the Cavs' all-time \w+)/); return m ? `${m[2]} ${m[3].replace(/^reached/, 'hits').replace(/ on the Cavs' all-time (\w+)/, ' in Cavs $1').replace(/^passed .+? for/, 'moves to')}` : ''; })();
/* subject is just the score so it fits on one line in phone mail apps; the top scorer is already in the preview text (Oct 30) */
/* winner first, then the Cavs' record after the game, e.g. "Hawks 114, Cavs 111 (3–3)" (Oct 30) */
const recS = (() => { const r = (D.SEASON.results || '').replace(/[^WL]/g, ''); if (!r.length || preseason) return ''; const w = (r.match(/W/g) || []).length; return ` (${w}\u2013${r.length - w})`; })();
const oppN = NICK[g[1]] || g[1];
const subj = `${!(LIVE && MODE !== 'test') ? '[Test] ' : ''}☕ ${cs > os ? `Cavs ${cs}, ${oppN} ${os}` : `${oppN} ${os}, Cavs ${cs}`}${recS}`;
void msBit; void topBit;
await mkdir(new URL('nl/', root), { recursive: true });
await writeFile(new URL('nl/last-issue.html', root), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${esc(subj)}</title><body style="margin:0">${html.replace('<!--UNSUB-->', '')}</body>`);

if (DRY) { console.log('dry run:', subj); process.exit(0); }
/* naked template: no Buttondown frame around the email (no "did someone forward you this", no repeated title, full phone width).
   Buttondown only allows it on some plans and then requires our own unsubscribe link, so fall back to the normal frame if it's refused */
let email;
try { email = await bd('/emails', 'POST', { subject: subj, body: html.replace('<!--UNSUB-->', '<br><a href="{{ unsubscribe_url }}" style="color:#8A8F96">Unsubscribe</a>'), status: 'draft', template: 'naked' }); console.log('naked template'); }
catch (e) { console.log('naked template refused, using the default frame:', String(e).slice(0, 160)); email = await bd('/emails', 'POST', { subject: subj, body: html.replace('<!--UNSUB-->', ''), status: 'draft' }); }
console.log('draft created', email.id);
const REAL = LIVE && (MODE === 'auto' || MODE === 'now');
if (REAL) {
  const wait = MODE === 'now' ? 0 : msTo619(); if (wait > 0) { console.log('waiting ' + Math.round(wait / 60000) + ' min for 6:19 AM ET'); await new Promise(r => setTimeout(r, wait)); }
  await bd('/emails/' + email.id, 'PATCH', { status: 'about_to_send' });
  console.log('sent to subscribers');
} else {
  await bd('/emails/' + email.id + '/send-draft', 'POST', {});
  console.log('test copy sent to the newsletter owner');
}
if (MODE === 'auto' || MODE === 'now') { sent[g[0]] = { id: email.id, live: LIVE, at: new Date().toISOString(), otd: otdKey }; await writeFile(sentFile, JSON.stringify(sent, null, 1) + '\n'); }
