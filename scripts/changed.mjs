// Decides whether a scheduled run's staged changes are worth a commit.
// Exit 0 = yes, commit. Exit 1 = only clock-driven churn (an "updated" stamp, a status file, the calendar's
// DTSTAMP, or page copies rebuilt from unchanged data), so skip it and keep the repo history small.
// Page copies are still refreshed at least every 6 hours so their baked-in "next game" text never goes stale.
import { execSync } from 'node:child_process';
const sh = c => execSync(c, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const STATUS = /(^|\/)(news-status|box-status)\.txt$|^data\/prerender-hash\.txt$/;
const GENERATED = /\.html$|^(og|a|embed)\/|^sitemap\.xml$/;
const STAMP = new Set(['updated', 'at', 'fetched', 'generated', 'checked']);
const clean = v => Array.isArray(v) ? v.map(clean) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !STAMP.has(k)).map(([k, x]) => [k, clean(x)])) : v;
const show = (rev, f) => { try { return sh(`git show ${rev}:"${f}"`); } catch { return null; } };

const lastCommit = +sh('git log -1 --format=%ct HEAD').trim() * 1000;
if (Date.now() - lastCommit > 6 * 3600e3) { console.log('changed: last commit over 6 hours old, refreshing'); process.exit(0); }

const lines = sh('git diff --cached --name-status').trim().split('\n').filter(Boolean);
for (const ln of lines) {
  const [st, f] = ln.split('\t');
  if (st !== 'M') { console.log(`changed: ${st} ${f}`); process.exit(0); }      // a new or removed file always counts
  if (STATUS.test(f) || (GENERATED.test(f) && f !== 'index.html')) continue;   // index.html is the source (team stats write into it), not a page copy
  const a = show('HEAD', f), b = show('', f);                                       // '' = the staged copy
  if (a == null || b == null) { console.log('changed:', f); process.exit(0); }
  if (f.endsWith('.json')) {
    let same = false; try { same = JSON.stringify(clean(JSON.parse(a))) === JSON.stringify(clean(JSON.parse(b))); } catch {}
    if (!same) { console.log('changed:', f); process.exit(0); }
    continue;
  }
  if (f.endsWith('.ics')) { const n = s => s.replace(/^DTSTAMP.*$/gm, ''); if (n(a) !== n(b)) { console.log('changed:', f); process.exit(0); } continue; }
  if (a !== b) { console.log('changed:', f); process.exit(0); }
}
console.log('changed: nothing but timestamps and rebuilt page copies; skipping the commit');
process.exit(1);
