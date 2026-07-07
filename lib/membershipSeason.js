// Club membership season helpers. A season runs 1 August – 31 July and is
// written "2026-2027" (same format the High Points page uses). Used on both
// the server (API routes) and in the browser, so keep this file plain JS
// with no imports.

// The season a given date falls inside.
export function currentSeason(date = new Date()) {
  const y = date.getFullYear();
  return date.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// The season a NEW membership bought on this date belongs to. During July —
// the last month of the old season — sign-ups count for the season about to
// start (1 August), so people renewing early aren't sold a membership that
// expires in a few weeks.
export function signupSeason(date = new Date()) {
  const y = date.getFullYear();
  if (date.getMonth() === 6) return `${y}-${y + 1}`; // July → the coming season
  return currentSeason(date);
}

// Seasons whose approved members count as "current" on this date. Normally
// just the current season; during July, next season's early sign-ups are
// valid immediately too.
export function activeSeasons(date = new Date()) {
  const seasons = [currentSeason(date)];
  const forSignup = signupSeason(date);
  if (!seasons.includes(forSignup)) seasons.push(forSignup);
  return seasons;
}

// "2026-2027" → "2026-27 (1 Aug 2026 – 31 Jul 2027)" style label.
export function seasonLabel(season) {
  const parts = String(season ?? "").split("-");
  if (parts.length !== 2) return season;
  return `${parts[0]}–${parts[1].slice(2)} season (1 Aug ${parts[0]} – 31 Jul ${parts[1]})`;
}
