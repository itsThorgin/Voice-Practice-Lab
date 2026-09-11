import { createHeldNoteTracker } from "../audio/pitch-smoothing.js";
import { HELD_NOTE_DEFAULTS } from "../config.js";
import { centsDeviation } from "../music/tuning.js";

// Free-tuner timing is independent of guided-practice completion and scoring.
export function createTunerHold() {
  const toleranceCents = HELD_NOTE_DEFAULTS.toleranceCents + 1e-7;
  const tracker = createHeldNoteTracker({ toleranceCents });
  let identity = null;
  const reset = () => tracker.reset();
  const sync = ({ a4Hz, target }) => {
    const next = JSON.stringify([a4Hz, target?.frequencyHz ?? null, target?.label ?? null]);
    if (next !== identity) { identity = next; reset(); }
    return tracker.getState();
  };
  return Object.freeze({
    reset,
    sync,
    getState: () => tracker.getState(),
    update(frame, timestampMs, options, referenceBlocked = false) {
      sync(options);
      if (!options.target || referenceBlocked || !frame.voiced || frame.accepted !== true
        || frame.confidence < HELD_NOTE_DEFAULTS.confidenceThreshold
        || Math.abs(centsDeviation(frame.frequencyHz, options.target.frequencyHz)) > toleranceCents) {
        reset();
        return tracker.getState();
      }
      return tracker.update(frame, timestampMs, options.target.frequencyHz);
    },
  });
}
