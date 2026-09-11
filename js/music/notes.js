export const NOTE_NAMES = Object.freeze([
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
]);

export const MIDI_MIN = 0;
export const MIDI_MAX = 127;

const NATURAL_NOTE_OFFSETS = Object.freeze({
  A: 9,
  B: 11,
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
});

const NOTE_PATTERN = /^([A-Ga-g])([#b♯♭]?)(-?\d+)$/;

export function isMidiNoteNumber(value) {
  return Number.isInteger(value) && value >= MIDI_MIN && value <= MIDI_MAX;
}

function assertMidiNoteNumber(midi) {
  if (!isMidiNoteNumber(midi)) {
    throw new RangeError(`MIDI note must be an integer from ${MIDI_MIN} to ${MIDI_MAX}.`);
  }
}

export function midiToNote(midi) {
  assertMidiNoteNumber(midi);

  const pitchClass = NOTE_NAMES[midi % NOTE_NAMES.length];
  const octave = Math.floor(midi / NOTE_NAMES.length) - 1;
  return `${pitchClass}${octave}`;
}

export function parseNote(note) {
  if (typeof note !== "string") {
    throw new TypeError("Note must be a string in scientific pitch notation.");
  }

  const input = note.trim();
  const match = NOTE_PATTERN.exec(input);

  if (!match) {
    throw new RangeError("Note must use scientific pitch notation, such as C4, F#3, or Bb2.");
  }

  const letter = match[1].toUpperCase();
  const accidental = match[2].replace("♯", "#").replace("♭", "b");
  const octave = Number(match[3]);
  const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (octave + 1) * NOTE_NAMES.length + NATURAL_NOTE_OFFSETS[letter] + accidentalOffset;

  if (!isMidiNoteNumber(midi)) {
    throw new RangeError(`Note must resolve to MIDI ${MIDI_MIN}–${MIDI_MAX}.`);
  }

  return Object.freeze({
    accidental,
    letter,
    midi,
    name: midiToNote(midi),
    octave,
  });
}

export function noteToMidi(note) {
  return parseNote(note).midi;
}

export function validateNoteRange(lowNote, highNote) {
  const low = parseNote(lowNote);
  const high = parseNote(highNote);

  if (low.midi > high.midi) {
    throw new RangeError("Low note must not be higher than high note.");
  }

  return Object.freeze({
    highMidi: high.midi,
    highNote: high.name,
    lowMidi: low.midi,
    lowNote: low.name,
  });
}

export function isValidNoteRange(lowNote, highNote) {
  try {
    validateNoteRange(lowNote, highNote);
    return true;
  } catch {
    return false;
  }
}
