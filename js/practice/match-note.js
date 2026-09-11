import { computePitchStability, createHeldNoteTracker } from "../audio/pitch-smoothing.js";
import { centsDeviation, noteToFrequency } from "../music/tuning.js";
import { createVocalRange } from "../music/vocal-range.js";
import { createTargetState, getActiveTarget } from "./target-note.js";
import { accuracyValue, scoreAttempt } from "./scoring.js";

export const MATCH_NOTE_RULES = Object.freeze({
  toleranceCents: 20, stabilityCents: 10, stableDurationMs: 1000,
  attemptDurationMs: 15000, confidenceThreshold: 0.82, gracePeriodMs: 120,
  stabilityWindowMs: 1000, maximumSamples: 1024,
});
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};

export function summarizeMatchErrors(errors) {
  if (!Array.isArray(errors) || errors.length > MATCH_NOTE_RULES.maximumSamples
    || !Array.from(errors).every((value) => Number.isFinite(value) && Math.abs(value) <= 20000)) {
    throw new RangeError("Invalid or oversized cents measurements.");
  }
  if (!errors.length) return Object.freeze({ sampleCount: 0, meanAbsoluteCents: null,
    medianAbsoluteCents: null, meanSignedCents: null, stabilityCents: null, accuracyScore: null });
  const absolute = errors.map(Math.abs);
  const meanAbsoluteCents = absolute.reduce((sum, value) => sum + value, 0) / errors.length;
  const center = median(errors);
  return Object.freeze({
    sampleCount: errors.length, meanAbsoluteCents, medianAbsoluteCents: median(absolute),
    meanSignedCents: errors.reduce((sum, value) => sum + value, 0) / errors.length,
    stabilityCents: errors.length < 3 ? null : median(errors.map((value) => Math.abs(value - center))),
    accuracyScore: Math.round(accuracyValue(meanAbsoluteCents)),
  });
}

export function resolveMatchTarget(targetState, value) {
  const validated = createTargetState(targetState);
  const target = getActiveTarget(validated);
  if (!target) throw new RangeError("Choose a note or exact-Hz target above before starting.");
  const range = createVocalRange(value);
  const lowHz = noteToFrequency(range.lowNote, validated.a4Hz);
  const highHz = noteToFrequency(range.highNote, validated.a4Hz);
  if (target.frequencyHz < lowHz - 1e-9 || target.frequencyHz > highHz + 1e-9) {
    throw new RangeError(`Choose a target inside your exercise range (${range.lowNote}–${range.highNote}), or edit that range in Settings.`);
  }
  return Object.freeze({ ...target, a4Hz: validated.a4Hz });
}

