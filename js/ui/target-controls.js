import { NOTE_NAMES } from "../music/notes.js";
import {
  A4_SOURCE,
  TARGET_SOURCE,
  formatTargetFrequency,
  getActiveTarget,
  resolveTargetFrequencyBounds,
  setA4Reference,
  setExactTargetFrequency,
  setTargetMode,
  setTargetNote,
} from "../practice/target-note.js";
import {
  COMMON_A4_REFERENCES,
  MAX_A4_HZ,
  MIN_A4_HZ,
} from "../music/tuning.js";

const REQUIRED_SELECTORS = Object.freeze({
  a4Custom: "[data-a4-custom]",
  a4Reference: "[data-a4-reference]",
  error: "[data-target-error]",
  exactFrequency: "[data-target-frequency]",
  helpButton: "[data-frequency-help-button]",
  helpPanel: "[data-frequency-help]",
  note: "[data-target-note-select]",
  octave: "[data-target-octave]",
  source: "[data-target-source]",
  summary: "[data-target-summary]",
});

function formatInputNumber(value) {
  return String(Number(value.toFixed(4)));
}

function formatNearestCents(cents) {
  const rounded = Math.round(cents);
  if (rounded === 0) {
    return "centered";
  }
  return `${Math.abs(rounded)} ${Math.abs(rounded) === 1 ? "cent" : "cents"} ${
    rounded < 0 ? "flat" : "sharp"
  }`;
}

function setText(element, text) {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

export function createFrequencyHelpController({ button, panel }) {
  if (!button || typeof button.addEventListener !== "function" || !panel) {
    throw new TypeError("Frequency-help button and panel are required.");
  }

  const setOpen = (open) => {
    const isOpen = Boolean(open);
    button.setAttribute("aria-expanded", String(isOpen));
    panel.hidden = !isOpen;
    return isOpen;
  };
  const toggle = () => setOpen(panel.hidden);
  const onKeyDown = (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      setOpen(false);
      button.focus();
    }
  };

  button.addEventListener("click", toggle);
  button.addEventListener("keydown", onKeyDown);
  panel.addEventListener("keydown", onKeyDown);
  setOpen(false);

  return Object.freeze({
    close() {
      return setOpen(false);
    },
    destroy() {
      button.removeEventListener("click", toggle);
      button.removeEventListener("keydown", onKeyDown);
      panel.removeEventListener("keydown", onKeyDown);
    },
    isOpen() {
      return !panel.hidden;
    },
  });
}

export function createTargetControls({ getState, onChange, root }) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("A target-controls root is required.");
  }
  if (typeof getState !== "function" || typeof onChange !== "function") {
    throw new TypeError("Target-controls state callbacks are required.");
  }

  const elements = {};
  for (const [name, selector] of Object.entries(REQUIRED_SELECTORS)) {
    const element = root.querySelector(selector);
    if (!element) {
      throw new Error(`Missing target-controls element: ${selector}`);
    }
    elements[name] = element;
  }

  const help = createFrequencyHelpController({
    button: elements.helpButton,
    panel: elements.helpPanel,
  });
  const listeners = [];

  const listen = (element, type, callback) => {
    element.addEventListener(type, callback);
    listeners.push([element, type, callback]);
  };

  const apply = (control, update) => {
    control.setCustomValidity("");
    try {
      const nextState = update(getState());
      setText(elements.error, "");
      onChange(nextState);
    } catch (error) {
      const message = error instanceof Error ? error.message : "That target value is invalid.";
      control.setCustomValidity(message);
      setText(elements.error, message);
      control.reportValidity();
      render(getState());
    }
  };

  listen(elements.source, "change", () => {
    apply(elements.source, (state) => setTargetMode(state, elements.source.value));
  });
  listen(elements.note, "change", () => {
    apply(elements.note, (state) =>
      setTargetNote(state, elements.note.value, Number(elements.octave.value))
    );
  });
  listen(elements.octave, "change", () => {
    apply(elements.octave, (state) =>
      setTargetNote(state, elements.note.value, Number(elements.octave.value))
    );
  });
  listen(elements.exactFrequency, "change", () => {
    apply(elements.exactFrequency, (state) =>
      setExactTargetFrequency(state, Number(elements.exactFrequency.value))
    );
  });
  listen(elements.a4Reference, "change", () => {
    if (elements.a4Reference.value === A4_SOURCE.CUSTOM) {
      apply(elements.a4Custom, (state) =>
        setA4Reference(state, Number(elements.a4Custom.value), A4_SOURCE.CUSTOM)
      );
      return;
    }
    apply(elements.a4Reference, (state) =>
      setA4Reference(state, Number(elements.a4Reference.value), A4_SOURCE.PRESET)
    );
  });
  listen(elements.a4Custom, "change", () => {
    apply(elements.a4Custom, (state) =>
      setA4Reference(state, Number(elements.a4Custom.value), A4_SOURCE.CUSTOM)
    );
  });

  function render(state) {
    const activeTarget = getActiveTarget(state);
    const mode = state.active ? state.source : "none";
    const noteMode = mode === TARGET_SOURCE.NOTE;
    const exactMode = mode === TARGET_SOURCE.EXACT_HZ;
    const customA4 = state.a4Source === A4_SOURCE.CUSTOM;
    const bounds = resolveTargetFrequencyBounds(state.sampleRate);

    elements.source.value = mode;
    elements.note.value = state.pitchClass;
    elements.octave.value = String(state.octave);
    elements.exactFrequency.value = formatInputNumber(state.exactFrequencyHz);
    elements.exactFrequency.min = String(bounds.minimumHz);
    elements.exactFrequency.max = String(bounds.maximumHz);
    elements.note.disabled = !noteMode;
    elements.octave.disabled = !noteMode;
    elements.exactFrequency.disabled = !exactMode;
    elements.a4Reference.value = customA4 ? A4_SOURCE.CUSTOM : String(state.a4Hz);
    elements.a4Custom.value = formatInputNumber(state.a4Hz);
    elements.a4Custom.disabled = !customA4;
    elements.a4Custom.min = String(MIN_A4_HZ);
    elements.a4Custom.max = String(MAX_A4_HZ);

    let summary = "No target selected. Detected pitch is compared with its nearest note.";
    if (activeTarget?.source === TARGET_SOURCE.NOTE) {
      summary = `${activeTarget.label} at ${formatTargetFrequency(activeTarget.frequencyHz)} with A4 = ${state.a4Hz} Hz.`;
    } else if (activeTarget) {
      summary = `${formatTargetFrequency(activeTarget.frequencyHz)} exact target. Nearest note: ${activeTarget.nearestNote} (${formatNearestCents(activeTarget.nearestNoteCents)} at A4 = ${state.a4Hz} Hz).`;
    }
    setText(elements.summary, summary);
    return state;
  }

  for (const pitchClass of NOTE_NAMES) {
    if (![...elements.note.options].some((option) => option.value === pitchClass)) {
      throw new Error(`Missing target note option: ${pitchClass}`);
    }
  }
  for (const reference of COMMON_A4_REFERENCES) {
    if (![...elements.a4Reference.options].some((option) => option.value === String(reference))) {
      throw new Error(`Missing A4 reference option: ${reference}`);
    }
  }

  render(getState());

  return Object.freeze({
    destroy() {
      help.destroy();
      for (const [element, type, callback] of listeners) {
        element.removeEventListener(type, callback);
      }
    },
    clearFeedback() {
      help.close();
      for (const element of Object.values(elements)) element.setCustomValidity?.("");
      setText(elements.error, "");
    },
    render,
  });
}
