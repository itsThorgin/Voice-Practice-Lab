import { TARGET_DEFAULTS } from "../config.js";
import { NOTE_NAMES, parseNote } from "../music/notes.js";
import {
  COMMON_A4_REFERENCES,
  DEFAULT_A4_HZ,
  frequencyToNote,
  noteToFrequency,
  validateA4,
} from "../music/tuning.js";

export const TARGET_SOURCE = Object.freeze({
  EXACT_HZ: "exact-hz",
  NOTE: "note",
});

export const A4_SOURCE = Object.freeze({
  CUSTOM: "custom",
  PRESET: "preset",
});

function validateFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
}

function validateSampleRate(sampleRate) {
  if (sampleRate === null) {
    return null;
  }
  validateFinite(sampleRate, "Sample rate");
  if (sampleRate <= 0) {
    throw new RangeError("Sample rate must be greater than zero.");
  }
  return sampleRate;
}

function validateSource(source) {
  if (!Object.values(TARGET_SOURCE).includes(source)) {
    throw new RangeError("Target source must be note or exact-hz.");
  }
  return source;
}

function validateA4Source(source) {
  if (!Object.values(A4_SOURCE).includes(source)) {
    throw new RangeError("A4 source must be preset or custom.");
  }
  return source;
}

function validatePitchClass(pitchClass) {
  if (!NOTE_NAMES.includes(pitchClass)) {
    throw new RangeError("Target note must use one of the available sharp note names.");
  }
  return pitchClass;
}

function validateOctave(octave) {
  if (
    !Number.isInteger(octave) ||
    octave < TARGET_DEFAULTS.minimumNoteOctave ||
    octave > TARGET_DEFAULTS.maximumNoteOctave
  ) {
    throw new RangeError(
      `Target octave must be an integer from ${TARGET_DEFAULTS.minimumNoteOctave} to ${TARGET_DEFAULTS.maximumNoteOctave}.`,
    );
  }
  return octave;
}

export function resolveTargetFrequencyBounds(sampleRate = null) {
  const validatedSampleRate = validateSampleRate(sampleRate);
  const sampleRateMaximum = validatedSampleRate === null
    ? TARGET_DEFAULTS.exactMaximumFrequencyHz
    : validatedSampleRate / 2;
  const maximumHz = Math.min(
    TARGET_DEFAULTS.exactMaximumFrequencyHz,
    sampleRateMaximum,
  );
  if (maximumHz < TARGET_DEFAULTS.exactMinimumFrequencyHz) {
    throw new RangeError("Sample rate is too low for the supported target-frequency range.");
  }
  return Object.freeze({
    maximumHz,
    minimumHz: TARGET_DEFAULTS.exactMinimumFrequencyHz,
  });
}

export function validateTargetFrequency(frequencyHz, sampleRate = null) {
  validateFinite(frequencyHz, "Exact target frequency");
  const bounds = resolveTargetFrequencyBounds(sampleRate);
  if (frequencyHz < bounds.minimumHz || frequencyHz > bounds.maximumHz) {
    throw new RangeError(
      `Exact target frequency must be from ${bounds.minimumHz} to ${bounds.maximumHz} Hz.`,
    );
  }
  return frequencyHz;
}

export function clampTargetFrequency(frequencyHz, sampleRate = null) {
  validateFinite(frequencyHz, "Exact target frequency");
  const bounds = resolveTargetFrequencyBounds(sampleRate);
  return Math.min(bounds.maximumHz, Math.max(bounds.minimumHz, frequencyHz));
}

function nearestSelection(frequencyHz, a4Hz) {
  const nearest = frequencyToNote(frequencyHz, a4Hz);
  const parsed = parseNote(nearest.name);
  const octave = Math.min(
    TARGET_DEFAULTS.maximumNoteOctave,
    Math.max(TARGET_DEFAULTS.minimumNoteOctave, parsed.octave),
  );
  return Object.freeze({
    nearest,
    octave,
    pitchClass: parsed.name.replace(/-?\d+$/, ""),
  });
}

function freezeState(state) {
  return Object.freeze({ ...state });
}

export function createTargetState({
  a4Hz = DEFAULT_A4_HZ,
  a4Source = A4_SOURCE.PRESET,
  active = false,
  exactFrequencyHz = DEFAULT_A4_HZ,
  octave = 4,
  pitchClass = "A",
  sampleRate = null,
  source = TARGET_SOURCE.NOTE,
} = {}) {
  const validatedA4 = validateA4(a4Hz);
  const validatedSampleRate = validateSampleRate(sampleRate);
  validateA4Source(a4Source);
  validateSource(source);
  validatePitchClass(pitchClass);
  validateOctave(octave);
  if (source === TARGET_SOURCE.EXACT_HZ) {
    validateTargetFrequency(exactFrequencyHz, validatedSampleRate);
  } else {
    validateFinite(exactFrequencyHz, "Synchronized note frequency");
    if (exactFrequencyHz <= 0) {
      throw new RangeError("Synchronized note frequency must be greater than zero.");
    }
  }
  if (typeof active !== "boolean") {
    throw new TypeError("Target active state must be boolean.");
  }
  if (a4Source === A4_SOURCE.PRESET && !COMMON_A4_REFERENCES.includes(validatedA4)) {
    throw new RangeError("A preset A4 reference must be one of the common reference values.");
  }
  return freezeState({
    a4Hz: validatedA4,
    a4Source,
    active,
    exactFrequencyHz,
    octave,
    pitchClass,
    sampleRate: validatedSampleRate,
    source,
  });
}

