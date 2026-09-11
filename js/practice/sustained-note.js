import { PITCH_TOLERANCE_OPTIONS_CENTS } from "../config.js";
import { computePitchStability, createHeldNoteTracker } from "../audio/pitch-smoothing.js";
import { centsDeviation } from "../music/tuning.js";
import { MATCH_NOTE_RULES, resolveMatchTarget, summarizeMatchErrors } from "./match-note.js";
import { scoreAttempt } from "./scoring.js";

export const SUSTAINED_DURATIONS_MS = Object.freeze([2000, 3000, 5000, 10000]);
export const SUSTAINED_DEFAULTS = Object.freeze({ holdDurationMs: 5000, toleranceCents: 20 });
export function validateSustainedSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !SUSTAINED_DURATIONS_MS.includes(value.holdDurationMs)
    || !PITCH_TOLERANCE_OPTIONS_CENTS.includes(value.toleranceCents)) {
    throw new RangeError("Choose a 2, 3, 5 or 10 second hold and a 20, 10 or 5 cent tolerance.");
  }
  return Object.freeze({ holdDurationMs: value.holdDurationMs, toleranceCents: value.toleranceCents });
}

// A valid hold measures time inside tolerance. Stability remains an independent
// observation, not another name for accuracy or a hidden completion threshold.
export function createSustainedNoteSession() {
  let settings = SUSTAINED_DEFAULTS, rules, tracker;
  let status, reason, target, startedAt, lastTimestamp, elapsedMs, errors, window,
    previousAcceptedAt, previousInTolerance, lastReliableAt, lastMatchingAt,
    dropoutActive, dropouts, voicedDurationMs, timeInToleranceMs,
    currentStableMs, bestStableMs, currentCents, recentStabilityCents, inGracePeriod;
  const makeRules = () => Object.freeze({ ...MATCH_NOTE_RULES, toleranceCents: settings.toleranceCents,
    stableDurationMs: settings.holdDurationMs, attemptDurationMs: 30000 });
  const clear = () => {
    rules = makeRules(); tracker = createHeldNoteTracker({ ...rules, toleranceCents: rules.toleranceCents + 1e-7 });
    status = "idle"; reason = null; target = null; startedAt = null; lastTimestamp = null;
    elapsedMs = 0; errors = []; window = []; previousAcceptedAt = null; previousInTolerance = false;
    lastReliableAt = null; lastMatchingAt = null; dropoutActive = false; dropouts = 0;
    voicedDurationMs = 0; timeInToleranceMs = 0; currentStableMs = 0; bestStableMs = 0;
    currentCents = null; recentStabilityCents = null; inGracePeriod = false;
  };
  clear();
  const snapshot = () => {
    const metrics = summarizeMatchErrors(errors);
    return Object.freeze({ kind: "sustained", status, reason, target,
    rules: status === "idle" ? makeRules() : rules, elapsedMs, voicedDurationMs, timeInToleranceMs,
    currentStableMs, bestStableMs, currentCents, recentStabilityCents, inGracePeriod, dropouts,
    metrics, scoring: scoreAttempt({ metrics, bestStableMs, requiredHoldMs: rules.stableDurationMs, completed: status === "complete" }) });
  };
  const validateTime = (now) => {
    if (!Number.isFinite(now) || now < 0 || (lastTimestamp !== null && now < lastTimestamp)) {
      throw new RangeError("Attempt timestamps must be finite, nonnegative, and monotonic.");
    }
  };
  const breakHold = () => { tracker.reset(); lastMatchingAt = null; currentStableMs = 0; inGracePeriod = false; };
  const markDropout = () => {
    if (!dropoutActive && lastReliableAt !== null) { dropouts += 1; dropoutActive = true; }
    previousAcceptedAt = null; previousInTolerance = false; currentCents = null; recentStabilityCents = null;
  };
  const advance = (now) => {
    if (status !== "running") return snapshot();
    validateTime(now); lastTimestamp = now; elapsedMs = Math.min(rules.attemptDurationMs, now - startedAt);
    if (lastReliableAt !== null && now - lastReliableAt > rules.gracePeriodMs) {
      markDropout(); window = []; breakHold();
    }
    if (lastMatchingAt !== null && now - lastMatchingAt > rules.gracePeriodMs) breakHold();
    if (elapsedMs >= rules.attemptDurationMs) {
      status = "finished"; reason = "timeout"; currentCents = null; recentStabilityCents = null; breakHold();
    }
    return snapshot();
  };
  return Object.freeze({
    getState: snapshot,
    getSettings: () => settings,
    configure(value) { settings = validateSustainedSettings(value); return settings; },
    start({ targetState, range, timestampMs }) {
      if (status === "running") return snapshot();
      const selected = resolveMatchTarget(targetState, range);
      if (!Number.isFinite(timestampMs) || timestampMs < 0) throw new RangeError("Invalid attempt start time.");
      clear(); target = selected; startedAt = timestampMs; lastTimestamp = timestampMs; status = "running";
      return snapshot();
    },
    advance,
    handlePitchFrame(frame, now) {
      if (status !== "running") return snapshot();
      validateTime(now);
      if (!frame || typeof frame.voiced !== "boolean" || typeof frame.accepted !== "boolean"
        || !Number.isFinite(frame.confidence) || frame.confidence < 0 || frame.confidence > 1
        || (frame.voiced && (!Number.isFinite(frame.frequencyHz) || frame.frequencyHz <= 0))) {
        throw new RangeError("Invalid attempt pitch frame.");
      }
      advance(now); if (status !== "running") return snapshot();
      const accepted = frame.voiced && frame.accepted && frame.confidence >= rules.confidenceThreshold;
      if (!accepted) {
        markDropout();
        inGracePeriod = lastMatchingAt !== null && now - lastMatchingAt <= rules.gracePeriodMs;
        // Keep only confirmed progress visible. Recovery can bridge a short gap,
        // but neither silence nor watchdog ticks can advance or complete a hold.
        if (!inGracePeriod) breakHold();
        return snapshot();
      }
      if (lastReliableAt === now) return snapshot();
      const cents = centsDeviation(frame.frequencyHz, target.frequencyHz);
      if (!Number.isFinite(cents) || Math.abs(cents) > 20000) throw new RangeError("Pitch is outside measurable bounds.");
      if (errors.length >= rules.maximumSamples) {
        status = "finished"; reason = "sample-limit"; currentCents = null; recentStabilityCents = null; breakHold();
        return snapshot();
      }
      const inTolerance = Math.abs(cents) <= rules.toleranceCents + 1e-7;
      const gap = previousAcceptedAt === null ? Infinity : now - previousAcceptedAt;
      if (gap <= rules.gracePeriodMs) {
        voicedDurationMs += gap;
        if (inTolerance && previousInTolerance) timeInToleranceMs += gap;
      }
      errors.push(cents); currentCents = cents; previousAcceptedAt = now; previousInTolerance = inTolerance;
      lastReliableAt = now; dropoutActive = false; inGracePeriod = false;
      window = window.filter((entry) => now - entry.time <= rules.stabilityWindowMs);
      window.push({ time: now, frequencyHz: frame.frequencyHz });
      recentStabilityCents = computePitchStability(window.map((entry) => entry.frequencyHz));
      if (!inTolerance) breakHold();
      else {
        const hold = tracker.update(frame, now, target.frequencyHz);
        lastMatchingAt = now; currentStableMs = hold.heldDurationMs;
        bestStableMs = Math.max(bestStableMs, currentStableMs);
        if (currentStableMs >= rules.stableDurationMs) { status = "complete"; reason = "held"; }
      }
      return snapshot();
    },
    breakContinuity() {
      // Reference exclusion is deliberate, so it does not count as a dropout.
      previousAcceptedAt = null; previousInTolerance = false; lastReliableAt = null;
      currentCents = null; recentStabilityCents = null; window = []; dropoutActive = false; breakHold();
      return snapshot();
    },
    stop(now, why = "stopped") {
      if (status !== "running") return snapshot();
      advance(now);
      if (status === "running") { status = "finished"; reason = why; currentCents = null; recentStabilityCents = null; breakHold(); }
      return snapshot();
    },
    reset() { settings = SUSTAINED_DEFAULTS; clear(); return snapshot(); },
  });
}
