// Saves a fully drawn copy of each page's main section into its page file (cap.html, schedule.html …, and
// home.html for the front page), so search engines see the real text without running the site's script.
// The original empty section is kept in a <template>; the site's script swaps it back in and redraws on load,
// so visitors get exactly the same page. Also adds per-page structured data (breadcrumbs, games, players).
// Called by build-pages.mjs --prerender (the GitHub Action). Needs Playwright or playwright-core + Chrome.
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname } from 'node:path';

const require = createRequire(import.meta.url);
const loadPw = () => { for (const m of ['playwright', 'playwright-core']) { try { return require(m); } catch {} } return null; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const NICK = { ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls', CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons', GSW: 'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'LA Clippers', LAL: 'Los Angeles Lakers', MEM: 'Memphis Grizzlies', MIA: 'Miami Heat', MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves', NOP: 'New Orleans Pelicans', NYK: 'New York Knicks', OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns', POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards' };
const SITE = 'https://cavsdatabase.com';
/* home city of each team, for the game listings' location (search engines require one for events) */
const CITY = { ATL: ['Atlanta', 'GA', 'US'], BOS: ['Boston', 'MA', 'US'], BKN: ['Brooklyn', 'NY', 'US'], CHA: ['Charlotte', 'NC', 'US'], CHI: ['Chicago', 'IL', 'US'], CLE: ['Cleveland', 'OH', 'US'], DAL: ['Dallas', 'TX', 'US'], DEN: ['Denver', 'CO', 'US'], DET: ['Detroit', 'MI', 'US'], GSW: ['San Francisco', 'CA', 'US'], HOU: ['Houston', 'TX', 'US'], IND: ['Indianapolis', 'IN', 'US'], LAC: ['Inglewood', 'CA', 'US'], LAL: ['Los Angeles', 'CA', 'US'], MEM: ['Memphis', 'TN', 'US'], MIA: ['Miami', 'FL', 'US'], MIL: ['Milwaukee', 'WI', 'US'], MIN: ['Minneapolis', 'MN', 'US'], NOP: ['New Orleans', 'LA', 'US'], NYK: ['New York', 'NY', 'US'], OKC: ['Oklahoma City', 'OK', 'US'], ORL: ['Orlando', 'FL', 'US'], PHI: ['Philadelphia', 'PA', 'US'], PHX: ['Phoenix', 'AZ', 'US'], POR: ['Portland', 'OR', 'US'], SAC: ['Sacramento', 'CA', 'US'], SAS: ['San Antonio', 'TX', 'US'], TOR: ['Toronto', 'ON', 'CA'], UTA: ['Salt Lake City', 'UT', 'US'], WAS: ['Washington', 'DC', 'US'] };
/* when each page's content last changed: daily data (SITE_UPDATED), plus newest video/article for Media and Home, newest final score for Schedule and Home */
let MODCTX = null;
const etDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
const MOD = route => { if (!MODCTX) return ''; const { upd, vid, art, score } = MODCTX; const pick = (...a) => a.filter(Boolean).sort().pop() || '';
  return route === 'home' ? pick(upd, vid, art, score) : route === 'media' ? pick(upd, vid, art) : route === 'schedule' || route.startsWith('games/') ? pick(upd, score) : pick(upd); };
export const modDates = () => MODCTX ? MOD : null;
const LABEL = { 'roster-tree': 'How the roster was built', schedule: 'Schedule', roster: 'Roster', staff: 'Staff', cap: 'Salary cap', assets: 'Assets', moves: 'Transactions', charge: 'Cleveland Charge', media: 'Media', resources: 'Resources' };

const etOffset = d => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(d + 'T17:00:00Z')).find(x => x.type === 'timeZoneName').value; const n = +(p.match(/GMT([+-]\d+)/) || [0, -5])[1]; return (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0') + ':00'; };
const iso = (d, t) => { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return d; let [h, m] = t.split(':').map(x => parseInt(x)); if (!/AM/i.test(t) && h < 12) h += 12; return `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${etOffset(d)}`; };
const team = a => ({ '@type': 'SportsTeam', name: NICK[a] || a });
const game = g => { const [d, o, ha, t] = g; const home = ha === 'H' ? 'CLE' : o, away = ha === 'H' ? o : 'CLE';
  const e = { '@type': 'SportsEvent', name: `${NICK[away]} at ${NICK[home]}`, sport: 'Basketball', startDate: iso(d, t), eventStatus: 'https://schema.org/EventScheduled', homeTeam: team(home), awayTeam: team(away), competitor: [team(away), team(home)] };
  if (ha === 'H') e.location = { '@type': 'Place', name: 'Rocket Arena', address: { '@type': 'PostalAddress', streetAddress: '1 Center Court', addressLocality: 'Cleveland', addressRegion: 'OH', postalCode: '44115', addressCountry: 'US' } };
  else { const c = CITY[o]; if (c) e.location = { '@type': 'Place', name: `${NICK[o]} home arena, ${c[0]}`, address: { '@type': 'PostalAddress', addressLocality: c[0], addressRegion: c[1], addressCountry: c[2] } }; }
  if (/T/.test(e.startDate)) { const en = new Date(new Date(e.startDate).getTime() + 150 * 60000); const P = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(en).map(x => [x.type, x.value])); const dd = `${P.year}-${P.month}-${P.day}`; e.endDate = `${dd}T${P.hour}:${P.minute}:00${etOffset(dd)}`; }
  e.eventAttendanceMode = 'https://schema.org/OfflineEventAttendanceMode';
  e.description = `${NICK[away]} at ${NICK[home]}, 2026–27 NBA regular season.`;
  e.image = SITE + '/og/schedule.jpg';
  e.organizer = { '@type': 'SportsOrganization', name: 'NBA', url: 'https://www.nba.com' };
  e.performer = [team(away), team(home)];
  e.url = SITE + '/games/' + d + '-' + o.toLowerCase();
  return e; };
