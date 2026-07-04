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
