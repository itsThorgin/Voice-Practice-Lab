import {
  HELD_NOTE_DEFAULTS,
  PITCH_SMOOTHING_DEFAULTS,
} from "../config.js";
import { centsDeviation } from "../music/tuning.js";

function validateFiniteInRange(value, minimum, maximum, label) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
}

function validatePositiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function absoluteCentsBetween(firstHz, secondHz) {
  return Math.abs(centsDeviation(firstHz, secondHz));
}

function interpolateFrequency(previousHz, nextHz, factor) {
  const distanceCents = centsDeviation(nextHz, previousHz);
  return previousHz * 2 ** ((distanceCents * factor) / 1200);
}

function readPitchFrame(frame) {
  if (!frame || typeof frame !== "object") {
    throw new TypeError("Pitch frame must be an object.");
  }
  if (typeof frame.voiced !== "boolean") {
    throw new TypeError("Pitch frame voiced state must be boolean.");
  }
  validateFiniteInRange(frame.confidence, 0, 1, "Pitch frame confidence");
  if (frame.voiced) {
    validatePositiveFinite(frame.frequencyHz, "Voiced pitch frequency");
  }

  return {
    confidence: frame.confidence,
    frequencyHz: frame.voiced ? frame.frequencyHz : null,
    reason: frame.reason ?? null,
    voiced: frame.voiced,
  };
}

function validateTimestamp(timestampMs, previousTimestampMs) {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError("Timestamp must be a finite number greater than or equal to zero.");
  }
  if (previousTimestampMs !== null && timestampMs < previousTimestampMs) {
    throw new RangeError("Timestamps must not move backward.");
  }
}

function resolveSmoothingOptions(options = {}) {
  const resolved = { ...PITCH_SMOOTHING_DEFAULTS, ...options };

  validateFiniteInRange(resolved.confidenceThreshold, 0, 1, "Confidence threshold");
  if (
    !Number.isInteger(resolved.medianWindowSize) ||
    resolved.medianWindowSize < 1 ||
    resolved.medianWindowSize > 31 ||
    resolved.medianWindowSize % 2 === 0
  ) {
    throw new RangeError("Median window size must be an odd integer from 1 to 31.");
  }
  validateFiniteInRange(resolved.smoothingFactor, Number.EPSILON, 1, "Smoothing factor");
  validatePositiveFinite(resolved.stabilityWindowMs, "Stability window");
  if (!Number.isInteger(resolved.minimumStabilitySamples) || resolved.minimumStabilitySamples < 2) {
    throw new RangeError("Minimum stability samples must be an integer of at least two.");
  }
  if (
    !Number.isInteger(resolved.maximumHistorySize) ||
    resolved.maximumHistorySize < resolved.minimumStabilitySamples
  ) {
    throw new RangeError("Maximum history size must fit the minimum stability samples.");
  }
  validatePositiveFinite(resolved.noteChangeThresholdCents, "Note-change threshold");
  validateFiniteInRange(resolved.octaveToleranceCents, 0, 300, "Octave tolerance");
  if (!Number.isInteger(resolved.octaveConfirmationFrames) || resolved.octaveConfirmationFrames < 2) {
    throw new RangeError("Octave confirmation frames must be an integer of at least two.");
  }
  validateFiniteInRange(resolved.silenceResetMs, 0, 60_000, "Silence reset");
  validatePositiveFinite(resolved.transitionConsistencyCents, "Transition consistency");

  return Object.freeze(resolved);
}

function resolveHeldNoteOptions(options = {}) {
  const resolved = { ...HELD_NOTE_DEFAULTS, ...options };
  validateFiniteInRange(resolved.confidenceThreshold, 0, 1, "Confidence threshold");
  validateFiniteInRange(resolved.gracePeriodMs, 0, 10_000, "Grace period");
  validatePositiveFinite(resolved.toleranceCents, "Pitch tolerance");
  return Object.freeze(resolved);
}

export function computePitchStability(frequenciesHz, { minimumSamples = 3 } = {}) {
  if (!frequenciesHz || typeof frequenciesHz.length !== "number") {
    throw new TypeError("Pitch values must be an array-like collection.");
  }
  if (!Number.isInteger(minimumSamples) || minimumSamples < 2) {
    throw new RangeError("Minimum samples must be an integer of at least two.");
  }

  const cents = Array.from(frequenciesHz, (frequencyHz) => {
    validatePositiveFinite(frequencyHz, "Pitch frequency");
    return 1200 * Math.log2(frequencyHz);
  });
  if (cents.length < minimumSamples) {
    return null;
  }

  const center = median(cents);
  return median(cents.map((value) => Math.abs(value - center)));
}

