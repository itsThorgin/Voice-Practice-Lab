import { PITCH_HISTORY_DEFAULTS } from "../config.js";
import { midiToNote, MIDI_MAX, MIDI_MIN } from "../music/notes.js";
import {
  centsDeviation,
  DEFAULT_A4_HZ,
  frequencyToMidi,
  validateA4,
} from "../music/tuning.js";
import { createRingBuffer } from "../util/ring-buffer.js";
import { resizeCanvas } from "./canvas.js";

const HISTORY_MODE = Object.freeze({
  NOTE_SPACE: "note-space",
  TARGET_RELATIVE: "target-relative",
});

function validateFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
}

function validatePositiveFinite(value, label) {
  validateFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
}

function validateConfidence(confidence) {
  validateFinite(confidence, "Pitch confidence");
  if (confidence < 0 || confidence > 1) {
    throw new RangeError("Pitch confidence must be from zero to one.");
  }
}

function validateTimestamp(timestampMs, previousTimestampMs = null) {
  validateFinite(timestampMs, "Pitch-history timestamp");
  if (timestampMs < 0) {
    throw new RangeError("Pitch-history timestamp must not be negative.");
  }
  if (previousTimestampMs !== null && timestampMs < previousTimestampMs) {
    throw new RangeError("Pitch-history timestamps must not move backward.");
  }
}

function resolveOptions(options = {}) {
  const resolved = { ...PITCH_HISTORY_DEFAULTS, ...options };
  validatePositiveFinite(resolved.durationMs, "Pitch-history duration");
  validatePositiveFinite(resolved.gapThresholdMs, "Pitch-history gap threshold");
  validatePositiveFinite(
    resolved.minimumNoteSpanSemitones,
    "Minimum note-space span",
  );
  validatePositiveFinite(resolved.targetRangeCents, "Target-relative range");
  if (!Number.isInteger(resolved.maximumSamples) || resolved.maximumSamples < 2) {
    throw new RangeError("Maximum pitch-history samples must be an integer of at least two.");
  }
  if (resolved.gapThresholdMs > resolved.durationMs) {
    throw new RangeError("Pitch-history gap threshold must not exceed its duration.");
  }
  return Object.freeze(resolved);
}

function validateTargetFrequency(targetFrequencyHz) {
  if (targetFrequencyHz === null) {
    return null;
  }
  validatePositiveFinite(targetFrequencyHz, "Pitch-history target frequency");
  return targetFrequencyHz;
}

function readFrame(frame) {
  if (!frame || typeof frame !== "object") {
    throw new TypeError("Pitch-history frame must be an object.");
  }
  if (typeof frame.voiced !== "boolean") {
    throw new TypeError("Pitch-history frame voiced state must be boolean.");
  }
  validateConfidence(frame.confidence);
  if (frame.voiced) {
    validatePositiveFinite(frame.frequencyHz, "Pitch-history frequency");
  }
  return frame;
}

function createEntry(frame, timestampMs, a4Hz, targetFrequencyHz) {
  if (!frame.voiced) {
    return Object.freeze({
      confidence: frame.confidence,
      frequencyHz: null,
      midiPosition: null,
      targetRelativeCents: null,
      timestampMs,
      voiced: false,
    });
  }
  return Object.freeze({
    confidence: frame.confidence,
    frequencyHz: frame.frequencyHz,
    midiPosition: frequencyToMidi(frame.frequencyHz, a4Hz),
    targetRelativeCents:
      targetFrequencyHz === null
        ? null
        : centsDeviation(frame.frequencyHz, targetFrequencyHz),
    timestampMs,
    voiced: true,
  });
}

