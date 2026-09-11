import { computePitchStability } from "../audio/pitch-smoothing.js";
import { NOTE_NAMES, MIDI_MIN, MIDI_MAX } from "../music/notes.js";
import { centsDeviation, frequencyToMidi, validateA4 } from "../music/tuning.js";

const MAX_GAP_MS = 120;
const HOLD_MS = 1000;
const label = (midi) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

// A view-only tracker. It never advances an exercise or owns audio or storage.
export function createLivePitchScale() {
  let center = null, position = null, cents = null, lastTime = null, lastAccepted = null;
  let started = null, heldMs = 0, samples = [], identity = null, status = "waiting";
  let config = { a4Hz: 440, target: null, toleranceCents: 5, referenceBlocked: false, practicing: false };
  let signature = null;
  const clearHold = () => { started = null; heldMs = 0; samples = []; identity = null; };
  const pause = () => {
    position = null; cents = null; lastAccepted = null; clearHold();
    status = config.referenceBlocked ? "reference" : "waiting";
  };
  const configure = (value = {}) => {
    const next = { a4Hz: 440, target: null, toleranceCents: 5, referenceBlocked: false, practicing: false, ...value };
    validateA4(next.a4Hz);
    if (![5, 10, 20].includes(next.toleranceCents)) throw new RangeError("Invalid live pitch tolerance.");
    if (next.target !== null && (!Number.isFinite(next.target.frequencyHz) || next.target.frequencyHz <= 0
      || typeof next.target.label !== "string")) throw new RangeError("Invalid live pitch target.");
    const nextSignature = JSON.stringify([next.a4Hz, next.target?.frequencyHz, next.target?.label,
      next.toleranceCents, Boolean(next.referenceBlocked), Boolean(next.practicing)]);
    if (next.a4Hz !== config.a4Hz) center = null;
    config = next;
    if (signature !== nextSignature) { signature = nextSignature; pause(); }
  };
  const time = (now) => {
    if (!Number.isFinite(now) || now < 0 || (lastTime !== null && now < lastTime)) {
      throw new RangeError("Live pitch timestamps must be monotonic and nonnegative.");
    }
  };
  const advance = (now) => {
    time(now); lastTime = now;
    if (config.referenceBlocked || (lastAccepted !== null && now - lastAccepted > MAX_GAP_MS)) pause();
  };
  const getState = () => {
    const targetMidi = config.target ? frequencyToMidi(config.target.frequencyHz, config.a4Hz) : null;
    const targetDirection = center === null || targetMidi === null ? null
      : targetMidi > center + 3 ? "above" : targetMidi < center - 3 ? "below" : "visible";
    // Use the same reference as cents feedback, including the brief period in
    // which label hysteresis keeps a neighboring note at the center.
    const referenceMidi = targetMidi ?? (position === null ? center : Math.round(position));
    const referencePercent = center === null || referenceMidi === null ? null
      : (center + 3.5 - referenceMidi) / 7 * 100;
    const referenceVisible = referencePercent !== null && (!config.target || targetDirection === "visible");
    return Object.freeze({
      centerMidi: center, rows: Object.freeze(Array.from({ length: 7 }, (_, i) =>
        center === null ? "-" : label(center + 3 - i))),
      markerPercent: position === null || center === null ? null : (center + 3.5 - position) / 7 * 100,
      detectedNote: position === null ? null : label(Math.round(position)),
      targetPercent: targetDirection === "visible" ? (center + 3.5 - targetMidi) / 7 * 100 : null,
      targetDirection, targetLabel: config.target?.label ?? null,
      referencePercent: referenceVisible ? referencePercent : null,
      shadeSplitPercent: targetDirection === "above" ? 0 : targetDirection === "below" ? 100 : referencePercent ?? 50,
      cents, heldMs, status, toleranceCents: config.toleranceCents,
    });
  };
  return Object.freeze({
    configure, advance, getState, pause,
    reset() { center = null; lastTime = null; pause(); },
    update(frame, now) {
      time(now);
      const duplicate = now === lastTime;
      advance(now);
      if (config.referenceBlocked) return getState();
      if (!frame || !frame.voiced || frame.accepted !== true || !Number.isFinite(frame.confidence)
        || frame.confidence < 0.82 || frame.confidence > 1 || !Number.isFinite(frame.frequencyHz) || frame.frequencyHz <= 0) {
        pause(); return getState();
      }
      if (duplicate && lastAccepted === now) return getState();
      const midi = frequencyToMidi(frame.frequencyHz, config.a4Hz);
      if (midi < MIDI_MIN || midi > MIDI_MAX) { pause(); return getState(); }
      const nearest = Math.round(midi);
      // Eight cents of hysteresis around the half-semitone boundary. Large jumps
      // move immediately once the upstream smoother accepts them.
      if (center === null || Math.abs(midi - center) > 0.58) center = nearest;
      position = midi;
      const targetHz = config.target?.frequencyHz ?? config.a4Hz * 2 ** ((nearest - 69) / 12);
      cents = centsDeviation(frame.frequencyHz, targetHz);
      const nextIdentity = config.target ? targetHz : nearest;
      if (identity !== nextIdentity) clearHold();
      lastAccepted = now;
      if (Math.abs(cents) > config.toleranceCents + 1e-7) {
        clearHold(); status = cents < 0 ? "low" : "high";
      } else {
        identity = nextIdentity;
        started ??= now;
        samples.push({ time: now, hz: frame.frequencyHz });
        samples = samples.filter((sample) => now - sample.time <= HOLD_MS).slice(-64);
        heldMs = Math.min(HOLD_MS, now - started);
        const spread = computePitchStability(samples.map((sample) => sample.hz));
        status = heldMs >= HOLD_MS && spread !== null && spread <= 10 + 1e-7 ? "steady" : "near";
      }
      return getState();
    },
  });
}

