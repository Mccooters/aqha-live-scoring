// Break timer (schema-v53): staff or the gate start a timed break; the live
// page shows a countdown and the return time. Pure helpers shared by the
// dashboard, gate page and public event page.

export const BREAK_PRESETS = [10, 15, 30, 45, 60];

// { active, until: Date|null, label, minutesLeft } — a break whose end has
// passed is over; nothing is stored back, it just stops showing.
export function breakState(event, now = new Date()) {
  const raw = event?.break_until;
  if (!raw) return { active: false, until: null, label: "", minutesLeft: 0 };
  const until = new Date(raw);
  if (Number.isNaN(until.getTime()) || until <= now) return { active: false, until: null, label: "", minutesLeft: 0 };
  return {
    active: true,
    until,
    label: String(event?.break_label ?? "").trim() || "Break",
    minutesLeft: Math.max(1, Math.ceil((until - now) / 60000)),
  };
}

export const fmtClock = (date) =>
  date ? new Date(date).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).toLowerCase() : "";

// The next program break coming up for the live/next class, if any — used
// as the default name when starting a break.
export function suggestedBreakLabel(liveClass, nextClass, normalise) {
  const after = normalise(liveClass?.program_break_after);
  if (after) return after;
  const before = normalise(nextClass?.program_break_before);
  if (before) return before;
  return "Break";
}