export function createPitchHistory(options = {}) {
  const resolved = resolveOptions(options);
  const a4Hz = validateA4(options.a4Hz ?? DEFAULT_A4_HZ);
  const buffer = createRingBuffer(resolved.maximumSamples);
  let lastTimestampMs = null;
  let targetFrequencyHz = validateTargetFrequency(options.targetFrequencyHz ?? null);

  const currentMode = () => targetFrequencyHz === null
    ? HISTORY_MODE.NOTE_SPACE
    : HISTORY_MODE.TARGET_RELATIVE;

  const evictExpired = (timestampMs) => {
    const earliestTimestampMs = timestampMs - resolved.durationMs;
    return buffer.evictWhile((entry) => entry.timestampMs < earliestTimestampMs);
  };

  return Object.freeze({
    append(frame, timestampMs) {
      const validatedFrame = readFrame(frame);
      validateTimestamp(timestampMs, lastTimestampMs);
      const entry = createEntry(validatedFrame, timestampMs, a4Hz, targetFrequencyHz);
      buffer.push(entry);
      lastTimestampMs = timestampMs;
      evictExpired(timestampMs);
      return entry;
    },

    clear() {
      buffer.clear();
      lastTimestampMs = null;
    },

    getEntries() {
      return Object.freeze(buffer.toArray());
    },

    getLatestTimestampMs() {
      return lastTimestampMs;
    },

    getMode() {
      return currentMode();
    },

    get size() {
      return buffer.size;
    },

    setTargetFrequency(nextTargetFrequencyHz) {
      const validatedTarget = validateTargetFrequency(nextTargetFrequencyHz);
      if (validatedTarget === targetFrequencyHz) {
        return currentMode();
      }
      targetFrequencyHz = validatedTarget;
      const entries = buffer.toArray();
      buffer.clear();
      for (const entry of entries) {
        buffer.push(
          createEntry(
            {
              confidence: entry.confidence,
              frequencyHz: entry.frequencyHz,
              voiced: entry.voiced,
            },
            entry.timestampMs,
            a4Hz,
            targetFrequencyHz,
          ),
        );
      }
      return currentMode();
    },
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resolveNoteRange(entries, minimumSpan) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.voiced && Number.isFinite(entry.midiPosition)) {
      minimum = Math.min(minimum, entry.midiPosition);
      maximum = Math.max(maximum, entry.midiPosition);
    }
  }
  if (!Number.isFinite(minimum)) {
    minimum = 69;
    maximum = 69;
  }
  const center = (minimum + maximum) / 2;
  const span = Math.max(minimumSpan, maximum - minimum + 1);
  return Object.freeze({ maximum: center + span / 2, minimum: center - span / 2 });
}

function noteLabel(midi) {
  return midi >= MIDI_MIN && midi <= MIDI_MAX ? midiToNote(midi) : "";
}

