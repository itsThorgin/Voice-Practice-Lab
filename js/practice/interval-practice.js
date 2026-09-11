import { createIntervalPair, validateIntervalSettings } from "../music/intervals.js";
import { parseNote } from "../music/notes.js";
import { createTargetState, setTargetNote } from "./target-note.js";
import { createMatchNoteSession } from "./match-note.js";

export const INTERVAL_DEFAULTS = Object.freeze({ rootMidi: 60, semitones: 7, direction: "ascending" });
const noteTarget = (base, name) => {
  const note = parseNote(name);
  return setTargetNote(base, note.name.replace(/-?\d+$/, ""), note.octave);
};

// Two bounded match attempts. Only a completed root advances to a fresh target
// attempt; the confirming root frame is never also counted toward the target.
export function createIntervalPracticeSession() {
  const attempt = createMatchNoteSession();
  let settings = INTERVAL_DEFAULTS, stage = "root", rootResult = null, pair = null, startContext = null, preview = "root";
  const snapshot = () => Object.freeze({ ...attempt.getState(), kind: "interval", stage, rootResult, pair });
  const getTargetState = (base, range) => {
    try {
      const notes = createIntervalPair(settings, range);
      const selected = attempt.getState().status === "running" ? stage : preview;
      return noteTarget(base, notes[selected === "root" ? 0 : 1]);
    } catch { return createTargetState({ ...base, active: false }); }
  };
  return Object.freeze({
    getState: snapshot, getSettings: () => settings, getPreview: () => preview, getTargetState,
    configure(value) { settings = validateIntervalSettings(value); },
    setPreview(value) {
      if (!["root", "target"].includes(value)) throw new RangeError("Choose the root or target reference.");
      if (attempt.getState().status !== "running") preview = value;
    },
    start({ targetState, range, timestampMs }) {
      if (attempt.getState().status === "running") return snapshot();
      const notes = createIntervalPair(settings, range);
      // Validate before replacing the retained result.
      const base = createTargetState(targetState);
      attempt.start({ targetState: noteTarget(base, notes[0]), range, timestampMs });
      pair = notes; stage = "root"; rootResult = null; preview = "root";
      startContext = { targetState: base, range: { lowNote: range.lowNote, highNote: range.highNote } };
      return snapshot();
    },
    handlePitchFrame(frame, timestampMs) {
      const state = attempt.handlePitchFrame(frame, timestampMs);
      if (stage === "root" && state.status === "complete") {
        rootResult = state; stage = "target";
        attempt.start({ ...startContext, targetState: noteTarget(startContext.targetState, pair[1]), timestampMs });
      }
      return snapshot();
    },
    advance(timestampMs) { attempt.advance(timestampMs); return snapshot(); },
    stop(timestampMs, reason) { attempt.stop(timestampMs, reason); return snapshot(); },
    breakContinuity() { attempt.breakContinuity(); return snapshot(); },
    reset() {
      attempt.reset(); settings = INTERVAL_DEFAULTS; stage = "root"; rootResult = null;
      pair = null; startContext = null; preview = "root"; return snapshot();
    },
  });
}
