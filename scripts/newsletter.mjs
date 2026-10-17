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

/* ---------- the email: one column, site colors, light throughout ---------- */
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const C = { wine: '#860038', wine2: '#7A1F33', gold: '#F2B231', ink: '#101419', fg2: '#2F363E', muted: '#5D646C', line: '#E3E5E0', line2: '#EFF0EC', sub: '#F5F6F3' };
const F = { sans: 'Arial,Helvetica,sans-serif', narrow: "'Arial Narrow',Arial,Helvetica,sans-serif", mono: "'SF Mono',Menlo,Consolas,'Courier New',monospace" };
const md2 = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
// section header: the site's block heading (uppercase, ink rule), optional note and link on the right
const H = (t, note, link) => `<tr><td style="padding:28px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:800 12px ${F.sans};letter-spacing:1.4px;text-transform:uppercase;color:${C.ink};padding-bottom:6px;border-bottom:2px solid ${C.ink}">${t}${note ? `<span style="font:400 12px ${F.sans};letter-spacing:0;text-transform:none;color:${C.muted}"> &nbsp;${note}</span>` : ''}</td><td align="right" style="font:600 12.5px ${F.sans};padding-bottom:6px;border-bottom:2px solid ${C.ink};white-space:nowrap">${Array.isArray(link) ? `<a href="${link[1]}" style="color:${C.wine2};text-decoration:none">${link[0]} &rarr;</a>` : link ? `<span style="font:italic 400 12.5px ${F.sans};color:${C.muted}">${link}</span>` : ''}</td></tr></table></td></tr>`;
const body = inner => `<tr><td style="padding:4px 28px 0">${inner}</td></tr>`;
// one list row: left label (date, chip), main text, small meta line, optional right value
const row = (main, o = {}) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${C.line2}"><tr>${o.left ? `<td width="${o.lw || 62}" valign="top" style="padding:10px 0;font:600 12px ${F.mono};color:${C.muted}">${o.left}</td>` : ''}<td valign="top" style="padding:9px 0;font:14px/1.45 ${F.sans};color:${C.ink}">${main}${o.meta ? `<div style="font:12px ${F.sans};color:${C.muted};margin-top:2px">${o.meta}</div>` : ''}</td>${o.right ? `<td align="right" valign="top" style="padding:9px 0 9px 10px;font:600 13px ${F.sans};color:#9A6A00;white-space:nowrap">${o.right}</td>` : ''}</tr></table>`;
const lk = (href, text) => `<a href="${esc(href)}" style="font-weight:700;color:${C.ink};text-decoration:none">${text}</a>`;
const chip = (t, bg, fg) => `<span style="display:inline-block;background:${bg};color:${fg};font:800 9.5px ${F.sans};letter-spacing:1px;padding:3px 6px;border-radius:2px">${t}</span>`;

