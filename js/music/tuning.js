import {
  MIDI_MAX,
  MIDI_MIN,
  midiToNote,
  noteToMidi,
} from "./notes.js";

export const DEFAULT_A4_HZ = 440;
export const MIN_A4_HZ = 400;
export const MAX_A4_HZ = 480;
export const COMMON_A4_REFERENCES = Object.freeze([432, 440, 441, 442, 443]);

export function isValidA4(a4Hz) {
  return (
    typeof a4Hz === "number" &&
    Number.isFinite(a4Hz) &&
    a4Hz >= MIN_A4_HZ &&
    a4Hz <= MAX_A4_HZ
  );
}

export function validateA4(a4Hz) {
  if (!isValidA4(a4Hz)) {
    throw new RangeError(`A4 reference must be a finite number from ${MIN_A4_HZ} to ${MAX_A4_HZ} Hz.`);
  }

  return a4Hz;
}

function assertFrequency(frequencyHz, label = "Frequency") {
  if (typeof frequencyHz !== "number" || !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new RangeError(`${label} must be a finite number greater than 0 Hz.`);
  }
}

function assertMidiPosition(midi) {
  if (typeof midi !== "number" || !Number.isFinite(midi) || midi < MIDI_MIN || midi > MIDI_MAX) {
    throw new RangeError(`MIDI position must be a finite number from ${MIDI_MIN} to ${MIDI_MAX}.`);
  }
}

export function midiToFrequency(midi, a4Hz = DEFAULT_A4_HZ) {
  assertMidiPosition(midi);
  validateA4(a4Hz);
  return a4Hz * 2 ** ((midi - 69) / 12);
}

export function noteToFrequency(note, a4Hz = DEFAULT_A4_HZ) {
  return midiToFrequency(noteToMidi(note), a4Hz);
}

export function frequencyToMidi(frequencyHz, a4Hz = DEFAULT_A4_HZ) {
  assertFrequency(frequencyHz);
  validateA4(a4Hz);
  return 69 + 12 * Math.log2(frequencyHz / a4Hz);
}

export function centsDeviation(frequencyHz, targetFrequencyHz) {
  assertFrequency(frequencyHz);
  assertFrequency(targetFrequencyHz, "Target frequency");
  return 1200 * Math.log2(frequencyHz / targetFrequencyHz);
}

export function frequencyToNote(frequencyHz, a4Hz = DEFAULT_A4_HZ) {
  const midiPosition = frequencyToMidi(frequencyHz, a4Hz);
  const midi = Math.round(midiPosition);

  if (midi < MIDI_MIN || midi > MIDI_MAX) {
    throw new RangeError(`Frequency must resolve to a MIDI note from ${MIDI_MIN} to ${MIDI_MAX}.`);
  }

  const noteFrequencyHz = midiToFrequency(midi, a4Hz);

  return Object.freeze({
    cents: centsDeviation(frequencyHz, noteFrequencyHz),
    frequencyHz: noteFrequencyHz,
    midi,
    midiPosition,
    name: midiToNote(midi),
  });
}
