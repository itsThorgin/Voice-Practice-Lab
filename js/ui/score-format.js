export const displayScore = (value) => value === null ? "-" : `${Math.round(value)} / 100`;
export const displayScorePart = (part) => part.value === null ? "-"
  : `${Math.round(part.value)} / 100 → ${part.points.toFixed(1)} of ${Math.round(part.weight * 100)} points`;
export const displayPracticeAverage = (summary) => `Practice average: ${displayScore(summary.average)} (${summary.count} scored, ${summary.excluded} insufficient/empty).`;
export const displayPracticeBreakdown = (scoring) => {
  if (!scoring || scoring.total === null) return "Practice score:: (at least 3 reliable frames and a stability estimate required).";
  const parts = scoring.components;
  return `Practice score: ${displayScore(scoring.total)} · Accuracy ${displayScorePart(parts.accuracy)}; stability ${displayScorePart(parts.stability)}; hold ${displayScorePart(parts.hold)}; completion ${displayScorePart(parts.completion)}.`;
};
