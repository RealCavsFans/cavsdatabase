// The current NBA season in one place (Nov 21, Luka). Every data script reads the season from here instead of writing
// '2026-27' itself, so the jobs roll over together. The season turns over on Aug 1 (Eastern); SEASON in the environment
// still overrides it (a past-season backfill). Regular-season dates: add next season's row to DATES when the NBA
// releases the schedule; until then a season gets Oct 1 to Apr 30, wide enough not to miss a game.
const DATES = { '2025-26': ['2025-10-21', '2026-04-12'], '2026-27': ['2026-10-20', '2027-04-12'] };
const etDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
export const seasonOf = (day = etDay()) => { const y = +day.slice(0, 4), m = +day.slice(5, 7); const s = m >= 8 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
export const CUR_SEASON = seasonOf();
export const SEASON = process.env.SEASON || CUR_SEASON;
export const prevOf = se => `${+se.slice(0, 4) - 1}-${se.slice(2, 4)}`;
export const PREV_SEASON = prevOf(CUR_SEASON);
export const dash = se => se.replace('-', '–');   // '2026-27' -> '2026–27' for labels
export const datesOf = se => DATES[se] || [`${se.slice(0, 4)}-10-01`, `${+se.slice(0, 4) + 1}-04-30`];
export const [START, END] = datesOf(CUR_SEASON);
