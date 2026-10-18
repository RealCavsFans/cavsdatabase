// Staleness check: is the site's data actually updating? Prints each problem and exits 1 if any (0 when healthy).
// Checks the daily data (SITE_UPDATED), the 30-minute job (last bot commit), box scores for finished games,
// the league feed, and the news feed. Run by the daily health scheduled task, which pushes Luka a note only on problems.
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
// 5. news feed
const N = await J('news.json');
const newest = N ? [...(N.articles || []), ...(N.videos || []), ...(N.podcasts || [])].map(x => x.date).sort().pop() : null;
if (!newest) problems.push('News feed (news.json) is empty or missing.');
else if (days(newest.slice(0, 10), today) > 3) problems.push(`Newest news item is from ${newest.slice(0, 10)}. The news fetch may be failing.`);
else notes.push('news ' + newest.slice(0, 10));
if (problems.length) { console.log('PROBLEMS:\n- ' + problems.join('\n- ')); console.log('ok: ' + notes.join(' · ')); process.exit(1); }
console.log('HEALTHY: ' + notes.join(' · '));