export function createPitchSmoother(options = {}) {
  const resolved = resolveSmoothingOptions(options);
  let medianValues = [];
  let stabilityEntries = [];
  let smoothedFrequencyHz = null;
  let lastAcceptedAt = null;
  let lastTimestampMs = null;
  let pendingOctave = null;
  let state = Object.freeze({
    accepted: false,
    confidence: 0,
    filteredFrequencyHz: null,
    frequencyHz: null,
    rawFrequencyHz: null,
    reason: "reset",
    stabilityCents: null,
    stabilitySampleCount: 0,
    timestampMs: null,
    transitioned: false,
    voiced: false,
  });

  function clearPitchHistory() {
    medianValues = [];
    stabilityEntries = [];
    smoothedFrequencyHz = null;
    lastAcceptedAt = null;
    pendingOctave = null;
  }

  function stabilityAt(timestampMs, frequencyHz, reset = false) {
    if (reset) {
      stabilityEntries = [];
    }
    const earliestTimestamp = timestampMs - resolved.stabilityWindowMs;
    stabilityEntries = stabilityEntries.filter(
      (entry) => entry.timestampMs >= earliestTimestamp,
    );
    stabilityEntries.push({ frequencyHz, timestampMs });
    if (stabilityEntries.length > resolved.maximumHistorySize) {
      stabilityEntries.splice(0, stabilityEntries.length - resolved.maximumHistorySize);
    }

    return computePitchStability(
      stabilityEntries.map((entry) => entry.frequencyHz),
      { minimumSamples: resolved.minimumStabilitySamples },
    );
  }

  function isOctaveJump(frequencyHz) {
    if (smoothedFrequencyHz === null) {
      return false;
    }
    const distance = absoluteCentsBetween(frequencyHz, smoothedFrequencyHz);
    const octaveCount = Math.round(distance / 1200);
    return (
      octaveCount >= 1 &&
      Math.abs(distance - octaveCount * 1200) <= resolved.octaveToleranceCents
    );
  }

  function unavailableResult(frame, timestampMs, reason) {
    pendingOctave = null;
    if (
      lastAcceptedAt !== null &&
      timestampMs - lastAcceptedAt >= resolved.silenceResetMs
    ) {
      clearPitchHistory();
    }
    state = Object.freeze({
      accepted: false,
      confidence: frame.confidence,
      filteredFrequencyHz: null,
      frequencyHz: null,
      rawFrequencyHz: frame.frequencyHz,
      reason,
      stabilityCents: null,
      stabilitySampleCount: stabilityEntries.length,
      timestampMs,
      transitioned: false,
      voiced: false,
    });
    return state;
  }

  return Object.freeze({
    getState() {
      return state;
    },

    reset() {
      clearPitchHistory();
      lastTimestampMs = null;
      state = Object.freeze({
        accepted: false,
        confidence: 0,
        filteredFrequencyHz: null,
        frequencyHz: null,
        rawFrequencyHz: null,
        reason: "reset",
        stabilityCents: null,
        stabilitySampleCount: 0,
        timestampMs: null,
        transitioned: false,
        voiced: false,
      });
      return state;
    },

    update(rawFrame, timestampMs) {
      validateTimestamp(timestampMs, lastTimestampMs);
      const frame = readPitchFrame(rawFrame);
      lastTimestampMs = timestampMs;

      if (!frame.voiced) {
        return unavailableResult(frame, timestampMs, frame.reason ?? "unvoiced");
      }
      if (frame.confidence < resolved.confidenceThreshold) {
        return unavailableResult(frame, timestampMs, "low-confidence");
      }

      if (
        lastAcceptedAt !== null &&
        timestampMs - lastAcceptedAt >= resolved.silenceResetMs
      ) {
        clearPitchHistory();
      }

      let confirmedOctaveTransition = false;
      if (isOctaveJump(frame.frequencyHz)) {
        const agreesWithPending =
          pendingOctave !== null &&
          absoluteCentsBetween(frame.frequencyHz, pendingOctave.frequencyHz) <=
            resolved.transitionConsistencyCents;
        pendingOctave = agreesWithPending
          ? {
              count: pendingOctave.count + 1,
              frequencyHz: frame.frequencyHz,
            }
          : { count: 1, frequencyHz: frame.frequencyHz };

        if (pendingOctave.count < resolved.octaveConfirmationFrames) {
          state = Object.freeze({
            accepted: false,
            confidence: frame.confidence,
            filteredFrequencyHz: smoothedFrequencyHz,
            frequencyHz: smoothedFrequencyHz,
            rawFrequencyHz: frame.frequencyHz,
            reason: "octave-candidate",
            stabilityCents: computePitchStability(
              stabilityEntries.map((entry) => entry.frequencyHz),
              { minimumSamples: resolved.minimumStabilitySamples },
            ),
            stabilitySampleCount: stabilityEntries.length,
            timestampMs,
            transitioned: false,
            voiced: smoothedFrequencyHz !== null,
          });
          return state;
        }

        clearPitchHistory();
        confirmedOctaveTransition = true;
      } else {
        pendingOctave = null;
      }

      medianValues.push(frame.frequencyHz);
      if (medianValues.length > resolved.medianWindowSize) {
        medianValues.shift();
      }
      let filteredFrequencyHz = median(medianValues);
      let transitioned = confirmedOctaveTransition;

      if (
        smoothedFrequencyHz !== null &&
        absoluteCentsBetween(filteredFrequencyHz, smoothedFrequencyHz) >=
          resolved.noteChangeThresholdCents
      ) {
        medianValues = [frame.frequencyHz];
        filteredFrequencyHz = frame.frequencyHz;
        smoothedFrequencyHz = frame.frequencyHz;
        transitioned = true;
      } else if (smoothedFrequencyHz === null) {
        smoothedFrequencyHz = filteredFrequencyHz;
      } else {
        smoothedFrequencyHz = interpolateFrequency(
          smoothedFrequencyHz,
          filteredFrequencyHz,
          resolved.smoothingFactor,
        );
      }

      const stabilityCents = stabilityAt(
        timestampMs,
        frame.frequencyHz,
        transitioned,
      );
      lastAcceptedAt = timestampMs;
      state = Object.freeze({
        accepted: true,
        confidence: frame.confidence,
        filteredFrequencyHz,
        frequencyHz: smoothedFrequencyHz,
        rawFrequencyHz: frame.frequencyHz,
        reason: null,
        stabilityCents,
        stabilitySampleCount: stabilityEntries.length,
        timestampMs,
        transitioned,
        voiced: true,
      });
      return state;
    },
  });
}

