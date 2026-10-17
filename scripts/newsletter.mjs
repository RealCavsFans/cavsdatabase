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

/* ---------- tonight: game page preview info for a same-day game ---------- */
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function tonight(D, tg, H) {
  const o = tg[1], home = tg[2] === 'H', slug = tg[0] + '-' + o.toLowerCase();
  const i = D.SCHEDULE.indexOf(tg), res = (D.SEASON.results || '').replace(/[^WL]/g, '').split('');
  const rec = a => { const t = D.STANDINGS.find(x => x[0] === a); return t ? t[2] + '–' + t[3] : ''; };
  const rr = D.REST[tg[0]] || []; const rest = rr[0] === 0 ? 'Back-to-back' : rr[0] == null ? (i === 0 ? 'Season opener' : '—') : rr[0] + ' day' + (rr[0] === 1 ? '' : 's');
  const box = (k, v) => `<td width="33%" style="background:rgba(255,255,255,.1);padding:7px 9px"><div style="font:800 9.5px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#F4D6DD">${k}</div><div style="font:700 13.5px Arial,Helvetica,sans-serif;color:#fff;margin-top:2px">${esc(v)}</div></td>`;
  const TS = D.TS || {}, all = Object.values(TS);
  const ROWS = [['Record', t => t[0] / Math.max(1, t[0] + t[1]), 1, t => t[0] + '–' + t[1]], ['Off rating', t => t[4], 1, t => t[4].toFixed(1)], ['Def rating', t => t[5], 0, t => t[5].toFixed(1)], ['Net rating', t => t[4] - t[5], 1, t => { const x = t[4] - t[5]; return (x > 0 ? '+' : '') + x.toFixed(1); }], ['Pace', t => t[6], 1, t => t[6].toFixed(1)]];
  const tape = TS.CLE && TS[o] ? ROWS.map(([lab, f, hi, fm]) => { const rk = t => ord(1 + all.filter(u => hi ? f(u) > f(t) : f(u) < f(t)).length); return `<tr><td style="padding:5px 0;font:600 13.5px 'SF Mono',Menlo,Consolas,monospace;color:#7A1F33">${fm(TS.CLE)} <span style="font:11px Arial,Helvetica,sans-serif;color:#5D646C">${rk(TS.CLE)}</span></td><td align="center" style="padding:5px 0;font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#5D646C;text-transform:uppercase">${lab}</td><td align="right" style="padding:5px 0;font:600 13.5px 'SF Mono',Menlo,Consolas,monospace;color:#101419"><span style="font:11px Arial,Helvetica,sans-serif;color:#5D646C">${rk(TS[o])}</span> ${fm(TS[o])}</td></tr>`; }).join('') : '';
  const meets = D.SCHEDULE.map((x, k) => [x, k]).filter(([x]) => x[1] === o);
  const ser = meets.map(([x, k]) => { const r = res[k], sc = D.SCORES[x[0]]; return `<tr><td width="70" style="padding:5px 0;font:600 12px 'SF Mono',Menlo,Consolas,monospace;color:#5D646C">${esc(new Date(x[0] + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</td><td style="padding:5px 0;font:${k === i ? '700' : '400'} 13.5px Arial,Helvetica,sans-serif;color:#101419">${x[2] === 'H' ? 'vs' : 'at'} ${x[1]}${r && sc ? ' · ' + r + ' ' + sc.replace('-', '–') : k === i ? ' · tonight' : ''}</td></tr>`; }).join('');
  return `${H('Tonight', ['Full game preview', SITE + '/games/' + slug])}
<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#7A1F33;background-image:linear-gradient(160deg,#8e2741,#5E0027)"><tr><td style="padding:14px 16px">
<div style="font:800 10.5px Arial,Helvetica,sans-serif;letter-spacing:1.4px;color:#F2B231">${esc(tg[3])} PM ET · ${esc(new Date(tg[0] + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase())}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 10px"><tr><td style="font:800 38px 'Arial Narrow',Arial,Helvetica,sans-serif;color:#fff">CLE${rec('CLE') ? `<div style="font:600 12px Arial,Helvetica,sans-serif;color:#F4D6DD">${rec('CLE')}</div>` : ''}</td><td align="center" style="font:600 14px Arial,Helvetica,sans-serif;color:#F4D6DD">${home ? 'vs' : 'at'}</td><td align="right" style="font:800 38px 'Arial Narrow',Arial,Helvetica,sans-serif;color:#fff">${o}${rec(o) ? `<div style="font:600 12px Arial,Helvetica,sans-serif;color:#F4D6DD">${rec(o)}</div>` : ''}</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="4" style="margin:0 -4px"><tr>${box('WATCH', D.tv[tg[0]] || 'TBA')}${box('LISTEN', D.radio)}${box('REST', rest)}</tr></table>
<div style="font:12.5px Arial,Helvetica,sans-serif;color:#F4D6DD;margin-top:8px">Game ${i + 1} of 82 · ${home ? 'Rocket Arena' : 'at ' + esc(D.TEAMS[o])} · meeting ${meets.findIndex(([, k]) => k === i) + 1} of ${meets.length}</div></td></tr></table></td></tr>
${tape ? `<tr><td style="padding:14px 28px 0"><div style="font:800 10.5px Arial,Helvetica,sans-serif;letter-spacing:1.2px;color:#101419;padding-bottom:4px;border-bottom:1px solid #E3E5E0">TALE OF THE TAPE <span style="font-weight:400;letter-spacing:0;color:#5D646C">· ${D.TS_CUR ? '2026–27' : '2025–26'} · league rank</span></div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tape}</table></td></tr>` : ''}
${meets.length > 1 ? `<tr><td style="padding:12px 28px 0"><div style="font:800 10.5px Arial,Helvetica,sans-serif;letter-spacing:1.2px;color:#101419;padding-bottom:4px;border-bottom:1px solid #E3E5E0">SEASON SERIES</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ser}</table></td></tr>` : ''}`;
}

