import { createExerciseSequence } from "./vocal-range.js";

export const SCALE_PATTERNS = Object.freeze({
  chromatic: Object.freeze(Array.from({ length: 13 }, (_, i) => i)),
  major: Object.freeze([0, 2, 4, 5, 7, 9, 11, 12]),
  "natural-minor": Object.freeze([0, 2, 3, 5, 7, 8, 10, 12]),
});
export const SCALE_LABELS = Object.freeze({ chromatic: "Chromatic", major: "Major", "natural-minor": "Natural minor" });
export function validateScaleSettings({ rootMidi, type, direction } = {}) {
  if (!Number.isInteger(rootMidi) || rootMidi < 12 || rootMidi > 119) throw new RangeError("Choose a lower tonic from C0 through B8.");
  if (!Object.hasOwn(SCALE_PATTERNS, type)) throw new RangeError("Choose chromatic, major or natural minor.");
  if (!["ascending", "descending", "up-down"].includes(direction)) throw new RangeError("Choose ascending, descending or up/down.");
  return Object.freeze({ rootMidi, type, direction });
}
export function scaleOffsets(value) {
  const { type, direction } = validateScaleSettings(value);
  const up = SCALE_PATTERNS[type];
  return Object.freeze(direction === "ascending" ? [...up] : direction === "descending" ? [...up].reverse()
    : [...up, ...up.slice(0, -1).reverse()]);
}
// The chosen tonic is always the lower endpoint; descending starts an octave
// above it. Up/down visits the upper tonic once, returning to the lower tonic.
export function createScaleSequence(settings, range) {
  const valid = validateScaleSettings(settings);
  const offsets = scaleOffsets(valid);
  try { return createExerciseSequence(range, valid.rootMidi, offsets); }
  catch { throw new RangeError("The whole scale must fit your exercise range. Choose another lower tonic or widen the range in Settings."); }
}
