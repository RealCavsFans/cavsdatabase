// Cavs & Coffee: builds the freshly brewed email from the site's own data and hands it to Buttondown.
//   node scripts/newsletter.mjs auto   (the morning run: sends at 6:19 AM ET, only if the Cavs played yesterday and it hasn't gone out)
//   node scripts/newsletter.mjs test   (latest final, or the preseason finale before the opener; test copy to the owner only)
// Nothing reaches subscribers unless the repo variable NEWSLETTER_LIVE is "true". Until then every issue is a
// Buttondown draft plus a test copy to the newsletter owner. Needs BUTTONDOWN_API_KEY, and Playwright/Chrome to read the site's data.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
  const d = await page.evaluate(async md => {
    const tvw = d => { const t = tvFor(d); return [t.nat, t.loc].filter(Boolean)[0] || ''; };
    const NIANG = await fetch('/niang.json').then(r => r.ok ? r.json() : null).catch(() => null);
    return { DRAFT_LAST: typeof DRAFT_LAST === 'object' ? DRAFT_LAST : [], NIANG, SCHEDULE, SCORES, SEASON, PRESEASON, TEAMS, INJURIES, INJ_ASSIGN: typeof INJ_ASSIGN !== "undefined" ? INJ_ASSIGN : [], CHARGE: typeof CHARGE !== "undefined" ? CHARGE : null, HISTORY, L14, TX: TX.slice(0, 60), DATES,
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
  let [tn, tl] = (top || '').split(': ');
  /* Nov 1: the line reads "X led the Cavs with N points", so X must be the top scorer (box.json's top is the best all-round line) */
  { const bx = (opts.boxRows || []).filter(r => r && r[0]).map(r => ({ n: r[0], pts: +r[2], reb: +r[3], ast: +r[4] })).sort((a, b) => b.pts - a.pts || b.reb + b.ast - a.reb - a.ast)[0];
    if (bx) { tn = bx.n; tl = `${bx.pts} pts, ${bx.reb} reb, ${bx.ast} ast`; } }
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
    if (TS.CLE && TS[o]) tape = [['Record', t => t[0] / Math.max(1, t[0] + t[1]), 1, t => t[0] + '–' + t[1]], ['ORTG', t => t[4], 1, t => t[4].toFixed(1)], ['DRTG', t => t[5], 0, t => t[5].toFixed(1)], ['NET RTG', t => t[4] - t[5], 1, t => { const x = t[4] - t[5]; return (x > 0 ? '+' : '') + x.toFixed(1); }]]
      .map(([lab, f, hi, fm]) => { const rk = t => ord(1 + all.filter(u => hi ? f(u) > f(t) : f(u) < f(t)).length); return [lab, fm(TS.CLE), rk(TS.CLE), fm(TS[o]), rk(TS[o])]; });
  }
  let inj = D.INJURIES.map(([n, , what, st]) => [n, what.toLowerCase(), st]), injNote = '', gl = (D.INJ_ASSIGN || []).map(r => r[0]);
  /* Nov 1: same as the site: when the league's official injury report (pdata/injury-report.json) covers the next game,
     its statuses win and anyone else the Cavs listed is added (G League assignments aren't injuries, so they stay off) */
  try {
    const R = JSON.parse(readFileSync(new URL('../pdata/injury-report.json', import.meta.url), 'utf8')), t = R.teams && R.teams.CLE;
    if (nx && t && t.filed && R.game && R.game.date === nx[0]) {
      const off = t.rows.filter(r => !/^G League/.test(r[2])), by = Object.fromEntries(off.map(r => [r[0], r]));
      gl = t.rows.filter(r => r[2] === 'G League assignment').map(r => r[0]);   /* Nov 3: assignments get their own short line */
      inj = inj.map(([n, what, st]) => by[n] ? [n, what, by[n][1]] : [n, what, st])
        .concat(off.filter(r => !inj.some(x => x[0] === r[0])).map(([n, st, why]) => [n, why.toLowerCase(), st]));
    }
    /* Nov 3 (Luka): the label itself names the report, e.g. "Nov 2, 6:30 pm injury report" */
    const fd = (R.report || '').replace(/^(\d+)\/(\d+)\/\d+ (\d+):(\d+) ([AP])M$/, (m, mo, d, h, mi, ap) => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+mo - 1] + ' ' + (+d) + ', ' + (+h) + (mi !== '00' ? ':' + mi : '') + ' ' + ap.toLowerCase() + 'm');
    if (fd && fd !== R.report) injNote = fd + ' injury report (CLE)';
  } catch {}
  // standings: five East rows around the Cavs (regular season only)
  const E = (D.STANDINGS || []).filter(t => t[1] === 'E').sort((x, y) => (y[2] - y[3]) - (x[2] - x[3]) || y[2] - x[2]);
  let stand = []; const ci = E.findIndex(t => t[0] === 'CLE');
  if (ci >= 0 && E.some(t => t[2] + t[3] > 0)) { const a = Math.max(0, Math.min(ci - 2, E.length - 5)), L = E[0]; stand = E.slice(a, a + 5).map((t, k) => { const gb = ((L[2] - t[2]) + (t[3] - L[3])) / 2; return [a + k + 1, t[0] === 'CLE' ? 'Cleveland' : (D.TEAMS[t[0]] || t[0]), t[2] + '–' + t[3], gb ? (gb % 1 ? gb.toFixed(1) : String(gb)) : '—', t[0] === 'CLE']; }); }
  /* Nov 3: last meeting and season series with the next opponent (this season's results) */
  let meet = null;
  if (nx) { const o = nx[1], past = D.SCHEDULE.filter(z => z[1] === o && D.SCORES[z[0]]), left = D.SCHEDULE.filter(z => z[1] === o && !D.SCORES[z[0]] && z[0] > g[0]).length;
    if (past.length) { const L = past[past.length - 1], [a, b] = D.SCORES[L[0]].split('-').map(Number), w = past.filter(z => { const [p, q] = D.SCORES[z[0]].split('-').map(Number); return p > q; }).length;
      meet = { d: L[0], ha: L[2], res: (a > b ? 'W ' : 'L ') + a + '–' + b, w, l: past.length - w, left, nick: NICK[o] || o, o, show: L[0] !== g[0] };
      /* the "last meeting" line shows only when that game wasn't last night */
    } }
  /* Nov 3: around the East, last night's results for the teams in the standings table (league box scores, pdata/league.json) */
  let around = [];
  try { const LG = JSON.parse(readFileSync(new URL('../pdata/league.json', import.meta.url), 'utf8')), AL = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' }, ab = x => AL[x] || x;
    const near = new Set(stand.filter(r => !r[4]).map(r => Object.keys(D.TEAMS).find(k => D.TEAMS[k] === r[1])).filter(Boolean));
    Object.values(LG.tg || {}).filter(t => t.d === g[0] && t.t && t.t.length === 2).forEach(t => { const [A, B] = t.t;
      if (near.has(ab(A.ab)) || near.has(ab(B.ab))) { const [W, Lo] = A.pts > B.pts ? [A, B] : [B, A]; around.push(`${esc(NICK[ab(W.ab)] || W.ab)} ${W.pts} – ${esc(NICK[ab(Lo.ab)] || Lo.ab)} ${Lo.pts}`); } }); } catch {}
  /* Nov 3: lineup of the night, the Cavs five-man group with the best plus-minus in 5+ minutes together (the site's game archive) */
  let lu = null, notes = [];
  try { const se = (() => { const y = +g[0].slice(0, 4), m = +g[0].slice(5, 7); const s0 = m >= 8 ? y : y - 1; return s0 + '-' + String(s0 + 1).slice(2); })();
    const ix = JSON.parse(readFileSync(new URL(`../live-archive/${se}/index.json`, import.meta.url), 'utf8')), e = ix.find(z => z.et === g[0]);
    if (e) notes = tastingNotes(e.rc || [], e.opp);
    if (e) { const C = createRequire(import.meta.url)('../live-core.js'), s = JSON.parse(readFileSync(new URL(`../live-archive/${se}/${e.id}.json`, import.meta.url), 'utf8')), Dg = C.prep(s), R = C.deriveCore(Dg, Dg.plays, 'all');
      const L5 = Object.values(R.L['5'][5] || {}).filter(l => l.sec >= 300).map(l => ({ l, pm: l.pf - l.pa })).sort((a, b) => b.pm - a.pm || b.l.sec - a.l.sec)[0];
      if (L5 && L5.pm > 0) lu = { names: L5.l.ids.map(id => Dg.P[id].last), pm: L5.pm, min: Math.floor(L5.l.sec / 60) + ':' + String(Math.round(L5.l.sec % 60)).padStart(2, '0'), pf: L5.l.pf, pa: L5.l.pa };
      /* best five with its net rating (points per 100 possessions scored minus allowed) */
      const bi = notes.findIndex(([l]) => l === 'Best five');
      if (lu && bi >= 0 && L5.l.o?.np && L5.l.d?.np) { const nr = 100 * (L5.l.pf / L5.l.o.np - L5.l.pa / L5.l.d.np), sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
        notes[bi] = ['Best five', `${lu.names.join(', ')} · +${lu.pm} in ${lu.min} · ${sg(nr)} net rating`]; }
      /* swing stats: the one or two numbers worth the most points either way. Cavs shooting is measured against their own
         season average before this game (makes above or below average, in points); the rest are head-to-head point gaps. */
      const cid = Dg.teams.find(t => t.abbr === 'CLE').id, oid = Dg.teams.find(t => t.abbr !== 'CLE').id, A = R.T[cid], O = R.T[oid], oab = e.opp, cand = [];
      const prior = ix.filter(z => z.et < g[0]).map(z => { try { const s2 = JSON.parse(readFileSync(new URL(`../live-archive/${se}/${z.id}.json`, import.meta.url), 'utf8')), D2 = C.prep(s2), R2 = C.deriveCore(D2, D2.plays, 'all'); return R2.T[D2.teams.find(t => t.abbr === 'CLE').id]; } catch { return null; } }).filter(Boolean);
      const pct = (m, a2) => a2 ? (100 * m / a2).toFixed(1) : '0.0';
      if (prior.length >= 2) { const sum = k => prior.reduce((v, t) => v + (t[k] || 0), 0);
        const fd = A.ftm - O.ftm, fx = A.fta && sum('fta') ? A.ftm - A.fta * sum('ftm') / sum('fta') : 0, off = Math.abs(100 * A.ftm / (A.fta || 1) - 100 * sum('ftm') / (sum('fta') || 1)) >= 5;
        // free throws as one line: the head-to-head makes, plus the Cavs' rate against their season when it's 5+ points off
        if (fd || off) cand.push([Math.abs(fd) >= Math.abs(fx) ? fd : fx, `Free throws: ${fd >= 0 ? 'CLE ' + A.ftm + '–' + O.ftm : oab + ' ' + O.ftm + '–' + A.ftm}${off && A.fta ? ` (Cavs ${A.ftm}-${A.fta}, ${pct(A.ftm, A.fta)}%; season ${pct(sum('ftm'), sum('fta'))}%)` : ''}`]);
        for (const [lab, m, a2, v, sm, sa] of [['3PT', A.tpm, A.tpa, 3, sum('tpm'), sum('tpa')], ['2PT', A.fgm - A.tpm, A.fga - A.tpa, 2, sum('fgm') - sum('tpm'), sum('fga') - sum('tpa')]])
          if (a2 && sa) cand.push([(m - a2 * sm / sa) * v, `Cavs ${lab} ${m}-${a2} (${pct(m, a2)}%, season ${pct(sm, sa)}%)`]); }
      const hh = (lab, a2, o2) => { if (a2 !== o2) cand.push([a2 - o2, `${lab}: ${a2 > o2 ? 'CLE ' + a2 + '–' + o2 : oab + ' ' + o2 + '–' + a2}`]); };
      hh('Paint', A.paint, O.paint); hh('Second chance', A.second, O.second); hh('Points off turnovers', A.offto, O.offto); hh('Bench', A.bnPts, O.bnPts);
      const sw = cand.sort((x2, y2) => Math.abs(y2[0]) - Math.abs(x2[0])).slice(0, 2).map(z => z[1]);
      if (sw.length) { const hiAt = notes.findIndex(([l]) => l === 'Highs'); notes.splice(hiAt >= 0 ? hiAt : notes.length, 0, ['Swing stats', sw.join(' · ')]); }
    } } catch (err) { if (process.env.NL_DRY) console.log('notes:', err.message); }
  /* Nov 3: Charge corner, last night's Charge result, or the next Charge game within a week */
  let ch = null;
  if (D.CHARGE && process.env.NL_CH_EXAMPLE) D.CHARGE = { ...D.CHARGE, record: '1–0', games: [['2026-11-02', 'Motor City Cruise', 'H', '7:00', 'W 118–110', '', 'https://www.basketball-reference.com/gleague/boxscores/', [['Khalifa Diop', 16, 11, 2, 28], ['Ernest Udeh Jr.', 9, 8, 1, 22]]], ...(D.CHARGE.games || [])] };   // mockup only
  if (D.CHARGE) { const G = D.CHARGE.games || [], last = G.filter(z => z[4] && z[0] <= issueDay && z[0] >= g[0]).pop(), next = G.find(z => z[0] >= issueDay && !z[4]);
    if (last) ch = { kind: 'res', d: last[0], o: last[1], ha: last[2], res: last[4], rec: D.CHARGE.record, box: last[6] || '', lines: last[7] || [] }, ch.nx = next && (Date.parse(next[0]) - Date.parse(issueDay)) / 864e5 <= 7 ? { d: next[0], o: next[1], ha: next[2], t: next[3] } : null;   // [7] = Cavs two-way and assignment players' lines [name, pts, reb, ast, min], kept by the daily update from the box score
    else if (next && (Date.parse(next[0]) - Date.parse(issueDay)) / 864e5 <= 7) ch = { kind: 'next', d: next[0], o: next[1], ha: next[2], t: next[3], rec: D.CHARGE.record, first: !G.some(z => z[4]), venue: next[5] || (next[2] === 'H' ? D.CHARGE.venue : '') };
    if (ch) { ch.assign = (D.INJ_ASSIGN || []).map(r => r[0]); ch.lines = ch.lines || []; } }
  /* Nov 5 (Luka): drafted players' latest games, same as the home page's Prospect pipeline (last 10 days) */
  const dp = (D.DRAFT_LAST || []).map(([n, d, team, opp, ha, res, url, st]) => ({ n, d, team, opp, ha, res, url, st }));
  { const J = D.NIANG, L = J && J.last; if (L && !L.dnp) { const m = String(J.score || '').match(/^LSU (\d+), .* (\d+)$/); dp.push({ n: 'Saliou Niang', d: L.d, team: 'LSU', opp: L.opp, ha: '', res: m ? (+m[1] > +m[2] ? 'W ' : 'L ') + m[1] + '–' + m[2] : 'Final', url: J.url, st: { pts: L.pts, reb: L.reb, ast: L.ast, stl: L.stl, blk: L.blk } }); } }
  const drafted = dp.filter(r => r.d && (Date.parse(issueDay) - Date.parse(r.d)) / 864e5 <= 10).sort((a, b) => a.d < b.d ? 1 : -1);
  return { g, cs, os, win, issueDay, md, w, l, hasRec: rec.length > 0, tn, tl, recap, hl, reads, play, moves, week, otd, nx: nxInfo, tape, inj, injNote, gl, stand, meet, around, lu, ch, drafted, notes, tq: opts.trivia, shot: opts.milestone || '', sotn: opts.sotn || null, names: (D.PL || []).map(p => p[0]),
    pid: n => (D.PL.find(p => p[0] === n) || [])[1], qs: opts.qs || null, where: (g[2] === 'H' ? 'vs ' : 'at ') + D.TEAMS[g[1]], whereShort: g[2] === 'H' ? 'Rocket Arena' : 'at ' + D.TEAMS[g[1]].split(' ').slice(-1)[0], boxLink, preseason: opts.preseason, test: opts.test, TEAMS: D.TEAMS };
}
const fontLink = `<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@800&family=Geist+Mono:wght@700&display=swap" rel="stylesheet"><!--<![endif]-->`;
const wrapOpen = bg => `<meta name="viewport" content="width=device-width,initial-scale=1">${fontLink}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF0F2"><tr><td align="center" style="padding:0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${bg}">
<tr><td><a href="${SITE}"><img src="${SITE}/nl/header.png" width="600" alt="Cavs &amp; Coffee · freshly brewed after every game · presented by cavs_db" style="display:block;width:100%;max-width:600px;height:auto;border:0"></a></td></tr>`;
const footLinks = [['Live stats', 'live'], ['Cap', 'cap'], ['Assets', 'assets'], ['Roster', 'roster'], ['History', 'history']];
const FOOT_LOGO = ['logo-t.png', 120];   /* Nov 3: transparent wordmark (Luka's pick over the wine block, nl/logo.png) */
/* Nov 3 footer (Luka: the old one was too clunky): small logo, one row of links, the two asks as plain links on one line, then the fine print in one small block */
const footer = (rule) => {
  const lk = (href, label) => `<a href="${href}" style="color:#860038;text-decoration:none;font-weight:700;white-space:nowrap">${label}</a>`;
  return `<tr><td style="padding:20px 16px 24px;text-align:center;font:12px/1.7 ${F.sans};color:#5D646C">${rule || ''}
<a href="${SITE}" style="text-decoration:none"><img src="${SITE}/nl/${FOOT_LOGO[0]}" width="${FOOT_LOGO[1]}" alt="cavs_db" style="display:block;width:${FOOT_LOGO[1]}px;height:auto;border:0;margin:0 auto 10px"></a>
<div style="font:12.5px/1.8 ${F.sans}">${footLinks.map(([t, r]) => lk(`${SITE}/${r}`, t)).join(' &nbsp;·&nbsp; ')}</div>
<div style="font:12.5px/1.8 ${F.sans};margin:6px 0 14px">${lk('https://buttondown.com/cavscoffee/?referral_code={{ subscriber.referral_code }}', 'Share with a Cavs fan &rarr;')} &nbsp;·&nbsp; ${lk('https://www.buymeacoffee.com/cavsdb', '&#9749; Buy cavs_db a coffee')}</div>
<div style="font:600 11.5px/1.5 ${F.sans};color:#5D646C;margin:-6px 0 14px">Save us to your contacts so every issue skips the spam folder.</div>
<div style="border-top:1px dotted #D9D4CC;padding-top:10px;font:10.5px/1.7 ${F.sans};color:#8A8F96">Independent fan site, not affiliated with the Cavs or NBA.<br><span style="white-space:nowrap">Cavs Database · P.O.&zwnj; Box 151 · West Jeff&zwnj;erson, OH 43&zwnj;162</span><!--UNSUB--></div></td></tr></table></td></tr></table>`;
};
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
   on a loss it drains, leaving a stain line and drips off the edge. A roast label sets the mood by margin; no extra line under the score (Nov 3).
   Images are extras: with images off, the solid fill and the label still carry it. */
