export function normaliseCategoryLabel(value, fallback = "") {
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  return label || fallback;
}

export function categoryKey(value) {
  return normaliseCategoryLabel(value).toLowerCase();
}

export function normaliseBreakLabel(value) {
  return normaliseCategoryLabel(value);
}

export function groupedByProgramCategory(classes, fallbackLabel = "") {
  const groups = [];
  classes.forEach((cls) => {
    const label = normaliseCategoryLabel(cls.program_category, fallbackLabel);
    const key = categoryKey(label);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.classes.push(cls);
    } else {
      groups.push({ key, label, classes: [cls] });
    }
  });
  return groups;
}

// Hidden classes (schema-v38) stay off every public page, but a program break
// attached to one (e.g. lunch noted on a class that was later hidden for
// having no entries) is still part of the day — carry the label onto the next
// visible class so the break never vanishes with the class.
export function withoutHiddenClasses(classes) {
  const visible = [];
  let carried = [];
  (classes ?? []).forEach((cls) => {
    if (cls.hidden) {
      const before = normaliseBreakLabel(cls.program_break_before);
      const after = normaliseBreakLabel(cls.program_break_after);
      if (before) carried.push(before);
      if (after) carried.push(after);
      return;
    }
    if (carried.length) {
      const own = normaliseBreakLabel(cls.program_break_before);
      visible.push({ ...cls, program_break_before: [...carried, own].filter(Boolean).join(" · ") });
      carried = [];
    } else {
      visible.push(cls);
    }
  });
  if (carried.length && visible.length) {
    const last = visible[visible.length - 1];
    const own = normaliseBreakLabel(last.program_break_after);
    visible[visible.length - 1] = { ...last, program_break_after: [own, ...carried].filter(Boolean).join(" · ") };
  }
  return visible;
}

export function programDisplayRows(classes, fallbackCategory = "") {
  const rows = [];
  let previousCategoryKey = "";

  classes.forEach((cls) => {
    const breakLabel = normaliseBreakLabel(cls.program_break_before);
    if (breakLabel) rows.push({ type: "break", key: `break-${cls.id}`, label: breakLabel });

    const categoryLabel = normaliseCategoryLabel(cls.program_category, fallbackCategory);
    const nextCategoryKey = categoryKey(categoryLabel);
    if (categoryLabel && nextCategoryKey !== previousCategoryKey) {
      rows.push({ type: "category", key: `category-${cls.id}`, label: categoryLabel });
    }
    previousCategoryKey = nextCategoryKey;

    rows.push({ type: "class", key: cls.id, cls });

    const breakAfterLabel = normaliseBreakLabel(cls.program_break_after);
    if (breakAfterLabel) rows.push({ type: "break", key: `break-after-${cls.id}`, label: breakAfterLabel });
  });

  return rows;
}
