import { midiToNote, validateNoteRange } from "./notes.js";

export const VOCAL_RANGE_MIN_MIDI = 12; // C0
export const VOCAL_RANGE_MAX_MIDI = 119; // B8, matching the target selectors.
export const VOCAL_RANGE_DEFAULTS = Object.freeze({ lowNote: "C3", highNote: "C5" });
export const VOCAL_RANGE_PRESETS = Object.freeze([
  Object.freeze({ id: "lower", label: "Lower starting range · C2–C4", lowNote: "C2", highNote: "C4" }),
  Object.freeze({ id: "middle", label: "Middle starting range · C3–C5", ...VOCAL_RANGE_DEFAULTS }),
  Object.freeze({ id: "higher", label: "Higher starting range · C4–C6", lowNote: "C4", highNote: "C6" }),
]);

// Exercise bounds are stricter than the general, inclusive note-range utility.
// Rebuild from exact notes; never trust caller-supplied derived MIDI fields.
export function createVocalRange(value = VOCAL_RANGE_DEFAULTS) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Choose exact lowest and highest notes.");
  }
  const range = validateNoteRange(value.lowNote, value.highNote);
  if (range.lowMidi >= range.highMidi) {
    throw new RangeError("Lowest note must be lower than highest note.");
  }
  if (range.lowMidi < VOCAL_RANGE_MIN_MIDI || range.highMidi > VOCAL_RANGE_MAX_MIDI) {
    throw new RangeError("Choose notes from C0 through B8.");
  }
  return range;
}

export function vocalRangeFromPreset(id) {
  const preset = VOCAL_RANGE_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new RangeError("Choose an available range preset.");
  return createVocalRange(preset);
}

export function listExerciseNotes(value) {
  const range = createVocalRange(value);
  return Object.freeze(Array.from(
    { length: range.highMidi - range.lowMidi + 1 }, (_, index) => range.lowMidi + index,
  ));
}

function validateOffsets(offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0 || offsets.length > 256
    || !Array.from(offsets).every((offset) => Number.isInteger(offset) && Math.abs(offset) <= 127)) {
    throw new RangeError("Use 1–256 integer semitone offsets from -127 through 127.");
  }
}

// Future exercises supply their own patterns. An impossible pattern has no
// roots; never silently clip, transpose, or return part of an exercise.
export function getExerciseRoots(value, offsets = [0]) {
  validateOffsets(offsets);
  const range = createVocalRange(value);
  return Object.freeze(listExerciseNotes(range).filter((root) => offsets.every(
    (offset) => root + offset >= range.lowMidi && root + offset <= range.highMidi,
  )));
}

export function createExerciseSequence(value, rootMidi, offsets = [0]) {
  if (!getExerciseRoots(value, offsets).includes(rootMidi)) {
    throw new RangeError("Every exercise note and its root must fit the selected range.");
  }
  return Object.freeze(offsets.map((offset) => midiToNote(rootMidi + offset)));
}