/* Nov 3: "The Pour", 4-6 short facts about the game from the game page's own recap lines (live-archive index rc):
   the best Cavs line, the four factors, the best lineup, the one or two biggest team edges either way, then any season or
   career high or milestone. No opinion: every line is a number from the game. */
function tastingNotes(rc, opp) {
  const get = re => rc.filter(([l]) => re.test(l)), out = [], dot = t => String(t).replace(/\.$/, '');
  get(/^Cavs high/).slice(0, 1).forEach(([, t]) => out.push(['Top line', dot(t)]));
  get(/^Four factors/).forEach(([, t]) => { /* Nov 5 (Luka): say who won each part, e.g. "Cavs won 1 of 4 (second chances) · Shooting: OKC 54.5–53.2 eFG%" */
    let s2 = dot(t).replace(/^(?:CLE|CAVS|Cavs) won (\d) of 4(?: factors)?: ([^.]*)\.\s*/, (m, n, w) => `Cavs won ${n} of 4 (${w}) · `).replace(/^(?:CLE|CAVS|Cavs) won 0 of 4(?: factors)?\.?\s*/, 'Cavs won 0 of 4 · ');
    s2 = s2.replace(/Effective FG% ([\d.]+) to ([\d.]+)/, (m, a, b) => +a >= +b ? `Shooting: Cavs ${a}–${b} eFG%` : `Shooting: ${opp || 'Opp'} ${b}–${a} eFG%`);
    out.push(['Four Factors', s2]); });
  get(/^Best lineup/).forEach(([, t]) => out.push(['Best five', dot(t).replace(/: \+/, ' · +').replace(/: -/, ' · -')]));
  // highs and records share one row: last name, short stat, and what kind of high in parentheses
  const AB = [[/made field goals?/, 'FGM'], [/made threes?/, '3PM'], [/made free throws?/, 'FTM'], [/points?/, 'pts'], [/rebounds?/, 'reb'], [/offensive reb/, 'oreb'], [/assists?/, 'ast'], [/steals?/, 'stl'], [/blocks?/, 'blk'], [/turnovers?/, 'tov']];
  const hi = get(/high|Milestone|Record|First|Most since/i).filter(([l]) => !/^(Cavs|Their) high/.test(l)).slice(0, 2).map(([l, t]) => {
    const m = /^(?:(.+?): )?(\d+) ([a-z ]+?), (.*?)\.?$/i.exec(t); if (!m) return dot(t);
    const who = m[1] ? m[1].replace(/ (Jr\.|Sr\.|II|III|IV)$/, '').split(' ').slice(-1)[0] : 'Cavs', st = (AB.find(([re]) => re.test(m[3])) || [, m[3]])[1];
    const kind = /tying/.test(m[4]) ? 'ties career high' : /^Career high/.test(l) ? 'career high' : /^Ties record/.test(l) ? 'ties Cavs record' : /^Cavs record/.test(l) ? 'Cavs record'
      : /most since/.test(m[4]) ? m[4].replace(/^(his|the Cavs’) /, '').replace(/,.*$/, '') : /^Season high/.test(l) ? 'season high' : l.toLowerCase();
    return `${who} ${m[2]} ${st} (${kind})`; });
  if (hi.length) out.push(['Highs', hi.join(' · ')]);
  return out.slice(0, 6);
}
function roast(x) {
  const m = Math.abs(x.cs - x.os), ot = x.qs && x.qs.cle && x.qs.cle.length > 4;
  if (x.win) return ot ? { t: 'DOUBLE SHOT', bg: '#860038', fg: '#FFFFFF', line: 'Needed the extra.' }
    : m >= 15 ? { t: 'DARK ROAST', bg: '#3B2216', fg: '#F2B231', line: 'A strong brew.' }
    : m >= 6 ? { t: 'MEDIUM ROAST', bg: '#A9744A', fg: '#FFFFFF', line: 'Smooth W.' }
    : { t: 'LIGHT ROAST', bg: '#E9D6BE', fg: '#101419', line: 'Light, but still a W.' };
  return m >= 15 ? { t: 'BURNT', bg: '#101419', fg: '#B9B2A8', line: 'Dump it and brew again.' }
    : { t: 'DECAF', bg: '#E3E5E0', fg: '#101419', line: 'Fresh pot tomorrow.' };
}
function coffeeBox(x, P, cell) {
  const CO = '#6B3E26', PAPER = '#FFFDF8', r = roast(x);
  const chip = `<div style="margin-top:6px"><span style="display:inline-block;background:${r.bg};color:${r.fg};font:800 10px ${F.sans};letter-spacing:1.4px;padding:4px 8px">${r.t}</span></div>`;
  const img = (f, w) => `<img src="${SITE}/nl/${f}.png" width="${w}" alt="" style="display:block;width:${w === '100%' ? '100%' : w + 'px'};height:auto;border:0;margin:0 auto">`;
  const cav = (bg, fg, sub, dim, pad) => `<td width="50%" align="center" valign="top" bgcolor="${bg}" style="background:${bg};padding:${pad}"><div style="font:800 20px/1 ${F.cond};color:${fg}">CLE</div><div style="font:700 36px/1.15 ${F.mono};color:${dim ? '#9A948B' : fg}">${x.cs}</div><div style="font:11px ${F.sans};color:${sub}">Cavaliers</div>${chip}</td>`;
  const opp = (pad) => cell(x.g[1], x.os, !x.win, NICK[x.g[1]] || '').replace('<td ', '<td valign="top" ').replace('padding:10px 0 9px;', `padding:${pad};`).replace(/border-bottom:4px solid [^;]+;/, '');
  const box = rows => T(rows, `bgcolor="${PAPER}" style="border:2px solid ${P.ink};background:${PAPER};border-collapse:collapse"`);
  if (x.win) return box(`<tr><td width="50%" style="padding:6px 0 0">${img('steam', 42)}</td><td width="50%"></td></tr><tr><td width="50%" style="padding:0;line-height:0;font-size:0">${img('crema', '100%')}</td><td width="50%"></td></tr><tr>${cav(CO, PAPER, '#E9D6BE', false, '2px 0 10px')}${opp('2px 0 10px')}</tr>`);
  return box(`<tr>${cav(PAPER, '#9A948B', P.muted, true, '16px 0 2px')}${opp('16px 0 2px')}</tr><tr><td width="50%" bgcolor="${PAPER}" style="background:${PAPER};padding:0 10px 6px;line-height:0;font-size:0">${img('ring', '100%')}</td><td></td></tr>`)
    + T(`<tr><td width="50%" style="padding:0 0 0 2px;line-height:0;font-size:0"><img src="${SITE}/nl/drip.png" width="100%" alt="" style="display:block;width:100%;height:auto;border:0;margin-top:-3px"></td><td width="50%"></td></tr>`);
}

