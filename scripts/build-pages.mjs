// Writes one copy of index.html per page (cap.html, schedule.html, media/rcf.html …) with that page's
// title, description, canonical address and share tags baked in, so search engines and link previews
// see the right details without running the site's script. The pages are otherwise identical to index.html.
// Run by .github/workflows/videos.yml; safe to run any time.
// With --prerender (the Action): skips everything if nothing changed since the last prerender, otherwise also
// writes home.html, bakes each page's drawn content in (scripts/prerender.mjs) and refreshes sitemap.xml dates.
// Without it (the daily task, local edits): plain copies only; the Action prerenders them on its next run.
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// the player pages read franchise lists from /pdata (the /data folder isn't served); keep the copy current
try { const { copyFileSync, mkdirSync } = await import('node:fs'); mkdirSync(new URL('../pdata/', import.meta.url), { recursive: true }); copyFileSync(new URL('../data/milestones.json', import.meta.url), new URL('../pdata/milestones.json', import.meta.url)); } catch (e) { console.warn('milestones copy skipped:', e.message); }
const exists = async u => { try { await stat(u); return true; } catch { return false; } };
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const PRE = process.argv.includes('--prerender');
const HASHF = new URL('data/prerender-hash.txt', root);
const h = createHash('sha1');
for (const f of ['index.html', 'videos.json', 'box.json', 'rcf.json', 'pdata/history.json', 'scripts/build-pages.mjs', 'scripts/prerender.mjs']) { try { h.update(await readFile(new URL(f, root))); } catch {} }
try { const { readdir } = await import('node:fs/promises'); h.update((await readdir(new URL('og/g/', root))).sort().join()); } catch {}  // a new game share image means the page copies need the new image tag
const hash = h.digest('hex');
if (PRE) { let old = ''; try { old = (await readFile(HASHF, 'utf8')).trim(); } catch {} if (old === hash) { console.log('pages unchanged, nothing to build'); process.exit(0); } }
const m = html.match(/const PAGE_META=(\{[\s\S]*?\});\n/);
if (!m) { console.log('::warning::PAGE_META not found'); process.exit(0); }
const META = Function('return ' + m[1])();
// one page per player (players/<name>), titles matching the site's PP_TITLE / PP_DESC
const pm = html.match(/const PLAYERS=(\[[\s\S]*?\]);\n/);
const slug = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (pm && /const PP_ON=true/.test(html)) for (const p of Function('return ' + pm[1])()) META['players/' + slug(p[1])] = [p[1] + ' Stats, Contract & Injury Status | cavs_db', p[1] + '’s stats with context, injury status, contract and trade eligibility, and where he ranks in Cavs history. Updated after every game.'];
// one page per Cavs season (history/1970-71 … ), titles matching the site's season page
try { const HJ = JSON.parse(await readFile(new URL('pdata/history.json', root), 'utf8')); for (const x of HJ.seasons) { const sl = x.s.replace('–', '-');
  META['history/' + sl] = [x.s + ' Cleveland Cavaliers: Record, Playoffs, Roster & Leaders | cavs_db', 'The ' + x.s + ' Cavaliers went ' + x.w + '–' + x.l + ' (' + x.div + '). ' + x.po + '. Season leaders, honors, coaches, key moves and the full roster.']; } } catch {}
