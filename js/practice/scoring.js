export const SCORE_WEIGHTS = Object.freeze({ accuracy: 0.5, stability: 0.2, hold: 0.2, completion: 0.1 });
const bounded = (value, min, max, label) => {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${label}.`);
  return value;
};
export function accuracyValue(meanAbsoluteCents) {
  return Math.max(0, 100 - bounded(meanAbsoluteCents, 0, 20000, "mean absolute error"));
}

// Versioned, deterministic practice feedback. No clock, audio, storage or DOM.
// Use unrounded components for arithmetic; rounding is only for displayed totals.
export function scoreAttempt({ metrics, bestStableMs, requiredHoldMs, completed }) {
  if (!metrics || !Number.isInteger(metrics.sampleCount) || metrics.sampleCount < 0 || metrics.sampleCount > 1024
    || typeof completed !== "boolean") throw new RangeError("Invalid score input.");
  bounded(bestStableMs, 0, 30000, "best hold"); bounded(requiredHoldMs, 1, 30000, "required hold");
  const accuracy = metrics.sampleCount === 0 ? null : accuracyValue(metrics.meanAbsoluteCents);
  if (metrics.sampleCount === 0 && metrics.meanAbsoluteCents !== null) throw new RangeError("Empty measurements must have no error estimate.");
  const stability = metrics.stabilityCents === null ? null
    : Math.max(0, 100 - 2 * bounded(metrics.stabilityCents, 0, 20000, "stability spread"));
  const values = { accuracy, stability, hold: 100 * Math.min(1, bestStableMs / requiredHoldMs), completion: completed ? 100 : 0 };
  const components = Object.freeze(Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
    Object.freeze({ value, weight: SCORE_WEIGHTS[name], points: value === null ? null : value * SCORE_WEIGHTS[name] })])));
  const eligibility = metrics.sampleCount === 0 ? "no-data" : metrics.sampleCount < 3 || stability === null ? "insufficient-data" : "scored";
  const unroundedTotal = eligibility === "scored" ? Object.values(components).reduce((sum, part) => sum + part.points, 0) : null;
  return Object.freeze({ version: 1, eligibility, components, unroundedTotal,
    total: unroundedTotal === null ? null : Math.round(Math.min(100, Math.max(0, unroundedTotal))),
    inputs: Object.freeze({ sampleCount: metrics.sampleCount, meanAbsoluteCents: metrics.meanAbsoluteCents,
      stabilityCents: metrics.stabilityCents, bestStableMs, requiredHoldMs, completed }) });
}

export function summarizePracticeScores(results) {
  if (!Array.isArray(results) || results.length > 100) throw new RangeError("Use at most 100 results.");
  const scored = results.filter((result) => result.scoring?.unroundedTotal !== null && result.scoring?.unroundedTotal !== undefined);
  for (const row of scored) bounded(row.scoring.unroundedTotal, 0, 100, "practice score");
  return Object.freeze({ count: scored.length, excluded: results.length - scored.length,
    average: scored.length ? Math.round(scored.reduce((sum, row) => sum + row.scoring.unroundedTotal, 0) / scored.length) : null });
}
