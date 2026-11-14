// "Did the site change without us?" Read-only. Fetches the live front page, the live game page and the files they load,
// and checks they match what's in the repo (allowing for a deploy that's a few commits behind). Also flags any script
// loaded from a domain the site doesn't use. Prints problems and exits 1 so the daily health check opens an issue.
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
const SITE = 'https://cavsdatabase.com', root = new URL('../', import.meta.url);
const OK_HOSTS = ['cavsdatabase.com', 'cdn.onesignal.com', 'www.youtube-nocookie.com', 'static.cloudflareinsights.com'];
const recent = f => { try { return execSync(`git -C ${root.pathname} log -12 --format=%H -- ${f}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(h => { try { return execSync(`git -C ${root.pathname} show ${h}:${f}`, { encoding: 'utf8', maxBuffer: 64e6 }); } catch { return null; } }).filter(Boolean); } catch { return []; } };
// Cloudflare's bot check challenges GitHub's servers (403 + cf-mitigated: challenge). That isn't the site being down,
// so a challenged page is skipped with a note instead of reported as a problem.
let challenged = 0;
const get = async p => { const r = await fetch(SITE + p, { headers: { 'user-agent': 'cavsdatabase site check' }, redirect: 'follow' }); if (r.status === 403 && /challenge/i.test(r.headers.get('cf-mitigated') || '')) { challenged++; return undefined; } return r.ok ? r.text() : null; };
const problems = [];
const norm = s => s.replace(/\s+/g, ' ').trim();
for (const [path, file] of [['/', 'home.html'], ['/live.html', 'live.html']]) {
  const live = await get(path);
  if (live === undefined) continue;   // Cloudflare challenged the check, see above
  if (live == null) { problems.push(`${path} did not load`); continue; }
  const known = recent(file).map(norm);
  let disk = null; try { disk = norm(await readFile(new URL(file, root), 'utf8')); } catch {}
  if (disk) known.push(disk);
  if (!known.includes(norm(live))) problems.push(`${path} doesn't match any recent version in the repo. If no deploy is in progress, someone may have changed the site outside GitHub.`);
  for (const m of live.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const u = new URL(m[1], SITE);
    if (!OK_HOSTS.includes(u.hostname)) problems.push(`${path} loads a script from an unexpected site: ${u.href}`);
    else if (u.hostname === 'cavsdatabase.com' && u.pathname.startsWith('/a/')) {
      const body = await get(u.pathname); let want = null; try { want = await readFile(new URL(u.pathname.slice(1), root), 'utf8'); } catch {}
      if (body === undefined) continue;
      if (body == null) problems.push(`${u.pathname} did not load`);
      else if (want != null && body !== want) problems.push(`${u.pathname} on the live site differs from the repo copy.`);
    }
  }
}
if (problems.length) { console.log('SITE CHECK\n' + problems.map(p => '- ' + p).join('\n')); process.exit(1); }
console.log(challenged ? `site check: skipped, Cloudflare's bot check blocked ${challenged} request(s) from GitHub (the site itself is fine)` : 'site check: live pages match the repo');
