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
const LABEL = { schedule: 'Schedule', roster: 'Roster', staff: 'Staff', cap: 'Salary cap', assets: 'Assets', moves: 'Transactions', charge: 'Cleveland Charge', media: 'Media', resources: 'Resources' };

const etOffset = d => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(d + 'T17:00:00Z')).find(x => x.type === 'timeZoneName').value; const n = +(p.match(/GMT([+-]\d+)/) || [0, -5])[1]; return (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0') + ':00'; };
const iso = (d, t) => { if (!t || !/^\d{1,2}:\d{2}/.test(t)) return d; let [h, m] = t.split(':').map(x => parseInt(x)); if (!/AM/i.test(t) && h < 12) h += 12; return `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${etOffset(d)}`; };
const team = a => ({ '@type': 'SportsTeam', name: NICK[a] || a });
const game = g => { const [d, o, ha, t] = g; const home = ha === 'H' ? 'CLE' : o, away = ha === 'H' ? o : 'CLE';
  const e = { '@type': 'SportsEvent', name: `${NICK[away]} at ${NICK[home]}`, sport: 'Basketball', startDate: iso(d, t), eventStatus: 'https://schema.org/EventScheduled', homeTeam: team(home), awayTeam: team(away), competitor: [team(away), team(home)] };
  if (ha === 'H') e.location = { '@type': 'Place', name: 'Rocket Arena', address: { '@type': 'PostalAddress', streetAddress: '1 Center Court', addressLocality: 'Cleveland', addressRegion: 'OH', postalCode: '44115', addressCountry: 'US' } };
  return e; };

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdb-intro', '1'); localStorage.removeItem('cdb-theme'); } catch {} });
  await ctx.route(u => !u.href.startsWith(base), r => r.request().resourceType() === 'image' ? r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }) : r.abort());
  let ok = 0, data = null;
  for (const route of Object.keys(META)) {
    if (route === 'media/rcf') continue; // articles load from rcf.json after the page opens; nothing to bake in
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    try {
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      if (route !== 'home') await page.evaluate(r => go(r), route);
      await page.waitForTimeout(1200);
      const snap = await page.evaluate(() => { const m = [...document.querySelectorAll('main[id^="view-"]')].find(x => !x.hidden && x.id !== 'view-stub'); if (!m) return null; const c = m.cloneNode(true); c.querySelectorAll('.xtoast,.gwrap').forEach(x => x.remove()); return { id: m.id, html: c.outerHTML }; });
      if (!data) data = await page.evaluate(() => ({ SCHEDULE, PLAYERS: PLAYERS.map(p => p[1]) }));
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
      if (route !== 'home') graph.push({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: LABEL[route] || META[route][0].split(' | ')[0], item: SITE + '/' + route }] });
      const today = new Date().toISOString().slice(0, 10);
      if (route === 'schedule') data.SCHEDULE.forEach(g => graph.push(game(g)));
      if (route === 'home') { const nx = data.SCHEDULE.find(g => g[0] >= today); if (nx) graph.push(game(nx)); }
      if (route === 'roster') graph.push({ '@type': 'ItemList', name: 'Cleveland Cavaliers roster', itemListElement: data.PLAYERS.map((n, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Person', name: n, jobTitle: 'Basketball player', memberOf: team('CLE') } })) });
      if (graph.length) html = html.replace('</head>', `<script type="application/ld+json" id="ld-page">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>\n</head>`);
      await writeFile(file, html); ok++;
    } finally { await page.close(); }
  }
  await browser.close(); server.close();
  console.log('prerendered', ok, 'pages');
  return ok > 0;
}