// Pure session state: no clock, DOM, audio ownership, persistence, or callbacks.
// Callers supply monotonic timestamps and accepted smoother frames.
export function createMatchNoteSession() {
  const rules = MATCH_NOTE_RULES;
  const tracker = createHeldNoteTracker({ ...rules, toleranceCents: rules.toleranceCents + 1e-7 });
  let status, reason, target, startedAt, lastTimestamp, elapsedMs, errors,
    previousAcceptedAt, voicedDurationMs, stableWindow, bestStableMs, currentStableMs, currentCents;
  const clear = () => {
    status = "idle"; reason = null; target = null; startedAt = null; lastTimestamp = null;
    elapsedMs = 0; errors = []; previousAcceptedAt = null; voicedDurationMs = 0;
    stableWindow = []; bestStableMs = 0; currentStableMs = 0; currentCents = null;
    tracker.reset();
  };
  clear();
  const snapshot = () => {
    const metrics = summarizeMatchErrors(errors);
    return Object.freeze({ status, reason, target, elapsedMs, voicedDurationMs,
      bestStableMs, currentStableMs, currentCents, metrics,
      scoring: scoreAttempt({ metrics, bestStableMs, requiredHoldMs: rules.stableDurationMs, completed: status === "complete" }) });
  };
  const timestamp = (now) => {
    if (!Number.isFinite(now) || now < 0 || (lastTimestamp !== null && now < lastTimestamp)) {
      throw new RangeError("Attempt timestamps must be finite, nonnegative, and monotonic.");
    }
  };
  const advance = (now) => {
    if (status !== "running") return snapshot();
    timestamp(now);
    lastTimestamp = now;
    elapsedMs = Math.min(rules.attemptDurationMs, now - startedAt);
    if (previousAcceptedAt !== null && now - previousAcceptedAt > rules.gracePeriodMs) {
      previousAcceptedAt = null; stableWindow = []; currentStableMs = 0; currentCents = null; tracker.reset();
    }
    if (elapsedMs >= rules.attemptDurationMs) { status = "finished"; reason = "timeout"; currentStableMs = 0; currentCents = null; }
    return snapshot();
  };
  return Object.freeze({
    getState: snapshot,
    start({ targetState, range, timestampMs }) {
      if (status === "running") return snapshot();
      const nextTarget = resolveMatchTarget(targetState, range);
      if (!Number.isFinite(timestampMs) || timestampMs < 0) throw new RangeError("Invalid attempt start time.");
      clear(); target = nextTarget; startedAt = timestampMs; lastTimestamp = timestampMs; status = "running";
      return snapshot();
    },
    advance,
    breakContinuity() {
      previousAcceptedAt = null; stableWindow = []; currentStableMs = 0; currentCents = null;
      tracker.reset();
      return snapshot();
    },
    handlePitchFrame(frame, now) {
      if (status !== "running") return snapshot();
      timestamp(now);
      if (!frame || typeof frame.voiced !== "boolean" || typeof frame.accepted !== "boolean"
        || !Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1
        || (frame.voiced && (!Number.isFinite(frame.frequencyHz) || frame.frequencyHz <= 0))) {
        throw new RangeError("Invalid attempt pitch frame.");
      }
      advance(now);
      if (status !== "running") return snapshot();
      const accepted = frame.voiced && frame.accepted && frame.confidence >= rules.confidenceThreshold;
      const gap = previousAcceptedAt === null ? Infinity : now - previousAcceptedAt;
      // Ignore duplicate accepted measurements rather than inventing voiced time.
      if (accepted && gap === 0) return snapshot();
      if (gap > rules.gracePeriodMs) stableWindow = [];
      currentCents = accepted ? centsDeviation(frame.frequencyHz, target.frequencyHz) : null;
      if (accepted) {
        if (!Number.isFinite(currentCents) || Math.abs(currentCents) > 20000) throw new RangeError("Pitch is outside measurable bounds.");
        if (errors.length >= rules.maximumSamples) { status = "finished"; reason = "sample-limit"; return snapshot(); }
        errors.push(currentCents);
        if (gap <= rules.gracePeriodMs) voicedDurationMs += gap;
        previousAcceptedAt = now;
        stableWindow = stableWindow.filter((entry) => now - entry.time <= rules.stabilityWindowMs);
        stableWindow.push({ time: now, frequencyHz: frame.frequencyHz });
      } else {
        previousAcceptedAt = null;
        stableWindow = [];
      }
      const stability = computePitchStability(stableWindow.map((entry) => entry.frequencyHz));
      const stable = accepted && stability !== null && stability <= rules.stabilityCents + 1e-7;
      const hold = tracker.update({ voiced: stable, frequencyHz: stable ? frame.frequencyHz : null,
        confidence: frame.confidence }, now, target.frequencyHz);
      currentStableMs = hold.inTolerance ? hold.heldDurationMs : 0;
      bestStableMs = Math.max(bestStableMs, hold.longestHeldDurationMs);
      if (hold.inTolerance && currentStableMs >= rules.stableDurationMs) { status = "complete"; reason = "matched"; }
      return snapshot();
    },
    stop(now, why = "stopped") {
      if (status !== "running") return snapshot();
      advance(now);
      if (status === "running") { status = "finished"; reason = why; currentStableMs = 0; currentCents = null; }
      return snapshot();
    },
    reset() { clear(); return snapshot(); },
  });
}
