/** Formats the compact MVP line shown above the final box score. */
export function formatMvpStats(sport, line) {
  if (sport.id === "nba") {
    return `${rounded(line.pts)} PTS / ${rounded(line.reb)} REB / ${rounded(line.ast)} AST`;
  }

  const labels = new Map(sport.boxColumns || []);
  const stats = (sport.lineKeys || [])
    .map((key, order) => ({ key, order, value: numeric(line[key]) }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .slice(0, 3);

  return stats.length
    ? stats.map(({ key, value }) => `${Math.round(value)} ${labels.get(key) || key.toUpperCase()}`).join(" / ")
    : "No recorded statistics";
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rounded(value) {
  return Math.round(numeric(value));
}
