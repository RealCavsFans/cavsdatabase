# cavsdatabase.com

Independent Cleveland Cavaliers reference site. Static, no build step.

- `index.html` — the whole site. Data lives in constants at the top of its script and is refreshed by a daily scheduled update.
- `videos.json` — latest videos from the official Cavs YouTube channel, written by `scripts/fetch-videos.mjs`.
- `.github/workflows/videos.yml` — runs the video job every 30 minutes.

Not affiliated with the Cleveland Cavaliers or the NBA.