/* finished games: add the final score so search engines can show it */
const withScore = (e, g, S) => { const sc = S && S[g[0]]; if (!sc) return e; const [c, o] = sc.split('-'); e.description = `Final: Cleveland Cavaliers ${c}, ${NICK[g[1]]} ${o}`; e.eventStatus = 'https://schema.org/EventScheduled'; return e; };

export default async function prerender(root, META) {
  const pw = loadPw();
  if (!pw) { console.log('::warning::Playwright not available, skipping prerender'); return false; }
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    try { const b = await readFile(new URL('.' + p, root)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  const browser = await pw.chromium.launch(opts);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light', timezoneId: 'America/New_York' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdb-intro', '1'); localStorage.removeItem('cdb-theme'); } catch {} });
  await ctx.route(u => !u.href.startsWith(base), r => r.request().resourceType() === 'image' ? r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }) : r.abort());
  let ok = 0, data = null;
  for (const route of Object.keys(META)) {
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    try {
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      if (route !== 'home') await page.evaluate(r => go(r), route);
      await page.waitForTimeout(1200);
      const snap = await page.evaluate(() => { const m = [...document.querySelectorAll('main[id^="view-"]')].find(x => !x.hidden && x.id !== 'view-stub'); if (!m) return null; const c = m.cloneNode(true); c.querySelectorAll('.xtoast,.gwrap').forEach(x => x.remove()); return { id: m.id, html: c.outerHTML }; });
      if (!data) data = await page.evaluate(() => ({ SCORES, SCHEDULE, PLAYERS: PLAYERS.map(p => p[1]), PL: PLAYERS, UPD: typeof SITE_UPDATED === 'string' ? SITE_UPDATED : '' }));
      if (data && !MODCTX) { const rj = async f => { try { return JSON.parse(await readFile(new URL(f, root), 'utf8')) } catch (e) { return null } };
        const v = await rj('videos.json'), r = await rj('rcf.json'); const sd = Object.keys(data.SCORES || {}).sort().pop();
        MODCTX = { upd: data.UPD, vid: v && v[0] && v[0].published ? etDay(v[0].published) : '', art: r && r.items && r.items[0] && r.items[0].date ? etDay(r.items.map(x => x.date).sort().pop()) : '', score: sd || '' }; }
      if (!snap || errs.length) { console.log('::warning::prerender skipped ' + route + ' ' + errs.join('; ')); continue; }
      const file = new URL((route === 'home' ? 'home' : route) + '.html', root);
      let html = await readFile(file, 'utf8');
      const re = new RegExp(`<main id="${snap.id}"( hidden)?>([\\s\\S]*?)</main>`);
      const mm = html.match(re); if (!mm) { console.log('::warning::no main for ' + route); continue; }
      const tpl = `<template id="pre-tpl" data-view="${snap.id}">${mm[2]}</template>`;
      html = html.replace(re, () => snap.html + tpl);
      if (snap.id !== 'view-home') html = html.replace('<main id="view-home">', '<main id="view-home" hidden>');
      // structured data for this page
      const graph = [];
      const pl = route.startsWith('players/') ? data.PL.find(p => 'players/' + p[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === route) : null;
      if (pl) graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Roster', item: SITE + '/roster' }, { '@type': 'ListItem', position: 3, name: pl[1], item: SITE + '/' + route }] },
        { '@type': 'Person', name: pl[1], url: SITE + '/' + route, image: 'https://cdn.nba.com/headshots/nba/latest/1040x760/' + pl[12] + '.png', jobTitle: 'Basketball player', birthDate: pl[5], ...(pl[3] && pl[3] !== '—' ? { height: pl[3].replace('-', ' ft ') + ' in' } : {}), ...(pl[4] ? { weight: pl[4] + ' lb' } : {}), memberOf: team('CLE'), sameAs: ['https://www.nba.com/player/' + pl[12]] });
      else if (route !== 'home' && !route.startsWith('games/')) graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: LABEL[route] || META[route][0].split(' | ')[0], item: SITE + '/' + route }] });
      const today = etDay(Date.now());
      { const url = SITE + '/' + (route === 'home' ? '' : route); const title = META[route][0], desc = META[route][1];
        graph.unshift({ '@type': 'WebPage', '@id': url + '#page', url, name: title, ...(desc ? { description: desc } : {}), isPartOf: { '@id': SITE + '/#site' }, inLanguage: 'en-US', ...(MOD(route) ? { dateModified: MOD(route) } : {}), primaryImageOfPage: { '@type': 'ImageObject', url: SITE + '/' + (route === 'home' ? 'og.jpg' : 'og/' + (route.startsWith('players/') ? 'roster' : route.replace(/\//g, '-')) + '.jpg') } }); }
      if (route === 'schedule') data.SCHEDULE.forEach(g => graph.push(withScore(game(g), g, data.SCORES)));
      if (route.startsWith('games/')) { const g = data.SCHEDULE.find(x => 'games/' + x[0] + '-' + x[1].toLowerCase() === route); if (g) { const e = withScore(game(g), g, data.SCORES); e.url = SITE + '/' + route; graph.push(e); graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Schedule', item: SITE + '/schedule' }, { '@type': 'ListItem', position: 3, name: META[route][0].split(' | ')[0], item: SITE + '/' + route }] }); } }
      if (route === 'home') { const nx = data.SCHEDULE.find(g => g[0] >= today); if (nx) graph.push(game(nx)); }
      if (route === 'roster') graph.push({ '@type': 'ItemList', name: 'Cleveland Cavaliers roster', itemListElement: data.PLAYERS.map((n, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Person', name: n, jobTitle: 'Basketball player', memberOf: team('CLE') } })) });
      if (graph.length) html = html.replace('</head>', `<script type="application/ld+json" id="ld-page">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>\n</head>`);
      await writeFile(file, html); ok++;
    } finally { await page.close(); }
  }
  // calendar feed (cavs.ics): every game with TV and radio; finished games show the final. Phones that subscribe re-check it every few hours.
  try {
    const page = await ctx.newPage(); await page.goto(base + '/index.html', { waitUntil: 'load' });
    const G = await page.evaluate(() => SCHEDULE.map(g => { const t = tvFor(g[0]), r = radioFor(g[0]); return { d: g[0], o: g[1], ha: g[2], tip: tipOf(g).toISOString(), opp: TEAMS[g[1]], tv: [t.nat, t.loc].filter(Boolean).join(' · '), radio: r.cavs || '', sc: SCORES[g[0]] || '' }; }));
    await page.close();
    const ics = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const dt = iso => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const fold = l => { const o = []; let x = l; while (x.length > 74) { o.push(x.slice(0, 74)); x = ' ' + x.slice(74); } o.push(x); return o.join('\r\n'); };
    const stamp = dt(new Date().toISOString());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cavsdatabase.com//Cavs schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Cavs 2026–27 (cavs_db)', 'X-WR-CALDESC:Every Cavaliers game with TV and radio. From cavsdatabase.com', 'X-WR-TIMEZONE:America/New_York', 'REFRESH-INTERVAL;VALUE=DURATION:PT4H', 'X-PUBLISHED-TTL:PT4H'];
    for (const g of G) {
      const vs = g.ha === 'H' ? 'vs' : 'at'; let sum = `🏀 Cavs ${vs} ${g.opp}`;
      if (g.sc) { const [c, o] = g.sc.split('-').map(Number); sum = `🏀 ${c > o ? 'W' : 'L'} ${c}–${o} ${vs} ${g.opp}`; }
      const desc = [g.tv ? 'TV: ' + g.tv : '', g.radio ? 'Radio: ' + g.radio : '', 'Preview, injuries and how to watch: ' + SITE + '/schedule'].filter(Boolean).join('\n');
      const end = new Date(Date.parse(g.tip) + 2.5 * 36e5).toISOString();
      L.push('BEGIN:VEVENT', 'UID:cavs-' + g.d + '@cavsdatabase.com', 'DTSTAMP:' + stamp, 'DTSTART:' + dt(g.tip), 'DTEND:' + dt(end), fold('SUMMARY:' + ics(sum)), fold('LOCATION:' + ics(g.ha === 'H' ? 'Rocket Arena, Cleveland' : g.opp)), fold('DESCRIPTION:' + ics(desc)), 'URL:' + SITE + '/schedule', 'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    await writeFile(new URL('cavs.ics', root), L.join('\r\n') + '\r\n');
  } catch (e) { console.log('::warning::calendar feed skipped ' + e.message); }
  await browser.close(); server.close();
  console.log('prerendered', ok, 'pages');
  return ok > 0;
}
