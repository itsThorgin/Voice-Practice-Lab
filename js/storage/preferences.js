import {
  createTargetState, setExactTargetFrequency, setTargetMode, setTargetNote,
} from "../practice/target-note.js";
import { createVocalRange } from "../music/vocal-range.js";

export const PREFERENCES_KEY = "voice-practice-lab:settings:v1";
export const PREFERENCES_VERSION = 1;
const maximumStoredLength = 4096;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const requireFields = (value, fields) => {
  if (!isObject(value) || fields.some((field) => !Object.hasOwn(value, field))) {
    throw new TypeError("Incomplete preference object.");
  }
};

// Build a new live target from a strict, source-specific allowlist. Never spread
// stored objects into application state or restore runtime sample-rate/audio data.
export function targetFromPreferences(value) {
  requireFields(value, ["version", "a4Hz", "a4Source", "target"]);
  if (value.version !== PREFERENCES_VERSION) throw new RangeError("Unsupported settings version.");
  if (typeof value.a4Hz !== "number" || typeof value.a4Source !== "string") {
    throw new TypeError("Invalid tuning reference.");
  }
  requireFields(value.target, ["active", "source"]);
  const target = value.target;
  if (typeof target.active !== "boolean") throw new TypeError("Invalid target active flag.");
  let state = createTargetState({ a4Hz: value.a4Hz, a4Source: value.a4Source });
  if (target.source === "note") {
    requireFields(target, ["pitchClass", "octave"]);
    state = setTargetNote(state, target.pitchClass, target.octave);
  } else if (target.source === "exact-hz") {
    requireFields(target, ["frequencyHz"]);
    state = setExactTargetFrequency(state, target.frequencyHz);
  } else {
    throw new RangeError("Invalid target source.");
  }
  return target.active ? state : setTargetMode(state, "none");
}

export function rangeFromPreferences(value) {
  // Version 1 gains an optional field: older valid settings retain their target
  // and receive an in-memory default. Loading never rewrites the stored value.
  if (!Object.hasOwn(value, "vocalRange")) return createVocalRange();
  requireFields(value.vocalRange, ["lowNote", "highNote"]);
  return createVocalRange(value.vocalRange);
}

export function preferencesFromTarget(state, range = createVocalRange()) {
  const target = { active: state.active, source: state.source };
  if (state.source === "note") {
    target.pitchClass = state.pitchClass;
    target.octave = state.octave;
  } else {
    target.frequencyHz = state.exactFrequencyHz;
  }
  const preferences = {
    version: PREFERENCES_VERSION,
    a4Hz: state.a4Hz,
    a4Source: state.a4Source,
    target,
    vocalRange: (() => {
      const validated = createVocalRange(range);
      return Object.freeze({ lowNote: validated.lowNote, highNote: validated.highNote });
    })(),
  };
  targetFromPreferences(preferences); // Apply the same field validators before writing.
  return Object.freeze({ ...preferences, target: Object.freeze(target) });
}

export function createPreferenceStore({ getStorage = () => globalThis.localStorage } = {}) {
  const defaults = (status) => Object.freeze({ status, target: createTargetState(), vocalRange: createVocalRange() });
  return Object.freeze({
    load() {
      let stored;
      try { stored = getStorage().getItem(PREFERENCES_KEY); }
      catch { return defaults("unavailable"); }
      if (stored === null) return defaults("empty");
      try {
        if (typeof stored !== "string" || stored.length > maximumStoredLength) {
          return defaults("invalid");
        }
        const value = JSON.parse(stored);
        if (isObject(value) && value.version !== PREFERENCES_VERSION) return defaults("unsupported-version");
        // Remember valid controls/tuning, but never activate a target on page startup.
        return Object.freeze({ status: "loaded", target: setTargetMode(targetFromPreferences(value), "none"), vocalRange: rangeFromPreferences(value) });
      } catch { return defaults("invalid"); }
    },
    save(target, range = createVocalRange()) {
      let serialized;
      try { serialized = JSON.stringify(preferencesFromTarget(target, range)); }
      catch { return Object.freeze({ status: "invalid-save" }); }
      try {
        getStorage().setItem(PREFERENCES_KEY, serialized);
        return Object.freeze({ status: "saved" });
      } catch { return Object.freeze({ status: "unavailable" }); }
    },
    clear() {
      try {
        getStorage().removeItem(PREFERENCES_KEY);
        return Object.freeze({ status: "cleared" });
      } catch { return Object.freeze({ status: "unavailable" }); }
    },
  });
}