export function buildPitchHistoryPlot(entries, {
  durationMs = PITCH_HISTORY_DEFAULTS.durationMs,
  gapThresholdMs = PITCH_HISTORY_DEFAULTS.gapThresholdMs,
  height,
  latestTimestampMs,
  minimumNoteSpanSemitones = PITCH_HISTORY_DEFAULTS.minimumNoteSpanSemitones,
  mode = HISTORY_MODE.NOTE_SPACE,
  targetRangeCents = PITCH_HISTORY_DEFAULTS.targetRangeCents,
  width,
} = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError("Pitch-history entries must be an array.");
  }
  const resolved = resolveOptions({
    durationMs,
    gapThresholdMs,
    minimumNoteSpanSemitones,
    targetRangeCents,
  });
  validatePositiveFinite(width, "Pitch-history plot width");
  validatePositiveFinite(height, "Pitch-history plot height");
  validateTimestamp(latestTimestampMs);
  if (!Object.values(HISTORY_MODE).includes(mode)) {
    throw new RangeError("Pitch-history mode must be note-space or target-relative.");
  }

  const left = width < 360 ? 38 : 48;
  const right = 8;
  const top = 10;
  const bottom = 22;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const earliestTimestampMs = latestTimestampMs - resolved.durationMs;
  const noteRange = resolveNoteRange(entries, resolved.minimumNoteSpanSemitones);
  const gridLines = [];

  const yForValue = (value) => {
    if (mode === HISTORY_MODE.TARGET_RELATIVE) {
      const normalized = clamp(value, -resolved.targetRangeCents, resolved.targetRangeCents);
      return top + ((resolved.targetRangeCents - normalized) / (2 * resolved.targetRangeCents)) * plotHeight;
    }
    const normalized = clamp(value, noteRange.minimum, noteRange.maximum);
    return top + ((noteRange.maximum - normalized) / (noteRange.maximum - noteRange.minimum)) * plotHeight;
  };

  if (mode === HISTORY_MODE.TARGET_RELATIVE) {
    for (const value of [resolved.targetRangeCents, 0, -resolved.targetRangeCents]) {
      gridLines.push(Object.freeze({
        label: value === 0 ? "0¢" : `${value > 0 ? "+" : "−"}${Math.abs(value)}¢`,
        value,
        y: yForValue(value),
      }));
    }
  } else {
    const firstMidi = Math.ceil(noteRange.minimum);
    const lastMidi = Math.floor(noteRange.maximum);
    for (let midi = firstMidi; midi <= lastMidi; midi += 1) {
      gridLines.push(Object.freeze({ label: noteLabel(midi), value: midi, y: yForValue(midi) }));
    }
  }

  const segments = [];
  let segment = [];
  let previousVoicedTimestampMs = null;
  for (const entry of entries) {
    if (entry.timestampMs < earliestTimestampMs || entry.timestampMs > latestTimestampMs) {
      continue;
    }
    const plotValue =
      mode === HISTORY_MODE.TARGET_RELATIVE
        ? entry.targetRelativeCents
        : entry.midiPosition;
    if (!entry.voiced || !Number.isFinite(plotValue)) {
      if (segment.length > 0) {
        segments.push(Object.freeze(segment));
        segment = [];
      }
      previousVoicedTimestampMs = null;
      continue;
    }
    if (
      previousVoicedTimestampMs !== null &&
      entry.timestampMs - previousVoicedTimestampMs > resolved.gapThresholdMs
    ) {
      if (segment.length > 0) {
        segments.push(Object.freeze(segment));
      }
      segment = [];
    }
    const x = left + ((entry.timestampMs - earliestTimestampMs) / resolved.durationMs) * plotWidth;
    segment.push(Object.freeze({
      confidence: entry.confidence,
      outOfRange:
        mode === HISTORY_MODE.TARGET_RELATIVE &&
        Math.abs(plotValue) > resolved.targetRangeCents,
      timestampMs: entry.timestampMs,
      value: plotValue,
      x,
      y: yForValue(plotValue),
    }));
    previousVoicedTimestampMs = entry.timestampMs;
  }
  if (segment.length > 0) {
    segments.push(Object.freeze(segment));
  }

  return Object.freeze({
    bounds: Object.freeze({ bottom, left, plotHeight, plotWidth, right, top }),
    earliestTimestampMs,
    gridLines: Object.freeze(gridLines),
    latestTimestampMs,
    mode,
    noteRange,
    segments: Object.freeze(segments),
  });
}

export function drawPitchHistory(context, plot, styles = {}) {
  if (!context || typeof context.clearRect !== "function") {
    throw new TypeError("A 2D context is required to draw pitch history.");
  }
  if (!plot || typeof plot !== "object") {
    throw new TypeError("A pitch-history plot is required.");
  }
  const width = plot.bounds.left + plot.bounds.plotWidth + plot.bounds.right;
  const height = plot.bounds.top + plot.bounds.plotHeight + plot.bounds.bottom;
  const gridStyle = styles.grid ?? "#ccd1ca";
  const labelStyle = styles.label ?? "#59645f";
  const traceStyle = styles.trace ?? "#87321f";

  context.clearRect(0, 0, width, height);
  context.save?.();
  context.font = "11px ui-sans-serif, system-ui, sans-serif";
  context.textBaseline = "middle";
  context.fillStyle = labelStyle;
  context.strokeStyle = gridStyle;
  context.lineWidth = 1;
  context.setLineDash?.([3, 4]);
  for (const line of plot.gridLines) {
    context.beginPath();
    context.moveTo(plot.bounds.left, line.y);
    context.lineTo(plot.bounds.left + plot.bounds.plotWidth, line.y);
    context.stroke();
    if (line.label) {
      context.fillText?.(line.label, 2, line.y);
    }
  }

  context.setLineDash?.([]);
  context.strokeStyle = traceStyle;
  context.fillStyle = traceStyle;
  context.lineWidth = 2.5;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const segment of plot.segments) {
    context.beginPath();
    if (segment.length === 1 && typeof context.arc === "function") {
      context.arc(segment[0].x, segment[0].y, 2.25, 0, Math.PI * 2);
      context.fill?.();
      continue;
    }
    context.moveTo(segment[0].x, segment[0].y);
    for (let index = 1; index < segment.length; index += 1) {
      context.lineTo(segment[index].x, segment[index].y);
    }
    context.stroke();
  }
  context.restore?.();
  return plot;
}

