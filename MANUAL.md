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

- **Season team stats** (standings, records, ratings, four factors): already backed up. `scripts/backup-pbpstats.mjs` runs with the overnight team-stats job and fills in any game ESPN hasn't delivered within a day, from pbpstats.com. Nothing to switch on.
- **Lineups, possessions and the game archive**: pbpstats.com has these too; the live archive would need pointing at it if ESPN stays down.
- **Box scores and scores** (next day): Basketball Reference. Use it sparingly; it rate-limits heavy use.
- **Live in-game data**: already backed up. If ESPN's game feed misses twice in a row, the live page switches by itself to `/pbp`, a small Cloudflare Worker route (`worker/pbp.js`, parsers in `scripts/pbp-sources.mjs`). It reads the same game from StatMuse first, then CBS, then Yahoo, and the page names the feed it's using under the scoreboard. It checks ESPN again every minute and switches back once ESPN answers. StatMuse has everything ESPN has except blocks. CBS and Yahoo don't list substitutions, so on those two the page hides minutes, plus-minus and the Lineups tab. One shared copy is cached for 15 seconds, so the sources see about four requests a minute however many people are watching.
  - Before tip-off, or if every source is down, `/pbp` still returns the matchup and tip time from the site's calendar, so the page shows the game.
  - If ESPN never delivers a finished game, the nightly game archive saves the StatMuse copy instead (`b<date>.json`), and swaps in ESPN's copy once it exists.
  - The daily health check replays the latest finished Cavs game through StatMuse and CBS and opens the "Site health" issue if either breaks.
  - Test it any time: `cavsdatabase.com/pbp?d=YYYYMMDD` for a Cavs game date. Add `&src=statmuse`, `&src=cbs` or `&src=yahoo` to try one source.

## Health check

A daily check (`scripts/health.mjs`) flags anything stale: no box scores after a game, team stats behind, or a failing job. It runs twice: as a Claude scheduled task, and as a free GitHub job (`.github/workflows/health.yml`) that opens a GitHub issue called "Site health" when something is wrong. GitHub emails you about the issue, so the warning reaches you even if Claude is down. The issue closes itself once things are healthy again.
