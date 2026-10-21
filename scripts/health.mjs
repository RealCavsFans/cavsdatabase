// Staleness check: is the site's data actually updating? Prints each problem and exits 1 if any (0 when healthy).
// Checks the daily data (SITE_UPDATED), the 30-minute job (last bot commit), box scores for finished games,
// the league feed, the news feed and the weekly outside-link check. Run by the daily health scheduled task, which pushes Luka a note only on problems.
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const J = async f => { try { return JSON.parse(await readFile(new URL(f, root), 'utf8')); } catch { return null; } };
const etDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const today = etDay(), now = Date.now(), problems = [], notes = [];
const grab = re => { const m = html.match(re); return m ? Function('return ' + m[1])() : null; };
const S = grab(/const SCHEDULE=(\[[\s\S]*?\]);\n/) || [];
const inSeason = S.length && today >= S[0][0] && today <= S[S.length - 1][0];
// 1. daily data task
const upd = (html.match(/const SITE_UPDATED='(\d{4}-\d\d-\d\d)'/) || [])[1];
if (!upd) problems.push('SITE_UPDATED is missing from index.html');
else if (days(upd, today) > (inSeason ? 2 : 6)) problems.push(`Daily data hasn't changed since ${upd} (${days(upd, today)} days). The daily update may be failing.`);
else notes.push('daily data ' + upd);
// 2. the 30-minute job: newest commit by the bot
try { const t = +execSync('git -C ' + root.pathname + ' log -1 --format=%ct --author=cavsdatabase-bot', { encoding: 'utf8' }).trim() * 1000;
  const h = (now - t) / 36e5; if (!t) problems.push('No commits from the 30-minute job found.'); else if (h > 6) problems.push(`The 30-minute job hasn't committed in ${h.toFixed(0)} hours. Check GitHub Actions.`); else notes.push(`30-min job ${h.toFixed(1)}h ago`);
} catch { notes.push('git log unavailable'); }
// 3. box scores: every regular-season game more than 6 hours past tip should be final with a box
const box = await J('box.json') || {};
const tipOf = (d, t) => { let h = 19, m = 0; if (t && /^\d{1,2}:\d{2}/.test(t)) { [h, m] = t.split(':').map(x => parseInt(x)); if (!/AM/i.test(t) && h < 12) h += 12; } return Date.parse(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`); };
const missing = S.filter(([d, , , t]) => { const tip = tipOf(d, t); return now - tip > 6 * 36e5 && !(box[d] && box[d].status === 'final' && (box[d].box || []).length); }).map(g => g[0] + ' ' + g[1]);
if (missing.length) problems.push(`Box scores missing for ${missing.length} finished game(s): ${missing.slice(-5).join(', ')}`);
// 4. league feed (players' league-wide ranks)
const L = await J('pdata/league.json');
if (inSeason && S.some(g => days(g[0], today) >= 2)) { if (!L || !L.updated) problems.push('League feed (pdata/league.json) has never updated.'); else if ((now - Date.parse(L.updated)) / 36e5 > 30) problems.push(`League feed last updated ${L.updated.slice(0, 16)}.`); else notes.push(`league feed ${L.games.length} games`); }
// 4b. team stats job (scripts/team-stats.mjs): once games are in the league feed, the Cavs scores and standings should follow within a day
if (L && L.tg && Object.keys(L.tg).length) {
  const played = Object.values(L.tg).filter(g => (g.t || []).some(t => t.ab === 'CLE') && days(g.d, today) >= 1).length;
  const scores = (html.match(/const SCORES=(\{[^\n]*?\});/) || [])[1] || '{}';
  const have = (scores.match(/'\d{4}-|"\d{4}-/g) || []).length;
  if (played > have) problems.push(`Team stats job is behind: ${played} Cavs games in the league feed but ${have} scores on the site. Check the "Team stats" GitHub job.`);
  else notes.push(`team stats ${have} games`);
}
// 5. news feed
const N = await J('news.json');
const newest = N ? [...(N.articles || []), ...(N.videos || []), ...(N.podcasts || [])].map(x => x.date).sort().pop() : null;
if (!newest) problems.push('News feed (news.json) is empty or missing.');
else if (days(newest.slice(0, 10), today) > 3) problems.push(`Newest news item is from ${newest.slice(0, 10)}. The news fetch may be failing.`);
else notes.push('news ' + newest.slice(0, 10));
// 6. weekly outside-link check (.github/workflows/links.yml)
const LK = await J('links-status.json');
if (!LK) notes.push('link check not run yet');
else { if (days(LK.checked.slice(0, 10), today) > 9) problems.push(`The weekly link check hasn't run since ${LK.checked.slice(0, 10)}. Check GitHub Actions.`);
  if (LK.broken && LK.broken.length) problems.push(`${LK.broken.length} broken outside link(s) as of ${LK.checked.slice(0, 10)}: ${LK.broken.slice(0, 5).map(([u, s]) => u + ' (' + s + ')').join(', ')}${LK.broken.length > 5 ? ', …' : ''}`);
  else notes.push(`links ok (${LK.total})`); }
// 7. live page backup feed (/pbp): replay the latest finished Cavs game through each source, so a layout change
// at StatMuse or CBS shows up here instead of during a game when ESPN is down. Yahoo is the last resort, so it only gets a note.
{
  const last = S.filter(([d]) => d < today && box[d] && box[d].status === 'final' && days(d, today) <= 10).pop();
  if (!last) notes.push('backup feed: no recent game to test');
  else for (const src of ['statmuse', 'cbs', 'yahoo']) {
    const d = last[0].replace(/-/g, ''); let msg = null;
    try { const r = await fetch(`https://cavsdatabase.com/pbp?d=${d}&src=${src}`, { signal: AbortSignal.timeout(30000) }); const j = await r.json();
      if (!r.ok || !j.plays) msg = (j.error || r.status) + (j.tried && j.tried.length ? ': ' + j.tried.join('; ') : '');
      else { const cav = j.header.competitions[0].competitors.find(c => c.id === '5'); const want = +String(box[last[0]].score || '').split('-')[0];
        if (j.plays.length < 150) msg = `only ${j.plays.length} plays`; else if (want && cav && +cav.score !== want) msg = `Cavs score ${cav.score}, box score says ${want}`; }
    } catch (e) { notes.push(`backup ${src}: site not reachable from here`); continue; }
    if (!msg) notes.push(`backup ${src} ok`);
    else if (src === 'yahoo') notes.push(`backup yahoo failed (${msg})`);
    else problems.push(`Live page backup feed: ${src} failed on the ${last[0]} game (${msg}). The live page still has the other backups; see MANUAL.md.`);
  }
}
if (problems.length) { console.log('PROBLEMS:\n- ' + problems.join('\n- ')); console.log('ok: ' + notes.join(' · ')); process.exit(1); }
console.log('HEALTHY: ' + notes.join(' · '));
