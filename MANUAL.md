# Manual mode: keeping cavsdatabase.com running by hand

Use this if the daily Claude update isn't running. You only need a web browser, signed in to GitHub. A phone works, but a laptop is easier.

## What updates on its own, with no Claude at all

These are free GitHub jobs plus Cloudflare. They keep going whatever happens to Claude:

- Box scores, news, videos, headshots and the site's page copies (every 30 minutes)
- Season team stats: standings, records, scores, net rating, last 14 days (overnight)
- Live game archive and the "game in numbers" recap (every 30 minutes on game nights)
- Scouting report for the next opponent, and live-page baselines (daily)
- The live page itself (it runs in each visitor's browser)
- The newsletter and game alerts (when they're turned on)

## What freezes without the daily update

The things a person (or Claude) types in: injuries, transactions, standings ranks and the NBA Cup, TV listings, Charge stats, key dates, and cap or contract changes. Nothing breaks. These just stop changing until someone edits them.

## How to edit by hand

1. Go to github.com/RealCavsFans/cavsdatabase and open `index.html`.
2. Click the pencil icon ("Edit this file"). On a laptop you can also press `.` to open the full editor.
3. Press Ctrl+F (Cmd+F on a Mac) and search for the name in the table below, for example `const INJURIES=`.
4. Change the line. Keep the same punctuation pattern as the lines around it: quotes, commas and square brackets.
5. Click "Commit changes", then commit straight to `main`.
6. The site updates within about 30 minutes. The next 30-minute job rebuilds the page copies and Cloudflare publishes them.

If a commit breaks something, the 30-minute job's safety check refuses to publish the broken version. To undo a commit, open it from the repo's commit list and click "Revert".

### Where things live in index.html

| What | Search for | Format of one entry |
|---|---|---|
| Injury report | `const INJURIES=` | `['Sam Merrill','SG','Elbow','Out'],`. Status is one of Out, Doubtful, Questionable, Probable, Game-time decision. Use `[]` for no injuries. |
| Transactions | `const TX=` | Add at the front: `{"d":"2026-10-20","k":"option","p":"Jaylon Tyson","t":"Picked up Jaylon Tyson’s 2027–28 team option"},`. `k` is one of trade, sign, waive, ext, option, twoway, draft, fa, other. |
| Release link for a transaction | `const TX_X={` | Add at the front: `"2026-10-20\|Jaylon Tyson":{"url":"https://www.nba.com/cavaliers/news/..."},` |
| Contracts and cap sheet | `const ROSTER=` | `['Name','Pos',[2026-27, 2027-28, ...],'Bird rights','Free agency','Note'],`. A salary is a number with no `$` or commas. A team option is `[5641500,'T']`, a player option is `[5641500,'P']`, and a free-agent year is `'UFA'` or `'RFA'`. |
| Contract details (agent, deal, notes) | `const CONTRACTS={` | One block per player |
| Exceptions | `const EXC=[` | `['Name',amount,'Expires','Description',[uses]]` |
| Two-way players | `const TWOWAY=` | `['Name','Bird rights','Free agency']` |
| Key dates | `const DATES=[` | `['2026-11-02','What happens',1],`. Use 1 for a Cavs date, 0 for league-wide. |
| TV for a game | `const TV=` | `'2026-10-22':'ESPN',` |
| Charge | `const CHARGE=` | Record, coach and games |
| Site "last updated" | `const SITE_UPDATED=` | `'2026-10-20'` |

Don't hand-edit these. The automatic jobs own them and would overwrite you: `TSTATS`, `FFR`, `NRTG`, `L14`, `OPP_FORM`, `STANDINGS`, `SCORES`, `MPG`, and `SEASON.results`.

## Keys and switches

All keys live in GitHub → Settings → Secrets and variables → Actions. Never paste a key anywhere else.

- `NEWSLETTER_LIVE`: set to `true` to send to subscribers.
- Game alerts are paused by commented-out schedule lines in `.github/workflows/push.yml`. To turn them on, remove the `#` in front of those lines.

## If ESPN changes or blocks its feed

Every job that reads ESPN keeps the last good data when a fetch fails, so pages freeze instead of breaking. The live page shows "Could not load the game". Possible replacement sources:

- **Next-day stats** (team stats, lineups, possessions, archive): pbpstats.com. The site already uses it for live-page baselines.
- **Box scores and scores** (next day): Basketball Reference. Use it sparingly; it rate-limits heavy use.
- **Live in-game data**: the only other dependable live feed is the NBA's own. It's off-limits under the site's data rule, so live stats would pause until ESPN's feed is fixed or replaced.

## Health check

A daily check (`scripts/health.mjs`) flags anything stale: no box scores after a game, team stats behind, or a failing job. It runs as a Claude scheduled task. It can also run as a free GitHub job that opens a GitHub issue, which GitHub emails you about, so the warning still reaches you if Claude is down.