function tonight(D, tg) {
  const o = tg[1], home = tg[2] === 'H', slug = tg[0] + '-' + o.toLowerCase(), i = D.SCHEDULE.indexOf(tg);
  const rec = a => { const t = D.STANDINGS.find(x => x[0] === a); return t ? t[2] + '–' + t[3] : ''; };
  const rr = D.REST[tg[0]] || []; const rest = rr[0] === 0 ? 'Back-to-back' : rr[0] == null ? (i === 0 ? 'Season opener' : '—') : rr[0] + ' day' + (rr[0] === 1 ? '' : 's');
  const box = (k, v) => `<td width="33%" style="background:rgba(255,255,255,.1);padding:7px 9px"><div style="font:800 9.5px ${F.sans};letter-spacing:1px;color:#F4D6DD">${k}</div><div style="font:700 13.5px ${F.sans};color:#fff;margin-top:2px">${esc(v)}</div></td>`;
  const TS = D.TS || {}, all = Object.values(TS);
  const ROWS = [['Record', t => t[0] / Math.max(1, t[0] + t[1]), 1, t => t[0] + '–' + t[1]], ['Off rating', t => t[4], 1, t => t[4].toFixed(1)], ['Def rating', t => t[5], 0, t => t[5].toFixed(1)], ['Net rating', t => t[4] - t[5], 1, t => { const x = t[4] - t[5]; return (x > 0 ? '+' : '') + x.toFixed(1); }], ['Pace', t => t[6], 1, t => t[6].toFixed(1)]];
  const tape = TS.CLE && TS[o] ? ROWS.map(([lab, f, hi, fm]) => { const rk = t => ord(1 + all.filter(u => hi ? f(u) > f(t) : f(u) < f(t)).length); return `<tr><td style="padding:5px 0;border-bottom:1px solid ${C.line2};font:600 13.5px ${F.mono};color:${C.wine2}">${fm(TS.CLE)} <span style="font:11px ${F.sans};color:${C.muted}">${rk(TS.CLE)}</span></td><td align="center" style="padding:5px 0;border-bottom:1px solid ${C.line2};font:800 10px ${F.sans};letter-spacing:1px;color:${C.muted};text-transform:uppercase">${lab}</td><td align="right" style="padding:5px 0;border-bottom:1px solid ${C.line2};font:600 13.5px ${F.mono};color:${C.ink}"><span style="font:11px ${F.sans};color:${C.muted}">${rk(TS[o])}</span> ${fm(TS[o])}</td></tr>`; }).join('') : '';
  return `${H('Tonight', null, ['Full preview', SITE + '/games/' + slug])}
<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.wine2};background-image:linear-gradient(160deg,#8e2741,#5E0027)"><tr><td style="padding:14px 16px">
<div style="font:800 10.5px ${F.sans};letter-spacing:1.4px;color:${C.gold}">${esc(tg[3])} PM ET · ${esc(new Date(tg[0] + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase())}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 10px"><tr><td style="font:800 36px ${F.narrow};color:#fff">CLE${rec('CLE') ? `<div style="font:600 12px ${F.sans};color:#F4D6DD">${rec('CLE')}</div>` : ''}</td><td align="center" style="font:600 14px ${F.sans};color:#F4D6DD">${home ? 'vs' : 'at'}</td><td align="right" style="font:800 36px ${F.narrow};color:#fff">${o}${rec(o) ? `<div style="font:600 12px ${F.sans};color:#F4D6DD">${rec(o)}</div>` : ''}</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="4" style="margin:0 -4px"><tr>${box('WATCH', D.tv[tg[0]] || 'TBA')}${box('LISTEN', D.radio)}${box('REST', rest)}</tr></table>
<div style="font:12.5px ${F.sans};color:#F4D6DD;margin-top:8px">Game ${i + 1} of 82 · ${home ? 'Rocket Arena' : 'at ' + esc(D.TEAMS[o])}</div></td></tr></table></td></tr>
${tape ? `<tr><td style="padding:12px 28px 0"><div style="font:800 10.5px ${F.sans};letter-spacing:1.2px;color:${C.ink};padding-bottom:4px;border-bottom:1px solid ${C.line}">TALE OF THE TAPE <span style="font-weight:400;letter-spacing:0;color:${C.muted}">· ${D.TS_CUR ? '2026–27' : '2025–26'} · league rank</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tape}</table></td></tr>` : ''}`;
}

// standings snapshot: five East rows centered on the Cavs (rank, team, record, games back)
function standings(D) {
  const E = (D.STANDINGS || []).filter(t => t[1] === 'E').sort((x, y) => (y[2] - y[3]) - (x[2] - x[3]) || y[2] - x[2]);
  const i = E.findIndex(t => t[0] === 'CLE'); if (i < 0 || !E.some(t => t[2] + t[3] > 0)) return '';
  const a = Math.max(0, Math.min(i - 2, E.length - 5)), L = E[0];
  const gb = t => { const g = ((L[2] - t[2]) + (t[3] - L[3])) / 2; return g ? (g % 1 ? g.toFixed(1) : String(g)) : '—'; };
  const td = (x, o = '') => `<td style="padding:7px 0;border-bottom:1px solid ${C.line2};${o}">${x}</td>`;
  return `${H('East standings', null, ['Full standings', SITE + '/schedule'])}<tr><td style="padding:4px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${['', 'Team', 'W–L', 'GB'].map((h, k) => `<td${k > 1 ? ' align="right"' : ''} style="padding:6px 0 4px;font:800 10px ${F.sans};letter-spacing:1px;color:${C.muted};text-transform:uppercase">${h}</td>`).join('')}</tr>
${E.slice(a, a + 5).map((t, k) => { const me = t[0] === 'CLE', c = me ? C.wine : C.ink, w = me ? '700' : '400'; return `<tr>${td(String(a + k + 1), `width:30px;font:600 12.5px ${F.mono};color:${C.muted}`)}${td(esc(t[0] === 'CLE' ? 'Cleveland' : (D.TEAMS[t[0]] || t[0])), `font:${w} 14px ${F.sans};color:${c}`)}${td(t[2] + '–' + t[3], `text-align:right;font:${me ? 700 : 500} 13.5px ${F.mono};color:${c}`)}${td(gb(t), `width:52px;text-align:right;font:500 13px ${F.mono};color:${C.muted}`)}</tr>`; }).join('')}
</table></td></tr>`;
}

