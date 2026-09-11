import { createRecorderController, RECORDING_LIMITS } from "./recorder.js";
import { analyzeTake } from "./take-analysis.js";
import { createTakePlayback } from "./take-playback.js";

export const COMPARISON_LIMITS = Object.freeze({
  maximumBytes: 2 * RECORDING_LIMITS.maximumBytes,
  maximumOffset: 5,
  // One uncancellable native decode may still hold a discarded Blob and its encoded copy.
  maximumInFlightBlobBytes: RECORDING_LIMITS.maximumBytes,
  maximumEncodedDecodeBytes: RECORDING_LIMITS.maximumBytes,
});
const keys = ["reference", "comparison"];
export function comparisonTimeline(referenceDuration, comparisonDuration, offset) {
  return { start: Math.min(0, comparisonDuration ? offset : 0),
    end: Math.max(referenceDuration, comparisonDuration ? offset + comparisonDuration : 0) };
}

export function createTakeComparison({ players, getStream, canStart = () => true, isPageVisible = () => true,
  onStateChange = () => {}, createRecorder = createRecorderController, analyze = analyzeTake,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  MediaRecorderClass = globalThis.MediaRecorder,
  createPlayback = createTakePlayback,
} = {}) {
  const recorders = {}, seen = {}, analysis = {}, analysisStatus = {}, pending = new Map();
  let destroyed = false, decoding = false, revision = 0, offset = 0, position = 0, mode = null;
  let timer = null, generation = 0, message = "", fallback = null;
  let playback = null;
  const duration = (key) => analysis[key]?.duration ?? recorders[key]?.getState().durationSeconds ?? 0;
  const bounds = () => comparisonTimeline(duration("reference"), duration("comparison"), offset);
  const busy = () => ["recording", "processing"].includes(recorders.comparison?.getState().status);
  const state = () => Object.freeze({ reference: recorders.reference?.getState(), comparison: recorders.comparison?.getState(),
    analysis: { ...analysis }, analysisStatus: { ...analysisStatus }, offset, position, mode, message,
    bounds: bounds(), revision, playback: playback?.getState(),
    levels: { reference: players.reference.volume, comparison: players.comparison.volume } });
  const publish = () => { if (!destroyed) { try { onStateChange(state()); } catch { /* Cleanup remains available. */ } } };
  playback = createPlayback({ isPageVisible: () => isPageVisible() && canStart() && !busy(), setTimer, clearTimer,
    onChange(next) {
      if (fallback) return;
      if (mode) position = next.position;
      if (next.status === "error") message = next.message;
      if (next.status === "idle" || next.status === "error") mode = null;
      publish();
    },
  });
  const pump = async () => {
    if (decoding || destroyed) return;
    decoding = true;
    try {
      while (pending.size && !destroyed) {
        const [key, blob] = pending.entries().next().value; pending.delete(key);
        const isCurrent = () => !destroyed && seen[key] === blob;
        try {
          const result = await analyze(blob, { isCurrent });
          if (isCurrent()) { analysis[key] = result; analysisStatus[key] = result ? "ready" : "unavailable"; revision++; publish(); }
        } catch {
          if (isCurrent()) { analysisStatus[key] = "unavailable"; revision++; publish(); }
        }
      }
    } finally { decoding = false; }
  };
  const changed = (key) => {
    const blob = recorders[key]?.getBlob();
    if (seen[key] !== blob) {
      seen[key] = blob; analysis[key] = null; pending.delete(key);
      playback.setTake(key, blob);
      analysisStatus[key] = blob ? "processing" : "empty"; revision++;
      if (blob) { pending.set(key, blob); void pump(); }
    }
    publish();
  };
  for (const key of keys) {
    players[key].volume = 0.5;
    recorders[key] = createRecorder({ player: players[key], getStream, canStart, isPageVisible,
      MediaRecorderClass, onStateChange: () => changed(key) });
    changed(key);
  }
  const pause = () => {
    generation++; clearTimer(timer); timer = null;
    if (fallback) position = players[fallback].currentTime + (fallback === "comparison" ? offset : 0);
    fallback = null; playback.pause(); mode = null;
    for (const key of keys) recorders[key].pause();
    publish();
  };
  const resetPosition = () => { position = bounds().start; };
  const play = (selection) => {
    if (destroyed || busy() || !canStart() || !isPageVisible() || ![...keys, "both"].includes(selection)) return false;
    const selected = selection === "both" ? keys : [selection];
    if (selected.some((key) => !recorders[key].getState().hasTake)) return false;
    pause(); message = "";
    const end = Math.max(...selected.map((key) => (key === "comparison" ? offset : 0) + duration(key)));
    if (position >= end) {
      message = "This take has ended at the current position. Use Return to start to listen again.";
      publish(); return false;
    }
    // Preserve single-take listening if this browser cannot decode for synchronized output.
    if (selection !== "both" && (playback.getState().ready[selection] === "unavailable" || playback.getState().unavailable)) {
      fallback = selection; mode = selection;
      message = "Individual fallback playback from the beginning; synchronized seeking is unavailable for this take.";
      players[selection].load(); players[selection].currentTime = 0;
      const token = generation;
      void recorders[selection].play().then((ok) => {
        if (token !== generation) return;
        if (!ok) { pause(); return; }
        const monitor = () => {
          if (token !== generation) return;
          if (!isPageVisible() || !canStart() || players[selection].paused) { pause(); return; }
          position = players[selection].currentTime + (selection === "comparison" ? offset : 0);
          publish(); timer = setTimer(monitor, 30);
        };
        monitor();
      });
      publish(); return true;
    }
    // play() first stops old sources and publishes idle; set the selected mode afterward.
    const accepted = playback.play(selection, position, offset);
    mode = accepted ? selection : null; publish(); return accepted;
  };
  const clear = () => {
    pause(); pending.clear(); playback.clear();
    for (const key of keys) recorders[key].clear();
    offset = 0; position = 0; message = "";
    for (const key of keys) { players[key].volume = 0.5; playback.setLevel(key, 0.5); }
    revision++; publish();
  };
  return Object.freeze({
    getState: state, play, pause,
    start(limit) { if (destroyed || busy()) return false; pause(); message = "";
      const result = recorders.comparison.start(limit); if (result) { resetPosition(); revision++; publish(); } return result; },
    stop() { recorders.comparison.stop(); pause(); },
    keepReference() {
      if (destroyed || busy() || !canStart()) return false;
      const blob = recorders.comparison.getBlob(); if (!blob) return false;
      pause();
      if (!recorders.reference.replaceBlob(blob, recorders.comparison.getState().durationSeconds)) return false;
      recorders.comparison.clear(); offset = 0; resetPosition(); revision++; publish(); return true;
    },
    deleteTake(key) { if (!keys.includes(key) || destroyed) return; pause(); recorders[key].clear();
      offset = 0; resetPosition(); message = ""; revision++; publish(); },
    setOffset(value) {
      if (destroyed || busy() || !Number.isFinite(value) || Math.abs(value) > 5) return false;
      pause(); offset = Math.round(value * 100) / 100; resetPosition(); revision++; publish(); return true;
    },
    seek(value) {
      const range = bounds();
      if (destroyed || busy() || !Number.isFinite(value) || value < range.start || value > range.end) return false;
      pause(); position = value; playback.seek(value); publish(); return true;
    },
    setLevel(key, value) {
      if (destroyed || !keys.includes(key) || !Number.isFinite(value) || value < 0 || value > 1) return false;
      players[key].volume = value; playback.setLevel(key, value); publish(); return true;
    },
    clear,
    destroy() { if (destroyed) return; clear(); destroyed = true; pending.clear(); playback.destroy(); for (const key of keys) recorders[key].destroy(); },
  });
}
