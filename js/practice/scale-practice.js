import { createScaleSequence, validateScaleSettings } from "../music/scales.js";
import { parseNote } from "../music/notes.js";
import { createTargetState, setTargetNote } from "./target-note.js";
import { createMatchNoteSession } from "./match-note.js";
import { summarizePracticeScores } from "./scoring.js";

export const SCALE_DEFAULTS = Object.freeze({ rootMidi: 60, type: "major", direction: "ascending" });
const noteTarget = (base, name) => {
  const note = parseNote(name);
  return setTargetNote(base, note.name.replace(/-?\d+$/, ""), note.octave);
};
const contextKey = ({ targetState, range }) => JSON.stringify([targetState.a4Hz, range.lowNote, range.highNote]);

// One match attempt plus at most 25 immutable note summaries. Re-visiting a
// note replaces that note and all later results, so recovery cannot double-score.
export function createScalePracticeSession() {
  const attempt = createMatchNoteSession();
  let settings = SCALE_DEFAULTS, sequence = null, index = 0, records = [], context = null, traversalFinished = false;
  const rows = () => {
    if (!sequence) return Object.freeze([]);
    const result = [...records];
    const current = attempt.getState();
    if (current.status !== "idle" && !result[index]) result[index] = Object.freeze({ ...current, outcome:
      current.status === "complete" ? "matched" : current.status === "running" ? "current" : "ended" });
    return Object.freeze(result);
  };
  const snapshot = () => {
    const results = rows(), scored = results.filter((row) => row.metrics.accuracyScore !== null);
    const matched = results.filter((row) => row.outcome === "matched").length;
    return Object.freeze({ ...attempt.getState(), kind: "scale", sequence, index, results, traversalFinished,
      practiceScores: summarizePracticeScores(results),
      matched, skipped: results.filter((row) => row.outcome === "skipped").length,
      allMatched: Boolean(sequence && matched === sequence.length),
      averageScore: scored.length ? Math.round(scored.reduce((sum, row) => sum + row.metrics.accuracyScore, 0) / scored.length) : null,
      scoredCount: scored.length });
  };
  const clear = () => { attempt.reset(); sequence = null; index = 0; records = []; context = null; traversalFinished = false; };
  const beginNote = (timestampMs) => {
    attempt.reset();
    attempt.start({ ...context, targetState: noteTarget(context.targetState, sequence[index]), timestampMs });
  };
  const canNavigate = (delta, currentContext) => Boolean(sequence && [-1, 1].includes(delta)
    && contextKey(context) === contextKey(currentContext)
    && (delta === -1 ? index > 0 : !traversalFinished));
  return Object.freeze({
    getState: snapshot, getSettings: () => settings, canNavigate,
    configure(value) {
      const validated = validateScaleSettings(value);
      if (attempt.getState().status === "running") throw new Error("Stop the scale before changing its settings.");
      settings = validated; clear();
    },
    getTargetState(base, range) {
      try {
        const notes = createScaleSequence(settings, range);
        return noteTarget(base, notes[Math.min(index, notes.length - 1)]);
      } catch { return createTargetState({ ...base, active: false }); }
    },
    start({ targetState, range, timestampMs }) {
      if (attempt.getState().status === "running") return snapshot();
      const notes = createScaleSequence(settings, range), base = createTargetState(targetState);
      // Validate before clearing a retained run.
      if (!Number.isFinite(timestampMs) || timestampMs < 0) throw new RangeError("Invalid scale start time.");
      clear(); sequence = notes;
      context = { targetState: base, range: { lowNote: range.lowNote, highNote: range.highNote } };
      beginNote(timestampMs); return snapshot();
    },
    handlePitchFrame(frame, timestampMs) {
      const state = attempt.handlePitchFrame(frame, timestampMs);
      if (state.status === "complete" && !traversalFinished) {
        records[index] = Object.freeze({ ...state, outcome: "matched" });
        if (index < sequence.length - 1) { index++; beginNote(timestampMs); }
        else traversalFinished = true;
      }
      return snapshot();
    },
    navigate(delta, args) {
      if (!canNavigate(delta, args)) return snapshot();
      if (!Number.isFinite(args.timestampMs) || args.timestampMs < 0) throw new RangeError("Invalid navigation time.");
      attempt.stop(args.timestampMs, "manual-next");
      if (delta === 1) {
        records[index] = Object.freeze({ ...attempt.getState(), outcome: "skipped" });
        if (index === sequence.length - 1) { traversalFinished = true; return snapshot(); }
      }
      index += delta; records = records.slice(0, index); traversalFinished = false;
      beginNote(args.timestampMs); return snapshot();
    },
    advance(timestampMs) { attempt.advance(timestampMs); return snapshot(); },
    stop(timestampMs, reason) { attempt.stop(timestampMs, reason); return snapshot(); },
    breakContinuity() { attempt.breakContinuity(); return snapshot(); },
    reset() { clear(); settings = SCALE_DEFAULTS; return snapshot(); },
  });
}