/* ---------- the email ---------- */
function build(D, g, score, top, boxLink, opts) {
  const [cs, os] = score.split('-').map(Number), win = cs > os;
  const where = g[2] === 'H' ? 'vs ' + D.TEAMS[g[1]] : 'at ' + D.TEAMS[g[1]];
  const issueDay = opts.issueDay;
  const rec = (D.SEASON.results || '').replace(/[^WL]/g, ''); const w = (rec.match(/W/g) || []).length, l = rec.length - w;
  const nx = D.SCHEDULE.find(x => x[0] > g[0]);
  const P = n => (D.PL.find(p => p[0] === n) || [])[1];
  const [tn, tl] = (top || '').split(': ');
  const H = (t, link) => `<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font:800 12px Arial,Helvetica,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#101419;padding-bottom:6px;border-bottom:2px solid #101419">${t}</td><td align="right" style="font:600 12.5px Arial,Helvetica,sans-serif;padding-bottom:6px;border-bottom:2px solid #101419">${link ? `<a href="${link[1]}" style="color:#7A1F33;text-decoration:none">${link[0]} &rarr;</a>` : ''}</td></tr></table></td></tr>`;
  const tile = (v, dark) => `<td style="background:${dark ? '#24292F' : '#7A1F33'};color:#fff;font:700 34px 'SF Mono',Menlo,Consolas,'Courier New',monospace;text-align:center;padding:10px 12px;border-radius:5px">${v}</td>`;
  const stat = (v, k) => `<td width="33%" style="border:1px solid #E3E5E0;border-top:3px solid #860038;padding:10px 12px"><div style="font:700 20px 'SF Mono',Menlo,Consolas,monospace;color:#7A1F33">${v}</div><div style="font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#5D646C;text-transform:uppercase;margin-top:2px">${k}</div></td>`;
  const md = issueDay.slice(5);
  const otd = (D.OTD || [])[0] || D.HISTORY.find(h => h[0] === md);
  const news = (opts.rcf?.items || []).filter(x => x.date && x.date.slice(0, 10) >= g[0] && Date.parse(x.date) > opts.sinceTs && x !== (opts.rcf?.items || []).find(y => /recap/i.test(y.title) && y.date && y.date.slice(0, 10) >= g[0])).slice(0, 4);
  const week = D.DATES.filter(x => x[0] >= issueDay && x[0] <= etDate(new Date(Date.parse(issueDay + 'T12:00:00Z') + 6 * 864e5))).slice(0, 3);
  // since your last cup: moves since the previous issue (or the previous game)
  const since = opts.since;
  const txText = x => x.k === 'trade' ? `Traded ${(x.sent || []).join(', ')} to ${(x.w || []).join('/')} for ${(x.got || []).join(', ')}` : (x.t || x.p || '');
  const moves = D.TX.filter(x => x.d > since && x.d <= issueDay).sort((a, b) => a.d.localeCompare(b.d));
  const recap = (opts.rcf?.items || []).find(x => /recap/i.test(x.title) && x.date && x.date.slice(0, 10) >= g[0]);
  // only what's new since the last issue went out
  const fresh = x => x.date && Date.parse(x.date) > opts.sinceTs;
  const more = (opts.news?.articles || []).filter(fresh).slice(0, 4);
  const pods = (opts.news?.podcasts || []).filter(fresh).slice(0, 4);
  const vids = []; (opts.news?.videos || []).filter(fresh).forEach(x => { if (!vids.some(v => v.src === x.src)) vids.push(x); });
  const nickU = (NICK[g[1]] || '').toUpperCase();
  const hl = (opts.news?.highlights || []).find(x => x.date.slice(0, 10) >= g[0] && Date.parse(x.date) - Date.parse(g[0] + 'T12:00:00Z') < 3 * 864e5 && x.title.toUpperCase().includes(nickU));
  // a game tonight: the site's game page preview, in the email
  const tg = D.SCHEDULE.find(x => x[0] === issueDay);
  const tq = opts.trivia;
  const l14 = D.L14.CLE ? (D.L14.CLE[0] > 0 ? '+' : '') + D.L14.CLE[0].toFixed(1) : '—';
  return `<!-- Cavs & Coffee · built by cavsdatabase.com -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F2"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff">
<tr><td><a href="${SITE}"><img src="${SITE}/nl/header.png" width="600" alt="Cavs &amp; Coffee · the morning after every Cavs game · presented by cavs_db" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>
<tr><td style="padding:12px 28px 0;font:600 12px 'SF Mono',Menlo,Consolas,monospace;color:#7A1F33;letter-spacing:.5px">&gt; ${esc(long(issueDay).toLowerCase())}${opts.test ? ' · <b style="color:#C8102E">test copy</b>' : ''}</td></tr>
${H(opts.preseason ? 'Preseason · last game' : 'Last night', ['Box score', boxLink])}
<tr><td style="padding:14px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="font:800 34px 'Arial Narrow',Arial,Helvetica,sans-serif;color:#860038;padding-right:10px">CLE</td>${tile(cs)}<td style="padding:0 8px"><div style="width:16px;height:4px;background:#F2B231"></div></td>${tile(os, true)}<td style="font:800 34px 'Arial Narrow',Arial,Helvetica,sans-serif;color:#101419;padding-left:10px">${g[1]}</td>
<td style="padding-left:14px"><span style="background:${win ? '#860038' : '#24292F'};color:#fff;font:800 11px Arial,Helvetica,sans-serif;letter-spacing:1.5px;padding:4px 8px;border-radius:3px">${win ? 'W' : 'L'}</span></td></tr></table>
<div style="font:13px Arial,Helvetica,sans-serif;color:#5D646C;margin-top:8px">${esc(where)} · ${esc(short(g[0]))}${rec.length ? ` · Cavs are ${w}–${l}` : ''}</div></td></tr>
${tn ? `<tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6F3;border-left:3px solid #F2B231"><tr>${P(tn) ? `<td width="62" style="padding:10px 0 10px 12px"><img src="https://cdn.nba.com/headshots/nba/latest/260x190/${P(tn)}.png" width="52" height="38" alt="" style="display:block;border-radius:4px;background:#fff"></td>` : ''}<td style="padding:10px 12px"><div style="font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1.2px;color:#5D646C">TOP LINE</div><div style="font:700 16px Arial,Helvetica,sans-serif;color:#101419;margin:2px 0">${esc(tn)}</div><div style="font:600 13px 'SF Mono',Menlo,Consolas,monospace;color:#2F363E">${esc((tl || '').toUpperCase().replace(/, /g, ' · '))}</div></td></tr></table></td></tr>` : ''}
${opts.preseason ? '' : `<tr><td style="padding:16px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${stat(rec.length ? w + '–' + l : '—', 'Record')}<td width="8"></td>${stat(esc(D.SEASON.eastRank || '—'), 'In the East')}<td width="8"></td>${stat(l14, 'Net, 2 wks')}</tr></table></td></tr>`}
${recap ? `<tr><td style="padding:14px 28px 0"><a href="${esc(recap.link)}" style="display:block;background:#101419;color:#fff;text-decoration:none;padding:12px 14px;border-left:4px solid #F2B231"><span style="display:block;font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1.2px;color:#F2B231">THE RECAP · REALCAVSFANS</span><span style="display:block;font:700 15px/1.35 Arial,Helvetica,sans-serif;margin-top:3px">${esc(recap.title)} &rarr;</span></a></td></tr>` : ''}
${hl ? `<tr><td style="padding:14px 28px 0"><a href="${esc(hl.link)}" style="display:block;text-decoration:none;color:#101419"><img src="https://i.ytimg.com/vi/${esc(hl.id)}/hqdefault.jpg" width="544" alt="${esc(hl.title)}" style="display:block;width:100%;height:auto;border:0"><span style="display:block;background:#860038;color:#fff;font:800 12px Arial,Helvetica,sans-serif;letter-spacing:1.2px;padding:9px 12px">&#9654;&nbsp; WATCH THE HIGHLIGHTS <span style="font-weight:400;letter-spacing:0;color:#F4D6DD">· NBA</span></span></a></td></tr>` : ''}
${H('Since your last cup', ['All moves', SITE + '/transactions'])}<tr><td style="padding:6px 28px 0">${moves.length ? moves.map(x => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #EFF0EC"><tr><td width="64" valign="top" style="padding:8px 0;font:600 12px 'SF Mono',Menlo,Consolas,monospace;color:#5D646C">${esc(new Date(x.d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</td><td style="padding:8px 0;font:14px/1.45 Arial,Helvetica,sans-serif;color:#101419">${esc(txText(x))}${x.note ? ` <span style="color:#5D646C">· ${esc(x.note)}</span>` : ''}</td></tr></table>`).join('') : `<div style="padding:8px 0;font:14px Arial,Helvetica,sans-serif;color:#5D646C">No roster moves since the last issue.</div>`}</td></tr>
${tg ? tonight(D, tg, H) : ''}
${nx && !tg ? `${H('Up next', ['Schedule', SITE + '/schedule'])}<tr><td style="padding:12px 28px 0"><span style="background:#860038;color:#fff;font:800 10.5px Arial,Helvetica,sans-serif;letter-spacing:1.5px;padding:4px 9px">${esc(short(nx[0]).toUpperCase())}</span>
<div style="font:800 36px 'Arial Narrow',Arial,Helvetica,sans-serif;margin:8px 0 2px;color:#101419"><span style="color:#860038">CLE</span> <span style="font:400 17px Arial,Helvetica,sans-serif;color:#5D646C">${nx[2] === 'H' ? 'vs' : 'at'}</span> ${nx[1]}</div>
<div style="font:600 14px Arial,Helvetica,sans-serif;color:#2F363E">${esc(nx[3])} PM ET${D.tv[nx[0]] ? ' · ' + esc(D.tv[nx[0]]) : ''} · ${esc(D.radio)}</div></td></tr>` : ''}
${D.INJURIES.length ? `${H('Injury report', ['Details', SITE + '/#inj'])}<tr><td style="padding:6px 28px 0">${D.INJURIES.map(([n, , inj, st]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #EFF0EC"><tr><td style="padding:8px 0;font:14px Arial,Helvetica,sans-serif;color:#101419">${esc(n)} · ${esc(inj.toLowerCase())}</td><td align="right" style="padding:8px 0;font:600 13px Arial,Helvetica,sans-serif;color:#B26B00">${esc(st)}</td></tr></table>`).join('')}</td></tr>` : ''}
${news.length ? `${H('Around the Cavs', ['More on RCF', 'https://realcavsfans.com'])}<tr><td style="padding:4px 28px 0">${news.map(x => `<div style="padding:9px 0;border-bottom:1px solid #EFF0EC"><a href="${esc(x.link)}" style="font:700 15px Arial,Helvetica,sans-serif;color:#101419;text-decoration:none">${esc(x.title)}</a><div style="font:12px Arial,Helvetica,sans-serif;color:#5D646C;margin-top:2px">RealCavsFans · ${esc(short(x.date.slice(0, 10)))}</div></div>`).join('')}</td></tr>` : ''}
${more.length ? `${news.length ? '' : H('Around the Cavs', null)}<tr><td style="padding:4px 28px 0">${more.map(x => `<div style="padding:9px 0;border-bottom:1px solid #EFF0EC"><a href="${esc(x.link)}" style="font:700 15px Arial,Helvetica,sans-serif;color:#101419;text-decoration:none">${esc(x.title)}</a><div style="font:12px Arial,Helvetica,sans-serif;color:#5D646C;margin-top:2px">${esc(x.src)} · ${esc(short(x.date.slice(0, 10)))}</div></div>`).join('')}</td></tr>` : ''}
${pods.length ? `${H('On the pod', null)}<tr><td style="padding:4px 28px 0">${pods.map(x => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #EFF0EC"><tr><td width="40" valign="top" style="padding:10px 0"><div style="width:30px;height:30px;border-radius:50%;background:#860038;color:#fff;font:700 12px Arial,Helvetica,sans-serif;text-align:center;line-height:30px">&#9654;</div></td><td style="padding:9px 0"><a href="${esc(x.link)}" style="font:700 15px/1.35 Arial,Helvetica,sans-serif;color:#101419;text-decoration:none">${esc(x.title)}</a><div style="font:12px Arial,Helvetica,sans-serif;color:#5D646C;margin-top:2px">${esc(x.src)}${x.dur ? ' · ' + esc(x.dur) : ''} · ${esc(short(x.date.slice(0, 10)))}</div></td></tr></table>`).join('')}</td></tr>` : ''}
${vids.length ? `${H('Watch', null)}<tr><td style="padding:8px 28px 0">${vids.map(x => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #EFF0EC"><tr><td width="132" valign="top" style="padding:8px 12px 8px 0"><a href="${esc(x.link)}"><img src="https://i.ytimg.com/vi/${esc(x.id)}/mqdefault.jpg" width="120" alt="" style="display:block;width:120px;height:auto;border:0"></a></td><td valign="top" style="padding:8px 0"><a href="${esc(x.link)}" style="font:700 14.5px/1.35 Arial,Helvetica,sans-serif;color:#101419;text-decoration:none">${esc(x.title)}</a><div style="font:12px Arial,Helvetica,sans-serif;color:#5D646C;margin-top:3px">${esc(x.src)} · ${esc(short(x.date.slice(0, 10)))}</div></td></tr></table>`).join('')}</td></tr>` : ''}
${week.length ? `${H('This week', ['Key dates', SITE])}<tr><td style="padding:8px 28px 0;font:14px/1.6 Arial,Helvetica,sans-serif;color:#101419">${week.map(x => `&bull; <b>${esc(short(x[0]))}:</b> ${esc(x[1])}`).join('<br>')}</td></tr>` : ''}
${tq ? `${H('Daily trivia', null)}<tr><td style="padding:10px 28px 0"><div style="font:700 16px/1.4 Arial,Helvetica,sans-serif;color:#101419">${esc(tq.q)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${[0, 2].map(r => `<tr>${[r, r + 1].map(k => `<td width="50%" style="padding:${k % 2 ? '0 0 6px 3px' : '0 3px 6px 0'}"><div style="border:1px solid #E3E5E0;padding:9px 10px;font:14px Arial,Helvetica,sans-serif;color:#2F363E"><b style="color:#7A1F33;font-family:'SF Mono',Menlo,Consolas,monospace">${String.fromCharCode(65 + k)}</b>&nbsp; ${esc(tq.c[k] || '')}</div></td>`).join('')}</tr>`).join('')}</table><div style="font:12px Arial,Helvetica,sans-serif;color:#5D646C;margin-top:6px">Answer at the bottom &darr;</div></td></tr>` : ''}
${otd ? `<tr><td style="padding:22px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E5E0"><tr><td width="64" valign="top" style="padding:12px 0 12px 12px"><div style="background:#860038;color:#fff;text-align:center;border-radius:3px;padding:7px 0;width:52px"><div style="font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1px">${esc(new Date(issueDay + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase())}</div><div style="font:800 24px 'Arial Narrow',Arial,sans-serif">${+md.slice(3)}</div></div></td><td style="padding:12px 14px"><div style="font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1.2px;color:#7A1F33">THIS DAY IN CAVS HISTORY · ${otd[1]}</div><div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#2F363E;margin-top:4px">${esc(otd[2])}</div></td></tr></table></td></tr>` : ''}
${tq ? `<tr><td style="padding:26px 28px 0"><div style="background:#F5F6F3;border-top:3px solid #F2B231;padding:10px 12px;font:13px/1.5 Arial,Helvetica,sans-serif;color:#2F363E"><b style="font:800 10px Arial,Helvetica,sans-serif;letter-spacing:1.2px;color:#7A1F33">TRIVIA ANSWER</b><br><b>${String.fromCharCode(65 + tq.a)}. ${esc(tq.c[tq.a])}</b></div></td></tr>` : ''}
<tr><td style="padding:26px 28px 24px;text-align:center;background:#101419;color:#C9CDD2;font:12px/1.6 Arial,Helvetica,sans-serif">
<div style="font:700 15px 'SF Mono',Menlo,Consolas,monospace;color:#fff">cavs<span style="color:#F2B231">_db</span></div>
Everything Cavaliers. Everything you need.<br>
<a href="https://www.buymeacoffee.com/cavsdb" style="display:inline-block;margin:10px 0;background:#860038;color:#fff;border-radius:999px;padding:8px 16px;font-weight:700;text-decoration:none">&#9749; Buy cavs_db a coffee</a><br>
<a href="${SITE}" style="color:#fff">cavsdatabase.com</a> · Independent fan reference, not affiliated with the Cavaliers or the NBA.</td></tr>
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
const tq = trivia.length ? trivia[Object.keys(sent).length % trivia.length] : null;
const html = build(D, g, score, b.top || '', b.url || D.box[g[0]] || SITE + '/schedule', { issueDay: today, rcf, news, trivia: tq, since, sinceTs, test: MODE === 'test' || !LIVE, preseason });
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
