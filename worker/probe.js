// One-off (Nov 3): can our Cloudflare server reach stats.nba.com (closest-defender shot data)? Removed after the test.
const H = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com', 'x-nba-stats-origin': 'stats', 'x-nba-stats-token': 'true', 'Accept-Language': 'en-US,en;q=0.9' };
const Q = 'leaguedashptshot?CloseDefDistRange=0-2%20Feet%20-%20Very%20Tight&College=&Conference=&Country=&DateFrom=11%2F02%2F2026&DateTo=11%2F02%2F2026&Division=&DraftPick=&DraftYear=&DribbleRange=&GameScope=&GameSegment=&GeneralRange=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PerMode=Totals&Period=0&PlayerExperience=&PlayerPosition=&Season=2026-27&SeasonSegment=&SeasonType=Regular%20Season&ShotClockRange=&ShotDistRange=&StarterBench=&TeamID=1610612739&TouchTimeRange=&VsConference=&VsDivision=&Weight=';
export async function probe() {
  const out = [];
  for (const [lab, url, h] of [['team defender-distance, browser headers', 'https://stats.nba.com/stats/' + Q, H], ['same, plain', 'https://stats.nba.com/stats/' + Q, { 'User-Agent': 'Mozilla/5.0' }]]) {
    const t0 = Date.now();
    try { const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20000) }); const b = await r.text(); out.push({ lab, status: r.status, ms: Date.now() - t0, len: b.length, head: b.slice(0, 400) }); }
    catch (e) { out.push({ lab, err: String(e).slice(0, 200), ms: Date.now() - t0 }); }
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