function build(D, g, score, top, boxLink, opts) {
  const [cs, os] = score.split('-').map(Number), win = cs > os;
  const issueDay = opts.issueDay, md = issueDay.slice(5);
  const rec = (D.SEASON.results || '').replace(/[^WL]/g, ''); const w = (rec.match(/W/g) || []).length, l = rec.length - w;
  const P = n => (D.PL.find(p => p[0] === n) || [])[1];
  const [tn, tl] = (top || '').split(': ');
  const fresh = x => x.date && Date.parse(x.date) > opts.sinceTs;
  const rcfItems = opts.rcf?.items || [];
  const recap = rcfItems.find(x => /recap/i.test(x.title) && x.date && x.date.slice(0, 10) >= g[0]);
  const nickU = (NICK[g[1]] || '').toUpperCase();
  const hl = (opts.news?.highlights || []).find(x => x.date.slice(0, 10) >= g[0] && Date.parse(x.date) - Date.parse(g[0] + 'T12:00:00Z') < 3 * 864e5 && x.title.toUpperCase().includes(nickU));
  const reads = [...rcfItems.filter(x => x !== recap && fresh(x)).map(x => ({ ...x, src: 'RealCavsFans' })), ...(opts.news?.articles || []).filter(fresh)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const play = []; [...(opts.news?.videos || []).map(x => ({ ...x, kind: 'video' })), ...(opts.news?.podcasts || []).map(x => ({ ...x, kind: 'podcast' }))].filter(fresh).sort((a, b) => b.date.localeCompare(a.date)).forEach(x => { if (!play.some(p => p.src === x.src)) play.push(x); });
  const moves = D.TX.filter(x => x.d > opts.since && x.d <= issueDay).sort((a, b) => a.d.localeCompare(b.d));
  const txText = x => x.k === 'trade' ? `Traded ${(x.sent || []).join(', ')} to ${(x.w || []).join('/')} for ${(x.got || []).join(', ')}` : (x.t || x.p || '');
  const tg = D.SCHEDULE.find(x => x[0] === issueDay), nx = D.SCHEDULE.find(x => x[0] > g[0] && x[0] > issueDay);
  const week = D.DATES.filter(x => x[0] >= issueDay && x[0] <= etDate(new Date(Date.parse(issueDay + 'T12:00:00Z') + 6 * 864e5))).slice(0, 3);
  const otd = (D.OTD || [])[0] || D.HISTORY.find(h => h[0] === md);
  const tq = opts.trivia;
  const where = (g[2] === 'H' ? 'vs ' : 'at ') + D.TEAMS[g[1]];
  // espresso shot: one quick hitter. Records and milestones go first once the career stats feed is in (opts.milestone); otherwise a streak of 3+
  const stk = (() => { if (opts.preseason || !rec.length) return ''; const last = rec[rec.length - 1]; let n = 0; for (let k = rec.length - 1; k >= 0 && rec[k] === last; k--) n++; return n >= 3 ? (last === 'W' ? `The Cavs have won ${n} straight.` : `The Cavs have lost ${n} straight.`) : ''; })();
  const shot = opts.milestone || stk;
  return `<!-- Cavs & Coffee · built by cavsdatabase.com -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F2"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff">
<tr><td><a href="${SITE}"><img src="${SITE}/nl/header.png" width="600" alt="Cavs &amp; Coffee · the morning after every Cavs game · presented by cavs_db" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>
<tr><td style="padding:14px 28px 0;font:600 12px ${F.mono};color:${C.wine2};letter-spacing:.5px">&gt; ${esc(long(issueDay).toLowerCase())}${opts.test ? ` · <b style="color:#C8102E">test copy</b>` : ''}</td></tr>

${otd ? `${H('This day in Cavs history')}<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="64" valign="top"><div style="background:${C.wine};color:#fff;text-align:center;padding:7px 0;width:52px"><div style="font:800 10px ${F.sans};letter-spacing:1px">${esc(new Date(issueDay + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase())}</div><div style="font:800 24px ${F.narrow}">${+md.slice(3)}</div></div><div style="width:52px;text-align:center;font:700 12px ${F.mono};color:${C.wine2};margin-top:4px">${esc(otd[1])}</div></td><td valign="top" style="font:14.5px/1.5 ${F.sans};color:${C.fg2}">${esc(otd[2])}</td></tr></table></td></tr>` : ''}

${tq ? `${H('Daily trivia')}<tr><td style="padding:12px 28px 0"><div style="font:700 16px/1.4 ${F.sans};color:${C.ink}">${esc(tq.q)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${[0, 2].map(r => `<tr>${[r, r + 1].map(k => `<td width="50%" style="padding:${k % 2 ? '0 0 6px 3px' : '0 3px 6px 0'}"><div style="border:1px solid ${C.line};padding:9px 10px;font:14px ${F.sans};color:${C.fg2}"><b style="color:${C.wine2};font-family:${F.mono}">${String.fromCharCode(65 + k)}</b>&nbsp; ${esc(tq.c[k] || '')}</div></td>`).join('')}</tr>`).join('')}</table><div style="font:12px ${F.sans};color:${C.muted};margin-top:2px">Answer at the bottom</div></td></tr>` : ''}

${H(opts.preseason ? 'Last game' : 'Last night', opts.preseason ? 'preseason' : null, ['Box score', boxLink])}
<tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-left:3px solid ${C.wine}">
<tr><td colspan="2" style="padding:9px 14px 4px;font:800 10px ${F.sans};letter-spacing:1.2px;color:${C.muted};text-transform:uppercase">Final · ${esc(where)} · ${esc(short(g[0]))}</td><td align="right" style="padding:9px 14px 4px">${chip(win ? 'W' : 'L', win ? C.gold : C.ink, win ? C.ink : '#fff')}</td></tr>
${[['CLE', 'Cavaliers', cs, win], [g[1], NICK[g[1]] || D.TEAMS[g[1]], os, !win]].map(([ab, nm, pts, won], k) => `<tr><td width="52" style="padding:${k ? '2px 0 11px 14px' : '4px 0 2px 14px'};font:800 20px ${F.narrow};color:${won ? C.ink : C.muted}">${ab}</td><td style="padding:${k ? '2px 0 11px' : '4px 0 2px'};font:${won ? 700 : 400} 14px ${F.sans};color:${won ? C.ink : C.muted}">${esc(nm)}</td><td align="right" style="padding:${k ? '2px 14px 11px 0' : '4px 14px 2px 0'};font:700 22px ${F.mono};color:${won ? C.ink : C.muted}">${pts}</td></tr>`).join('')}
</table>${rec.length ? `<div style="font:12.5px ${F.sans};color:${C.muted};margin-top:6px">Cavs are ${w}–${l}</div>` : ''}</td></tr>
${shot ? `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-left:3px solid ${C.wine}"><tr><td style="padding:9px 12px;font:14px/1.45 ${F.sans};color:${C.ink}"><span style="font:800 10px ${F.sans};letter-spacing:1.2px;color:${C.wine2}">&#9749; ESPRESSO SHOT</span><br>${esc(shot)}</td></tr></table></td></tr>` : ''}
${tn ? `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.sub}"><tr>${P(tn) ? `<td width="62" style="padding:8px 0 8px 10px"><img src="https://cdn.nba.com/headshots/nba/latest/260x190/${P(tn)}.png" width="52" height="38" alt="" style="display:block;background:#fff"></td>` : ''}<td style="padding:9px 12px"><div style="font:800 10px ${F.sans};letter-spacing:1.2px;color:${C.muted}">TOP PERFORMER</div><div style="font:700 15px ${F.sans};color:${C.ink};margin-top:1px">${esc(tn)} <span style="font:600 13px ${F.mono};color:${C.wine2}">&nbsp;${esc((tl || '').toUpperCase().replace(/, /g, ' · '))}</span></div></td></tr></table></td></tr>` : ''}
${hl || recap ? body(`${hl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${C.line2}"><tr><td width="172" valign="top" style="padding:10px 12px 10px 0"><a href="${esc(hl.link)}"><img src="https://i.ytimg.com/vi/${esc(hl.id)}/mqdefault.jpg" width="160" alt="Full game highlights" style="display:block;width:160px;height:auto;border:0"></a></td><td valign="middle" style="padding:10px 0;font:14px/1.45 ${F.sans};color:${C.ink}">${lk(hl.link, '&#9654;&nbsp; Full game highlights')}<div style="font:12px ${F.sans};color:${C.muted};margin-top:2px">NBA · YouTube</div></td></tr></table>` : ''}${recap ? row(lk(recap.link, esc(recap.title)), { meta: 'RealCavsFans recap' }) : ''}`) : ''}

${standings(D)}

${tg ? tonight(D, tg) : nx ? `${H('Up next', null, ['Preview', SITE + '/games/' + nx[0] + '-' + nx[1].toLowerCase()])}${body(row(`<b>${nx[2] === 'H' ? 'vs' : 'at'} ${esc(D.TEAMS[nx[1]])}</b>`, { left: esc(short(nx[0])), lw: 92, meta: `${esc(nx[3])} PM ET${D.tv[nx[0]] ? ' · ' + esc(D.tv[nx[0]]) : ''} · ${esc(D.radio)}` }))}` : ''}

${D.INJURIES.length ? `${H('Injury report', D.INJ_UPDATED ? 'updated ' + esc(D.INJ_UPDATED) : null)}${body(D.INJURIES.map(([n, , inj, st]) => row(`${esc(n)} <span style="color:${C.muted}">· ${esc(inj.toLowerCase())}</span>`, { right: esc(st) })).join(''))}` : ''}

${moves.length ? `${H('Transactions', null, 'since your last cup')}${body(moves.map(x => row(esc(txText(x)) + (x.note ? ` <span style="color:${C.muted}">· ${esc(x.note)}</span>` : ''), { left: esc(md2(x.d)) })).join(''))}` : ''}

${reads.length ? `${H('Morning reads')}${body(reads.map(x => row(lk(x.link, esc(x.title)), { meta: `${esc(x.src)} · ${esc(md2(x.date.slice(0, 10)))}` })).join(''))}` : ''}

${play.length ? `${H('Press play', 'podcasts &amp; video')}${body(play.map(x => row(lk(x.link, esc(x.title)), { left: chip(x.kind === 'video' ? 'WATCH' : 'LISTEN', x.kind === 'video' ? C.wine : C.ink, '#fff'), lw: 64, meta: `${esc(x.src)}${x.dur ? ' · ' + esc(x.dur) : ''} · ${esc(md2(x.date.slice(0, 10)))}` })).join(''))}` : ''}

${week.length ? `${H('This week', null, ['Key dates', SITE])}${body(week.map(x => row(esc(x[1]), { left: esc(short(x[0])), lw: 92 })).join(''))}` : ''}

${tq ? `<tr><td style="padding:28px 28px 0"><div style="border-top:2px solid ${C.ink};padding-top:10px;font:13px/1.5 ${F.sans};color:${C.fg2}"><span style="font:800 10.5px ${F.sans};letter-spacing:1.2px;color:${C.wine2}">TRIVIA ANSWER</span><br><b style="color:${C.ink}">${String.fromCharCode(65 + tq.a)}. ${esc(tq.c[tq.a])}</b></div></td></tr>` : ''}

<tr><td style="padding:28px 28px 26px;text-align:center;font:12px/1.7 ${F.sans};color:${C.muted}">
<a href="${SITE}"><img src="${SITE}/nl/logo.png" width="140" alt="cavs_db" style="display:inline-block;width:140px;height:auto;border:0;margin-bottom:6px"></a><br>
<a href="${SITE}" style="color:${C.wine2};font-weight:600;text-decoration:none">cavsdatabase.com</a> &nbsp;·&nbsp; <a href="https://www.buymeacoffee.com/cavsdb" style="color:${C.wine2};font-weight:600;text-decoration:none">&#9749; Buy cavs_db a coffee</a><br>
Independent fan reference, not affiliated with the Cavaliers or the NBA.</td></tr>
</table></td></tr></table>`;
}

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
const subj = `${MODE === 'test' || !LIVE ? '[Test] ' : ''}☕ Final: Cavs ${cs}, ${NICK[g[1]] || g[1]} ${os}${b.top ? ' · ' + b.top.split(':')[0].split(' ').slice(-1)[0] + ' ' + (b.top.match(/(\d+) pts/) || [])[1] : ''}`;
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
