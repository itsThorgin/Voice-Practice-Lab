import { createExerciseSequence } from "./vocal-range.js";

export const INTERVALS = Object.freeze([
  "Minor second", "Major second", "Minor third", "Major third", "Perfect fourth", "Tritone",
  "Perfect fifth", "Minor sixth", "Major sixth", "Minor seventh", "Major seventh", "Octave",
].map((label, index) => Object.freeze({ label, semitones: index + 1 })));

export function validateIntervalSettings({ rootMidi, semitones, direction } = {}) {
  if (!Number.isInteger(rootMidi) || rootMidi < 12 || rootMidi > 119) throw new RangeError("Choose a root from C0 through B8.");
  if (!INTERVALS.some((entry) => entry.semitones === semitones)) throw new RangeError("Choose an interval from a minor second through an octave.");
  if (!["ascending", "descending"].includes(direction)) throw new RangeError("Choose ascending or descending direction explicitly.");
  return Object.freeze({ rootMidi, semitones, direction });
}

export function createIntervalPair(settings, range) {
  const valid = validateIntervalSettings(settings);
  const offset = valid.semitones * (valid.direction === "ascending" ? 1 : -1);
  try {
    return createExerciseSequence(range, valid.rootMidi, [0, offset]);
  } catch {
    throw new RangeError("Both root and target must fit your exercise range. Choose another root, interval or direction, or edit the range in Settings.");
  }
}
