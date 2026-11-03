// One-off probe (Nov 2): what the NBA's sources answer from a GitHub server.
const B = 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com';
const H = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com', 'x-nba-stats-origin': 'stats', 'x-nba-stats-token': 'true', 'Accept-Language': 'en-US,en;q=0.9' };
async function t(label, url, headers) { const t0 = Date.now(); try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) }); const b = await r.text(); console.log(`${label} | ${r.status} | ${Date.now() - t0}ms | ${b.length}b | ${r.headers.get('content-type')} | ${b.slice(0, 220).replace(/\s+/g, ' ')}`); return b; } catch (e) { console.log(`${label} | ERR ${String(e).slice(0, 120)} | ${Date.now() - t0}ms`); } }
const q = 'leaguedashteamstats?MeasureType=Advanced&PerMode=PerGame&Season=2026-27&SeasonType=Regular%20Season&LastNGames=0&Month=0&OpponentTeamID=0&PaceAdjust=N&Period=0&PlusMinus=N&Rank=N&TeamID=0&DateFrom=&DateTo=&GameSegment=&LeagueID=00&Location=&Outcome=&PORound=0&SeasonSegment=&ShotClockRange=&VsConference=&VsDivision=&Conference=&Division=&GameScope=&PlayerExperience=&PlayerPosition=&StarterBench=&TwoWay=0&ISTRound=';
console.log('== stats.nba.com');
await t('teamstats advanced, browser headers', 'https://stats.nba.com/stats/' + q, H);
await t('teamstats advanced, plain', 'https://stats.nba.com/stats/' + q, { 'User-Agent': 'Mozilla/5.0' });
await t('playbyplayv3, browser headers', 'https://stats.nba.com/stats/playbyplayv3?GameID=0022600151&StartPeriod=0&EndPeriod=0', H);
await t('boxscoreadvancedv3, browser headers', 'https://stats.nba.com/stats/boxscoreadvancedv3?GameID=0022600151&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0', H);
console.log('== bucket listing');
const l = await t('list NBA/liveData/', B + '/?list-type=2&prefix=NBA/liveData/&delimiter=/', {});
if (l && /<CommonPrefixes>/.test(l)) console.log('PREFIXES', [...l.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map(m => m[1]).join(' '));
await t('list NBA/', B + '/?list-type=2&prefix=NBA/&delimiter=/', {});
await t('list NBA/staticData/', B + '/?list-type=2&prefix=NBA/staticData/&delimiter=/', {});
console.log('== likely liveData files');
for (const p of ['liveData/odds/odds_todaysGames.json', 'liveData/channels/v2/channels_00.json', 'liveData/winprobability/winprobability_0022600151.json', 'liveData/gamedetails/gamedetails_0022600151.json', 'liveData/playbyplay/playbyplay_0022600151.json', 'liveData/boxscore/boxscore_0022600151.json', 'liveData/scoreboard/todaysScoreboard_00.json', 'staticData/scheduleLeagueV2_1.json', 'staticData/scheduleLeagueV2.json', 'liveData/leaders/todaysLeaders_00.json'])
  await t(p, `${B}/NBA/${p}`, {});
console.log('== cdn.nba.com still serving anything?');
for (const p of ['https://cdn.nba.com/static/json/liveData/odds/odds_todaysGames.json', 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json', 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json'])
  await t(p, p, { 'User-Agent': 'Mozilla/5.0' });
