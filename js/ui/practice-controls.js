import { createMatchControls } from "./match-controls.js";
import { createMatchNoteSession } from "../practice/match-note.js";
import { createRandomNoteSession, RANDOM_RESULT_LIMIT } from "../practice/random-note.js";
import { createSustainedNoteSession, validateSustainedSettings } from "../practice/sustained-note.js";
import { createIntervalPracticeSession } from "../practice/interval-practice.js";
import { INTERVALS, createIntervalPair } from "../music/intervals.js";
import { midiToNote } from "../music/notes.js";
import { createScalePracticeSession } from "../practice/scale-practice.js";
import { createScaleControls } from "./scale-controls.js";
import { displayScore, displayPracticeAverage, displayPracticeBreakdown } from "./score-format.js";
import { noteSummary, resultOutcome } from "./result-presentation.js";

// Guided modes share the same frame, watchdog, reference guard and attempt view.
export function createPracticeControls({ root, getContext, onTargetChange = () => {},
  now = () => performance.now(), documentTarget = document, windowTarget = window,
  randomSession = createRandomNoteSession(), sustainedSession = createSustainedNoteSession(),
  intervalSession = createIntervalPracticeSession(), scaleSession = createScalePracticeSession(), ...options }) {
  const manualSession = createMatchNoteSession();
  const mode = root.querySelector("[data-practice-mode]");
  const next = root.querySelector("[data-random-next]");
  const summary = root.querySelector("[data-random-summary]");
  const hint = root.querySelector("[data-random-hint]");
  const resetButton = root.querySelector("[data-match-reset]");
  const targetLabel = root.querySelector("[data-match-target]");
  const duration = root.querySelector("[data-sustain-duration]");
  const tolerance = root.querySelector("[data-sustain-tolerance]");
  const settingsError = root.querySelector("[data-sustain-error]");
  const intervalFields = Object.fromEntries(["root", "distance", "direction", "preview"]
    .map((name) => [name, root.querySelector(`[data-interval-${name}]`)]));
  const addOptions = (element, entries) => {
    // Native DOM in production; lightweight controller fixtures need no option nodes.
    if (!root.ownerDocument) return;
    element.replaceChildren(...entries.map(([value, label]) => {
      const option = root.ownerDocument.createElement("option"); option.value = String(value); option.textContent = label; return option;
    }));
  };
  addOptions(intervalFields.root, Array.from({ length: 108 }, (_, i) => [i + 12, midiToNote(i + 12)]));
  addOptions(intervalFields.distance, INTERVALS.map(({ semitones, label }) => [semitones, label]));
  let intervalError = "", effectiveSignature = null;
  let practiceMode = "selected", destroyed = false, rangeSignature = null;
  const active = () => practiceMode === "random" ? randomSession : practiceMode === "sustained" ? sustainedSession
    : practiceMode === "interval" ? intervalSession : practiceMode === "scale" ? scaleSession : manualSession;
  const getTargetState = () => practiceMode === "random" ? randomSession.getTargetState(getContext().targetState)
    : practiceMode === "interval" ? intervalSession.getTargetState(getContext().targetState, getContext().range)
    : practiceMode === "scale" ? scaleSession.getTargetState(getContext().targetState, getContext().range) : getContext().targetState;
  const intervalWarning = () => {
    try { createIntervalPair(intervalSession.getSettings(), getContext().range); return intervalError; }
    catch (error) { return error.message; }
  };
  const editable = () => !destroyed && !getContext().busy && !documentTarget.hidden;
  let match = null;
  const scaleUI = createScaleControls({ root, session: scaleSession, getContext,
    editable: () => editable() && practiceMode === "scale",
    onConfigure: () => { match.sync(); onTargetChange(); },
    onNavigate: (delta) => { if (editable() && practiceMode === "scale") match.navigate(delta); },
  });
  const resetSessions = () => {
    manualSession.reset(); randomSession.reset(); sustainedSession.reset(); intervalSession.reset(); intervalError = "";
    scaleSession.reset(); scaleUI.clearError();
    settingsError.textContent = ""; onTargetChange();
    return active().getState();
  };
  const proxy = Object.fromEntries(["getState", "start", "stop", "advance", "handlePitchFrame", "breakContinuity"]
    .map((name) => [name, (...args) => active()[name](...args)]));
  proxy.reset = resetSessions;
  proxy.navigate = (delta, args) => practiceMode === "scale" ? scaleSession.navigate(delta, args) : active().getState();
  const renderExtras = () => {
    const randomMode = practiceMode === "random", sustainedMode = practiceMode === "sustained", intervalMode = practiceMode === "interval";
    const setText = (selector, text) => { const element = root.querySelector(selector); if (element.textContent !== text) element.textContent = text; };
    mode.value = practiceMode;
    mode.disabled = !editable(); next.hidden = !randomMode; next.disabled = !editable();
    hint.hidden = !randomMode; summary.hidden = !randomMode;
    const state = randomSession.getSessionState();
    resetButton.textContent = randomMode ? "Reset random session" : sustainedMode ? "Reset sustained session" : intervalMode ? "Reset interval session" : practiceMode === "scale" ? "Reset scale session" : "Reset attempt";
    resetButton.disabled = !editable() || (randomMode
      ? state.midi === null && state.results.length === 0
      : sustainedMode || intervalMode || practiceMode === "scale" ? false : manualSession.getState().status === "idle");
    root.querySelector("[data-interval-options]").hidden = !intervalMode;
    root.querySelector("[data-interval-results]").hidden = !intervalMode;
    root.querySelector("[data-sustain-options]").hidden = !sustainedMode;
    root.querySelector("[data-sustain-feedback]").hidden = !sustainedMode;
    root.querySelector("[data-sustain-explanation]").hidden = !sustainedMode;
    root.querySelector("[data-match-explanation]").hidden = sustainedMode;
    const settings = sustainedSession.getSettings();
    duration.value = String(settings.holdDurationMs); tolerance.value = String(settings.toleranceCents);
    duration.disabled = !editable(); tolerance.disabled = !editable();
    setText("[data-practice-title]", sustainedMode ? "Sustain a note" : intervalMode ? "Match an interval" : practiceMode === "scale" ? "Sing a scale" : "Match a note");
    setText("[data-match-hold-label]", sustainedMode ? "Continuous hold" : "Steady match");
    setText("[data-match-best-label]", sustainedMode ? "Longest valid hold" : "Best steady match");
    root.querySelector("[data-match-progress]").setAttribute?.("aria-label", sustainedMode ? "Continuous hold progress" : "Steady match progress");
    setText("[data-practice-instructions]", sustainedMode
      ? `Choose a target inside your exercise range. Stay within ±${settings.toleranceCents} cents for ${settings.holdDurationMs / 1000} seconds. You have 30 seconds to complete the attempt. Stability is scored separately; it does not decide when this hold completes.`
      : "Choose a target inside your exercise range. Stay within ±20 cents of the target for 1 steady second. You have 15 seconds to complete the attempt.");
    const holdSeconds = sustainedMode ? settings.holdDurationMs / 1000 : 1;
    setText("[data-practice-hold-example]", `A ${holdSeconds / 2}-second hold earns 10 hold points. A ${holdSeconds}-second hold earns all 20. Separate holds do not add together.${intervalMode || practiceMode === "scale" ? " Each note is scored separately." : ""}`);
    const held = sustainedSession.getState();
    const cents = held.currentCents;
    setText("[data-sustain-closeness]", cents === null ? "No reliable pitch" : Math.abs(cents) <= held.rules.toleranceCents + 1e-7
      ? "Within tolerance" : cents < 0 ? "Too low: raise pitch" : "Too high: lower pitch");
    const spread = held.recentStabilityCents;
    setText("[data-sustain-stability]", spread === null ? "Waiting for 3 recent reliable frames"
      : `${spread <= 10 + 1e-7 ? "Steady" : "Varying"} · ${spread.toFixed(1)} cents MAD`);
    setText("[data-sustain-time]", `${(held.timeInToleranceMs / 1000).toFixed(1)} s`);
    setText("[data-sustain-dropouts]", String(held.dropouts));
    setText("[data-sustain-rules]", held.target
      ? `Attempt goal: ±${held.rules.toleranceCents} cents for ${held.rules.stableDurationMs / 1000} seconds. Grace: ${held.rules.gracePeriodMs} ms.` : "");
    if (randomMode) {
      if (state.midi === null) {
        targetLabel.textContent = "Choose Next note to generate a target inside your exercise range.";
        root.querySelector("[data-match-status]").textContent = targetLabel.textContent;
      }
      else targetLabel.textContent = targetLabel.textContent.replace("Selected target:", "Random target:");
      const text = `Session: ${state.results.length} ${state.results.length === 1 ? "attempt" : "attempts"} · ${state.completed} matched · Average accuracy: ${state.averageScore === null ? "-" : `${state.averageScore} / 100`} (${state.scoredCount} scored). ${displayPracticeAverage(state.practiceScores)} Last ${RANDOM_RESULT_LIMIT} attempts only; empty attempts have no score.`;
      setText("[data-random-average]", `Practice average: ${displayScore(state.practiceScores.average)}`);
      setText("[data-random-count]", `${state.completed} matched · ${state.results.length} attempts`);
      setText("[data-random-summary-details]", text);
    }
    const interval = intervalSession.getState(), config = intervalSession.getSettings();
    intervalFields.root.value = String(config.rootMidi); intervalFields.distance.value = String(config.semitones);
    intervalFields.direction.value = config.direction;
    intervalFields.preview.value = interval.status === "running" ? interval.stage : intervalSession.getPreview();
    for (const field of Object.values(intervalFields)) field.disabled = !editable() || interval.status === "running";
    if (intervalMode) {
      setText("[data-interval-error]", intervalWarning());
      let pairText = "Choose a pair inside your exercise range.";
      try {
        const pair = createIntervalPair(config, getContext().range);
        pairText = `${config.direction === "ascending" ? "Ascending" : "Descending"} ${INTERVALS[config.semitones - 1].label.toLowerCase()}: ${pair[0]} → ${pair[1]}.`;
      } catch { /* The actionable range warning remains visible. */ }
      setText("[data-interval-pair]", pairText);
      setText("[data-practice-instructions]", "Choose a root, interval and direction. Sing the root first, then the target. Match each note within ±20 cents for 1 steady second; you have 15 seconds per note. Before starting, Reference note chooses which note you hear. Retry restarts both notes.");
      const stageLabel = interval.stage === "root" ? "Root" : "Target";
      if (interval.status === "running") {
        setText("[data-match-target]", `${stageLabel} stage: ${interval.target.label} · ${interval.target.frequencyHz.toFixed(2)} Hz`);
      } else {
        targetLabel.textContent = targetLabel.textContent.replace("Selected target:", "Reference preview:");
      }
      if (interval.status === "complete") setText("[data-match-status]", "Interval complete! Both stages matched. Separate results are below.");
      const describe = (result) => !result || result.status === "idle" ? "Not attempted yet."
        : `${result.target.label} · ${result.status === "complete" ? "Matched" : result.status === "running" ? "In progress" : `Ended (${result.reason})`} · Accuracy: ${result.metrics.accuracyScore === null ? "-" : `${result.metrics.accuracyScore} / 100`} · Mean error: ${result.metrics.meanAbsoluteCents === null ? "-" : `${result.metrics.meanAbsoluteCents.toFixed(1)} cents`} · Stability: ${result.metrics.stabilityCents === null ? "-" : `${result.metrics.stabilityCents.toFixed(1)} cents MAD`} · Voiced: ${(result.voicedDurationMs / 1000).toFixed(1)} s`;
      const rootResult = interval.rootResult ?? (interval.stage === "root" ? interval : null);
      const targetResult = interval.stage === "target" ? interval : null;
      for (const [name, result] of [["root", rootResult], ["target", targetResult]]) {
        setText(`[data-interval-${name}-result]`, noteSummary(result, result?.target?.label ?? (name === "root" ? "Root" : "Target")));
        root.querySelector(`[data-interval-${name}-card]`).dataset.outcome = resultOutcome(result).tone;
        setText(`[data-interval-${name}-details]`, `${describe(result)}${result ? ` · ${displayPracticeBreakdown(result.scoring)}` : ""}`);
      }
    }
    scaleUI.render(practiceMode === "scale", match?.getFeedbackContext().referenceBlocked ?? false);
    if (practiceMode === "scale") setText("[data-practice-instructions]", "Choose the lower tonic, scale and direction. Sing the highlighted note within ±20 cents for 1 steady second; you have 15 seconds per note. Play reference follows the current note. Next skips a note. Back clears that note's result and later results for a fresh try. Retry restarts the whole scale.");
    if (randomMode) setText("[data-practice-instructions]", "Select Next note to choose a target inside your exercise range. Stay within ±20 cents of the target for 1 steady second. You have 15 seconds per attempt.");
    const effective = getTargetState(), scale = scaleSession.getState();
    const signature = JSON.stringify([practiceMode, effective, intervalMode ? interval.stage : practiceMode === "scale" ? scale.index : null]);
    if (effectiveSignature !== signature) {
      const previous = effectiveSignature; effectiveSignature = signature;
      if (((intervalMode && interval.status === "running") || (practiceMode === "scale" && scale.status === "running")) && previous !== null) options.onAttemptStart?.();
      onTargetChange();
    }
  };
  match = createMatchControls({ ...options, root, now, documentTarget, windowTarget, session: proxy,
    getContext: () => ({ ...getContext(), targetState: getTargetState(),
      ...(practiceMode === "interval" ? { unavailable: intervalWarning(), attemptKey: intervalSession.getSettings() }
        : practiceMode === "scale" ? { unavailable: scaleUI.warning(), attemptKey: scaleSession.getSettings() } : {}) }), onRender: renderExtras });
  const changeMode = () => {
    if (!editable()) { renderExtras(); return; }
    if (!["selected", "random", "sustained", "interval", "scale"].includes(mode.value)) { renderExtras(); return; }
    active().stop(now(), "stopped");
    practiceMode = mode.value;
    // Switching mode starts a fresh session; no hidden exercise keeps running.
    match.reset(); match.sync(); onTargetChange();
  };
  const nextNote = () => {
    if (!editable() || practiceMode !== "random") return;
    randomSession.next({ range: getContext().range, timestampMs: now() });
    match.sync(); onTargetChange();
  };
  mode.addEventListener("change", changeMode);
  next.addEventListener("click", nextNote);
  const configure = () => {
    if (!editable() || practiceMode !== "sustained") { renderExtras(); return; }
    try {
      const settings = validateSustainedSettings({ holdDurationMs: Number(duration.value), toleranceCents: Number(tolerance.value) });
      sustainedSession.stop(now(), "settings-changed"); sustainedSession.configure(settings); settingsError.textContent = "";
    } catch (error) { settingsError.textContent = error.message; }
    match.sync();
  };
  duration.addEventListener("change", configure); tolerance.addEventListener("change", configure);
  const configureInterval = () => {
    if (!editable() || practiceMode !== "interval" || intervalSession.getState().status === "running") { renderExtras(); return; }
    try {
      intervalSession.configure({ rootMidi: Number(intervalFields.root.value), semitones: Number(intervalFields.distance.value), direction: intervalFields.direction.value });
      intervalSession.setPreview(intervalFields.preview.value); intervalError = "";
    } catch (error) { intervalError = error.message; }
    match.sync(); onTargetChange();
  };
  for (const field of Object.values(intervalFields)) field.addEventListener("change", configureInterval);
  const sync = () => {
    const range = getContext().range;
    const signature = JSON.stringify([range.lowNote, range.highNote]);
    const changed = rangeSignature !== null && rangeSignature !== signature;
    rangeSignature = signature;
    if (changed) randomSession.clearTarget(now());
    match.sync();
    if (changed && practiceMode === "random") onTargetChange();
  };
  sync();
  return Object.freeze({
    ...match, sync, getTargetState, isRandomMode: () => practiceMode === "random",
    isIntervalMode: () => practiceMode === "interval",
    isScaleMode: () => practiceMode === "scale",
    destroy() {
      destroyed = true;
      mode.removeEventListener("change", changeMode); next.removeEventListener("click", nextNote);
      duration.removeEventListener("change", configure); tolerance.removeEventListener("change", configure);
      for (const field of Object.values(intervalFields)) field.removeEventListener("change", configureInterval);
      scaleUI.destroy();
      match.destroy();
    },
  });
}
