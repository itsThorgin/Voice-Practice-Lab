import { centsDeviation } from "../music/tuning.js";
import { createLivePitchScale } from "./live-pitch-scale.js";

// Reuse the live scale's bounded pitch/hold rules so both views agree.
export function createSineOverlayControls({ root, renderer, getContext,
  now = () => performance.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const find = (name) => root.querySelector(`[data-sine-${name}]`);
  const feedback = createLivePitchScale();
  let signature = null, detectedHz = null, lastAcceptedAt = null, lastTime = null;
  let destroyed = false, timer = null;
  let context = { target: null, referenceBlocked: false };
  const write = (name, value) => { const element = find(name); if (element.textContent !== value) element.textContent = value; };
  const hz = (frequency) => `${frequency.toFixed(2)} Hz`;
  const renderText = () => {
    const state = feedback.getState();
    const labels = { low: "Too low · raise pitch", high: "Too high · lower pitch", near: "Near note", steady: "Steady hold" };
    const status = !context.target ? "Choose a target to compare pitch models."
      : context.referenceBlocked ? "Reference tone · comparison paused"
      : detectedHz === null ? "Waiting for a reliable microphone pitch"
      : labels[state.status] ?? "Waiting for a reliable microphone pitch";
    root.dataset.comparison = !context.target ? "no-target" : context.referenceBlocked ? "reference" : detectedHz === null ? "waiting" : "live";
    root.dataset.pitchFeedback = detectedHz === null ? "waiting" : state.status;
    write("status", status);
    write("rules", `Near: ±${state.toleranceCents}¢ · steady: 1 second. Visual feedback; exercise completion is separate.`);
    write("target", context.target ? `${context.target.label} · ${hz(context.target.frequencyHz)}` : "No target selected");
    let reading = "No reliable pitch";
    if (detectedHz !== null && context.target) {
      const cents = centsDeviation(detectedHz, context.target.frequencyHz);
      const rounded = Math.abs(cents) < 0.05 ? 0 : cents;
      reading = `${hz(detectedHz)} · ${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}¢ from target`;
    }
    write("reading", reading);
  };
  const clear = () => {
    detectedHz = null; lastAcceptedAt = null;
    feedback.pause();
    renderer.setDetectedFrequency(null); renderText();
  };
  const safely = (action) => {
    if (destroyed) return;
    try { return action(); } catch {
      destroyed = true;
      if (timer !== null) clearIntervalFn(timer);
      detectedHz = null; lastAcceptedAt = null;
      feedback.pause(); root.dataset.pitchFeedback = "waiting";
      try { renderer.setDetectedFrequency(null); } catch { /* Preserve other views. */ }
      root.dataset.comparison = "unavailable";
      write("reading", "No reliable pitch");
      write("status", "Pitch comparison is unavailable; other controls remain usable.");
    }
  };
  const sync = (timestamp = now()) => {
    if (!Number.isFinite(timestamp) || timestamp < 0 || (lastTime !== null && timestamp < lastTime)) {
      throw new RangeError("Invalid sine-overlay timestamp.");
    }
    lastTime = timestamp;
    const next = getContext();
    const nextSignature = JSON.stringify([next.target?.frequencyHz, next.target?.label, next.a4Hz,
      next.toleranceCents ?? 5, Boolean(next.practicing)]);
    context = next;
    feedback.configure(context); feedback.advance(timestamp);
    if (signature !== nextSignature) {
      signature = nextSignature;
      clear(); renderer.setTarget(context.target);
    }
    if (!context.target || context.referenceBlocked || (lastAcceptedAt !== null && timestamp - lastAcceptedAt > 120)) clear();
    else renderText();
    return timestamp;
  };
  safely(sync);
  if (!destroyed) timer = setIntervalFn(() => safely(sync), 100);
  return Object.freeze({
    sync: () => safely(sync),
    clear: () => safely(clear),
    update(frame, timestampMs = now()) {
      return safely(() => {
        const timestamp = sync(timestampMs);
        if (!context.target || context.referenceBlocked) return;
        if (!frame?.voiced || frame.accepted !== true || !Number.isFinite(frame.confidence)
          || frame.confidence < 0.82 || frame.confidence > 1 || !Number.isFinite(frame.frequencyHz)
          || frame.frequencyHz < 16.35 || frame.frequencyHz > 8372.02) { clear(); return; }
        detectedHz = frame.frequencyHz; lastAcceptedAt = timestamp;
        feedback.update(frame, timestamp);
        renderer.setDetectedFrequency(detectedHz); renderText();
      });
    },
    destroy() {
      if (destroyed) return;
      clearIntervalFn(timer);
      safely(clear); destroyed = true;
    },
  });
}
