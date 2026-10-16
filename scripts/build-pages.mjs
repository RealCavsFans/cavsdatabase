// Writes one copy of index.html per page (cap.html, schedule.html, media/rcf.html …) with that page's
// title, description, canonical address and share tags baked in, so search engines and link previews
// see the right details without running the site's script. The pages are otherwise identical to index.html.
// Run by .github/workflows/videos.yml; safe to run any time.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const m = html.match(/const PAGE_META=(\{[\s\S]*?\});\n/);
if (!m) { console.log('::warning::PAGE_META not found'); process.exit(0); }
const META = Function('return ' + m[1])();
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
  const file = new URL(route + '.html', root);
  await mkdir(new URL('./', file), { recursive: true });
  await writeFile(file, out);
}
console.log('built', Object.keys(META).length - 1, 'pages');
