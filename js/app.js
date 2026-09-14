import { createAnalyserSession } from "./audio/analyser.js";
import { createMicrophoneController } from "./audio/microphone.js";
import { createPitchDetector } from "./audio/pitch-detector.js";
import { createPitchSmoother } from "./audio/pitch-smoothing.js";
import { createTunerHold } from "./ui/tuner-hold.js";
import { TUNER_DEFAULTS } from "./config.js";
import {
  formatTargetFrequency,
  getActiveTarget,
  setTargetSampleRate,
} from "./practice/target-note.js";
import { createAppState, MICROPHONE_STATUS } from "./state.js";
import { createPreferenceStore } from "./storage/preferences.js";
import { createSessionActions } from "./practice/session-actions.js";
import { createSettingsControls } from "./ui/settings-controls.js";
import { createRangeControls } from "./ui/range-controls.js";
import { createPracticeControls } from "./ui/practice-controls.js";
import { createTargetControls } from "./ui/target-controls.js";
import { createToneControls } from "./ui/tone-controls.js";
import { createPracticeTools } from "./ui/practice-tools.js";
import { createCollapsibleCards } from "./ui/collapsible-cards.js";
import { createAccessibleSummaries, preserveControlFocus } from "./ui/accessibility.js";
import { createRecordingControls } from "./ui/recording-controls.js";
import {
  createTunerPresenter,
  createTunerViewModel,
  createUnavailableTunerView,
} from "./ui/tuner-meter.js";
import { createPitchHistoryRenderer } from "./ui/pitch-history.js";
import { createLivePitchScaleControls } from "./ui/live-pitch-scale.js";
import { createSpectrumRenderer } from "./ui/spectrum.js";
import { createTargetWaveRenderer } from "./ui/target-wave.js";
import { createSineOverlayControls } from "./ui/sine-overlay.js";
import { createWaveformRenderer } from "./ui/waveform.js";
import { detectMicrophoneSupport } from "./util/feature-detection.js";
import { createCleanupStack } from "./util/lifecycle.js";

const app = document.querySelector("[data-app]");

