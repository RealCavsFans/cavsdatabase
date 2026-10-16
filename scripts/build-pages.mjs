// Writes one copy of index.html per page (cap.html, schedule.html, media/rcf.html …) with that page's
// title, description, canonical address and share tags baked in, so search engines and link previews
// see the right details without running the site's script. The pages are otherwise identical to index.html.
// Run by .github/workflows/videos.yml; safe to run any time.
// With --prerender (the Action): skips everything if nothing changed since the last prerender, otherwise also
// writes home.html, bakes each page's drawn content in (scripts/prerender.mjs) and refreshes sitemap.xml dates.
// Without it (the daily task, local edits): plain copies only; the Action prerenders them on its next run.
import { readFile, writeFile, mkdir, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const exists = async u => { try { await stat(u); return true; } catch { return false; } };
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const PRE = process.argv.includes('--prerender');
const HASHF = new URL('data/prerender-hash.txt', root);
const h = createHash('sha1');
for (const f of ['index.html', 'videos.json', 'box.json', 'rcf.json', 'scripts/build-pages.mjs', 'scripts/prerender.mjs']) { try { h.update(await readFile(new URL(f, root))); } catch {} }
const hash = h.digest('hex');
if (PRE) { let old = ''; try { old = (await readFile(HASHF, 'utf8')).trim(); } catch {} if (old === hash) { console.log('pages unchanged, nothing to build'); process.exit(0); } }
const m = html.match(/const PAGE_META=(\{[\s\S]*?\});\n/);
if (!m) { console.log('::warning::PAGE_META not found'); process.exit(0); }
const META = Function('return ' + m[1])();
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
  const img = 'og/' + route.replace(/\//g, '-') + '.jpg';
  if (await exists(new URL(img, root))) {
    const u = 'https://cavsdatabase.com/' + img + '?v=1';
    out = out.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${u}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${u}">`)
      .replace(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(title)}">`);
  }
  const file = new URL(route + '.html', root);
  await mkdir(new URL('./', file), { recursive: true });
  await writeFile(file, out);
}
console.log('built', Object.keys(META).length, 'pages');
if (PRE) {
  const { default: prerender } = await import('./prerender.mjs');
  if (await prerender(root, META)) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const urls = Object.keys(META).map(r => `  <url><loc>https://cavsdatabase.com/${r === 'home' ? '' : r}</loc><lastmod>${day}</lastmod><changefreq>daily</changefreq></url>`);
    await writeFile(new URL('sitemap.xml', root), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
    await mkdir(new URL('data/', root), { recursive: true });
    await writeFile(HASHF, hash + '\n');
  }
} else { await rm(HASHF, { force: true }); }