export function createLivePitchScaleControls({ root, getContext, now = () => performance.now(),
  setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  const model = createLivePitchScale();
  const find = (name) => root.querySelector(`[data-live-${name}]`);
  const rows = [...root.querySelectorAll("[data-live-note]")];
  const marker = find("marker"), targetMarker = find("target-marker");
  const referenceLine = find("reference-line"), sharpZone = find("sharp-zone"), flatZone = find("flat-zone");
  let destroyed = false, timer = null;
  const write = (name, text) => { const element = find(name); if (element.textContent !== text) element.textContent = text; };
  const render = () => {
    const state = model.getState();
    root.dataset.feedback = state.status;
    rows.forEach((row, i) => { if (row.textContent !== state.rows[i]) row.textContent = state.rows[i]; });
    marker.hidden = state.markerPercent === null;
    if (!marker.hidden) marker.style.top = `${state.markerPercent}%`;
    targetMarker.hidden = state.targetPercent === null;
    if (!targetMarker.hidden) targetMarker.style.top = `${state.targetPercent}%`;
    referenceLine.hidden = state.referencePercent === null;
    if (!referenceLine.hidden) referenceLine.style.top = `${state.referencePercent}%`;
    sharpZone.style.height = `${state.shadeSplitPercent}%`;
    flatZone.style.top = `${state.shadeSplitPercent}%`;
    const messages = { waiting: "Listening for a reliable pitch", reference: "Reference tone · feedback paused",
      low: "Too low · raise pitch", high: "Too high · lower pitch", near: "Near note", steady: "Steady hold" };
    write("status", messages[state.status]);
    const displayCents = state.cents === null || Math.abs(state.cents) < 0.05 ? 0 : state.cents;
    write("reading", state.detectedNote === null ? "-" : `${state.detectedNote} · ${displayCents >= 0 ? "+" : ""}${displayCents.toFixed(1)}¢`);
    write("target", state.targetLabel
      ? `Target: ${state.targetLabel}${state.targetDirection === "above" ? " ↑ above scale" : state.targetDirection === "below" ? " ↓ below scale" : ""}`
      : "Following nearest note");
    write("rules", `Near: ±${state.toleranceCents}¢ · steady: 1 second`);
    return state;
  };
  const safely = (action) => {
    if (destroyed) return;
    try { return action(); } catch {
      destroyed = true;
      if (timer !== null) clearIntervalFn(timer);
      model.pause(); render();
      write("status", "Live pitch scale is unavailable.");
    }
  };
  const sync = () => safely(() => { model.configure(getContext()); model.advance(now()); return render(); });
  sync();
  if (!destroyed) timer = setIntervalFn(sync, 100);
  return Object.freeze({
    sync,
    update(frame, timestampMs = now()) { return safely(() => { model.configure(getContext()); model.update(frame, timestampMs); return render(); }); },
    pause() { return safely(() => { model.pause(); return render(); }); },
    reset() { return safely(() => { model.reset(); return render(); }); },
    destroy() { destroyed = true; clearIntervalFn(timer); model.reset(); render(); },
  });
}