function replaceState(state, changes) {
  return createTargetState({ ...state, ...changes });
}

export function setTargetMode(state, mode) {
  if (mode === "none") {
    return replaceState(state, { active: false });
  }
  validateSource(mode);
  if (mode === TARGET_SOURCE.NOTE) {
    return replaceState(state, {
      active: true,
      exactFrequencyHz: noteToFrequency(`${state.pitchClass}${state.octave}`, state.a4Hz),
      source: mode,
    });
  }
  validateTargetFrequency(state.exactFrequencyHz, state.sampleRate);
  const selection = nearestSelection(state.exactFrequencyHz, state.a4Hz);
  return replaceState(state, {
    active: true,
    octave: selection.octave,
    pitchClass: selection.pitchClass,
    source: mode,
  });
}

export function setTargetNote(state, pitchClass, octave) {
  validatePitchClass(pitchClass);
  validateOctave(octave);
  return replaceState(state, {
    active: true,
    exactFrequencyHz: noteToFrequency(`${pitchClass}${octave}`, state.a4Hz),
    octave,
    pitchClass,
    source: TARGET_SOURCE.NOTE,
  });
}

export function setExactTargetFrequency(state, frequencyHz) {
  const validatedFrequency = validateTargetFrequency(frequencyHz, state.sampleRate);
  const selection = nearestSelection(validatedFrequency, state.a4Hz);
  return replaceState(state, {
    active: true,
    exactFrequencyHz: validatedFrequency,
    octave: selection.octave,
    pitchClass: selection.pitchClass,
    source: TARGET_SOURCE.EXACT_HZ,
  });
}

export function setA4Reference(state, a4Hz, a4Source = A4_SOURCE.PRESET) {
  const validatedA4 = validateA4(a4Hz);
  validateA4Source(a4Source);
  if (a4Source === A4_SOURCE.PRESET && !COMMON_A4_REFERENCES.includes(validatedA4)) {
    throw new RangeError("Choose a listed A4 reference or use the custom option.");
  }
  if (state.source === TARGET_SOURCE.NOTE) {
    return replaceState(state, {
      a4Hz: validatedA4,
      a4Source,
      exactFrequencyHz: noteToFrequency(
        `${state.pitchClass}${state.octave}`,
        validatedA4,
      ),
    });
  }
  const selection = nearestSelection(state.exactFrequencyHz, validatedA4);
  return replaceState(state, {
    a4Hz: validatedA4,
    a4Source,
    octave: selection.octave,
    pitchClass: selection.pitchClass,
  });
}

export function setTargetSampleRate(state, sampleRate) {
  const validatedSampleRate = validateSampleRate(sampleRate);
  const exactFrequencyHz = state.source === TARGET_SOURCE.EXACT_HZ
    ? clampTargetFrequency(state.exactFrequencyHz, validatedSampleRate)
    : state.exactFrequencyHz;
  const selection = nearestSelection(exactFrequencyHz, state.a4Hz);
  return replaceState(state, {
    exactFrequencyHz,
    octave:
      state.source === TARGET_SOURCE.EXACT_HZ ? selection.octave : state.octave,
    pitchClass:
      state.source === TARGET_SOURCE.EXACT_HZ ? selection.pitchClass : state.pitchClass,
    sampleRate: validatedSampleRate,
  });
}

export function getActiveTarget(state) {
  if (!state.active) {
    return null;
  }
  if (state.source === TARGET_SOURCE.NOTE) {
    const label = `${state.pitchClass}${state.octave}`;
    return Object.freeze({
      frequencyHz: noteToFrequency(label, state.a4Hz),
      label,
      nearestNote: label,
      nearestNoteCents: 0,
      source: TARGET_SOURCE.NOTE,
    });
  }
  const nearest = frequencyToNote(state.exactFrequencyHz, state.a4Hz);
  return Object.freeze({
    frequencyHz: state.exactFrequencyHz,
    label: `Exact ${formatTargetFrequency(state.exactFrequencyHz)}`,
    nearestNote: nearest.name,
    nearestNoteCents: nearest.cents,
    source: TARGET_SOURCE.EXACT_HZ,
  });
}

export function formatTargetFrequency(frequencyHz) {
  return `${frequencyHz < 100 ? frequencyHz.toFixed(2) : frequencyHz.toFixed(1)} Hz`;
}
