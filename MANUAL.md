# Manual mode: keeping cavsdatabase.com running by hand

Use this if the daily Claude update isn't running. You only need a web browser, signed in to GitHub. A phone works, but a laptop is easier.

## What updates on its own, with no Claude at all

These are free GitHub jobs plus Cloudflare. They keep going whatever happens to Claude:

- Box scores, news, videos, headshots and the site's page copies (every 30 minutes)
- Season team stats: standings, records, scores, net rating, last 14 days (overnight)
- Live game archive and the "game in numbers" recap (every 30 minutes on game nights), built from the NBA's own files
- NBA game store and nightly accuracy checks (1:20 and 6:50 a.m. Eastern)
- Scouting report for the next opponent, and live-page baselines (daily; the scouting report reruns in the afternoon if a source was late)
- Game-day injury statuses for both teams, from the league's official injury report (hourly on game days)
- Box score accuracy check against Basketball Reference (every morning)
- The live page itself (it runs in each visitor's browser)
- The newsletter and game alerts (when they're turned on)

## What freezes without the daily update

The things a person (or Claude) types in: injury details and timelines (game-day statuses still update from the official report), transactions, standings ranks and the NBA Cup, TV listings, Charge stats, key dates, and cap or contract changes. Nothing breaks. These just stop changing until someone edits them.

## How to edit by hand

1. Go to github.com/RealCavsFans/cavsdatabase and open `index.html`.
2. Click the pencil icon ("Edit this file"). On a laptop you can also press `.` to open the full editor.
3. Press Ctrl+F (Cmd+F on a Mac) and search for the name in the table below, for example `const INJURIES=`.
4. Change the line. Keep the same punctuation pattern as the lines around it: quotes, commas and square brackets.
5. Click "Commit changes", then commit straight to `main`.
6. The site updates within a few minutes: the edit starts a page rebuild, which publishes to the `deploy` branch, and Cloudflare serves that branch.

If a commit breaks something, the 30-minute job's safety check refuses to publish the broken version. To undo a commit, open it from the repo's commit list and click "Revert".

### Where things live in index.html

| What | Search for | Format of one entry |
|---|---|---|
| Injury report | `const INJURIES=` | `['Sam Merrill','SG','Elbow','Out'],`. Status is one of Out, Doubtful, Questionable, Probable, Game-time decision. Use `[]` for no injuries. |
| Injury details (dropdown under each player) | `const INJ_CTX={` | Every injured player gets all four rows: Diagnosis (announced, with a plain-English gloss), Team timeline (with source and date), Typical return (`type` pointing to an `INJ_TYPICAL` entry: a peer-reviewed NBA study's sample size, average days and range, plus his own last return time), History (same body part with games missed and dates, then other past injuries). The full rules are in the comment above `INJ_CTX`. |
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
- Game alerts went live Oct 27 and were paused Oct 29 (Luka's call). To turn them back on, uncomment the schedule lines in `.github/workflows/push.yml`. The repository variable PUSH_LIVE must also be "true"; anything else makes every run a dry run.

## The NBA feed comes first (Nov 3)

Since Nov 2 the site reads the NBA's own files (box scores and play-by-play from the NBA's stats feed) wherever it can, with ESPN kept as the backup and for win probability, the schedule, TV and news.

- **NBA game store.** `scripts/nba-store.mjs` (`nba-store.yml`, 1:20 and 6:50 a.m. Eastern) saves every finished NBA game, untouched, on the `nba-data` branch (`<season>/<gameId>.json.gz`). The game archive and the checks build from these copies.
- **Live page.** The live page reads the NBA feed through the site's `/nba` route (`worker/nba.js`) and falls back to ESPN by itself if the NBA doesn't answer.
- **Nightly checks.** `scripts/nba-check.mjs` (same job) holds every stored game to rules that are always true: the NBA's box score adds up on its own; our play-by-play build matches it player by player (minutes and every box column); five on the floor all game; possessions within 5 of the NBA's own markers; and, for Cavs games, the NBA box score against ESPN's. The report is saved on `nba-data` as `checks/<season>.json`.
- **Corrections.** The NBA sometimes names the wrong player in a substitution. `scripts/nba-fixfind.mjs` runs nightly on the last 7 days and finds the one correction that makes every player's minutes match the NBA box score (saved on `nba-data` as `fixes.json`). Hand-checked corrections live in `pdata/nba-fixes.json`. Both are applied by the archive and the checks (`scripts/nba-fixes.mjs`). To redo a past season: run "NBA game store" by hand with that season.
- **Locked test games.** `scripts/regress.mjs` rebuilds three saved games (`tests/nba/`) and runs a live replay and bad-data drills (missing shot spots, a player missing from the box, plays out of order or sent twice, no plays). It runs before every publish and page build; if it fails, the site keeps the last good version.
- **Phone alerts.** Failures push to Luka's phone through the ntfy app (private channel in the `NTFY_TOPIC` secret): the NBA store, game archive, newsletter, morning, injury report and publish jobs, the health check, and a game saved from ESPN because the NBA feed was down. "Test phone alert" (Actions tab) sends a test push.
- **Shot contest.** Closest-defender shooting only comes from stats.nba.com, which answers a real browser only. A daily scheduled task reads it in the Claude app's browser on Luka's computer (5:22 p.m. Eastern) and saves `pdata/defender.json`; if the computer is off, that day is skipped and the card shows the last saved numbers with their date.
- If the NBA feed's address ever changes, open any game on nba.com with the browser's network tab and look for the `boxscore_` and `playbyplay_` file names; update the base address in `scripts/nba-store.mjs` and `worker/nba.js`.

## If ESPN changes or blocks its feed

Every job that reads ESPN keeps the last good data when a fetch fails, so pages freeze instead of breaking. The live page shows "Could not load the game". Possible replacement sources:

- **Season team stats** (standings, records, ratings, four factors): already backed up. `scripts/backup-pbpstats.mjs` runs with the overnight team-stats job and fills in any game ESPN hasn't delivered within a day, from pbpstats.com. Nothing to switch on.
- **Lineups, possessions and the game archive**: pbpstats.com has these too; the live archive would need pointing at it if ESPN stays down.
- **Box scores and scores** (next day): Basketball Reference. Use it sparingly; it rate-limits heavy use.
- **Live in-game data**: already backed up. If ESPN's game feed misses twice in a row, the live page switches by itself to `/pbp`, a small Cloudflare Worker route (`worker/pbp.js`, parsers in `scripts/pbp-sources.mjs`). It reads the same game from CBS first, then Yahoo, then StatMuse (Nov 2: StatMuse's game page changed, so its reader needs rework before it can be relied on), and the page names the feed it's using under the scoreboard. It checks ESPN again every minute and switches back once ESPN answers. StatMuse has everything ESPN has except blocks. CBS and Yahoo don't list substitutions, so on those two the page hides minutes, plus-minus and the Lineups tab. One shared copy is cached for 15 seconds, so the sources see about four requests a minute however many people are watching.
  - Before tip-off, or if every source is down, `/pbp` still returns the matchup and tip time from the site's calendar, so the page shows the game.
  - If ESPN never delivers a finished game, the nightly game archive saves the StatMuse copy instead (`b<date>.json`), and swaps in ESPN's copy once it exists.
  - The daily health check replays the latest finished Cavs game through CBS and Yahoo and opens the "Site health" issue if either breaks (StatMuse gets a note only).
  - Test it any time: `cavsdatabase.com/pbp?d=YYYYMMDD` for a Cavs game date. Add `&src=statmuse`, `&src=cbs` or `&src=yahoo` to try one source.

## Health check

A daily check (`scripts/health.mjs`) flags anything stale: no box scores after a game, team stats behind, or a failing job. It runs as a free GitHub job (`.github/workflows/health.yml`, about 5:15 a.m. Eastern; the Claude daily update also reads its result) that opens a GitHub issue called "Site health" when something is wrong. GitHub emails you about the issue, so the warning reaches you even if Claude is down. The issue closes itself once things are healthy again.

**Injury "Typical return" fallback.** When no peer-reviewed NBA study fits, the injury dropdown and share card use Hashtag Basketball's NBA injury log (hashtagbasketball.com/nba-injury) by injury type, labeled "not a peer-reviewed study". The type is matched from the injury text (e.g. "Ankle (sprain)" → sprained ankle); set `hb:'<type>'` in INJ_CTX to force one.

**Live page source.** Edit `live.src.html`, not `live.html`. The page build (`scripts/build-live.mjs`, run by build-pages in the Action) writes `live.html` as a small shell plus `a/live.<hash>.css/.js`, which browsers cache for a year. Run `node scripts/build-live.mjs` to rebuild it by hand.

**Game archive format.** Archived games store plays and win probability as compact rows (`pv: 2`); `prep()` in live-core.js unpacks them, so every reader goes through `prep`.

**Page rebuilds.** Any push that changes `index.html`, `live.src.html` or the build scripts starts the page rebuild by itself, so there's no need to start it by hand after an edit (extra starts queue up and cancel each other). The rebuild is skipped when nothing but timestamps changed, and runs at least every 6 hours so the baked-in next-game text stays current. The 30-minute job runs hourly from about 3 to 7 a.m. Eastern.

**Commits from the 30-minute job.** `scripts/changed.mjs` skips a scheduled commit when only timestamps changed. The job commits data only; built pages never go to `main`.

**Security.** GitHub Actions are pinned to exact commits (checkout v5.1.0, setup-node v5.0.0); to update, swap in the new tag's commit from `git ls-remote https://github.com/actions/<name> refs/tags/<tag>`. The daily health check also confirms cavsdatabase.com answers and serves the newest build. Security headers are in `_headers`.

- Oct 27: the four morning data jobs (live page baselines, scouting report, Basketball Reference ids, games missed to injury) run together in `.github/workflows/morning.yml` at 6:45 a.m. Eastern. To rerun any of them, run that whole job by hand (Nov 1: the separate by-hand copies were removed).
- Nov 1: **Where the site comes from.** Cloudflare serves the `deploy` branch, not `main`. `main` holds the source (`index.html`, `live.src.html`, scripts) and data; the built pages, page copies and generated share images exist only on `deploy`, which `scripts/publish-deploy.mjs` replaces with one fresh commit each time (so old builds never pile up). The 30-minute job publishes after each build; `publish.yml` puts other data saves and hand edits on the site within a couple of minutes without a rebuild. Edit files on `main` as before; never edit `deploy` by hand. If `deploy` were ever lost, run "Update videos, box scores and news" by hand: it rebuilds everything and recreates it.
- Nov 1: **Official injury report.** `scripts/injury-report.py` (`injury-report.yml`) reads the league's injury report PDF for the next Cavs game and saves `pdata/injury-report.json`; the home injury list and the game card show it over `INJURIES`/`OPP_INJ` while it's for the upcoming game. `INJURIES`, `INJ_CTX` and `OPP_INJ` stay hand-kept (details, timelines, and the fallback). Run it any time with "Official NBA injury report" → Run workflow → "Check now".
- Nov 1: **Box score accuracy check.** `scripts/bbr-check.mjs` (`bbr-check.yml`, 3:41 a.m. Eastern) compares each finished game's box score with Basketball Reference (every player's points, rebounds, assists, shooting and minutes, plus the final score) and the health check reports any difference.
- Nov 13: **Stat checks, in order.** (1) During a Cavs game, every 15 minutes: `box-check.yml` rebuilds the live page's numbers from the play-by-play and holds them to the NBA's official box score and line score. (2) The night of the game: `postgame-check.yml` waits until the final is in both the game archive and the league feed (`scripts/postgame-ready.mjs`), then runs `box-check.mjs` on the saved games and `season-check.mjs` on the season totals once; the game it checked is saved in `data/postgame-check.json`. (3) 3:41 a.m.: `bbr-check.yml` against Basketball Reference, rechecked for three days. (4) 10:20 a.m.: `season-check.yml` against the NBA's latest box scores and the league feed. Each one pushes to Luka's phone (ntfy) when something doesn't match. Player pages show "Stats updated <date, time> ET · through the <date> game", from the league feed's own timestamp.
- Nov 13: **Inputs in workflows.** Values typed into "Run workflow" reach scripts as environment variables, never pasted into a shell command (injury report, newsletter, NBA game store).
