import { MATCH_NOTE_RULES, createMatchNoteSession, resolveMatchTarget } from "../practice/match-note.js";
import { getActiveTarget, formatTargetFrequency } from "../practice/target-note.js";
import { displayScore } from "./score-format.js";
import { displayPoints, resultOutcome } from "./result-presentation.js";
import { preserveControlFocus } from "./accessibility.js";

export function createMatchControls({ root, getContext, onAttemptStart = () => {},
  onRender = () => {},
  now = () => performance.now(), setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
  documentTarget = document, windowTarget = window, session = createMatchNoteSession() }) {
  const find = (name) => root.querySelector(`[data-match-${name}]`);
  const start = find("start"), stop = find("stop"), reset = find("reset"), status = find("status");
  const listeners = [];
  let timer = null, generation = 0, signature = null, referenceActive = false, blockedUntil = 0, destroyed = false;
  let referenceTimer = null;
  const write = (name, value) => { const element = find(name); if (element.textContent !== value) element.textContent = value; };
  const number = (value, suffix = " cents") => value === null ? "-" : `${(Math.abs(value) < 0.05 ? 0 : value).toFixed(1)}${suffix}`;
  const clearTimer = () => { generation += 1; if (timer !== null) clearIntervalFn(timer); timer = null; };
  const referenceBlocked = () => referenceActive || now() < blockedUntil;
  const availability = () => {
    const context = getContext();
    if (context.busy) return "Session cleanup is in progress.";
    if (documentTarget.hidden) return "Return to this page before starting an attempt.";
    if (context.unavailable) return context.unavailable;
    if (!context.microphoneActive) return "Start the microphone above before starting an attempt.";
    if (referenceBlocked()) return "Release the reference tone, then start your attempt.";
    try { resolveMatchTarget(context.targetState, context.range); } catch (error) { return error.message; }
    return null;
  };
  const render = () => {
    const restoreFocus = preserveControlFocus(root, [start, stop, reset, status]);
    const state = session.getState();
    const rules = state.rules ?? MATCH_NOTE_RULES;
    const selected = getActiveTarget(getContext().targetState);
    write("target", selected ? `Selected target: ${selected.label} · ${formatTargetFrequency(selected.frequencyHz)}` : "Choose your target in Target pitch above.");
    root.dataset.status = state.status;
    start.disabled = destroyed || state.status === "running" || availability() !== null;
    start.textContent = state.status === "idle" ? "Start attempt" : "Retry attempt";
    stop.disabled = state.status !== "running";
    reset.disabled = state.status === "idle";
    if (state.status !== "running") clearTimer();
    let message;
    if (state.status === "idle") message = availability() ?? "";
    else if (state.status === "running") message = referenceBlocked()
      ? "Reference playing: measurement paused. The timer continues."
      : state.inGracePeriod ? "Brief detector gap. Hold progress is paused while waiting for reliable pitch."
      : `Match the target within ±${rules.toleranceCents} cents and hold it for ${rules.stableDurationMs / 1000} ${rules.stableDurationMs === 1000 ? "second" : "seconds"}.`;
    else if (state.status === "complete") message = state.kind === "sustained"
      ? "Hold complete! Accuracy and stability are shown separately below."
      : "Matched! Your result is below. Retry whenever you are ready.";
    else {
      const reasons = { timeout: "Time is up.", stopped: "Attempt stopped.", interrupted: "Attempt interrupted by microphone or page state.",
        "settings-changed": "Practice settings, target, tuning, or range changed. Start a fresh attempt.",
        "sample-limit": "Measurement limit reached.", error: "Attempt measurement was unavailable." };
      message = `${reasons[state.reason] ?? "Attempt ended."} ${state.metrics.sampleCount ? "The result covers the measured portion." : "No reliable pitch measured; no score."}`;
    }
    if (status.textContent !== message) status.textContent = message;
    write("availability", state.status !== "idle" && state.status !== "running" ? availability() ?? "Ready to retry." : "");
    write("elapsed", `${(state.elapsedMs / 1000).toFixed(1)} / ${rules.attemptDurationMs / 1000} s`);
    write("current", number(state.currentCents));
    write("hold", `${(state.currentStableMs / 1000).toFixed(1)} / ${(rules.stableDurationMs / 1000).toFixed(1)} s`);
    find("progress").max = rules.stableDurationMs;
    find("progress").value = Math.min(rules.stableDurationMs, state.currentStableMs);
    const metrics = state.metrics;
    find("result").hidden = state.status === "idle";
    write("result-target", state.target ? `${state.target.label} · ${formatTargetFrequency(state.target.frequencyHz)}` : "");
    write("result-heading", state.kind === "interval" ? `${state.stage === "root" ? "Root" : "Target"} note result`
      : state.kind === "scale" ? `Note ${state.index + 1} result` : "Your result");
    const outcome = resultOutcome(state.kind === "scale" ? { ...state, outcome: state.results[state.index]?.outcome } : state);
    find("result").dataset.outcome = outcome.tone;
    write("outcome", outcome.label);
    write("score-label", state.status === "running" ? "Live score" : "Practice score");
    write("hold-summary", `Best ${state.kind === "sustained" ? "continuous hold" : "steady match"}: ${(state.bestStableMs / 1000).toFixed(1)} of ${(rules.stableDurationMs / 1000).toFixed(1)} seconds`);
    if (state.status === "idle") find("measurements").open = false;
    write("mean", number(metrics.meanAbsoluteCents));
    write("median", number(metrics.medianAbsoluteCents));
    write("bias", number(metrics.meanSignedCents));
    write("stability", number(metrics.stabilityCents));
    write("voiced", number(state.voicedDurationMs / 1000, " s"));
    write("best", number(state.bestStableMs / 1000, " s"));
    write("samples", String(metrics.sampleCount));
    write("score", metrics.accuracyScore === null ? "-" : `${metrics.accuracyScore} / 100`);
    const scoring = state.scoring;
    // Injected session fixtures may omit scoring; production sessions always supply it.
    write("practice-score", displayScore(scoring?.total ?? null));
    for (const name of ["accuracy", "stability", "hold", "completion"]) {
      const part = scoring?.components[name];
      write(`score-${name}`, displayPoints(part));
      const meter = find(`meter-${name}`);
      meter.value = part?.points ?? 0;
      meter.hidden = !part || part.points === null;
    }
    write("score-note", scoring?.eligibility === "scored"
      ? `${state.status === "running" ? "Live estimate" : "Practice estimate"}. Based on measured pitch.`
      : "Needs at least 3 reliable readings.");
    onRender(state);
    restoreFocus();
  };
  const stopAttempt = (reason = "stopped") => {
    session.stop(now(), reason); clearTimer(); render();
  };
  const resetAttempt = () => { clearTimer(); session.reset(); render(); };
  const sync = () => {
    const context = getContext();
    const target = getActiveTarget(context.targetState);
    const next = JSON.stringify([context.attemptKey ?? [target?.frequencyHz, target?.label], context.targetState.a4Hz, context.range.lowNote, context.range.highNote]);
    if (signature !== null && signature !== next) session.stop(now(), "settings-changed");
    signature = next;
    if (!context.microphoneActive || documentTarget.hidden) session.stop(now(), "interrupted");
    render();
  };
  const watchAttempt = () => {
    clearTimer();
    if (session.getState().status !== "running") return;
    const token = generation;
    timer = setIntervalFn(() => {
      if (destroyed || token !== generation) return;
      sync(); session.advance(now()); render();
    }, 100);
  };
  const begin = () => {
    if (destroyed || session.getState().status === "running") return;
    if (availability()) { render(); return; }
    const context = getContext();
    onAttemptStart();
    session.start({ targetState: context.targetState, range: context.range, timestampMs: now() });
    watchAttempt();
    render();
  };
  const listen = (element, event, handler) => {
    element.addEventListener(event, handler);
    listeners.push(() => element.removeEventListener(event, handler));
  };
  listen(start, "click", begin);
  listen(stop, "click", () => stopAttempt());
  listen(reset, "click", resetAttempt);
  listen(documentTarget, "visibilitychange", sync);
  listen(windowTarget, "pagehide", resetAttempt);
  sync();
  return Object.freeze({
    sync, reset: resetAttempt,
    navigate(delta) {
      if (destroyed || availability() || !session.navigate) { render(); return; }
      const context = getContext();
      session.navigate(delta, { targetState: context.targetState, range: context.range, timestampMs: now() });
      onAttemptStart(); watchAttempt(); render();
    },
    getFeedbackContext() {
      const state = session.getState();
      const practicing = state.status === "running";
      return Object.freeze({ practicing, referenceBlocked: referenceBlocked(),
        toleranceCents: practicing ? (state.rules ?? MATCH_NOTE_RULES).toleranceCents : 5 });
    },
    handlePitchFrame(frame, timestampMs) {
      if (session.getState().status !== "running") return;
      try {
        if (referenceBlocked()) { session.breakContinuity(); session.advance(timestampMs); }
        else session.handlePitchFrame(frame, timestampMs);
        render();
      } catch { stopAttempt("error"); }
    },
    setReferenceState(state) {
      if (destroyed) return;
      const active = state === "starting" || state === "playing";
      if (referenceTimer !== null) { clearTimeoutFn(referenceTimer); referenceTimer = null; }
      if (active || referenceActive) {
        blockedUntil = now() + 250;
        if (session.getState().status === "running") session.breakContinuity();
      }
      referenceActive = active;
      if (!active && now() < blockedUntil) referenceTimer = setTimeoutFn(() => {
        referenceTimer = null;
        if (!destroyed) render();
      }, 250);
      render();
    },
    destroy() {
      destroyed = true; clearTimer();
      if (referenceTimer !== null) clearTimeoutFn(referenceTimer);
      session.reset(); for (const remove of listeners) remove(); render();
    },
  });
}
