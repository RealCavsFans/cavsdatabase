// Nov 14 (Luka): GitHub's own scheduler skips and delays runs (it skipped everything from ~3:30 to 7:40 AM ET on Nov 14, including
// Cavs & Coffee). Cloudflare's cron triggers are reliable, so every 5 minutes this Worker starts the GitHub jobs that are due,
// using the same schedules as the workflow files (UTC). Every job here is safe to run twice: they skip when there is nothing new,
// the newsletter never sends an issue twice, and each workflow has its own concurrency group.
// Needs one secret on the Worker: GH_TOKEN, a fine-grained GitHub token for RealCavsFans/cavsdatabase with Actions: read and write.
// Without it, this does nothing.
const REPO = 'RealCavsFans/cavsdatabase';
export const JOBS = [
  // [workflow file, [cron expressions], inputs]
  ['newsletter.yml', ['37 9 * * *', '37 10 * * *', '7 11 * * *', '23 12 * * *', '53 13 * * *', '41 15 * * *'], { mode: 'auto' }],
  ['morning.yml', ['45 10 * * *']],
  ['scout.yml', ['35 15 * * *', '35 18 * * *', '5 21 * * *']],
  ['injury-report.yml', ['7,37 14-23 * * *', '7,37 0-3 * * *']],
  ['videos.yml', ['*/30 0-6,11-23 * * *', '0 7-10 * * *']],
  ['live-archive.yml', ['*/30 0-6 * * *', '40 14 * * *']],
  ['box-check.yml', ['*/15 0-6 * * *']],
  ['postgame-check.yml', ['7,37 1-8 * * *']],
  ['nba-store.yml', ['20 5 * * *', '50 10 * * *']],
  ['league-injuries.yml', ['10 22 * * *']],
  ['season-check.yml', ['20 15 * * *']],
  ['bbr-check.yml', ['41 8 * * *']],
  ['health.yml', ['15 9 * * *']],
  ['pron.yml', ['35 13 * * *']],
  ['highs-hist.yml', ['17 9 * * 1']],
  ['links.yml', ['23 10 * * 1']],
  ['capsheets.yml', ['29 11 * * 1']],
];
function field(spec, v) {
  return spec.split(',').some(part => {
    let [range, step] = part.split('/'); step = step ? +step : 1;
    let lo, hi;
    if (range === '*') { lo = 0; hi = 99; } else if (range.includes('-')) { [lo, hi] = range.split('-').map(Number); } else { lo = hi = +range; if (part.includes('/')) hi = 99; }
    return v >= lo && v <= hi && (v - lo) % step === 0;
  });
}
export function cronMatch(expr, d) {
  const [mi, h, dom, mo, dow] = expr.trim().split(/\s+/);
  return field(mi, d.getUTCMinutes()) && field(h, d.getUTCHours()) && field(dom, d.getUTCDate()) && field(mo, d.getUTCMonth() + 1) && field(dow, d.getUTCDay());
}
// the jobs due in the 5 minutes ending at this tick (a run at :40 covers :36 to :40)
export function dueJobs(when) {
  const t = Math.floor(when / 60000) * 60000, out = [];
  for (const [wf, crons, inputs] of JOBS) {
    for (let k = 0; k < 5; k++) { const d = new Date(t - k * 60000); if (crons.some(c => cronMatch(c, d))) { out.push([wf, inputs || {}]); break; } }
  }
  return out;
}
export async function runTimer(event, env) {
  if (!env.GH_TOKEN) { console.log('timer: no GH_TOKEN secret, nothing started'); return; }
  const due = dueJobs(event.scheduledTime || Date.now());
  for (const [wf, inputs] of due) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.GH_TOKEN, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'cavsdatabase-timer', 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs })
    });
    console.log('timer:', wf, r.status === 204 ? 'started' : 'failed ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  if (!due.length) console.log('timer: nothing due');
}
