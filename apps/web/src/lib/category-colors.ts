interface CategoryColor {
  text: string;
  bg: string;
  dot: string;
}

const categoryMap: Record<string, CategoryColor> = {
  cricket: { text: "#1B3D2F", bg: "#E8F0EC", dot: "#1B3D2F" },
  "1st xi": { text: "#1B3D2F", bg: "#E8F0EC", dot: "#1B3D2F" },
  "2nd xi": { text: "#1d4ed8", bg: "#dbeafe", dot: "#1d4ed8" },
  senior: { text: "#1B3D2F", bg: "#E8F0EC", dot: "#1B3D2F" },
  running: { text: "#1d4ed8", bg: "#dbeafe", dot: "#1d4ed8" },
  football: { text: "#7c3aed", bg: "#ede9fe", dot: "#7c3aed" },
  boxing: { text: "#d97706", bg: "#fef3c7", dot: "#d97706" },
  charity: { text: "#b91c1c", bg: "#fee2e2", dot: "#b91c1c" },
  refugee: { text: "#b91c1c", bg: "#fee2e2", dot: "#b91c1c" },
  junior: { text: "#d97706", bg: "#fef3c7", dot: "#d97706" },
  women: { text: "#7c3aed", bg: "#ede9fe", dot: "#7c3aed" },
};

const defaultColor: CategoryColor = {
  text: "#1B3D2F",
  bg: "#E8F0EC",
  dot: "#1B3D2F",
};

export function getCategoryColor(tagTitle: string): CategoryColor {
  const lower = tagTitle.toLowerCase();
  for (const [keyword, color] of Object.entries(categoryMap)) {
    // eslint-disable-next-line react-doctor/js-set-map-lookups -- String.prototype.includes does substring search; can't be replaced by Set.has
    if (lower.includes(keyword)) {
      return color;
    }
  }
  return defaultColor;
}