// one page per regular-season game (games/<date>-<opp>), titles matching the site's GAME_META
{ const sm = html.match(/const SCHEDULE=(\[[\s\S]*?\]);\n/), scm = html.match(/const SCORES=(\{[^;]*\});/), rm = html.match(/const SEASON=\{results:'([WL]*)'/);
  const NK = {ATL:'Hawks',BOS:'Celtics',BKN:'Nets',CHA:'Hornets',CHI:'Bulls',DAL:'Mavericks',DEN:'Nuggets',DET:'Pistons',GSW:'Warriors',HOU:'Rockets',IND:'Pacers',LAC:'Clippers',LAL:'Lakers',MEM:'Grizzlies',MIA:'Heat',MIL:'Bucks',MIN:'Timberwolves',NOP:'Pelicans',NYK:'Knicks',OKC:'Thunder',ORL:'Magic',PHI:'76ers',PHX:'Suns',POR:'Trail Blazers',SAC:'Kings',SAS:'Spurs',TOR:'Raptors',UTA:'Jazz',WAS:'Wizards'};
  const CITY = {ATL:'Atlanta',BOS:'Boston',BKN:'Brooklyn',CHA:'Charlotte',CHI:'Chicago',DAL:'Dallas',DEN:'Denver',DET:'Detroit',GSW:'Golden State',HOU:'Houston',IND:'Indiana',LAC:'LA',LAL:'Los Angeles',MEM:'Memphis',MIA:'Miami',MIL:'Milwaukee',MIN:'Minnesota',NOP:'New Orleans',NYK:'New York',OKC:'Oklahoma City',ORL:'Orlando',PHI:'Philadelphia',PHX:'Phoenix',POR:'Portland',SAC:'Sacramento',SAS:'San Antonio',TOR:'Toronto',UTA:'Utah',WAS:'Washington'};
  if (sm) { const S = Function('return ' + sm[1])(), SC = scm ? Function('return ' + scm[1])() : {}, R = rm ? rm[1] : '';
    S.forEach((g, i) => { const [d, o, ha] = g; const dl = new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); const nk = NK[o] || o, sc = SC[d];
      META['games/' + d + '-' + o.toLowerCase()] = (R[i] && sc) ? ['Cavs ' + sc.split('-')[0] + ', ' + nk + ' ' + sc.split('-')[1] + ' (' + dl + '): Box Score & Recap | cavs_db', 'Final: Cavaliers ' + sc.split('-')[0] + ', ' + CITY[o] + ' ' + nk + ' ' + sc.split('-')[1] + ' on ' + dl + '. Box score, top performers, postgame video and recap.']
        : ['Cavs ' + (ha === 'H' ? 'vs ' : 'at ') + nk + ', ' + dl + ': How to Watch, Preview & Injuries | cavs_db', 'Cavaliers ' + (ha === 'H' ? 'vs ' : 'at ') + CITY[o] + ' ' + nk + ' on ' + dl + ': tip time, TV and radio, tale of the tape, injuries and the season series.']; }); } }
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
await writeFile(new URL('home.html', root), html); // front page copy (served at / via _redirects)
for (const [route, [title, desc]] of Object.entries(META)) {
  if (route === 'home') continue;
  const url = 'https://cavsdatabase.com/' + route;
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
  // each page has its own share image in og/<route>.jpg (media/rcf -> og/media-rcf.jpg); fall back to the site-wide one
  let img = 'og/' + (route.startsWith('players/') ? 'roster' : route.startsWith('games/') ? 'schedule' : route.replace(/\//g, '-')) + '.jpg';
  if (route.startsWith('games/') && await exists(new URL('og/g/' + route.slice(6) + '.jpg', root))) img = 'og/g/' + route.slice(6) + '.jpg';  // finished games get their own score card (scripts/og-games.mjs)
  if (await exists(new URL(img, root))) {
    const u = 'https://cavsdatabase.com/' + img + '?v=2';
    out = out.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${u}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${u}">`)
      .replace(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(title)}">`);
  }
  const file = new URL(route + '.html', root);
  await mkdir(new URL('./', file), { recursive: true });
  await writeFile(file, out);
}
// embeddable widgets: /embed/cap and /embed/schedule (kept out of search; the main pages are canonical)
await mkdir(new URL('embed/', root), { recursive: true });
for (const [k, r] of [['cap', 'cap'], ['schedule', 'schedule']]) {
  const e = html.replace('<head>', `<head>\n<script>window.CDB_EMBED='${k}'</script>\n<meta name="robots" content="noindex">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="https://cavsdatabase.com/${r}">`);
  await writeFile(new URL('embed/' + k + '.html', root), e);
}
console.log('built', Object.keys(META).length, 'pages');
if (PRE) {
  const { default: prerender, modDates } = await import('./prerender.mjs');
  if (await prerender(root, META)) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const urls = Object.keys(META).map(r => `  <url><loc>https://cavsdatabase.com/${r === 'home' ? '' : r}</loc><lastmod>${(modDates() && modDates()(r)) || day}</lastmod><changefreq>daily</changefreq></url>`);
    await writeFile(new URL('sitemap.xml', root), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
    await mkdir(new URL('data/', root), { recursive: true });
    await writeFile(HASHF, hash + '\n');
  }
} else { await rm(HASHF, { force: true }); }
