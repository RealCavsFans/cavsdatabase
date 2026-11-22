// Which NBA.com jobs (the ones that run in the browser on Luka's computer) are behind? Nov 22 (Luka): run them whenever
// his computer is on, not only at one set time. The catch-up scheduled task runs this every couple of hours and starts
// only the jobs listed here. A job is due when NBA.com has games its file hasn't caught up to:
//   play types / hustle / tracking and shot contest   any NBA game on a day after the file's date
//   matchups                                         a Cavs game on or after the file's date (it is Cavs-only)
//   possessions                                      a finished Cavs game missing from data/poss-nba.json
// Games count once the next morning comes (NBA.com finishes its numbers overnight). Prints JSON: {"due":[...],"why":{...}}
//   node scripts/mac-due.mjs
import fs from 'node:fs';
import { CUR_SEASON } from './season.mjs';
const J = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const sched = J('data/league-schedule.json'), arch = J(`live-archive/${CUR_SEASON}/index.json`) || [], poss = J('data/poss-nba.json');
const nbaDays = [...new Set(Object.values((sched && sched.teams) || {}).flat().map(g => g[0]))].filter(d => d < today).sort();
const lastNba = nbaDays.pop() || null, lastCavs = arch.map(g => g.et).filter(d => d && d < today).sort().pop() || null;
const due = [], why = {};
const chk = (job, file, last) => { const j = J(file), u = j && String(j.updated || '').slice(0, 10); if (last && (!u || u <= last)) { due.push(job); why[job] = `${file} is from ${u || 'never'}, games through ${last}`; } };
chk('tracking', 'pdata/tracking.json', lastNba);
chk('shot-contest', 'pdata/defender.json', lastNba);
// matchups only move when the Cavs play; its date is the day it was saved, so a save the day after the game is current
{ const j = J('pdata/matchups.json'), u = j && String(j.updated || '').slice(0, 10); if (lastCavs && (!u || u <= lastCavs)) { due.push('matchups'); why.matchups = `matchups from ${u || 'never'}, last Cavs game ${lastCavs}`; } }
{ const miss = arch.filter(g => g.et && g.et < today && !(poss && poss.games && poss.games[g.id])).map(g => g.et); if (miss.length) { due.push('possessions'); why.possessions = 'no NBA.com count for ' + miss.join(', '); } }
console.log(JSON.stringify({ today, lastNba, lastCavs, due, why }));