function defaultStyles() {
  return Object.freeze({ grid: "#ccd1ca", label: "#59645f", trace: "#87321f" });
}

export function createPitchHistoryRenderer({
  canvas,
  emptyState,
  getDevicePixelRatio = () => 1,
  getStyles = defaultStyles,
  historyOptions,
  modeLabel,
  resetButton,
  ResizeObserverClass,
  windowTarget,
} = {}) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("A canvas is required for pitch-history rendering.");
  }
  if (!resetButton || typeof resetButton.addEventListener !== "function") {
    throw new TypeError("A pitch-history reset button is required.");
  }
  if (!emptyState || !modeLabel) {
    throw new TypeError("Pitch-history status elements are required.");
  }
  if (typeof getDevicePixelRatio !== "function" || typeof getStyles !== "function") {
    throw new TypeError("Pitch-history style and pixel-ratio readers must be functions.");
  }
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("A 2D canvas context is unavailable for pitch history.");
  }

  const resolved = resolveOptions(historyOptions);
  const history = createPitchHistory({ ...resolved, ...historyOptions });
  let destroyed = false;
  let size = null;
  let resizeObserver = null;
  let removeWindowResize = null;

  const updateLabels = (entries) => {
    const targetMode = history.getMode() === HISTORY_MODE.TARGET_RELATIVE;
    modeLabel.textContent = targetMode ? "Target-relative cents" : "Note space";
    canvas.dataset.mode = history.getMode();
    const hasVoiced = entries.some((entry) => entry.voiced);
    emptyState.hidden = hasVoiced;
    emptyState.textContent = entries.length === 0
      ? "No pitch history yet."
      : "Listening for a reliable pitch. Silence appears as a gap.";
    const voiced = entries.filter((entry) => entry.voiced);
    const frequencies = voiced.map((entry) => entry.frequencyHz);
    const summary = voiced.length
      ? `Pitch history, last eight seconds. ${Math.round(Math.min(...frequencies))} to ${Math.round(Math.max(...frequencies))} Hz. ${entries.some((entry) => !entry.voiced) ? "Includes gaps in reliable pitch." : "No recorded gaps."} ${targetMode ? "Target-relative cents." : "Note space."}`
      : `Pitch history. ${emptyState.textContent}`;
    canvas.setAttribute?.("aria-label", summary);
  };

  const render = () => {
    if (destroyed) {
      return null;
    }
    const entries = history.getEntries();
    updateLabels(entries);
    const currentSize = size ?? resizeCanvas(canvas, context, getDevicePixelRatio());
    size = currentSize;
    const plot = buildPitchHistoryPlot(entries, {
      ...resolved,
      height: currentSize.cssHeight,
      latestTimestampMs: history.getLatestTimestampMs() ?? 0,
      mode: history.getMode(),
      width: currentSize.cssWidth,
    });
    return drawPitchHistory(context, plot, getStyles());
  };

  const resize = () => {
    if (destroyed) {
      return null;
    }
    size = resizeCanvas(canvas, context, getDevicePixelRatio());
    return render();
  };

  const clear = () => {
    history.clear();
    return render();
  };

  const handleReset = () => clear();
  resetButton.addEventListener("click", handleReset);
  if (typeof ResizeObserverClass === "function") {
    resizeObserver = new ResizeObserverClass(resize);
    resizeObserver.observe(canvas);
  }
  if (windowTarget?.addEventListener) {
    windowTarget.addEventListener("resize", resize);
    removeWindowResize = () => windowTarget.removeEventListener("resize", resize);
  }
  resize();

  return Object.freeze({
    addGap(timestampMs, confidence = 0) {
      history.append({ confidence, voiced: false }, timestampMs);
      return render();
    },

    append(frame, timestampMs) {
      history.append(frame, timestampMs);
      return render();
    },

    clear,

    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      resetButton.removeEventListener?.("click", handleReset);
      resizeObserver?.disconnect();
      removeWindowResize?.();
      context.clearRect(0, 0, size?.cssWidth ?? 1, size?.cssHeight ?? 1);
    },

    getEntries: history.getEntries,
    getMode: history.getMode,
    render,
    resize,

    setTargetFrequency(targetFrequencyHz) {
      history.setTargetFrequency(targetFrequencyHz);
      return render();
    },
  });
}

export { HISTORY_MODE };
