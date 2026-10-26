// Builds /live.html from live.src.html (the editable source).
// The page's stylesheet and main script move into a/live.<hash>.css and a/live.<hash>.js, which browsers cache for
// a year (see _headers), so a phone on game night only re-downloads the small page shell after each site update.
// Minified with esbuild when it's installed (the Action installs it); hashes come from the source text.
// Run on its own (node scripts/build-live.mjs) or from build-pages.mjs.
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function buildLive(root = new URL('../', import.meta.url)) {
  const src = await readFile(new URL('live.src.html', root), 'utf8');
  const sm = src.match(/<style>([\s\S]*?)<\/style>/);
  const jm = [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)].sort((x, y) => y[1].length - x[1].length)[0];
  if (!sm || !jm || jm[1].length < 50000) { await writeFile(new URL('live.html', root), src); return 'live.html: copied as is'; }
  const h = s => createHash('sha1').update(s).digest('hex').slice(0, 10);
  const hc = h(sm[1]), hj = h(jm[1]);
  let css = sm[1], js = jm[1];
  try { const { transform } = await import('esbuild');
    js = (await transform(jm[1], { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' })).code;
    css = (await transform(sm[1], { loader: 'css', minify: true })).code;
  } catch (e) { if (!/Cannot find (package|module)/.test(e.message)) console.warn('live minify skipped:', e.message.split('\n')[0]); }
  await mkdir(new URL('a/', root), { recursive: true });
  await writeFile(new URL(`a/live.${hc}.css`, root), css); await writeFile(new URL(`a/live.${hj}.js`, root), js);
  for (const f of await readdir(new URL('a/', root))) if (/^live\.[0-9a-f]{10}\.(css|js)$/.test(f) && f !== `live.${hc}.css` && f !== `live.${hj}.js`) await unlink(new URL('a/' + f, root));
  const out = src.replace(sm[0], () => `<link rel="stylesheet" href="/a/live.${hc}.css">`).replace(jm[0], () => `<script src="/a/live.${hj}.js"></script>`);
  await writeFile(new URL('live.html', root), out);
  return `live.html: ${src.length} bytes -> ${out.length} shell + a/live.${hc}.css + a/live.${hj}.js`;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(await buildLive());