if (app) {
  const card = app.querySelector("[data-microphone-card]");
  const startButton = app.querySelector("[data-microphone-start]");
  const stopButton = app.querySelector("[data-microphone-stop]");
  const statusText = app.querySelector("[data-microphone-status]");
  const tunerRoot = app.querySelector("[data-tuner]");
  const pitchHistoryCard = app.querySelector("[data-pitch-history-card]");
  const pitchHistoryCanvas = app.querySelector("[data-pitch-history]");
  const pitchHistoryEmpty = app.querySelector("[data-pitch-history-empty]");
  const pitchHistoryMode = app.querySelector("[data-pitch-history-mode]");
  const pitchHistoryReset = app.querySelector("[data-pitch-history-reset]");
  const waveformCard = app.querySelector("[data-waveform-card]");
  const waveformCanvas = app.querySelector("[data-waveform]");
  const waveformPlaceholder = app.querySelector("[data-waveform-placeholder]");
  const signalMeter = app.querySelector("[data-signal-meter]");
  const signalLabel = app.querySelector("[data-signal-label]");
  const spectrumCard = app.querySelector("[data-spectrum-card]");
  const spectrumCanvas = app.querySelector("[data-spectrum]");
  const spectrumPlaceholder = app.querySelector("[data-spectrum-placeholder]");
  const targetControlsRoot = app.querySelector("[data-target-controls]");
  const targetWaveCanvas = app.querySelector("[data-target-wave]");
  const targetWaveCard = app.querySelector("[data-target-wave-card]");
  const targetWaveEmpty = app.querySelector("[data-target-wave-empty]");
  const preferences = createPreferenceStore();
  const initialPreferences = preferences.load();
  const appState = createAppState({ target: initialPreferences.target, vocalRange: initialPreferences.vocalRange });
  let sessionActions = null;
  let recordingControls = null;
  let matchControls = null;
  let livePitchScale = null;
  let sineOverlay = null;
  const practiceTargetState = () => matchControls?.getTargetState() ?? appState.getState().target;
  const support = detectMicrophoneSupport();
  const practiceTools = createPracticeTools({ root: app,
    AudioContextClass: support.AudioContextClass, canStart: () => !sessionActions?.isBusy() });
  const detector = createPitchDetector();
  const smoother = createPitchSmoother();
  const tunerHold = createTunerHold();
  let resetTunerHold = () => tunerHold.reset();
  const tuner = createTunerPresenter(tunerRoot);
  const inactivePitchHistory = Object.freeze({
    append() {},
    clear() {},
    destroy() {},
    setTargetFrequency() {},
  });
  const showUnavailablePitchHistory = () => {
    pitchHistoryCard.dataset.status = "unavailable";
    pitchHistoryEmpty.hidden = false;
    pitchHistoryEmpty.textContent = "Pitch history is unavailable, but the tuner still works.";
    pitchHistoryReset.disabled = true;
  };
  let pitchHistory = inactivePitchHistory;
  try {
    pitchHistory = createPitchHistoryRenderer({
      canvas: pitchHistoryCanvas,
      emptyState: pitchHistoryEmpty,
      getDevicePixelRatio: () => window.devicePixelRatio,
      getStyles: () => {
        const styles = window.getComputedStyle(pitchHistoryCanvas);
        return {
          grid: styles.getPropertyValue("--color-line").trim(),
          label: styles.getPropertyValue("--color-muted").trim(),
          trace: styles.color,
        };
      },
      modeLabel: pitchHistoryMode,
      resetButton: pitchHistoryReset,
      ResizeObserverClass: window.ResizeObserver,
      windowTarget: window,
    });
  } catch {
    showUnavailablePitchHistory();
  }
  const inactiveTargetWave = Object.freeze({
    destroy() {},
    setTarget() {},
    setDetectedFrequency() {},
  });
  const showUnavailableTargetWave = () => {
    sineOverlay?.destroy();
    app.querySelector("[data-sine-status]").textContent = "Pitch comparison is unavailable.";
    targetWaveCard.dataset.status = "unavailable";
    targetWaveEmpty.hidden = false;
    targetWaveEmpty.textContent = "The target tone shape is unavailable, but target selection still works.";
  };
  let targetWave = inactiveTargetWave;
  try {
    targetWave = createTargetWaveRenderer({
      canvas: targetWaveCanvas,
      emptyState: targetWaveEmpty,
      getDevicePixelRatio: () => window.devicePixelRatio,
      getStyles: () => {
        const styles = window.getComputedStyle(targetWaveCanvas);
        return {
          grid: styles.getPropertyValue("--color-line").trim(),
          trace: styles.color,
          detected: styles.getPropertyValue("--color-positive").trim(),
        };
      },
      ResizeObserverClass: window.ResizeObserver,
      windowTarget: window,
    });
  } catch {
    showUnavailableTargetWave();
  }
  const targetControls = createTargetControls({
    getState: () => appState.getState().target,
    onChange: (targetState) => {
      if (sessionActions?.isBusy()) {
        targetControls.render(appState.getState().target);
        return;
      }
      appState.setTarget(targetState);
      settingsControls.reportStorage(preferences.save(targetState, appState.getState().vocalRange));
    },
    root: targetControlsRoot,
  });
  const rangeControls = createRangeControls({
    root: app.querySelector("[data-range-controls]"),
    getRange: () => appState.getState().vocalRange,
    canChange: () => !sessionActions?.isBusy(),
    onChange: (range) => {
      appState.setVocalRange(range);
      settingsControls.reportStorage(preferences.save(appState.getState().target, appState.getState().vocalRange));
    },
  });
  const toneControls = createToneControls({
    AudioContextClass: support.AudioContextClass,
    canStart: () => !sessionActions?.isBusy(),
    onStateChange: (state) => {
      matchControls?.setReferenceState(state);
      resetTunerHold();
      livePitchScale?.sync();
      sineOverlay?.sync();
    },
    getTarget: () => getActiveTarget(practiceTargetState()),
    root: app.querySelector("[data-tone-controls]"),
    extraButtons: app.querySelectorAll("[data-tone-shortcut]"),
  });
  let analysisFailed = false;
  let lastPitchAnalysisAt = null;
  let latestPitchFrame = null;
  let unavailableTunerState = Object.freeze({
    confidence: null,
    message: "Start the microphone to begin tuning.",
    status: "idle",
  });
  let spectrum = null;
  let waveform = null;
  const microphone = createMicrophoneController({
    AudioContextClass: support.AudioContextClass,
    getUserMedia: support.getUserMedia,
    isPageVisible: () => !document.hidden,
    onStateChange: (microphoneState) => {
      if ([MICROPHONE_STATUS.STOPPING, MICROPHONE_STATUS.ERROR,
        MICROPHONE_STATUS.PAUSED, MICROPHONE_STATUS.RESUME_REQUIRED,
      ].includes(microphoneState.status)) {
        toneControls.cancel();
        recordingControls?.stop();
      }
      appState.setMicrophone(microphoneState);
    },
  });
  recordingControls = createRecordingControls({
    root: app.querySelector("[data-recording-controls]"),
    getStream: () => microphone.getState().status === MICROPHONE_STATUS.ACTIVE
      ? microphone.getResources()?.stream ?? null : null,
    canStart: () => !sessionActions?.isBusy(),
  });

  const updateSignalLevel = (level) => {
    const percent = Math.round(level * 100);
    const label =
      level < 0.08 ? "Quiet" : level < 0.45 ? "Low" : level < 0.82 ? "Present" : "Strong";

    signalMeter.value = level;
    signalMeter.textContent = `${percent}%`;
    if (signalLabel.textContent !== label) {
      signalLabel.textContent = label;
    }
  };

  const setWaveformStatus = (status, message, placeholderHidden = false) => {
    waveformCard.dataset.status = status;
    waveformPlaceholder.textContent = message;
    waveformPlaceholder.hidden = placeholderHidden;
  };

  const setSpectrumStatus = (status, message, placeholderHidden = false) => {
    spectrumCard.dataset.status = status;
    spectrumPlaceholder.textContent = message;
    spectrumPlaceholder.hidden = placeholderHidden;
  };

  const stopSpectrum = () => {
    const activeSpectrum = spectrum;
    spectrum = null;
    try {
      activeSpectrum?.destroy();
    } catch {
      // Waveform and microphone cleanup must continue if this secondary view fails.
    }
  };

  const updateSpectrum = (timestampMs) => {
    if (!spectrum) {
      return;
    }
    try {
      spectrum.render(timestampMs);
    } catch {
      stopSpectrum();
      setSpectrumStatus(
        "unavailable",
        "The spectrum is unavailable, but the tuner and waveform still work.",
      );
    }
  };

  const currentTargetOptions = () => {
    const targetState = practiceTargetState();
    return Object.freeze({
      a4Hz: targetState.a4Hz,
      target: getActiveTarget(targetState),
    });
  };

  const renderCurrentTuner = () => {
    const options = currentTargetOptions();
    const heldState = tunerHold.sync(options);
    if (latestPitchFrame) {
      return tuner.render(createTunerViewModel(latestPitchFrame, { ...options, heldState }));
    }
    return tuner.render(
      createUnavailableTunerView({
        ...unavailableTunerState,
        target: options.target,
      }),
    );
  };

  resetTunerHold = () => { tunerHold.reset(); renderCurrentTuner(); };

  const showUnavailableTuner = (message, status, confidence = null) => {
    tunerHold.reset();
    livePitchScale?.pause();
    sineOverlay?.clear();
    latestPitchFrame = null;
    unavailableTunerState = Object.freeze({ confidence, message, status });
    renderCurrentTuner();
  };

  const resetPitchAnalysis = (message, status) => {
    smoother.reset();
    analysisFailed = false;
    lastPitchAnalysisAt = null;
    showUnavailableTuner(message, status);
  };

  const updatePitchHistory = (pitchFrame, timestampMs) => {
    try {
      pitchHistory.append(pitchFrame, timestampMs);
    } catch {
      try {
        pitchHistory.destroy();
      } catch {
        // The tuner must stay usable even if visualization cleanup also fails.
      }
      pitchHistory = inactivePitchHistory;
      showUnavailablePitchHistory();
    }
  };

  const renderTarget = (targetState) => {
    livePitchScale?.sync();
    sineOverlay?.sync();
    toneControls.render();
    targetControls.render(targetState);
    const activeTarget = getActiveTarget(practiceTargetState());
    const randomMode = matchControls?.isRandomMode() ?? false;
    const intervalMode = matchControls?.isIntervalMode() ?? false;
    const scaleMode = matchControls?.isScaleMode() ?? false;
    targetControlsRoot.querySelector("[data-target-summary]").hidden = randomMode || intervalMode || scaleMode;
    const practiceSummary = targetControlsRoot.querySelector("[data-practice-target-summary]");
    practiceSummary.hidden = !randomMode && !intervalMode && !scaleMode;
    practiceSummary.textContent = scaleMode
      ? `${activeTarget ? `Scale goal: ${activeTarget.label} at ${formatTargetFrequency(activeTarget.frequencyHz)}.` : "Scale practice: choose a sequence inside your exercise range below."} The reference follows the current scale note. Your manual target is retained.`
      : intervalMode
      ? `${activeTarget ? `Interval reference / goal: ${activeTarget.label} at ${formatTargetFrequency(activeTarget.frequencyHz)}.` : "Interval practice: choose an in-range pair below."} Your manual target is retained. Select Root or Target below to preview before starting.`
      : randomMode
      ? `${activeTarget ? `Random target: ${activeTarget.label} at ${formatTargetFrequency(activeTarget.frequencyHz)}.` : "Random practice: choose Next note below."} The controls above keep your manual target. Switch practice mode to use it again.`
      : "";
    try {
      pitchHistory.setTargetFrequency(activeTarget?.frequencyHz ?? null);
    } catch {
      try {
        pitchHistory.destroy();
      } catch {
        // Target controls and the core tuner remain available if history cleanup fails.
      }
      pitchHistory = inactivePitchHistory;
      showUnavailablePitchHistory();
    }
    try {
      targetWave.setTarget(activeTarget);
      targetWaveCard.dataset.status = activeTarget ? "active" : "idle";
    } catch {
      try {
        targetWave.destroy();
      } catch {
        // Target selection and tuner updates must continue if this view fails.
      }
      targetWave = inactiveTargetWave;
      showUnavailableTargetWave();
    }
    renderCurrentTuner();
  };

  const syncTargetSampleRate = (sampleRate) => {
    const currentTargetState = appState.getState().target;
    if (currentTargetState.sampleRate === sampleRate) {
      return;
    }
    appState.setTarget(setTargetSampleRate(currentTargetState, sampleRate));
  };

  const updatePitchAnalysis = (samples, timestampMs, sampleRate) => {
    if (analysisFailed) {
      return;
    }
    const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : window.performance.now();
    if (
      lastPitchAnalysisAt !== null &&
      safeTimestamp - lastPitchAnalysisAt < TUNER_DEFAULTS.analysisIntervalMs
    ) {
      return;
    }
    lastPitchAnalysisAt = safeTimestamp;

    try {
      const rawPitch = detector.detect(samples, sampleRate);
      const presentationPitch = smoother.update(rawPitch, safeTimestamp);
      latestPitchFrame = presentationPitch;
      const options = currentTargetOptions();
      const heldState = tunerHold.update(presentationPitch, safeTimestamp, options,
        matchControls?.getFeedbackContext().referenceBlocked ?? false);
      const tunerView = createTunerViewModel(presentationPitch, { ...options, heldState });
      updatePitchHistory(presentationPitch, safeTimestamp);
      tuner.render(tunerView);
      matchControls?.handlePitchFrame(presentationPitch, window.performance.now());
      const feedbackTimestamp = window.performance.now();
      livePitchScale?.update(presentationPitch, feedbackTimestamp);
      sineOverlay?.update(presentationPitch, feedbackTimestamp);
    } catch {
      analysisFailed = true;
      matchControls?.sync();
      smoother.reset();
      showUnavailableTuner(
        "Pitch analysis is unavailable, but microphone controls remain usable.",
        "unavailable",
      );
    }
  };

  const stopWaveform = () => {
    stopSpectrum();
    waveform?.stop();
    waveform = null;
    updateSignalLevel(0);
  };

  const startWaveform = () => {
    if (waveform) {
      waveform.resume();
      setWaveformStatus("active", "Live microphone waveform.", true);
      if (spectrum) {
        setSpectrumStatus("active", "Live vocal-range frequency spectrum.", true);
      }
      return true;
    }

    const resources = microphone.getResources();
    if (!resources) {
      return false;
    }

    syncTargetSampleRate(resources.audioContext.sampleRate);

    let analyserSession = null;
    try {
      analyserSession = createAnalyserSession(resources);
      waveform = createWaveformRenderer({
        analyserSession,
        cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
        canvas: waveformCanvas,
        getDevicePixelRatio: () => window.devicePixelRatio,
        getStrokeStyle: () => window.getComputedStyle(waveformCanvas).color,
        isPageVisible: () => !document.hidden,
        onLevel: updateSignalLevel,
        onSamples: (samples, timestampMs) => {
          updatePitchAnalysis(samples, timestampMs, resources.audioContext.sampleRate);
          updateSpectrum(timestampMs);
        },
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        ResizeObserverClass: window.ResizeObserver,
        windowTarget: window,
      });
      try {
        spectrum = createSpectrumRenderer({
          analyserSession,
          canvas: spectrumCanvas,
          fftSize: analyserSession.analyserNode.fftSize,
          getDevicePixelRatio: () => window.devicePixelRatio,
          getStyles: () => {
            const styles = window.getComputedStyle(spectrumCanvas);
            return {
              fill: styles.color,
              grid: styles.getPropertyValue("--color-line").trim(),
              label: styles.getPropertyValue("--color-muted").trim(),
              trace: styles.color,
            };
          },
          sampleRate: resources.audioContext.sampleRate,
          ResizeObserverClass: window.ResizeObserver,
          windowTarget: window,
        });
        setSpectrumStatus("active", "Live vocal-range frequency spectrum.", true);
      } catch {
        stopSpectrum();
        setSpectrumStatus(
          "unavailable",
          "The spectrum is unavailable, but the tuner and waveform still work.",
        );
      }
      waveform.start();
      setWaveformStatus("active", "Live microphone waveform.", true);
      return true;
    } catch {
      stopWaveform();
      analyserSession?.disconnect();
      setWaveformStatus(
        "unavailable",
        "The waveform is unavailable, but microphone controls remain usable.",
      );
      return false;
    }
  };

  const syncWaveform = (microphoneState) => {
    switch (microphoneState.status) {
      case MICROPHONE_STATUS.ACTIVE:
        return startWaveform();
      case MICROPHONE_STATUS.PAUSED:
        waveform?.pause();
        setWaveformStatus("paused", "Waveform paused while this page is hidden.");
        if (spectrum) {
          setSpectrumStatus("paused", "Spectrum paused while this page is hidden.");
        }
        return waveform !== null;
      case MICROPHONE_STATUS.RESUME_REQUIRED:
        waveform?.pause();
        setWaveformStatus("paused", "Resume the microphone to continue the waveform.");
        if (spectrum) {
          setSpectrumStatus("paused", "Resume the microphone to continue the spectrum.");
        }
        return waveform !== null;
      case MICROPHONE_STATUS.REQUESTING:
        stopWaveform();
        setWaveformStatus("waiting", "Waiting for microphone permission…");
        setSpectrumStatus("waiting", "Waiting for microphone permission…");
        return false;
      default:
        stopWaveform();
        setWaveformStatus("idle", "Start the microphone to see the live signal.");
        setSpectrumStatus("idle", "Start the microphone to see harmonic energy.");
        return false;
    }
  };

  const syncTuner = (microphoneState, analysisReady) => {
    switch (microphoneState.status) {
      case MICROPHONE_STATUS.ACTIVE:
        resetPitchAnalysis(
          analysisReady
            ? "No pitch detected."
            : "Pitch analysis is unavailable, but microphone controls remain usable.",
          analysisReady ? "listening" : "unavailable",
        );
        break;
      case MICROPHONE_STATUS.PAUSED:
        resetPitchAnalysis("Pitch analysis is paused while this page is hidden.", "paused");
        break;
      case MICROPHONE_STATUS.RESUME_REQUIRED:
        resetPitchAnalysis("Resume the microphone to continue pitch analysis.", "paused");
        break;
      case MICROPHONE_STATUS.REQUESTING:
        resetPitchAnalysis("Waiting for microphone permission…", "waiting");
        break;
      case MICROPHONE_STATUS.ERROR:
        resetPitchAnalysis("Pitch is unavailable. Try the microphone again when ready.", "error");
        break;
      case MICROPHONE_STATUS.UNSUPPORTED:
        resetPitchAnalysis("Pitch analysis is unavailable in this browser or context.", "unavailable");
        break;
      case MICROPHONE_STATUS.STOPPING:
        resetPitchAnalysis("Stopping pitch analysis…", "waiting");
        break;
      default:
        resetPitchAnalysis("Start the microphone to begin tuning.", "idle");
    }
  };

  const renderMicrophone = (state) => {
    const restoreFocus = preserveControlFocus(card, [startButton, stopButton, statusText]);
    const { microphone: microphoneState } = state;
    const isBusy =
      microphoneState.status === MICROPHONE_STATUS.REQUESTING ||
      microphoneState.status === MICROPHONE_STATUS.STOPPING;
    const isActive = microphoneState.status === MICROPHONE_STATUS.ACTIVE;
    const isUnsupported = microphoneState.status === MICROPHONE_STATUS.UNSUPPORTED;
    const isPaused = microphoneState.status === MICROPHONE_STATUS.PAUSED;
    const needsResume = microphoneState.status === MICROPHONE_STATUS.RESUME_REQUIRED;

    card.dataset.status = microphoneState.status;
    statusText.textContent = microphoneState.message;
    startButton.disabled = isBusy || isActive || isUnsupported || isPaused;
    startButton.textContent = needsResume
      ? "Resume microphone"
      : microphoneState.status === MICROPHONE_STATUS.ERROR
        ? "Try microphone again"
        : "Start microphone";
    stopButton.disabled =
      !isActive &&
      !isPaused &&
      !needsResume &&
      microphoneState.status !== MICROPHONE_STATUS.REQUESTING;
    const analysisReady = syncWaveform(microphoneState);
    syncTuner(microphoneState, analysisReady);
    toneControls.render({ analysisActive: isActive && analysisReady });
    recordingControls.render();
    restoreFocus();
  };

  let renderedMicrophoneState = null;
  let renderedTargetState = null;
  let renderedVocalRange = appState.getState().vocalRange;
  appState.subscribe((state) => {
    if (state.vocalRange !== renderedVocalRange) {
      renderedVocalRange = state.vocalRange;
      rangeControls.render(state.vocalRange);
    }
    if (state.microphone !== renderedMicrophoneState) {
      renderedMicrophoneState = state.microphone;
      renderMicrophone(state);
    }
    if (state.target !== renderedTargetState) {
      renderedTargetState = state.target;
      renderTarget(state.target);
    }
    matchControls?.sync();
    livePitchScale?.sync();
    sineOverlay?.sync();
  });
  appState.setMicrophone(microphone.getState());

  const runCleanup = async (callbacks) => {
    const cleanup = createCleanupStack();
    for (const callback of callbacks) cleanup.add(callback);
    const errors = await cleanup.dispose();
    if (errors.length) throw new Error("Session cleanup was incomplete.");
  };
  sessionActions = createSessionActions({
    preferences,
    stopAudio: () => runCleanup([
      () => practiceTools.stop(),
      () => microphone.stop(),
      () => toneControls.cancel({ immediate: true }),
    ]),
    clearSession: () => runCleanup([
      () => recordingControls.clear(),
      () => targetControls.clearFeedback(),
      () => rangeControls.clearFeedback(),
      () => matchControls.reset(),
      () => pitchHistory.clear(),
      () => livePitchScale?.reset(),
      () => sineOverlay?.clear(),
      () => resetPitchAnalysis("Start the microphone to begin tuning.", "idle"),
      () => stopWaveform(),
    ]),
    setTarget: (target) => appState.setTarget(target),
    setVocalRange: (range) => appState.setVocalRange(range),
    resetToolSettings: () => practiceTools.resetSettings(),
  });
  const settingsControls = createSettingsControls({
    actions: sessionActions,
    initialStorageStatus: initialPreferences.status,
    root: app.querySelector("[data-settings-controls]"),
  });
  matchControls = createPracticeControls({
    root: app.querySelector("[data-match-controls]"),
    getContext: () => ({
      targetState: appState.getState().target,
      range: appState.getState().vocalRange,
      microphoneActive: microphone.getState().status === MICROPHONE_STATUS.ACTIVE && waveform !== null && !analysisFailed,
      busy: sessionActions.isBusy(),
    }),
    onAttemptStart: () => { smoother.reset(); resetTunerHold(); livePitchScale?.pause(); sineOverlay?.clear(); },
    onTargetChange: () => renderTarget(appState.getState().target),
  });

  try {
    livePitchScale = createLivePitchScaleControls({
      root: app.querySelector("[data-live-pitch-scale]"),
      getContext: () => ({ ...currentTargetOptions(), ...matchControls.getFeedbackContext() }),
    });
  } catch {
    app.querySelector("[data-live-status]").textContent = "Live pitch scale is unavailable.";
  }

  if (targetWave !== inactiveTargetWave) {
    sineOverlay = createSineOverlayControls({
      root: targetWaveCard,
      renderer: {
        setTarget: (target) => targetWave.setTarget(target),
        setDetectedFrequency: (frequency) => targetWave.setDetectedFrequency(frequency),
      },
      getContext: () => ({ ...currentTargetOptions(), ...matchControls.getFeedbackContext() }),
    });
  }

  startButton.addEventListener("click", () => {
    if (sessionActions.isBusy()) return;
    if (microphone.getState().status === MICROPHONE_STATUS.RESUME_REQUIRED) {
      void microphone.setPageVisible(true);
    } else {
      void microphone.start();
    }
  });
  stopButton.addEventListener("click", () => {
    toneControls.cancel();
    recordingControls.stop();
    void microphone.stop();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetTunerHold();
    if (document.hidden) livePitchScale?.pause();
    if (document.hidden) sineOverlay?.clear();
    void microphone.setPageVisible(!document.hidden);
  });
  window.addEventListener("pagehide", () => {
    resetTunerHold();
    toneControls.cancel({ immediate: true });
    void microphone.stop();
    recordingControls.clear();
    matchControls.reset();
    livePitchScale?.reset();
    sineOverlay?.clear();
  });

  createCollapsibleCards({ root: app, onCollapse: (card) => toneControls.cancelWithin(card) });
  createAccessibleSummaries({ root: app });
  app.dataset.appReady = "true";
}
