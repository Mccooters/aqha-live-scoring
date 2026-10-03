// Suggests a High Points category from a class name + program heading (the
// same guesswork the class-import template used). Returns "" when unsure —
// open classes earn no club points and are left blank on purpose.
export function suggestHpCategory(cls) {
  const name = String(cls?.name ?? "").toLowerCase();
  const section = String(cls?.program_category ?? "").toLowerCase();
  if (/\bopen\b/.test(name)) return "";
  if (/lead ?line/.test(name)) return "Leadline";
  if (/\byouth\b/.test(name)) return "Youth";
  if (/\bewd\b/.test(name)) return "EWD";
  if (/beginner/.test(name)) return "Beginner";
  if (/improver/.test(name)) return "Beginner";
  if (/select\s*am/.test(name)) return "Select";
  if (/novice\s*am/.test(name)) return "Novice Amateur";
  if (/amateur|\ba\/o\b/.test(name)) return "Amateur";
  if (/junior horse/.test(name)) return "Junior Horse";
  if (/senior horse/.test(name)) return "Senior Horse";
  if (/halter/.test(section) || /champ|supreme|colt|stallion|filly|mare|gelding/.test(name)) return "Overall Halter";
  if (/lungeline|lunge ?line|hunter in hand|led trail/.test(section + " " + name)) {
    if (/\b2 ?yr/.test(name)) return "Overall 2YO";
    if (/\b3 ?yrs?/.test(name)) return "Overall 3YO";
  }
  return "";
}
