import { listExerciseNotes } from "../music/vocal-range.js";
import { midiToNote, parseNote } from "../music/notes.js";
import { createMatchNoteSession } from "./match-note.js";
import { createTargetState, setTargetNote } from "./target-note.js";
import { summarizePracticeScores } from "./scoring.js";

export const RANDOM_RESULT_LIMIT = 100;

// Sampling from a filtered list avoids retry loops, even with constant randomness.
export function chooseRandomNote(range, previousMidi = null, random = Math.random) {
  const notes = listExerciseNotes(range);
  const candidates = notes.filter((midi) => midi !== previousMidi);
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("Randomness must return a number from 0 (inclusive) to 1 (exclusive).");
  }
  return candidates[Math.floor(value * candidates.length)];
}

// Match-compatible session with bounded summaries, never raw pitch history.
export function createRandomNoteSession({ random = Math.random } = {}) {
  const attempt = createMatchNoteSession();
  let midi = null, previousMidi = null, recorded = false, results = [];
  const collect = (state) => {
    if (!recorded && (state.status === "complete" || state.status === "finished")) {
      results.push(state);
      if (results.length > RANDOM_RESULT_LIMIT) results.shift();
      recorded = true;
    }
    return state;
  };
  const getTargetState = (base) => {
    if (midi === null) return createTargetState({ ...base, active: false });
    const note = parseNote(midiToNote(midi));
    return setTargetNote(base, note.name.replace(/-?\d+$/, ""), note.octave);
  };
  return Object.freeze({
    getState: attempt.getState,
    getTargetState,
    getSessionState() {
      const scored = results.filter((result) => result.metrics.accuracyScore !== null);
      return Object.freeze({ midi, results: Object.freeze([...results]), practiceScores: summarizePracticeScores(results),
        completed: results.filter((result) => result.status === "complete").length,
        scoredCount: scored.length,
        averageScore: scored.length ? Math.round(scored.reduce((sum, result) => sum + result.metrics.accuracyScore, 0) / scored.length) : null,
      });
    },
    next({ range, timestampMs }) {
      const nextMidi = chooseRandomNote(range, previousMidi, random);
      collect(attempt.stop(timestampMs, "next-note"));
      attempt.reset(); recorded = false; midi = nextMidi; previousMidi = nextMidi;
      return midi;
    },
    start(context) {
      if (midi === null) throw new RangeError("Choose Next note before starting a random attempt.");
      const state = attempt.start({ ...context, targetState: getTargetState(context.targetState) });
      if (state.status === "running") recorded = false;
      return state;
    },
    stop: (...args) => collect(attempt.stop(...args)),
    advance: (...args) => collect(attempt.advance(...args)),
    handlePitchFrame: (...args) => collect(attempt.handlePitchFrame(...args)),
    breakContinuity: attempt.breakContinuity,
    clearTarget(timestampMs) {
      collect(attempt.stop(timestampMs, "settings-changed"));
      attempt.reset(); midi = null; recorded = false;
    },
    reset() {
      attempt.reset(); midi = null; previousMidi = null; recorded = false; results = [];
      return attempt.getState();
    },
  });
}