/* ========== Sports Page: old school newspaper, double rules, condensed heads, boxed linescore ========== */
/* Type scale (Nov 3 audit), every section follows it:
   section heads 21px condensed caps · kickers 10px bold caps, wine, 1.4px tracking · main list text 14px (reads, press play,
   transactions, this week, standings) · detail text 12.5px (The Pour, Charge corner, injury report, media line, stat of the night)
   · fine print 12px muted (meta lines, last meeting, Around the East, trivia note and answer) · coffee break 13.5px serif. */
function renderSports(x) {
  const P = { bg: '#F7F3EC', dot: '#B9B2A8', wine: '#860038', ink: '#101419', fg2: '#2F363E', muted: '#5D646C' };
  const K = (t, link, sz) => `<tr><td style="padding:24px 14px 0">${T(`<tr><td style="font:800 ${sz || 21}px/1 ${F.cond};text-transform:uppercase;color:${P.ink};padding-bottom:6px;border-bottom:3px solid ${P.ink}">${t}</td><td align="right" valign="bottom" style="padding-bottom:6px;border-bottom:3px solid ${P.ink};font:700 13px ${F.sans};white-space:nowrap">${link ? `<a href="${link[1]}" style="color:#860038;text-decoration:none">${link[0]} &rarr;</a>` : ''}</td></tr>`)}</td></tr>`;
  const B = inner => `<tr><td style="padding:8px 14px 0">${inner}</td></tr>`;
  const li = (main, o = {}) => T(`<tr>${o.left ? `<td width="${o.lw || 86}" valign="baseline" style="vertical-align:baseline;padding:${o.sm ? '6px 8px 6px 0;font:700 10px/18px' : '8px 8px 8px 0;font:700 11.5px/20px'} ${F.mono};color:${P.muted};white-space:nowrap">${o.left}</td>` : ''}<td valign="baseline" style="vertical-align:baseline;padding:${o.sm ? '6px 0;font:12.5px/18px' : '8px 0;font:14px/20px'} ${F.sans};color:${P.ink}">${main}${o.meta ? `<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${o.meta}</div>` : ''}</td></tr>`, `style="border-bottom:1px dotted ${P.dot}"`);
  const a = (h, t) => `<a href="${esc(h)}" style="color:${P.ink};font-weight:700;text-decoration:none">${t}</a>`;
  const s = [];
  s.push(`<tr><td style="padding:12px 14px 0"><div style="border-bottom:3px double ${P.ink};padding-bottom:9px;text-align:center;font:700 11px ${F.mono};letter-spacing:1px;color:${P.ink}"><span style="color:${P.wine}">&gt;</span> ${esc(new Date(x.issueDay + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase())}${x.test ? ' · <span style="color:#C8102E">TEST</span>' : ''}</div><div style="height:2px;background:#F2B231;margin-top:2px;font-size:0;line-height:0">&nbsp;</div></td></tr>`);
  /* Nov 1: history and trivia as one compact "coffee break" card, so the game stays the headline (small kickers, no drop cap) */
  { const kick = t => `<div style="font:800 10px ${F.sans};letter-spacing:1.4px;text-transform:uppercase;color:${P.wine};margin-bottom:3px">${t}</div>`;
    const rows = [];
    if (x.otd) rows.push(kick('This day in Cavs history · ' + esc(x.otd[1])) + `<div style="font:13.5px/1.45 ${F.serif};color:${P.ink}">${esc(x.otd[2])}</div>`);
    if (x.tq) rows.push(`<div style="display:inline-block;max-width:100%">${kick('Daily trivia')}<div style="font:13.5px/1.45 ${F.serif};color:${P.ink}">${esc(x.tq.q)}</div><div style="width:0;min-width:100%;font:12.5px/1.6 ${F.sans};color:${P.ink};margin-top:3px">${[0, 1, 2, 3].map(k => `<span style="white-space:nowrap;margin-right:12px"><b style="color:${P.wine};font-family:${F.mono}">${'ABCD'[k]}</b>&nbsp;${esc(x.tq.c[k] ?? '')}</span>`).join(' ')}<span style="float:right;font:italic 10px/2.4 ${F.sans};color:#9A948B">Answer at the bottom</span></div></div>`);
    if (rows.length) s.push(`<tr><td style="padding:16px 14px 0">${T(rows.map((r, k) => `<tr><td style="padding:${k ? '10px' : '0'} 0 ${k === rows.length - 1 ? '0' : '10px'};${k < rows.length - 1 ? `border-bottom:1px dotted ${P.dot};` : ''}">${r}</td></tr>`).join(''))}</td></tr>`); }
  // last game: boxed linescore, winner reversed out in ink
  const cell = (ab, pts, won, nm) => `<td width="50%" align="center" style="padding:10px 0 9px;${won ? 'border-bottom:4px solid #F2B231;' : 'border-bottom:4px solid transparent;'}"><div style="font:800 20px/1 ${F.cond};color:${P.ink}">${ab}</div><div style="font:700 36px/1.15 ${F.mono};color:${won ? P.ink : '#9A948B'}">${pts}</div><div style="font:11px ${F.sans};color:${P.muted}">${esc(nm)}</div></td>`;
  s.push(K(x.preseason ? 'Last game · preseason' : 'Last game' + (x.hasRec ? ` · ${x.w}–${x.l}` : ''), ['Box score', esc(x.boxLink)]));
  s.push(B(`${coffeeBox(x, P, cell)}${x.qs ? lineScore(x, P) : ''}
${x.notes && x.notes.length ? `<div style="margin-top:14px"><div style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine};padding-bottom:2px">THE POUR</div>${x.notes.map(([l, t]) => li(esc(t).split(' · ').map(z => z.length < 34 ? `<span style="white-space:nowrap">${z}</span>` : z).join(' · '), { left: esc(l.toUpperCase()), lw: 88, sm: 1 })).join('')}</div>` : x.tn ? `<div style="font:14px/1.5 ${F.serif};color:${P.fg2};margin-top:10px">${esc(x.tn)} led the Cavs with ${esc(x.tl || '')}.</div>` : ''}${x.sotn ? `<div style="font:12.5px/1.5 ${F.sans};color:${P.fg2};margin-top:6px"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">STAT OF THE NIGHT</b>&nbsp; ${x.sotn[1]} ${esc(x.sotn[2])} from <a href="${SITE}/players/${pslug(x.sotn[0])}" style="color:${P.ink};font-weight:700;text-decoration:none;border-bottom:2px solid #F2B231">${esc(x.sotn[0].split(' ').slice(-1)[0])}</a>, ${esc(x.sotn[3])} above his average</div>` : ''}`));
  /* email can't play video (Gmail and Outlook strip players), so this is built to look like one: the video's own frame plus a player bar; a tap opens it on YouTube */
  if (x.hl && x.hl.id) s.push(`<tr><td style="padding:12px 14px 0"><a href="${esc(x.hl.link)}" style="text-decoration:none"><img src="https://i.ytimg.com/vi/${esc(x.hl.id)}/hq720.jpg" width="572" alt="Play the full game highlights" style="display:block;width:100%;height:auto;border:0">${T(`<tr><td bgcolor="#101419" style="background:#101419;padding:10px 12px;font:800 13px ${F.sans};letter-spacing:.5px;color:#FFFFFF"><span style="display:inline-block;background:#C8102E;color:#FFFFFF;padding:3px 9px;margin-right:8px">&#9654;</span>PLAY HIGHLIGHTS</td><td bgcolor="#101419" align="right" style="background:#101419;padding:10px 12px;font:12px ${F.sans};color:#B9B2A8;white-space:nowrap">${x.hl.src === 'Cavs' ? 'Cavs' : 'NBA'} on YouTube</td></tr>`)}</a></td></tr>`);
  if (x.hl || x.recap) s.push(B(`${x.hl && !x.hl.id ? li(a(x.hl.link, '&#9654;&nbsp; Full game highlights'), { meta: x.hl.nba ? 'NBA.com' : 'NBA · YouTube' }) : ''}${x.recap ? li(a(x.recap.link, esc(x.recap.title)), { meta: 'RealCavsFans recap' }) : ''}`));
  if (x.shot) s.push(B(`<div style="border-left:3px solid #F2B231;background:#FFFDF8;padding:9px 12px;margin-top:6px;font:14px/1.5 ${F.serif};color:${P.ink}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">ESPRESSO SHOT</b>&nbsp; ${(() => { let t = esc(x.shot); const nm = (x.names || []).find(n => t.includes(esc(n))); return nm ? t.replace(esc(nm), `<a href="${SITE}/players/${pslug(nm)}#ch-his" style="color:${P.ink};font-weight:700;text-decoration:none;border-bottom:2px solid #F2B231">${esc(nm)}</a>`) : t; })()}</div>`));
  if (x.nx) {
    const n = x.nx;
    s.push(K(n.tonight ? 'Tonight' : 'Up next', ['Preview', `${SITE}/games/${n.slug}`]), B(`<div style="font:800 26px/1 ${F.cond};color:${P.ink}"><span style="color:${P.wine}">CLE</span> ${n.home ? 'vs' : 'at'} ${n.o}</div><div style="font:12.5px ${F.sans};color:${P.muted};margin:4px 0 4px">${esc(short(n.date))} · ${esc(n.tip)} PM ET${n.tv ? ' · ' + esc(n.tv) : ''} · ${esc(n.radio)}</div>`));
    if (x.meet) { const mt = x.meet; s.push(B(`<div style="font:12px/1.4 ${F.sans};color:${P.muted};margin:-4px 0 8px"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">LAST MEETING</b>&nbsp; ${esc(short(mt.d).replace(/^\w+, /, ''))} · ${esc(mt.res.replace(' ', ', '))}</div>`)); }
    if (x.tape.length) s.push(B(T(`<tr><td style="padding:4px 0;font:800 14px ${F.cond};color:${P.wine}">CLE</td><td align="center" style="font:700 10px ${F.sans};letter-spacing:1.4px;color:${P.muted}">${n.season} · RANK</td><td align="right" style="font:800 14px ${F.cond};color:${P.ink}">${n.o}</td></tr>` + x.tape.map(([lab, a1, r1, b1, r2]) => `<tr><td style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 13.5px ${F.mono};color:${P.wine}">${a1} <span style="font:400 11px ${F.sans};color:${P.muted}">${r1}</span></td><td align="center" style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 10px ${F.sans};letter-spacing:1.4px;text-transform:uppercase;color:${P.muted}">${lab}</td><td align="right" style="padding:5px 0;border-top:1px dotted ${P.dot};font:700 13.5px ${F.mono}"><span style="font:400 11px ${F.sans};color:${P.muted}">${r2}</span> ${b1}</td></tr>`).join(''))));
    if (x.inj.length) s.push(B(`<div style="font:12.5px/1.55 ${F.sans};color:${P.fg2};padding-top:6px;border-top:1px dotted ${P.dot}"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">${x.injNote ? esc(x.injNote.toUpperCase()) + ':' : 'INJURIES'}</b>&nbsp; ${x.inj.map(([nm, what, st]) => `${esc(nm)} (${esc(what)}, ${esc(st.toLowerCase())})`).join(' · ')}${x.gl && x.gl.length ? `<br><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">G LEAGUE ASSIGNMENT:</b>&nbsp; ${x.gl.map(esc).join(' · ')}` : ''}</div>`));
  }
  if (x.stand.length) s.push(K('East standings'), B(T(x.stand.map(([rk, nm, wl, gb, me]) => `<tr><td width="26" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 12px ${F.mono};color:${P.muted}">${rk}</td><td style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:${me ? 700 : 400} 14px ${F.sans};color:${me ? P.wine : P.ink}">${esc(nm)}</td><td align="right" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 13.5px ${F.mono};color:${me ? P.wine : P.ink}">${wl}</td><td width="46" align="right" style="padding:6px 0;border-bottom:1px dotted ${P.dot};font:700 12.5px ${F.mono};color:${P.muted}">${gb}</td></tr>`).join(''))));
  if (x.around.length) s.push(B(`<div style="font:12px/1.6 ${F.sans};color:${P.fg2};padding-top:8px"><b style="font:800 10px ${F.sans};letter-spacing:1.4px;color:${P.wine}">AROUND THE EAST LAST NIGHT</b>&nbsp; ${x.around.map(t => `<span style="white-space:nowrap">${t}</span>`).join(' · ')}</div>`));
  if (x.reads.length) s.push(K('Morning reads'), B(x.reads.map(r => li(a(r.link, esc(r.title)), { meta: `${esc(r.src)} · ${esc(md2(r.date.slice(0, 10)))}` })).join('')));
  if (x.play.length) s.push(K('Press play'), B(x.play.map(p => T(`<tr><td width="24" valign="top" style="padding:9px 0;font:14px ${F.sans};color:${P.wine}">${p.kind === 'video' ? '&#9654;' : '&#127911;'}</td><td valign="top" style="padding:8px 0;font:14px/1.45 ${F.sans}">${a(p.link, esc(p.title))}<div style="font:12px ${F.sans};color:${P.muted};margin-top:2px">${esc(p.src)}${p.dur ? ' · ' + esc(p.dur) : ''} · ${esc(md2(p.date.slice(0, 10)))}</div></td></tr>`, `style="border-bottom:1px dotted ${P.dot}"`)).join('')));
  if (x.moves.length) s.push(K('Transactions'), B(x.moves.map(([d, t]) => li(esc(t), { left: esc(d), lw: 60 })).join('')));
  /* Charge corner: every line one size. A result shows when the Charge played since the last Cavs game, with their next game
     under it if it's within a week; with no new result, just the next game (within a week); neither, no section. */
  if (x.ch) { const c = x.ch, wd = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', ''), o = (d, extra) => ({ left: esc(wd(d)), lw: 88, sm: 1, ...extra });
    const nx = n => `${n.first ? 'Season opener, ' : ''}${n.ha === 'H' ? 'vs' : 'at'} ${esc(n.o)} <span style="color:${P.muted}">· ${esc(n.t)} PM${n.venue ? ' · ' + esc(n.venue) : ''}</span>`;
    const asg = c.assign.length && !c.lines.length ? `<div style="color:${P.muted}">On assignment: ${c.assign.map(esc).join(', ')}</div>` : '';
    const rows = c.kind === 'res'
      ? li(`${c.box ? `<a href="${esc(c.box)}" style="color:${P.ink};font-weight:700;text-decoration:none;border-bottom:1px solid #F2B231">${esc(c.res)}</a>` : `<b>${esc(c.res)}</b>`} <span style="color:${P.muted}">(${esc(c.rec)})</span>${c.lines.map(([nm, p, r, a2, mi]) => `<div style="padding-top:2px">${esc(nm)} ${p} pts, ${r} reb, ${a2} ast <span style="color:${P.muted}">· ${mi} min</span></div>`).join('')}${asg}`, o(c.d)) + (c.nx ? li(nx(c.nx), o(c.nx.d)) : '')
      : li(nx(c) + asg, o(c.d));
    x.chRows = rows; }
  /* Nov 5 (Luka): Prospect pipeline replaces Charge corner: the Charge plus the drafted players, like the home page */
  if (x.chRows || x.drafted.length) { const sub = (t, link) => `<tr><td style="padding:14px 0 2px;font:800 13px ${F.cond};letter-spacing:1px;text-transform:uppercase;color:${P.wine}">${t}${link ? ` <a href="${link[1]}" style="float:right;font:700 12.5px ${F.sans};letter-spacing:0;text-transform:none;color:${P.wine};text-decoration:none">${link[0]} &rarr;</a>` : ''}</td></tr>`;
    const dd = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const drow = r => { const v = (k, n) => n == null ? '' : `<td style="padding:0 12px 0 0;white-space:nowrap"><b style="font:700 13.5px ${F.mono};color:${P.ink}">${n}</b> <span style="font:700 9.5px ${F.sans};letter-spacing:1px;color:${P.muted}">${k}</span></td>`;
      return `<tr><td style="padding:9px 0;border-bottom:1px dotted ${P.dot}"><div style="font:700 14px ${F.sans};color:${P.ink}">${esc(r.n)} <span style="font:700 10px ${F.sans};letter-spacing:1px;text-transform:uppercase;color:${P.muted}">${esc(r.team)}</span></div>
        <div style="font:12.5px ${F.sans};color:${P.muted};margin:2px 0 5px">${esc(dd(r.d))} ${r.ha === 'A' ? 'at' : 'vs'} ${esc(r.opp)} · ${r.url ? `<a href="${esc(r.url)}" style="color:${P.ink};font-weight:700;text-decoration:none;border-bottom:1px solid #F2B231">${esc(r.res)}</a>` : `<b style="color:${P.ink}">${esc(r.res)}</b>`}</div>
        ${T(`<tr>${v('PTS', r.st.pts)}${v('REB', r.st.reb)}${v('AST', r.st.ast)}${v('STL', r.st.stl)}${v('BLK', r.st.blk)}<td width="100%"></td></tr>`, 'style="width:auto"')}</td></tr>`; };
    s.push(K('Prospect pipeline'), B(T((x.chRows ? sub('Cleveland Charge', ['Charge', `${SITE}/charge`]) + `<tr><td>${x.chRows}</td></tr>` : '') + (x.drafted.length ? sub('Drafted players', ['All drafted', `${SITE}/assets#rights`]) + x.drafted.map(drow).join('') : '')))); }
  if (x.week.length) s.push(K('This week'), B(x.week.map(([wd, d, t]) => li(esc(t), { left: `${esc(wd)} ${esc(d)}`, lw: 96 })).join('')));
  if (x.tq) s.push(`<tr><td style="padding:14px 14px 0;text-align:center;font:italic 12px ${F.sans};color:${P.muted}">Trivia answer: ${String.fromCharCode(65 + x.tq.a)}. ${esc(x.tq.c[x.tq.a])}</td></tr>`);
  /* pass it on: the referral link now lives in the footer (Nov 1) */
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

/* Nov 1: an early run used to build the issue at ~5:15 and then sit for an hour, so anything posted before 6:19 missed
   Morning reads and Press play. Now, on a game morning, it waits first, then pulls the latest data (news, videos, box
   scores, injury report) about 8 minutes before 6:19, and builds from that. Mornings with no game still exit at once. */
if (MODE === 'auto' && LIVE && !DRY) {
  const yd = etDate(new Date(Date.now() - 864e5));
  let src = ''; try { src = await readFile(new URL('index.html', root), 'utf8'); } catch {}
  const wait = msTo619() - 8 * 60000;
  if (src.includes(`['${yd}',`) && !sent[yd] && wait > 60000) {
    console.log('game morning: waiting ' + Math.round(wait / 60000) + ' min, then building from the latest data');
    await new Promise(r => setTimeout(r, wait));
    try { execSync('git pull -q --ff-only origin main', { stdio: 'inherit' }); } catch (e) { console.log('::warning::could not pull the latest main; building from this checkout'); }
    try { sent = JSON.parse(await readFile(sentFile, 'utf8')); } catch {}
  }
}

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
const sinceTs = process.env.NL_SINCE ? Date.parse(process.env.NL_SINCE) : lastSent ? Date.parse(lastSent) : Date.parse(since + 'T12:00:00Z');   // NL_SINCE: dry runs only, to rebuild an issue as it looked when sent
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
let ourBox = preseason ? (b.url || D.box[g[0]] || SITE + '/schedule') : `${SITE}/games/${g[0]}-${String(g[1]).toLowerCase()}`;
/* Nov 5 (Luka): Box score opens the live game page's box score (players tab) when the game is in the live archive */
if (!preseason) { try { const y = +g[0].slice(0, 4), mo = +g[0].slice(5, 7), s0 = mo >= 8 ? y : y - 1, se = s0 + '-' + String(s0 + 1).slice(2);
  const IX = JSON.parse(await readFile(new URL(`live-archive/${se}/index.json`, root), 'utf8')); const hit = IX.find(z => etDate(new Date(z.date)) === g[0]);
  if (hit) ourBox = `${SITE}/live.html?g=a${se}:${hit.id}&tab=players`; } catch {} }
const html = build(D, g, score, b.top || '', ourBox, { issueDay: today, boxRows: b.box, rcf, news, trivia: tq, since, sinceTs, qs: b.qs, milestone: milestone(), sotn, usedOtd: Object.values(sent).map(v => v.otd).filter(Boolean).slice(-60), test: !(LIVE && MODE !== 'test'), preseason });
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
  /* Nov 1: two runs both sent. A run checks out the repo as it was when it was triggered, so a run that waited behind another
     never saw the first run's record. Right before sending, read the latest record from GitHub and ask Buttondown what went out today. */
  let dup = false;
  try { execSync('git fetch -q origin main'); const fresh = JSON.parse(execSync('git show origin/main:data/newsletter-sent.json', { encoding: 'utf8' })); if (fresh[g[0]]?.live) dup = true; } catch (e) { console.log('could not re-read the sent record:', String(e).slice(0, 120)); }
  try { const L = await bd('/emails?ordering=-publish_date&page_size=10', 'GET'); if ((L.results || []).some(x => x.id !== email.id && x.subject === subj && /sent|about_to_send|in_flight|scheduled/.test(x.status || ''))) dup = true; } catch (e) { console.log('could not list Buttondown emails:', String(e).slice(0, 120)); }
  if (dup) { console.log('already sent by another run; deleting this draft'); try { await bd('/emails/' + email.id, 'DELETE'); } catch {} process.exit(0); }
  await bd('/emails/' + email.id, 'PATCH', { status: 'about_to_send' });
  console.log('sent to subscribers');
} else {
  await bd('/emails/' + email.id + '/send-draft', 'POST', {});
  console.log('test copy sent to the newsletter owner');
}
if (MODE === 'auto' || MODE === 'now') { sent[g[0]] = { id: email.id, live: LIVE, at: new Date().toISOString(), otd: otdKey }; await writeFile(sentFile, JSON.stringify(sent, null, 1) + '\n'); }