export function createHeldNoteTracker(options = {}) {
  const resolved = resolveHeldNoteOptions(options);
  let activeTargetHz = null;
  let holdStartedAt = null;
  let lastMatchingAt = null;
  let lastTimestampMs = null;
  let longestHeldDurationMs = 0;
  let state = Object.freeze({
    cents: null,
    confidence: 0,
    heldDurationMs: 0,
    holding: false,
    inGracePeriod: false,
    inTolerance: false,
    longestHeldDurationMs: 0,
    targetFrequencyHz: null,
    timestampMs: null,
  });

  function clearCurrentHold() {
    holdStartedAt = null;
    lastMatchingAt = null;
  }

  function resetAll() {
    activeTargetHz = null;
    clearCurrentHold();
    lastTimestampMs = null;
    longestHeldDurationMs = 0;
  }

  return Object.freeze({
    getState() {
      return state;
    },

    reset() {
      resetAll();
      state = Object.freeze({
        cents: null,
        confidence: 0,
        heldDurationMs: 0,
        holding: false,
        inGracePeriod: false,
        inTolerance: false,
        longestHeldDurationMs: 0,
        targetFrequencyHz: null,
        timestampMs: null,
      });
      return state;
    },

    update(pitchFrame, timestampMs, targetFrequencyHz) {
      validateTimestamp(timestampMs, lastTimestampMs);
      validatePositiveFinite(targetFrequencyHz, "Target frequency");
      const frame = readPitchFrame(pitchFrame);
      lastTimestampMs = timestampMs;

      if (activeTargetHz !== targetFrequencyHz) {
        activeTargetHz = targetFrequencyHz;
        clearCurrentHold();
        longestHeldDurationMs = 0;
      }

      const cents = frame.voiced
        ? centsDeviation(frame.frequencyHz, targetFrequencyHz)
        : null;
      const inTolerance =
        frame.voiced &&
        frame.confidence >= resolved.confidenceThreshold &&
        Math.abs(cents) <= resolved.toleranceCents;
      let holding = false;
      let inGracePeriod = false;
      let heldDurationMs = 0;

      if (inTolerance) {
        if (
          holdStartedAt === null ||
          timestampMs - lastMatchingAt > resolved.gracePeriodMs
        ) {
          holdStartedAt = timestampMs;
        }
        lastMatchingAt = timestampMs;
        heldDurationMs = timestampMs - holdStartedAt;
        longestHeldDurationMs = Math.max(longestHeldDurationMs, heldDurationMs);
        holding = true;
      } else if (
        holdStartedAt !== null &&
        timestampMs - lastMatchingAt <= resolved.gracePeriodMs
      ) {
        heldDurationMs = timestampMs - holdStartedAt;
        holding = true;
        inGracePeriod = true;
      } else {
        clearCurrentHold();
      }

      state = Object.freeze({
        cents,
        confidence: frame.confidence,
        heldDurationMs,
        holding,
        inGracePeriod,
        inTolerance,
        longestHeldDurationMs,
        targetFrequencyHz,
        timestampMs,
      });
      return state;
    },
  });
}
